import { WorkerEntrypoint } from "cloudflare:workers";
import { withDrizzleClient } from "@repo/db";
import { sendEmail, TenantInviteEmail } from "@repo/email";
import { getBrandConfig } from "@repo/shared/brand";
import { logger } from "@repo/shared/logger";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import {
  createInvalidator,
  type InvalidationSpec,
  type Invalidator,
} from "@repo/tenancy";
import type { AppBindings } from "@/lib/context";
import type {
  CreateTenantPayload,
  CreateTenantResult,
  SendInviteEmailHook,
} from "@/lib/tenants/create-tenant";
import { createServerInvalidator } from "@/middlewares/invalidator";
import { NOTIFICATION_TYPES } from "@/modules/notifications/constants";
import { notificationDispatch } from "@/modules/notifications/dispatch";
import { onUserStatusChange as statusChangeHook } from "@/modules/users/user-status-hooks";
import { TenantOperations } from "@/services/tenant-operations";
import type { GlobalAdminActor } from "@/services/tenant-operations/types";

// boundary: vendor-SDK generic variance — Cloudflare Workers exposes
// `caches.default` at runtime, but the DOM `CacheStorage` typing doesn't model
// it. Safe in Workers only.
const tenancyCache = (caches as unknown as { default: Cache }).default;

function createServerOwnInvalidator(env: CloudflareBindings): Invalidator {
  return createInvalidator({
    CACHE: env.CACHE,
    tenancyCache: {
      match: (req) => tenancyCache.match(req),
      put: (req, res) => tenancyCache.put(req, res),
      delete: (req) => tenancyCache.delete(req),
    },
  });
}

// Strip a trailing slash so URL joins below produce stable absolute URLs.
const TRAILING_SLASH_RE = /\/$/;

/**
 * B2 / Audit-fix #5 — Resend-backed `TenantInviteEmail` dispatcher used by
 * the operator-led `createTenantOnBehalfOf` flow. Mirrors the BA-side
 * `sendInvitationEmail` callback in `apps/auth/src/instance.ts` so a
 * tenant-admin-led member invite and an operator-led primary-admin invite
 * land on the same template + transport.
 *
 * The acceptUrl uses the wildcard suffix from worker vars to construct the
 * tenant subdomain origin (e.g. `https://acme.app.example.com/accept-invite/<id>`).
 */
