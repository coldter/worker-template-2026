/**
 * A5 / D74 — Custom-hostname lifecycle service. Co-located in the tenancy
 * module per the plan; C3 will refactor this into a deeper service. The
 * surface (request / verifyTxt / list / remove / reconcileOne / reconcileAll)
 * is the contract C3 will preserve verbatim.
 */
import {
  type DrizzleClient,
  type Executor,
  firstOrNull,
  firstOrThrow,
  liveOrganizations,
} from "@repo/db";
import {
  organizations,
  reservedSlugs,
  type TenantCustomHostname,
  tenantCustomHostnames,
} from "@repo/db/schema";
import { logger } from "@repo/shared/logger";
import type { FanOutInvalidator } from "@repo/tenancy";
import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { auditLogService } from "@/modules/audit-logs/service";
import { writeActiveCustomHostnamesSnapshot } from "./active-hostnames-snapshot";
import {
  type CfApiDeps,
  type CfApiEnv,
  createCustomHostname,
  deleteCustomHostname,
  getCustomHostname,
} from "./cf-api";
import { CfApiContractError, type CfCustomHostname } from "./cf-api.types";
import { type DohResolver, defaultDohResolvers } from "./doh-resolver";
import {
  type CustomHostnameLifecycle,
  isReconcilable,
  mapCloudflareStatus,
} from "./lifecycle-status";
import {
  assertWithinDailyLimit,
  assertWithinPendingLimit,
} from "./rate-limits";
import { type VerifyTxtResult, verifyTxtRecord } from "./txt-verification";
import { generateVerificationToken } from "./verification-token";

/**
 * Per-label hostname check (no leading/trailing hyphen, ≤ 63 chars per label).
 * Total hostname length ≤ 253 (validated separately so we can produce a
 * specific error for it).
 *
 * NB: punycode (`xn--*`) labels are rejected here at the lifecycle level —
 * only the request-time tenant resolver allows them and only for `kind:
 * "custom"` (per A1i).
 */
const HOSTNAME_LABEL_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/;

function isValidHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253) {
    return false;
  }
  if (hostname.startsWith(".") || hostname.endsWith(".")) {
    return false;
  }
  return HOSTNAME_LABEL_RE.test(hostname);
}

/**
 * Reconciler row-fetch limit. The cron runs every minute; with up to 100
 * rows per pass we cycle through 6,000 rows / hour, which is ample for the
 * project's expected concurrency. Rows beyond the first 100 wait their
 * turn — `lastReconciledAt ASC NULLS FIRST` ordering guarantees the oldest
 * row is always picked first, so no row is starved indefinitely. Per-call
 * jitter is added on the CF API side (see `cf-api.ts` retries) to
 * desynchronize concurrent isolates.
 */
const RECONCILE_BATCH_LIMIT = 100;

/**
 * If a `removing` row remains in that state past this threshold, treat it
 * as reconcilable so the reconciler can retry the CF DELETE — a transient
 * CF outage during `remove()` would otherwise pin the row forever.
 */
const REMOVING_RETRY_AFTER_MS = 5 * 60 * 1000;

export type LifecycleEnv = CfApiEnv &
  Readonly<{
    CUSTOM_HOST_CNAME_TARGET: string;
    CUSTOM_HOST_VERIFICATION_LABEL: string;
  }>;

export type Actor = Readonly<{
  id: string;
  organizationId: string;
}>;

export type CfBudgetGuard = Readonly<{
  /**
   * Returns true when the caller may proceed with a CF API call within the
   * shared per-token budget. Returns false when the budget is exhausted —
   * the caller should yield (reconciler) or surface an error (user-driven
   * mutation). Implementations are expected to be idempotent across
   * concurrent isolates.
   */
  tryAcquire(): Promise<boolean>;
}>;

export type LifecycleDeps = Readonly<{
  cfApi?: CfApiDeps;
  dohResolvers?: readonly DohResolver[];
  invalidator?: FanOutInvalidator;
  now?: () => Date;
  cronRunId?: string;
  /**
   * Optional KV-namespace target for refreshing the host-guard active
   * hostnames snapshot. Pass when the lifecycle service is invoked from a
   * worker context that has CACHE bound; omit in unit tests.
   */
  cache?: { put(key: string, value: string): Promise<void> };
  /**
   * Optional CF API budget guard — see `cf-budget.ts`. When provided, the
   * reconciler yields gracefully if the shared per-token budget is
   * exhausted; user-driven mutations that pass this guard fall back to
   * surfacing a 503 to the tenant.
   */
  cfBudget?: CfBudgetGuard;
}>;

