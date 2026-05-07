/**
 * A5 internal lifecycle for tenant custom hostnames (D5 / D74).
 *
 * The internal `customHostnameLifecycle` enum is intentionally separate from
 * Cloudflare's raw `status` / `ssl.status` strings so CF surface changes do
 * not leak into our state machine. `mapCloudflareStatus` is the single source
 * of truth for translating CF state into our 7-state model.
 */

export const customHostnameLifecycle = [
  "pending_txt",
  "awaiting_cf",
  "pre_validation",
  "active",
  "failed",
  "removing",
  "removed",
] as const;

export type CustomHostnameLifecycle = (typeof customHostnameLifecycle)[number];

const FAILED_VERIFICATION_ERRORS = new Set([
  "caa_error",
  "validation_timed_out",
]);

/**
 * Map raw Cloudflare hostname state into our internal lifecycle. Driven from
 * the status mapping table in the A5 plan; every row of that table is covered
 * by a unit test in lifecycle-status.test.ts.
 */
export function mapCloudflareStatus(
  cfStatus: string | null | undefined,
  cfSslStatus: string | null | undefined,
  hasValidationRecords: boolean,
  verificationErrors: readonly string[] = []
): CustomHostnameLifecycle {
  if (!cfStatus) {
    return "pending_txt";
  }

  // CF top-level `deleted` takes precedence over any ssl_status — the
  // hostname has been removed from the zone and the row should tombstone.
  if (cfStatus === "deleted") {
    return "removed";
  }

  // Hard CA / DNS / validation-timeout failures regardless of CF top-level status.
  if (cfSslStatus === "validation_timed_out") {
    return "failed";
  }
  // CF marks expired or operator-deactivated certs `expired` /
  // `deactivated`. Both are terminal failure-shapes from the tenant's
  // perspective — surface as `failed` so the operator sees them in the
  // recent-deactivations feed and the host is removed from the active
  // snapshot.
  if (cfSslStatus === "expired" || cfSslStatus === "deactivated") {
    return "failed";
  }
  for (const e of verificationErrors) {
    if (FAILED_VERIFICATION_ERRORS.has(e) || e.startsWith("caa_error")) {
      return "failed";
    }
  }
  if (cfSslStatus === "caa_error") {
    return "failed";
  }

  switch (cfStatus) {
    case "active":
      if (cfSslStatus === "active") {
        return "active";
      }
      // `pending_expiration` on an active host means the cert is up for
      // renewal — keep the host serving until CF flips to `expired`.
      if (cfSslStatus === "pending_expiration") {
        return "active";
      }
      return "awaiting_cf";
    case "moved":
    case "blocked":
    case "pending_blocked":
      return "failed";
    case "pending":
    case "pending_validation":
    case "pending_issuance":
    case "pending_deployment": {
      if (
        hasValidationRecords &&
        (cfSslStatus === "pending_validation" || cfSslStatus === "pending")
      ) {
        return "pre_validation";
      }
      return "awaiting_cf";
    }
    default:
      // Unknown CF status — keep polling so the reconciler can update us.
      return "awaiting_cf";
  }
}

export function isTerminal(status: CustomHostnameLifecycle): boolean {
  switch (status) {
    case "active":
    case "removed":
      return true;
    case "pending_txt":
    case "awaiting_cf":
    case "pre_validation":
    case "failed":
    case "removing":
      return false;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/**
 * Whether the row should be picked up by the 60s reconciler. Excludes the
 * terminal `removed` state and `pending_txt` (which has no `cfHostnameId`
 * to poll).
 *
 * `removing` is normally writer-owned, but if the writer's CF DELETE
 * threw (transient outage) the row would be pinned forever. Allow the
 * reconciler to retry once the row has been in `removing` for at least
 * `removingRetryAfterMs` (defaults to never — callers pass the threshold
 * from `lifecycle.ts`). The age check is on the lifecycle service side
 * because the reconciler row select needs to filter on the same field.
 */
export function isReconcilable(
  status: CustomHostnameLifecycle,
  lastReconciledAt: Date | null = null,
  now: Date = new Date(),
  removingRetryAfterMs: number = Number.POSITIVE_INFINITY
): boolean {
  switch (status) {
    case "awaiting_cf":
    case "pre_validation":
    case "failed":
    case "active":
      return true;
    case "removing": {
      if (!lastReconciledAt) {
        // No timestamp yet — the writer just set the row; let it finish.
        return false;
      }
      return now.getTime() - lastReconciledAt.getTime() >= removingRetryAfterMs;
    }
    case "pending_txt":
    case "removed":
      return false;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
