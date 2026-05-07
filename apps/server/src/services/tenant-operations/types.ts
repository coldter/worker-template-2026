/**
 * C5 — `TenantOperator` actor union.
 *
 * Per D54 the `tenantOperations` service is the single owner of tenant CRUD.
 * Per D67 it accepts both `GlobalAdmin` (operator-driven mutations from the
 * apps/admin worker) and `SystemActor` (cron / workflow-driven mutations
 * such as billing-suspension or scheduled cleanup) as first-class actors.
 *
 * The two cases are kept structurally distinct so callers cannot
 * accidentally claim system attribution from the operator branch:
 *
 *  - `global_admin` carries the full `GlobalAdmin` row (id, role, etc.)
 *    so the audit row can record actor id + role-derived metadata.
 *  - `system` requires a free-form `reason` string so the operator-feed
 *    consumer in apps/admin can show a human why the row was written.
 *
 * `ipAddress` and `userAgent` are optional metadata threaded through to
 * the audit row; they are only meaningful for the global-admin branch
 * (system actors have no inbound HTTP request).
 */
import type { OperatorGlobalAdmin as GlobalAdmin } from "@repo/authorization";

export type SystemActor = Readonly<{
  kind: "system";
  /**
   * Free-form reason recorded in the audit metadata (e.g. "cron-billing-
   * suspend", "backfill-from-legacy-admin"). Required so the operator
   * audit feed always shows a human-readable rationale for system-driven
   * mutations.
   */
  reason: string;
}>;

export type GlobalAdminActor = Readonly<{
  kind: "global_admin";
  admin: GlobalAdmin;
  ipAddress?: string;
  userAgent?: string;
}>;

export type TenantOperator = GlobalAdminActor | SystemActor;