export type LifecycleErrorCode =
  | "duplicate_hostname"
  | "reserved"
  | "not_found"
  | "txt_verification_failed"
  | "txt_resolver_error"
  | "cf_create_failed"
  | "service_guard"
  | "invalid_hostname";

export class LifecycleError extends Error {
  readonly code: LifecycleErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(
    code: LifecycleErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LifecycleError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Raised when a tenancy mutation would violate a service-level constraint
 * (e.g. removing the last SSO-routable access path for an `enforce_sso=true`
 * org). Mapped to HTTP 409 by the route handler — the operation is well-formed
 * but conflicts with current state.
 */
export type TenancyConstraintCode = "last_sso_access_path";

export class TenancyConstraintError extends Error {
  readonly code: TenancyConstraintCode;
  readonly details?: Record<string, unknown>;
  constructor(
    code: TenancyConstraintCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "TenancyConstraintError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Count active custom-hostname rows for an organization. Used by `remove()`
 * to decide whether removing a hostname would leave an `enforce_sso=true`
 * org with zero SSO-routable access paths. The default subdomain is always
 * SSO-routable too, but the plan's strict reading (per A5.6 task 2(c)) is
 * that `enforce_sso=true` + last active custom host being removed is the
 * trigger for the guard — operators using SSO-only mode typically rely on
 * a vanity hostname for branded login flows.
 */
export async function countActiveHosts(
  db: DrizzleClient | Executor,
  organizationId: string
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(tenantCustomHostnames)
    .where(
      and(
        eq(tenantCustomHostnames.organizationId, organizationId),
        eq(tenantCustomHostnames.lifecycleStatus, "active")
      )
    );
  return row?.n ?? 0;
}

export type RequestResult = Readonly<{
  id: string;
  hostname: string;
  verificationToken: string;
  verificationLabel: string;
  instructions: string;
}>;

export type VerifyResult = Readonly<{
  id: string;
  hostname: string;
  cfHostnameId: string | null;
  lifecycleStatus: CustomHostnameLifecycle;
  cnameTarget: string;
  preValidation?: { url: string; body: string } | null;
  /**
   * CF-issued TXT records the tenant must add for DCV. Empty when CF has
   * not surfaced TXT records yet (the reconciler will pick them up on the
   * next poll) or when an idempotency short-circuit returns before a CF
   * call. Mutable array so OpenAPI can serialize it through Hono's
   * typed-response without a `readonly` cast.
   */
  cfTxtRecords?: { name: string; value: string }[];
}>;

const TRAILING_DOT_RE = /\.$/;

function normalizeHostname(input: string): string {
  return input
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(TRAILING_DOT_RE, "");
}

function apexOf(hostname: string): string {
  const parts = hostname.split(".");
  if (parts.length <= 2) {
    return hostname;
  }
  return parts.slice(-2).join(".");
}

function buildInstructions(label: string, hostname: string, token: string) {
  return [
    "Add a DNS TXT record:",
    `  ${label}.${hostname}  →  ${token}`,
    "Then call /verify-txt to continue.",
  ].join("\n");
}

function pickPreValidation(
  cf: CfCustomHostname
): { url: string; body: string } | null {
  const rec = cf.ssl.validation_records?.[0];
  if (!(rec?.http_url && rec.http_body)) {
    return null;
  }
  return { url: rec.http_url, body: rec.http_body };
}

/**
 * CF-issued TXT validation records to surface to tenants. With
 * `ssl.method: "txt"` (Wave 2 decision in `cf-api.ts`) tenants must add
 * BOTH our `_app-verify` TXT (for ownership proof) and CF's
 * `_acme-challenge` TXT (for DCV). We surface both so the tenant UI can
 * render a single combined "DNS records to add" view.
 */
function pickCfTxtRecords(
  cf: CfCustomHostname
): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const rec of cf.ssl.validation_records ?? []) {
    if (rec.txt_name && rec.txt_value) {
      out.push({ name: rec.txt_name, value: rec.txt_value });
    }
  }
  return out;
}

export const customHostnameLifecycle = {
  /**
   * Phase A request flow: insert a `pending_txt` row with a verification
   * token. NO CF API call here — that happens after the tenant proves
   * control of the host via TXT (verifyTxt below).
   */
  async request(
    db: DrizzleClient,
    env: LifecycleEnv,
    rawHostname: string,
    actor: Actor,
    _deps: LifecycleDeps = {}
  ): Promise<RequestResult> {
    const hostname = normalizeHostname(rawHostname);
    if (!isValidHostname(hostname)) {
      throw new LifecycleError("invalid_hostname", "Hostname is not valid");
    }

    return await db.transaction(async (tx) => {
      await assertWithinPendingLimit(tx, actor.organizationId);
      await assertWithinDailyLimit(tx, actor.organizationId);

      const apex = apexOf(hostname);
      // Filter to `kind = 'hostname'` so a host request never collides with
      // a tenant slug tombstone (e.g., a deleted slug `acme` should not
      // block the host `acme.example.com`). The reserved-slugs table's
      // unique-on-slug-only invariant is preserved by `kind` being a
      // discriminator on the row, not part of the unique key — see
      // `packages/db/src/schema/reserved-slugs.ts`.
      const reservedExact = await firstOrNull(
        tx
          .select({ slug: reservedSlugs.slug })
          .from(reservedSlugs)
          .where(
            and(
              inArray(reservedSlugs.slug, [hostname, apex]),
              eq(reservedSlugs.kind, "hostname")
            )
          )
      );
      if (reservedExact) {
        throw new LifecycleError("reserved", "Hostname or apex is reserved", {
          slug: reservedExact.slug,
        });
      }

      const dup = await firstOrNull(
        tx
          .select({ id: tenantCustomHostnames.id })
          .from(tenantCustomHostnames)
          .where(eq(tenantCustomHostnames.hostname, hostname))
      );
      if (dup) {
        throw new LifecycleError(
          "duplicate_hostname",
          "Hostname already requested",
          { hostname }
        );
      }

      const token = generateVerificationToken();
      const row = await firstOrThrow(
        tx
          .insert(tenantCustomHostnames)
          .values({
            organizationId: actor.organizationId,
            hostname,
            lifecycleStatus: "pending_txt",
            verificationToken: token,
          })
          .returning(),
        "Failed to insert tenant custom hostname"
      );

      await auditLogService.create(
        {
          event: "tenancy.custom_hostname.requested",
          actorId: actor.id,
          actorType: "user",
          organizationId: actor.organizationId,
          targetId: row.id,
          targetType: "custom_hostname",
          metadata: { hostname },
        },
        tx
      );

      return {
        id: row.id,
        hostname,
        verificationToken: token,
        verificationLabel: env.CUSTOM_HOST_VERIFICATION_LABEL,
        instructions: buildInstructions(
          env.CUSTOM_HOST_VERIFICATION_LABEL,
          hostname,
          token
        ),
      };
    });
  },

  /**
   * verifyTxt: resolve the TXT (DoH dual-resolver) and, on success, register
   * the hostname with Cloudflare-for-SaaS. TXT proof and CF registration are
   * orthogonal — if CF call fails, we still keep the TXT-verified flag so
   * future retries don't ask the tenant to add the TXT again.
   */
  async verifyTxt(
    db: DrizzleClient,
    env: LifecycleEnv,
    id: string,
    actor: Actor,
    deps: LifecycleDeps = {}
  ): Promise<VerifyResult> {
    const row = await firstOrNull(
      db
        .select()
        .from(tenantCustomHostnames)
        .where(eq(tenantCustomHostnames.id, id))
    );
    if (!row || row.organizationId !== actor.organizationId) {
      throw new LifecycleError("not_found", "Custom hostname not found");
    }
    // Idempotency short-circuit.
    if (row.verificationVerifiedAt && row.cfHostnameId) {
      return {
        id: row.id,
        hostname: row.hostname,
        cfHostnameId: row.cfHostnameId,
        lifecycleStatus: row.lifecycleStatus,
        cnameTarget: env.CUSTOM_HOST_CNAME_TARGET,
        preValidation: null,
        cfTxtRecords: [],
      };
    }

    const resolvers = deps.dohResolvers ?? defaultDohResolvers;
    const verify: VerifyTxtResult = await verifyTxtRecord(
      row.hostname,
      row.verificationToken,
      {
        dohResolver: resolvers,
        verificationLabel: env.CUSTOM_HOST_VERIFICATION_LABEL,
      }
    );
    if (!verify.ok) {
      // Do NOT persist a row update — TXT can be retried.
      throw new LifecycleError(
        verify.reason === "resolver_error"
          ? "txt_resolver_error"
          : "txt_verification_failed",
        `TXT verification failed: ${verify.reason}`,
        { reason: verify.reason }
      );
    }

    let cf: CfCustomHostname;
    try {
      cf = await createCustomHostname(env, row.hostname, deps.cfApi);
    } catch (cause) {
      // Buffered audit — TXT is verified, CF retry can happen on next request
      // or via the reconciler once a cfHostnameId exists. We persist the
      // verification timestamp so the retry doesn't re-ask the tenant for TXT.
      await db
        .update(tenantCustomHostnames)
        .set({
          verificationVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tenantCustomHostnames.id, row.id));
      const errorMessage =
        cause instanceof Error ? cause.message : String(cause);
      auditLogService.enqueue({
        event: "tenancy.custom_hostname.cf_create_failed",
        actorId: actor.id,
        actorType: "user",
        organizationId: actor.organizationId,
        targetId: row.id,
        targetType: "custom_hostname",
        metadata: {
          hostname: row.hostname,
          error: errorMessage,
        },
      });
      throw new LifecycleError(
        "cf_create_failed",
        "Cloudflare hostname registration failed",
        {
          hostname: row.hostname,
          cfErrorCode:
            cause instanceof CfApiContractError ? cause.cfErrorCode : undefined,
        }
      );
    }

    const hasRecords = (cf.ssl.validation_records?.length ?? 0) > 0;
    const lifecycle = mapCloudflareStatus(
      cf.status,
      cf.ssl.status ?? null,
      hasRecords,
      cf.verification_errors ?? []
    );

    const updated = await db.transaction(async (tx) => {
      const persisted = await firstOrThrow(
        tx
          .update(tenantCustomHostnames)
          .set({
            cfHostnameId: cf.id,
            lifecycleStatus: lifecycle,
            cfStatus: cf.status,
            cfSslStatus: cf.ssl.status ?? null,
            verificationVerifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(tenantCustomHostnames.id, row.id))
          .returning(),
        "Failed to persist hostname update"
      );
      await auditLogService.create(
        {
          event: "tenancy.custom_hostname.verified",
          actorId: actor.id,
          actorType: "user",
          organizationId: actor.organizationId,
          targetId: row.id,
          targetType: "custom_hostname",
          metadata: { hostname: row.hostname, cfHostnameId: cf.id },
        },
        tx
      );
      return persisted;
    });

    return {
      id: updated.id,
      hostname: updated.hostname,
      cfHostnameId: updated.cfHostnameId,
      lifecycleStatus: updated.lifecycleStatus,
      cnameTarget: env.CUSTOM_HOST_CNAME_TARGET,
      preValidation: pickPreValidation(cf),
      cfTxtRecords: pickCfTxtRecords(cf),
    };
  },

  async list(
    db: DrizzleClient,
    organizationId: string
  ): Promise<
    Pick<
      TenantCustomHostname,
      | "id"
      | "hostname"
      | "lifecycleStatus"
      | "cfStatus"
      | "cfSslStatus"
      | "verificationVerifiedAt"
      | "lastReconciledAt"
      | "verificationErrors"
      | "createdAt"
    >[]
  > {
    return await db
      .select({
        id: tenantCustomHostnames.id,
        hostname: tenantCustomHostnames.hostname,
        lifecycleStatus: tenantCustomHostnames.lifecycleStatus,
        cfStatus: tenantCustomHostnames.cfStatus,
        cfSslStatus: tenantCustomHostnames.cfSslStatus,
        verificationVerifiedAt: tenantCustomHostnames.verificationVerifiedAt,
        lastReconciledAt: tenantCustomHostnames.lastReconciledAt,
        verificationErrors: tenantCustomHostnames.verificationErrors,
        createdAt: tenantCustomHostnames.createdAt,
      })
      .from(tenantCustomHostnames)
      .where(eq(tenantCustomHostnames.organizationId, organizationId))
      .orderBy(desc(tenantCustomHostnames.createdAt));
  },

  async remove(
    db: DrizzleClient,
    env: LifecycleEnv,
    id: string,
    actor: Actor,
    deps: LifecycleDeps = {}
  ): Promise<{ id: string; lifecycleStatus: CustomHostnameLifecycle }> {
    const row = await firstOrNull(
      db
        .select()
        .from(tenantCustomHostnames)
        .where(eq(tenantCustomHostnames.id, id))
    );
    if (!row || row.organizationId !== actor.organizationId) {
      throw new LifecycleError("not_found", "Custom hostname not found");
    }
    if (row.lifecycleStatus === "removed") {
      // Idempotent.
      return { id: row.id, lifecycleStatus: "removed" };
    }

    // Service guard (A5.6 task 2(c)): if removing this row would leave an
    // `enforce_sso=true` org with zero active custom hostnames, reject. The
    // guard only triggers when this row itself is `active` — pending or
    // failed rows aren't routable today, so removing them changes nothing
    // about the org's accessible-host set.
    if (row.lifecycleStatus === "active") {
      // Use the live-organizations seam: deleted tenants are filtered out
      // automatically (`org` will be null for them), which matches the
      // "deleted orgs already have zero access paths" carve-out below.
      const org = await firstOrNull(
        liveOrganizations(db).selectById(
          {
            enforceSSO: organizations.enforceSSO,
            suspendedAt: organizations.suspendedAt,
          },
          actor.organizationId
        )
      );
      // Suspended orgs already have zero access paths effectively; the guard
      // does not apply because tenants can't reach them anyway.
      if (org?.enforceSSO && !org.suspendedAt) {
        const activeCount = await countActiveHosts(db, actor.organizationId);
        if (activeCount <= 1) {
          throw new TenancyConstraintError(
            "last_sso_access_path",
            "Removing this hostname would leave the organization with no SSO-routable access path",
            { hostname: row.hostname, activeCount }
          );
        }
      }
    }

    // Mark `removing` so the reconciler skips this row while DELETE is in
    // flight. We stamp `lastReconciledAt` to the current time so the
    // reconciler's age-based retry can pick the row back up if the CF
    // DELETE below throws (e.g. transient CF outage). Without this stamp
    // the row would be pinned in `removing` forever — `isReconcilable`
    // returns false for `removing` and only the age check unblocks it.
    await db
      .update(tenantCustomHostnames)
      .set({
        lifecycleStatus: "removing",
        lastReconciledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenantCustomHostnames.id, row.id));

    if (row.cfHostnameId) {
      try {
        await deleteCustomHostname(env, row.cfHostnameId, deps.cfApi);
      } catch (cause) {
        // The row stays `removing` so the reconciler can retry once the
        // age threshold elapses. CF DELETE is idempotent on 404 so retries
        // are safe.
        logger.warn("custom hostname CF DELETE failed; reconciler will retry", {
          rowId: row.id,
          error: cause instanceof Error ? cause.message : String(cause),
        });
        throw cause;
      }
    }

    const result = await db.transaction(async (tx) => {
      const persisted = await firstOrThrow(
        tx
          .update(tenantCustomHostnames)
          .set({ lifecycleStatus: "removed", updatedAt: new Date() })
          .where(eq(tenantCustomHostnames.id, row.id))
          .returning(),
        "Failed to mark hostname removed"
      );

      // Tombstone into reserved_slugs (D16) so the same hostname cannot be
      // re-added by another org. Ignore conflicts (already tombstoned). The
      // `kind: "hostname"` discriminator (A1i) keeps host tombstones separate
      // from slug tombstones — request-time lookups use this to scope reads.
      await tx
        .insert(reservedSlugs)
        .values({
          slug: row.hostname,
          kind: "hostname",
          reason: "tombstoned",
          organizationId: actor.organizationId,
        })
        .onConflictDoNothing();

      await auditLogService.create(
        {
          event: "tenancy.custom_hostname.removed",
          actorId: actor.id,
          actorType: "user",
          organizationId: actor.organizationId,
          targetId: row.id,
          targetType: "custom_hostname",
          metadata: { hostname: row.hostname },
        },
        tx
      );
      return persisted;
    });

    // Cache fan-out (D28) — best-effort, post-commit.
    if (deps.invalidator) {
      try {
        await deps.invalidator.fanOut({ kind: "custom", host: row.hostname });
      } catch (cause) {
        logger.error("custom hostname invalidator fanOut failed", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }

    // Drop the row from the host-guard active snapshot if it was previously
    // active. Best-effort — if KV is unreachable the snapshot TTL will pick
    // up the change within 30s.
    if (row.lifecycleStatus === "active") {
      await refreshSnapshotIfPossible(db, deps);
    }

    return { id: result.id, lifecycleStatus: result.lifecycleStatus };
  },

  /**
   * Reconcile a single row against CF's view. Returns the per-row outcome.
   * Used by `reconcileAll` and exposed for targeted refresh.
   */
  async reconcileOne(
    db: DrizzleClient,
    env: LifecycleEnv,
    rowId: string,
    deps: LifecycleDeps = {}
  ): Promise<{
    rowId: string;
    action:
      | "unchanged"
      | "transitioned_active"
      | "transitioned_failed"
      | "transitioned_removed"
      | "cf_404_tombstoned"
      | "skipped"
      | "error";
    lifecycleStatus?: CustomHostnameLifecycle;
    error?: string;
  }> {
    const row = await firstOrNull(
      db
        .select()
        .from(tenantCustomHostnames)
        .where(eq(tenantCustomHostnames.id, rowId))
    );
    if (!row?.cfHostnameId) {
      return { rowId, action: "skipped" };
    }
    const now = (deps.now ?? (() => new Date()))();
    if (
      !isReconcilable(
        row.lifecycleStatus,
        row.lastReconciledAt ?? null,
        now,
        REMOVING_RETRY_AFTER_MS
      )
    ) {
      return { rowId, action: "skipped" };
    }

    // Stuck-`removing` retry: the writer marked the row `removing` but the
    // CF DELETE failed. Retry the DELETE — idempotent on 404. If it
    // succeeds, finish the tombstone path.
    if (row.lifecycleStatus === "removing") {
      try {
        await deleteCustomHostname(env, row.cfHostnameId, deps.cfApi);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        await db
          .update(tenantCustomHostnames)
          .set({ lastReconciledAt: now, updatedAt: now })
          .where(eq(tenantCustomHostnames.id, row.id));
        return { rowId, action: "error", error: message };
      }
      await db.transaction(async (tx) => {
        await tx
          .update(tenantCustomHostnames)
          .set({
            lifecycleStatus: "removed",
            lastReconciledAt: now,
            lastCfPolledAt: now,
            updatedAt: now,
          })
          .where(eq(tenantCustomHostnames.id, row.id));
        await tx
          .insert(reservedSlugs)
          .values({
            slug: row.hostname,
            kind: "hostname",
            reason: "tombstoned",
            organizationId: row.organizationId,
          })
          .onConflictDoNothing();
        await auditLogService.create(
          {
            event: "tenancy.custom_hostname.removed",
            actorType: "system",
            organizationId: row.organizationId,
            targetId: row.id,
            targetType: "custom_hostname",
            metadata: { hostname: row.hostname, reason: "removing_retry" },
          },
          tx
        );
      });
      return {
        rowId,
        action: "transitioned_removed",
        lifecycleStatus: "removed",
      };
    }

    let cf: CfCustomHostname | null;
    try {
      cf = await getCustomHostname(env, row.cfHostnameId, deps.cfApi);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      logger.error("custom hostname reconcile error", {
        rowId,
        cronRunId: deps.cronRunId,
        error: message,
      });
      return { rowId, action: "error", error: message };
    }

    if (cf === null) {
      await db.transaction(async (tx) => {
        await tx
          .update(tenantCustomHostnames)
          .set({
            lifecycleStatus: "removed",
            lastReconciledAt: new Date(),
            lastCfPolledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(tenantCustomHostnames.id, row.id));
        await auditLogService.create(
          {
            event: "tenancy.custom_hostname.deleted_by_cf",
            actorType: "system",
            organizationId: row.organizationId,
            targetId: row.id,
            targetType: "custom_hostname",
            metadata: {
              hostname: row.hostname,
              reason: "cf_deleted_after_backoff",
            },
          },
          tx
        );
      });
      await refreshSnapshotIfPossible(db, deps);
      return {
        rowId,
        action: "cf_404_tombstoned",
        lifecycleStatus: "removed",
      };
    }

    const hasRecords = (cf.ssl.validation_records?.length ?? 0) > 0;
    const next = mapCloudflareStatus(
      cf.status,
      cf.ssl.status ?? null,
      hasRecords,
      cf.verification_errors ?? []
    );

    const wasActive = row.lifecycleStatus === "active";
    const wasFailed = row.lifecycleStatus === "failed";

    await db.transaction(async (tx) => {
      const verifErrors = [
        ...(cf.verification_errors ?? []),
        ...((cf.ssl.validation_errors ?? []).map((v) => v.message ?? "") ?? []),
      ].filter(Boolean);
      await tx
        .update(tenantCustomHostnames)
        .set({
          lifecycleStatus: next,
          cfStatus: cf.status,
          cfSslStatus: cf.ssl.status ?? null,
          verificationErrors: verifErrors,
          lastReconciledAt: new Date(),
          lastCfPolledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tenantCustomHostnames.id, row.id));

      if (next === "active" && !wasActive) {
        await auditLogService.create(
          {
            event: "tenancy.custom_hostname.activated",
            actorType: "system",
            organizationId: row.organizationId,
            targetId: row.id,
            targetType: "custom_hostname",
            metadata: { hostname: row.hostname },
          },
          tx
        );
      }
      // Active -> not-active is a routing-impacting transition: surface it
      // separately so dashboards / alerting can show recent deactivations
      // without scanning every reconciler tick.
      if (wasActive && next !== "active") {
        await auditLogService.create(
          {
            event: "tenancy.custom_hostname.deactivated",
            actorType: "system",
            organizationId: row.organizationId,
            targetId: row.id,
            targetType: "custom_hostname",
            metadata: {
              hostname: row.hostname,
              previousStatus: row.lifecycleStatus,
              nextStatus: next,
              cfStatus: cf.status,
              cfSslStatus: cf.ssl.status ?? null,
            },
          },
          tx
        );
      }
    });

    // Snapshot + cache fan-out must reflect any transition into or out of
    // `active`. The fan-out (D28) busts positive caches in peer workers so
    // the host-guard middleware sees the new state on the next request.
    if ((next === "active" && !wasActive) || (wasActive && next !== "active")) {
      await refreshSnapshotIfPossible(db, deps);
      if (deps.invalidator) {
        try {
          await deps.invalidator.fanOut({
            kind: "custom",
            host: row.hostname,
          });
        } catch (cause) {
          logger.error("custom hostname reconciler invalidator fanOut failed", {
            rowId,
            cronRunId: deps.cronRunId,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    }

    if (next === "active" && !wasActive) {
      return { rowId, action: "transitioned_active", lifecycleStatus: next };
    }
    if (next === "failed" && !wasFailed) {
      return { rowId, action: "transitioned_failed", lifecycleStatus: next };
    }
    if (next === "removed") {
      return { rowId, action: "transitioned_removed", lifecycleStatus: next };
    }
    return { rowId, action: "unchanged", lifecycleStatus: next };
  },

  /**
   * 60s reconciler entrypoint. Selects up to 100 reconcilable rows ordered by
   * last_reconciled_at ASC NULLS FIRST so the oldest get priority. Each row is
   * processed independently — failure on row N never aborts the batch.
   *
   * Per-row jitter: between rows we sleep 0..100ms to desynchronize
   * concurrent isolates and stagger CF API requests across the cron tick.
   * Combined with the `lastReconciledAt ASC NULLS FIRST` ordering, the
   * effect is round-robin: rows fall to the back of the queue after each
   * pass, so a stuck row cannot starve a fresh one.
   *
   * CF budget: when `deps.cfBudget` is provided, we yield gracefully at
   * the first refusal — the row stays unmodified and the next cron tick
   * will pick it up. Defense in depth; the real budget is enforced
   * per-token by CF.
   */
  async reconcileAll(
    db: DrizzleClient,
    env: LifecycleEnv,
    deps: LifecycleDeps = {}
  ): Promise<{
    cronRunId: string;
    processed: number;
    transitionedActive: number;
    transitionedFailed: number;
    transitionedRemoved: number;
    errors: number;
    budgetYielded?: boolean;
  }> {
    const cronRunId = deps.cronRunId ?? crypto.randomUUID();
    const rows = await db
      .select({ id: tenantCustomHostnames.id })
      .from(tenantCustomHostnames)
      .where(
        and(
          isNotNull(tenantCustomHostnames.cfHostnameId),
          inArray(tenantCustomHostnames.lifecycleStatus, [
            "awaiting_cf",
            "pre_validation",
            "failed",
            "removing",
            // `active` rows are polled so the reconciler can detect
            // deactivations (cert expired, CF deactivated). The
            // deactivation audit (`tenancy.custom_hostname.deactivated`)
            // is emitted from `reconcileOne` when `wasActive && next !==
            // "active"`.
            "active",
          ])
        )
      )
      .orderBy(sql`${tenantCustomHostnames.lastReconciledAt} ASC NULLS FIRST`)
      .limit(RECONCILE_BATCH_LIMIT);

    const random = deps.cfApi?.random ?? Math.random;
    const sleep =
      deps.cfApi?.sleep ??
      ((ms: number) => new Promise((r) => setTimeout(r, ms)));

    const summary = {
      cronRunId,
      processed: 0,
      transitionedActive: 0,
      transitionedFailed: 0,
      transitionedRemoved: 0,
      errors: 0,
      budgetYielded: false,
    };
    for (const r of rows) {
      if (deps.cfBudget) {
        const ok = await deps.cfBudget.tryAcquire();
        if (!ok) {
          logger.warn("cron.reconcile.budget_yield", { cronRunId });
          summary.budgetYielded = true;
          break;
        }
      }
      const out = await customHostnameLifecycle.reconcileOne(db, env, r.id, {
        ...deps,
        cronRunId,
      });
      summary.processed += 1;
      switch (out.action) {
        case "transitioned_active":
          summary.transitionedActive += 1;
          break;
        case "transitioned_failed":
          summary.transitionedFailed += 1;
          break;
        case "transitioned_removed":
        case "cf_404_tombstoned":
          summary.transitionedRemoved += 1;
          break;
        case "error":
          summary.errors += 1;
          break;
        default:
          break;
      }
      logger.info("cron.reconcile.row", {
        cronRunId,
        rowId: r.id,
        action: out.action,
        lifecycleStatus: out.lifecycleStatus,
      });
      // Per-row jitter — desynchronize peer isolates and avoid bursting
      // CF with N requests in <1ms.
      const jitterMs = Math.floor(random() * 100);
      if (jitterMs > 0) {
        await sleep(jitterMs);
      }
    }
    logger.info("cron.reconcile.completed", summary);
    return summary;
  },
};

export type CustomHostnameLifecycleService = typeof customHostnameLifecycle;

/**
 * Snapshot of currently-active custom hostnames, used by the host-header
 * guard to admit valid custom-hostname requests at the edge without a DB
 * lookup on every request. The middleware caches this in the per-isolate
 * memo (`hostGuardSnapshotMemo`); the snapshot is refreshed on TTL or on
 * tenancy invalidation.
 */
export async function listActiveCustomHostnames(
  db: DrizzleClient | Executor
): Promise<readonly string[]> {
  const rows = await db
    .select({ hostname: tenantCustomHostnames.hostname })
    .from(tenantCustomHostnames)
    .where(eq(tenantCustomHostnames.lifecycleStatus, "active"));
  return rows.map((r) => r.hostname);
}

async function refreshSnapshotIfPossible(
  db: DrizzleClient,
  deps: LifecycleDeps
): Promise<void> {
  if (!deps.cache) {
    return;
  }
  const hostnames = await listActiveCustomHostnames(db);
  await writeActiveCustomHostnamesSnapshot(deps.cache, hostnames);
}

export { refreshSnapshotIfPossible };