function buildTenantInviteEmailSender(
  env: CloudflareBindings
): SendInviteEmailHook {
  // boundary: workerd env bindings are typed via wrangler codegen; the brand
  // helper accepts a plain string-record and the runtime field set is a
  // strict superset of what it reads.
  const brand = getBrandConfig(
    env as unknown as Record<string, string | undefined>
  );
  return async (input) => {
    // The wildcard suffix is the leading-dot form (".app.example.com");
    // strip the dot when joining the slug. Fall back to the apex APP_URL
    // when the suffix is empty (single-domain deploys).
    const suffix = env.WILDCARD_SUFFIX.startsWith(".")
      ? env.WILDCARD_SUFFIX.slice(1)
      : env.WILDCARD_SUFFIX;
    const tenantHost = suffix.length > 0 ? `${input.slug}.${suffix}` : "";
    const acceptUrl =
      tenantHost.length > 0
        ? `https://${tenantHost}/accept-invite/${input.invitationId}`
        : `${env.APP_URL.replace(TRAILING_SLASH_RE, "")}/accept-invite/${input.invitationId}`;
    const result = await sendEmail({
      apiKey: env.RESEND_API_KEY,
      from: `${brand.appName} <${env.EMAIL_FROM}>`,
      to: input.email,
      subject: `You're invited to ${input.organizationName}`,
      template: TenantInviteEmail,
      props: {
        acceptUrl,
        organizationName: input.organizationName,
        inviterName: null,
        expiresInHours: input.expiresInHours,
      },
    });
    if (!result.success) {
      logger.error("Failed to send operator-led tenant invitation email", {
        organizationId: input.organizationId,
        invitationId: input.invitationId,
        email: input.email,
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
    }
  };
}

function getDrizzleLogger() {
  return process.env.NODE_ENV === "development"
    ? new DrizzleLogger()
    : undefined;
}

export class ApiEntrypoint extends WorkerEntrypoint<CloudflareBindings> {
  /** Called by Auth Worker after a new user is created */
  async onUserCreated(user: {
    id: string;
    email: string;
    name: string;
  }): Promise<{ workflowId: string }> {
    const instance = await this.env.ONBOARDING_WF.create({
      params: { userId: user.id, email: user.email, name: user.name },
    });
    return { workflowId: instance.id };
  }

  /** Called by Auth Worker when sign-in from a new device is detected */
  async onNewDeviceLogin(params: {
    userId: string;
    ipAddress: string;
    userAgent: string;
    platform: string;
  }): Promise<void> {
    await withDrizzleClient(
      this.env.HYPERDRIVE.connectionString,
      async (db) => {
        const deviceDesc =
          params.platform === "mobile" ? "a mobile device" : "a web browser";
        await notificationDispatch.send(db, {
          userId: params.userId,
          type: NOTIFICATION_TYPES.SECURITY_LOGIN_NEW_DEVICE,
          subject: "New device sign-in",
          body: `A new sign-in was detected from ${deviceDesc}.`,
          props: {
            ipAddress: params.ipAddress,
            userAgent: params.userAgent,
            platform: params.platform,
          },
        });
      },
      { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
    );
  }

  /** Called by Auth Worker admin plugin when user status changes */
  async onUserStatusChange(params: {
    userId: string;
    newStatus: string;
    previousStatus: string;
    reason: string | null;
  }): Promise<void> {
    await statusChangeHook(
      params.userId,
      params.newStatus,
      params.previousStatus,
      params.reason
    );
  }

  /**
   * A2.6 / A2.9 — fan-in invalidation entrypoint. Called by peers (admin
   * worker) when a tenancy mutation needs to evict this colo's Cache API
   * entry for the given host.
   */
  async invalidateTenant(spec: InvalidationSpec): Promise<void> {
    const invalidator = createServerOwnInvalidator(this.env);
    await invalidator.invalidateOwn(spec);
  }

  /**
   * A2.6 / A2.9 — fan-in version-bump entrypoint. Bumps the server's KV
   * version key, invalidating all cached tenant lookups in this colo.
   * Returns the new version so callers can confirm propagation.
   */
  async bumpTenantCacheVersion(): Promise<string> {
    const invalidator = createServerOwnInvalidator(this.env);
    return invalidator.bumpOwnVersion();
  }
}

/**
 * Operator identity payload sent across the service binding from
 * apps/admin. The admin worker has the full `GlobalAdmin` row in
 * `c.var.globalAdmin`; we only need the durable subset for audit + actor
 * fields here. Kept narrow so the wire format does not couple to the DB
 * row layout.
 */
type OperatorIdentity = Readonly<{
  id: string;
  email: string;
  role: GlobalAdminActor["admin"]["role"];
}>;

function operatorActor(
  operator: OperatorIdentity,
  meta: { ipAddress?: string; userAgent?: string } = {}
): GlobalAdminActor {
  return {
    kind: "global_admin",
    admin: {
      ...operator,
      // The C5 service treats `deactivatedAt: Date | null`. Coming over RPC
      // we trust that the caller has already gated the operator (the admin
      // worker's `requireOperator` middleware refuses deactivated rows).
      deactivatedAt: null,
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  };
}

/**
 * B2 / C5 / D35 / D54 — RPC entrypoint exposed to the apps/admin worker.
 * Operator-led tenant CRUD flows through this class so the admin worker
 * never holds a Hyperdrive binding directly. Each call opens a fresh
 * Drizzle client (via `withDrizzleClient`) and runs the underlying
 * `TenantOperations` flow inside a single transaction.
 *
 * Slug-conflict propagation (create only): the underlying
 * `createTenantOnBehalfOf` lib throws `SlugReservedError` (DB-backed
 * reserved_slugs match) or `SlugTakenError` (Postgres unique-violation
 * 23505 on `organization_slug_key`) before any audit row is written.
 * Workers RPC preserves the thrown error's `name`, `message`, and
 * own-enumerable `code` properties — class identity is lost across the
 * service binding, so the admin worker maps each conflict to a 409 via
 * `tenantConflictCode` from `@repo/shared/api-binding`.
 */
export class AdminApiEntrypoint extends WorkerEntrypoint<CloudflareBindings> {
  /**
   * Build a `TenantOperations` bound to a fresh Drizzle client. Each RPC call
   * opens its own pool checkout via `withDrizzleClient` and closes it on
   * completion so a long-lived RPC binding cannot leak Hyperdrive connections.
   */
  private async withOps<T>(
    fn: (ops: TenantOperations) => Promise<T>
  ): Promise<T> {
    // boundary: vendor-SDK generic variance — `WorkerEntrypoint<CloudflareBindings>`
    // surfaces the static binding shape, but the AUTH peer binding is augmented
    // at runtime with RPC methods (`AuthBindingRpc`) declared on `AppBindings`.
    // The runtime methods always exist; the cast aligns the type.
    const env = this.env as unknown as AppBindings;
    return withDrizzleClient(
      this.env.HYPERDRIVE.connectionString,
      async (db) => {
        const ops = new TenantOperations({
          db,
          invalidator: createServerInvalidator(env),
          ctx: this.ctx,
          sendInviteEmail: buildTenantInviteEmailSender(this.env),
        });
        return fn(ops);
      },
      { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
    );
  }

  async createTenantOnBehalfOf(
    operator: OperatorIdentity,
    payload: CreateTenantPayload
  ): Promise<CreateTenantResult> {
    return this.withOps((ops) => ops.create(payload, operatorActor(operator)));
  }

  /**
   * C5 — operator-led tenant suspend (D34 / D54). Invoked by the apps/admin
   * worker after `requireOperator("tenant.suspend")` clears.
   */
  async suspendTenant(
    organizationId: string,
    operator: OperatorIdentity,
    reason?: string
  ): Promise<void> {
    await this.withOps((ops) =>
      ops.suspend({ organizationId, reason }, operatorActor(operator))
    );
  }

  /**
   * C5 — operator-led tenant restore (D34 / D54).
   */
  async restoreTenant(
    organizationId: string,
    operator: OperatorIdentity
  ): Promise<void> {
    await this.withOps((ops) =>
      ops.restore({ organizationId }, operatorActor(operator))
    );
  }

  /**
   * C5 — operator-led tenant delete (D54). Soft-delete + slug tombstone +
   * session revoke, dual-scope audit, post-commit cache fan-out.
   */
  async deleteTenant(
    organizationId: string,
    operator: OperatorIdentity,
    reason?: string
  ): Promise<void> {
    await this.withOps((ops) =>
      ops.delete({ organizationId, reason }, operatorActor(operator))
    );
  }
}
