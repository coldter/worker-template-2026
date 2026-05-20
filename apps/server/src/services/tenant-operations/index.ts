/**
 * C5 — `TenantOperations` deeper service (D54).
 *
 * Single owner of tenant CRUD: create / suspend / restore / delete (rename
 * is intentionally a stub per D66; reintroducing it requires coordinating
 * with each tenant's IdP-registered SSO callbacks).
 *
 * Each method is a thin wrapper onto the proven Phase A / Phase B helpers:
 *
 *   - `create`  -> `createTenantOnBehalfOf` (B2 + B2 polish)
 *   - `suspend` -> in-class implementation (collapsed from the A6.6
 *                  `suspendTenant` helper in C6).
 *   - `restore` -> in-class implementation (collapsed from the A6.7
 *                  `restoreTenant` helper in C6).
 *   - `delete`  -> in-class implementation: soft-delete + tombstone
 *                  the slug into `reserved_slugs`, revoke sessions, audit.
 *
 * The four-piece coordination per spec is:
 *   1. DB writes inside a single Postgres transaction.
 *   2. Dual-scope CRITICAL audit (D25) inside the same transaction.
 *   3. Session DELETE + `session_version` bump for revocation (D34).
 *   4. POST-COMMIT cache invalidation via `ctx.waitUntil` so the response
 *      can flush before the cross-worker fan-out completes.
 *
 * Atomicity invariant: if any in-tx step throws, the transaction rolls
 * back and the post-commit invalidation is NEVER scheduled — peer caches
 * stay consistent with the durable database state.
 *
 * Per D77 there is no self-serve surface; only the operator (apps/admin)
 * and the cron / workflow runtime instantiate this service.
 */
import type { DrizzleClient, Transaction } from "@repo/db";
import { firstOrNull } from "@repo/db";
import { organizations, reservedSlugs, sessions } from "@repo/db/schema";
import { AUDIT_EVENTS } from "@repo/shared/audit";
import { logger } from "@repo/shared/logger";
import type { FanOutInvalidator } from "@repo/tenancy";
import { eq, sql } from "drizzle-orm";
import {
  type CreateTenantPayload,
  type CreateTenantResult,
  createTenantOnBehalfOf,
  type SendInviteEmailHook,
} from "@/lib/tenants/create-tenant";
import { auditLogService } from "@/modules/audit-logs/service";
import type { CriticalAuditLogInput } from "@/modules/audit-logs/types";
import type { TenantOperator } from "./types";

export type {
  GlobalAdminActor,
  SystemActor,
  TenantOperator,
} from "./types";

// Own enumerable `code`/`organizationId` so the error survives Workers RPC
// serialization on the apps/server <-> apps/admin service binding; admin maps
// `TENANT_NOT_FOUND` to 404 without string-matching the message.
export class OrganizationNotFoundError extends Error {
  readonly code = "TENANT_NOT_FOUND" as const;
  readonly organizationId: string;
  constructor(organizationId: string) {
    super(`Organization not found: ${organizationId}`);
    this.name = "OrganizationNotFoundError";
    this.organizationId = organizationId;
  }
}

type TenantOpsDb = Pick<DrizzleClient, "transaction">;

/**
 * Minimal `ctx` surface the service needs. We accept any object shaped like
 * `{ waitUntil(p): void }` so both `WorkerEntrypoint.ctx` (production) and a
 * `vi.fn()`-backed stub (tests) satisfy the type.
 */
type WaitUntilCtx = { waitUntil(promise: Promise<unknown>): void };

export type TenantOperationsDeps = Readonly<{
  db: TenantOpsDb;
  invalidator: FanOutInvalidator;
  ctx: WaitUntilCtx;
  /**
   * Optional invite email dispatcher. The B2 operator-led tenant create
   * flow fires this post-commit so the primary admin receives the same
   * `TenantInviteEmail` template the BA org-plugin sends for tenant-admin
   * led member invites. Tests omit it; production wiring (in the API
   * entrypoint) injects a Resend-backed implementation.
   */
  sendInviteEmail?: SendInviteEmailHook;
}>;

export type SuspendInput = Readonly<{
  organizationId: string;
  reason?: string;
}>;

export type RestoreInput = Readonly<{
  organizationId: string;
}>;

export type DeleteInput = Readonly<{
  organizationId: string;
  reason?: string;
}>;

export type SuspensionResult = Readonly<{
  changed: boolean;
  organizationId: string;
}>;

export type DeleteResult = Readonly<{
  organizationId: string;
}>;

const RENAME_DEFERRED_MESSAGE =
  "rename deferred to v2 (D66) — coordinate with tenant on IdP-registered SSO callbacks before reintroducing";

function actorAuditFields(
  by: TenantOperator
): Pick<
  CriticalAuditLogInput,
  "actorId" | "actorType" | "ipAddress" | "userAgent"
