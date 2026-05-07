/**
 * B2 / D23 / D25 / D35 — operator-led tenant creation.
 *
 * One Postgres transaction:
 *   1. INSERT organization (direct Drizzle — Better Auth `organization.create`
 *      is unconditionally rejected per D35; see apps/auth/src/disable-org-create.ts).
 *   2. INSERT invitation row (BA org-plugin schema; D23 — no separate
 *      invitations table).
 *   3. CRITICAL dual-scope audit `tenant.created` (D25 — global-scope row for
 *      the operator feed plus tenant-scope row for the tenant audit log).
 *
 * Any failure rolls back the org row so the system never persists a tenant
 * without an outstanding admin invitation.
 *
 * The `forceInvitationId` knob is for tests that want to inject a duplicate id
 * to simulate a unique-constraint violation on the invitation insert.
 */
import type { DrizzleClient, Executor } from "@repo/db";
import { generatePrefixedCuid, ID_PREFIXES } from "@repo/db";
import { invitations, organizations, reservedSlugs } from "@repo/db/schema";
import { AUDIT_EVENTS } from "@repo/shared/audit";
import { and, eq } from "drizzle-orm";
import { auditLogService } from "@/modules/audit-logs/service";
import {
  isPgUniqueViolation,
  SlugReservedError,
  SlugTakenError,
} from "./errors";

const ORGANIZATION_SLUG_UNIQUE_CONSTRAINT = "organization_slug_key";

export type CreateTenantPayload = Readonly<{
  slug: string;
  name: string;
  primaryAdminEmail: string;
}>;

export type CreateTenantResult = Readonly<{
  orgId: string;
  invitationId: string;
}>;

/**
 * Post-commit invitation email dispatch hook. Called once the tx commits
 * with the invitation id and the resolved primary-admin email so the caller
 * (TenantOperations) can fan out to the shared `TenantInviteEmail` template
 * via Resend (see apps/auth/src/instance.ts for the BA-side equivalent).
 *
 * The hook receives the slug + tenant name + expiry hours so it has every
 * field it needs to build the acceptUrl + render the email without the
 * lib having to know about wildcard suffixes or transport config.
 */
export type SendInviteEmailHook = (input: {
  invitationId: string;
  organizationId: string;
  slug: string;
  organizationName: string;
  email: string;
  expiresInHours: number;
}) => Promise<void> | void;

/**
 * Actor variant accepted by the lib. C5 layers the richer `TenantOperator`
 * union on top via `services/tenant-operations`; this lib only needs the
 * narrow audit-actor subset.
 */
export type CreateTenantActor =
  | Readonly<{ kind: "global_admin"; globalAdminId: string }>
  | Readonly<{ kind: "system"; reason: string }>;

export type CreateTenantContext = Readonly<{
  /**
   * C5 / D67 actor variant. Required — the legacy `operatorId?: string`
   * path was retired in C6 once every caller routed through
   * `TenantOperations.create` (which always supplies an explicit actor).
   */
  actor: CreateTenantActor;
  db: Pick<DrizzleClient, "transaction">;
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * Test-only: force a specific invitation id (e.g. to assert rollback when
   * the row collides with a pre-seeded `inv_dup`). Production callers omit it.
   */
  forceInvitationId?: string;
  /**
   * Optional invitation TTL override (ms). Defaults to 48h.
   */
  invitationTtlMs?: number;
  ipAddress?: string;
  userAgent?: string;
  /**
   * Optional post-commit invite email dispatcher. When supplied, the lib
   * fires it AFTER the transaction commits so a transport failure cannot
   * roll back the tenant row. `ctx.waitUntil` is used when provided to
   * defer the work past the response flush.
   */
  sendInviteEmail?: SendInviteEmailHook;
}>;

const DEFAULT_INVITATION_TTL_MS = 48 * 60 * 60 * 1000;
// BA organization plugin uses "owner" as the primary tenant admin role.
const PRIMARY_ADMIN_ROLE = "owner";

export async function createTenantOnBehalfOf(
  ctx: CreateTenantContext,
  payload: CreateTenantPayload
): Promise<CreateTenantResult> {
  const email = payload.primaryAdminEmail.toLowerCase().trim();
  const ttl = ctx.invitationTtlMs ?? DEFAULT_INVITATION_TTL_MS;
  const { actor } = ctx;

  const result = await ctx.db.transaction(async (tx: Executor) => {
    // Reserved-slugs gate (D16) — the operator UI's Zod schema rejects a
    // hand-coded list, but the DB-backed reservation table is the source of
    // truth (e.g. tombstones from deleted tenants, manually reserved slugs).
    // Run the guard inside the transaction so a concurrent reserved-slug
    // insert can't race past us.
    const reservedRow = await tx
      .select({ slug: reservedSlugs.slug })
      .from(reservedSlugs)
      .where(
        and(
          eq(reservedSlugs.slug, payload.slug),
          eq(reservedSlugs.kind, "slug")
        )
      )
      .limit(1);
    if (reservedRow.length > 0) {
      throw new SlugReservedError(payload.slug);
    }

    const orgId = generatePrefixedCuid(ID_PREFIXES.organization);
    try {
      await tx.insert(organizations).values({
        id: orgId,
        slug: payload.slug,
        name: payload.name,
      });
    } catch (err) {
      // Map Postgres unique-violation on the slug column to a typed conflict.
      // We narrow on constraint name when the driver populates it, but fall
      // back to bare SQLSTATE 23505 because only the slug column is unique
      // on this insert (id is generated and statistically unique).
      if (
        isPgUniqueViolation(err, ORGANIZATION_SLUG_UNIQUE_CONSTRAINT) ||
        isPgUniqueViolation(err)
      ) {
        throw new SlugTakenError(payload.slug);
      }
      throw err;
    }

    const invitationId =
      ctx.forceInvitationId ?? generatePrefixedCuid(ID_PREFIXES.invitation);
    await tx.insert(invitations).values({
      id: invitationId,
      email,
      inviterId: null,
      organizationId: orgId,
      role: PRIMARY_ADMIN_ROLE,
      status: "pending",
      expiresAt: new Date(Date.now() + ttl),
    });

    await auditLogService.createDualScope(
      {
        event: AUDIT_EVENTS.TENANT.CREATED.event,
        ...(actor.kind === "global_admin"
          ? { actorType: "global_admin", actorId: actor.globalAdminId }
          : { actorType: "system" }),
        targetType: "tenant",
        targetId: orgId,
        organizationId: orgId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          slug: payload.slug,
          primaryAdminEmail: email,
          ...(actor.kind === "system" ? { systemReason: actor.reason } : {}),
        },
      },
      tx
    );

    return { orgId, invitationId };
  });

  // Post-commit invite email dispatch (B2 / D60). The transaction has
  // committed at this point, so transport failure does not roll back the
  // tenant. We schedule via ctx.waitUntil when available so the response
  // can flush before the cross-network email send completes.
  if (ctx.sendInviteEmail) {
    const expiresInHours = Math.max(1, Math.round(ttl / (60 * 60 * 1000)));
    const dispatch = Promise.resolve(
      ctx.sendInviteEmail({
        invitationId: result.invitationId,
        organizationId: result.orgId,
        slug: payload.slug,
        organizationName: payload.name,
        email,
        expiresInHours,
      })
    );
    if (ctx.waitUntil) {
      ctx.waitUntil(dispatch);
    } else {
      // Best-effort fire-and-forget when no execution context is available
      // (e.g. test harness or non-Worker caller). Swallow rejection so the
      // caller's success result is unaffected.
      dispatch.catch(() => undefined);
    }
  }

  return result;
}