> {
  if (by.kind === "global_admin") {
    return {
      actorId: by.admin.id,
      actorType: "global_admin",
      ipAddress: by.ipAddress,
      userAgent: by.userAgent,
    };
  }
  return { actorType: "system" };
}

export class TenantOperations {
  private readonly deps: TenantOperationsDeps;

  constructor(deps: TenantOperationsDeps) {
    this.deps = deps;
  }

  /**
   * Operator-led tenant creation (D35). Wraps `createTenantOnBehalfOf` so
   * the proven B2 transactional flow keeps guarding the org + invitation
   * + dual-scope audit insert sequence.
   *
   * No cache invalidation runs on create: the new tenant has nothing
   * cached yet by definition. The `hostedAt` URL is the resolved
   * subdomain origin so the operator UI can deep-link the new tenant.
   */
  async create(
    payload: CreateTenantPayload,
    by: TenantOperator
  ): Promise<CreateTenantResult> {
    return createTenantOnBehalfOf(
      {
        actor:
          by.kind === "global_admin"
            ? { kind: "global_admin", globalAdminId: by.admin.id }
            : { kind: "system", reason: by.reason },
        db: this.deps.db,
        ipAddress: by.kind === "global_admin" ? by.ipAddress : undefined,
        userAgent: by.kind === "global_admin" ? by.userAgent : undefined,
        sendInviteEmail: this.deps.sendInviteEmail,
        waitUntil: (p) => this.deps.ctx.waitUntil(p),
      },
      payload
    );
  }

  /**
   * Suspend a tenant (D34). Atomic in-tx mutation:
   *   UPDATE organization SET suspended_at = now(), session_version += 1
   *   DELETE FROM sessions WHERE active_organization_id = orgId
   *   INSERT audit_logs (tenant.suspended) -- dual-scope
   * On commit, schedule a post-commit cache fan-out via `ctx.waitUntil`.
   */
  async suspend(
    input: SuspendInput,
    by: TenantOperator
  ): Promise<SuspensionResult> {
    const { organizationId, reason } = input;
    const actorFields = actorAuditFields(by);

    const result = await this.deps.db.transaction<SuspensionResult>(
      async (tx) => {
        const row = await lockOrgRow(tx, organizationId);
        if (!row) {
          throw new OrganizationNotFoundError(organizationId);
        }

        if (row.suspendedAt) {
          // BUFFERABLE no-op audit. Bypass createDualScope because the
          // event is observational and not classified CRITICAL.
          auditLogService.enqueue({
            event: "tenant.suspended.noop",
            organizationId,
            targetType: "organization",
            targetId: organizationId,
            metadata: reason ? { reason } : undefined,
            ...actorFields,
          });
          return { changed: false, organizationId };
        }

        await tx
          .update(organizations)
          .set({
            suspendedAt: sql`now()`,
            suspendedBy: by.kind === "global_admin" ? by.admin.id : null,
            suspendedReason: reason ?? null,
            sessionVersion: sql`${organizations.sessionVersion} + 1`,
          })
          .where(eq(organizations.id, organizationId));

        await tx
          .delete(sessions)
          .where(eq(sessions.activeOrganizationId, organizationId));

        await auditLogService.createDualScope(
          {
            event: AUDIT_EVENTS.TENANT.SUSPENDED.event,
            organizationId,
            targetType: "organization",
            targetId: organizationId,
            metadata: reason ? { reason } : undefined,
            ...actorFields,
          },
          tx
        );

        return { changed: true, organizationId };
      }
    );

    if (result.changed) {
      // Post-commit fan-out. Scheduled via `ctx.waitUntil` so the response
      // can flush before peer workers acknowledge the cache bump.
      this.deps.ctx.waitUntil(
        this.deps.invalidator.fanOutBumpVersion().catch((cause) => {
          logger.error("tenant suspend invalidator fan-out failed", {
            organizationId,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        })
      );
    }

    return result;
  }

  /**
   * Restore a previously suspended tenant. Clears `suspended_at` and
   * `suspended_reason` only — `session_version` is intentionally left
   * untouched so previously revoked JWTs stay revoked (D34).
   */
  async restore(
    input: RestoreInput,
    by: TenantOperator
  ): Promise<SuspensionResult> {
    const { organizationId } = input;
    const actorFields = actorAuditFields(by);

    const result = await this.deps.db.transaction<SuspensionResult>(
      async (tx) => {
        const row = await lockOrgRow(tx, organizationId);
        if (!row) {
          throw new OrganizationNotFoundError(organizationId);
        }

        if (!row.suspendedAt) {
          auditLogService.enqueue({
            event: "tenant.restored.noop",
            organizationId,
            targetType: "organization",
            targetId: organizationId,
            ...actorFields,
          });
          return { changed: false, organizationId };
        }

        await tx
          .update(organizations)
          .set({
            suspendedAt: null,
            suspendedBy: null,
            suspendedReason: null,
            // session_version intentionally NOT decremented (D34).
          })
          .where(eq(organizations.id, organizationId));

        await auditLogService.createDualScope(
          {
            event: AUDIT_EVENTS.TENANT.RESTORED.event,
            organizationId,
            targetType: "organization",
            targetId: organizationId,
            ...actorFields,
          },
          tx
        );

        return { changed: true, organizationId };
      }
    );

    if (result.changed) {
      this.deps.ctx.waitUntil(
        this.deps.invalidator.fanOutBumpVersion().catch((cause) => {
          logger.error("tenant restore invalidator fan-out failed", {
            organizationId,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        })
      );
    }

    return result;
  }

  /**
   * Soft-delete a tenant and tombstone its slug.
   *
   * Atomic in-tx mutation:
   *   UPDATE organization SET deleted_at = now(), deleted_by = ...
   *   INSERT INTO reserved_slugs (slug, kind='slug', reason='deleted_org')
   *     ON CONFLICT (slug) DO NOTHING  -- idempotent re-delete safe
   *   DELETE FROM sessions WHERE active_organization_id = orgId
   *   INSERT audit_logs (tenant.deprovisioned) -- dual-scope CRITICAL
   *
   * Per D66 we keep this a soft-delete (deleted_at column, no row removal)
   * so the audit history and slug tombstone survive. Hard-delete is out of
   * scope for v1 — the slug tombstone prevents re-registration even after
   * the org row is purged by a future GDPR-driven hard-delete job.
   */
  async delete(input: DeleteInput, by: TenantOperator): Promise<DeleteResult> {
    const { organizationId, reason } = input;
    const actorFields = actorAuditFields(by);
    const actorId = by.kind === "global_admin" ? by.admin.id : null;

    await this.deps.db.transaction(async (tx) => {
      const row = await lockOrgRow(tx, organizationId);
      if (!row) {
        throw new OrganizationNotFoundError(organizationId);
      }

      await tx
        .update(organizations)
        .set({
          deletedAt: sql`now()`,
          deletedBy: actorId,
          // Bump session_version on delete so any in-flight JWT is
          // immediately invalid even if the session DELETE below races.
          sessionVersion: sql`${organizations.sessionVersion} + 1`,
        })
        .where(eq(organizations.id, organizationId));

      // Tombstone the slug so it cannot be reclaimed by a future tenant.
      // ON CONFLICT DO NOTHING keeps the operation idempotent if the slug
      // is already reserved (e.g. via the manual reserved-slugs UI).
      if (row.slug) {
        await tx
          .insert(reservedSlugs)
          .values({
            slug: row.slug,
            kind: "slug",
            reason: "deleted_org",
            organizationId,
          })
          .onConflictDoNothing({ target: reservedSlugs.slug });
      }

      await tx
        .delete(sessions)
        .where(eq(sessions.activeOrganizationId, organizationId));

      await auditLogService.createDualScope(
        {
          event: AUDIT_EVENTS.TENANT.DEPROVISIONED.event,
          organizationId,
          targetType: "organization",
          targetId: organizationId,
          metadata: reason ? { reason } : undefined,
          ...actorFields,
        },
        tx
      );
    });

    this.deps.ctx.waitUntil(
      this.deps.invalidator.fanOutBumpVersion().catch((cause) => {
        logger.error("tenant delete invalidator fan-out failed", {
          organizationId,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      })
    );

    return { organizationId };
  }

  /**
   * Rename is deferred to v2 (D66). Reintroducing it requires coordinating
   * with each tenant's IdP-registered SSO callbacks (slug change rewrites
   * the `https://<slug>.app.example.com/auth/callback/sso` URL the IdP has
   * on file). Throw a typed error so callers can surface the deferral
   * explicitly rather than silently no-op'ing.
   */
  rename(
    _organizationId: string,
    _newSlug: string,
    _by: TenantOperator
  ): never {
    throw new Error(RENAME_DEFERRED_MESSAGE);
  }
}

/**
 * Locking read of the organization row. Allowlisted to bypass
 * `liveOrganizations` because:
 *
 *   1. The suspend / restore / delete flows manage `deleted_at` directly;
 *      filtering out tombstoned rows here would hide the row the operation
 *      is trying to mutate (re-delete is idempotent and must succeed).
 *   2. `.for("update")` row locking is not surfaced on the relational
 *      query API.
 *
 * Enforced by `packages/db/__tests__/live-organizations.spec.ts`.
 */
async function lockOrgRow(
  tx: Transaction,
  organizationId: string
): Promise<{
  id: string;
  suspendedAt: Date | null;
  slug: string | null;
} | null> {
  return firstOrNull(
    tx
      .select({
        id: organizations.id,
        suspendedAt: organizations.suspendedAt,
        slug: organizations.slug,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      // boundary: drizzle's row-locking helper is not surfaced on the typed
      // builder; .for("update") is the supported runtime API documented in
      // drizzle-orm.
      .for("update")
  );
}
