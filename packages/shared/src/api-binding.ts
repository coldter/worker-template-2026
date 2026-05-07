export type OnUserCreatedParams = {
  id: string;
  email: string;
  name: string;
};

export type OnNewDeviceLoginParams = {
  userId: string;
  ipAddress: string;
  userAgent: string;
  platform: string;
};

export type AdminStatusMutationParams = {
  userId: string;
  actorId: string;
  reason?: string | null;
};

export type StatusMutationResult =
  | { success: true }
  | { success: false; reason: "not_found" };

export interface ApiBindingRpc {
  adminActivateUser(
    params: Omit<AdminStatusMutationParams, "reason">
  ): Promise<StatusMutationResult>;
  adminDeactivateUser(
    params: AdminStatusMutationParams
  ): Promise<StatusMutationResult>;
  adminUnlockUser(
    params: Omit<AdminStatusMutationParams, "reason">
  ): Promise<StatusMutationResult>;
  onNewDeviceLogin(params: OnNewDeviceLoginParams): Promise<void>;
  onUserCreated(params: OnUserCreatedParams): Promise<{ workflowId: string }>;
}

// B2 / D35 — payload + result shapes for the admin worker's RPC into the
// server's AdminApiEntrypoint. Kept in @repo/shared so both apps reference the
// same structural type without crossing the worker boundary at compile time.
export type AdminApiCreateTenantPayload = {
  slug: string;
  name: string;
  primaryAdminEmail: string;
};

export type AdminApiCreateTenantResult = {
  orgId: string;
  invitationId: string;
};

/**
 * Operator identity payload sent across the service binding from
 * apps/admin to apps/server's `AdminApiEntrypoint`. The admin worker has the
 * full `GlobalAdmin` row in `c.var.globalAdmin`; only the durable subset is
 * forwarded so the wire format does not couple to the DB row layout. The
 * server worker rebuilds the `GlobalAdminActor` it needs from this payload.
 */
export type AdminApiOperatorIdentity = {
  id: string;
  email: string;
  role: "super_admin" | "support" | "read_only" | "security";
};

export interface AdminApiBindingRpc {
  /**
   * B2 / D35 / Audit-fix #2 — operator-led tenant creation. The full operator
   * identity (id/email/role) is forwarded so the server-side audit row records
   * the actor's email and role rather than synthesizing `email: ""` /
   * `role: "support"`. Mirrors the suspend/restore/delete payload shape.
   */
  createTenantOnBehalfOf(
    operator: AdminApiOperatorIdentity,
    payload: AdminApiCreateTenantPayload
  ): Promise<AdminApiCreateTenantResult>;
  /**
   * C5 / D54 — operator-led tenant soft-delete. Tombstones the slug and
   * revokes sessions; idempotent at the service layer.
   */
  deleteTenant(
    organizationId: string,
    operator: AdminApiOperatorIdentity,
    reason?: string
  ): Promise<void>;
  /**
   * C5 / D34 / D54 — operator-led tenant restore. Idempotent.
   */
  restoreTenant(
    organizationId: string,
    operator: AdminApiOperatorIdentity
  ): Promise<void>;
  /**
   * C5 / D34 / D54 — operator-led tenant suspend. Idempotent at the service
   * layer; admin worker maps both first-suspend and re-suspend to 204.
   */
  suspendTenant(
    organizationId: string,
    operator: AdminApiOperatorIdentity,
    reason?: string
  ): Promise<void>;
}

/**
 * Conflict codes thrown by `createTenantOnBehalfOf` when the requested slug
 * cannot be assigned. The HTTP boundary maps each to a 409 response with
 * `{ code: <CODE> }` JSON. Workers RPC preserves `name` + own-enumerable
 * properties on thrown errors, but not class identity — callers must
 * structurally narrow on `code` / `name` (see `tenantConflictCode` helper in
 * apps/server/src/lib/tenants/errors.ts; mirrored here for cross-worker use).
 */
export type TenantConflictCode = "SLUG_RESERVED" | "SLUG_TAKEN";

export function tenantConflictCode(err: unknown): TenantConflictCode | null {
  if (!err || typeof err !== "object") {
    return null;
  }
  // boundary: cross-worker RPC error narrowing — properties are validated
  // structurally before use because BA / pg drivers don't export error
  // classes that survive the service-binding boundary.
  const e = err as { code?: unknown; name?: unknown };
  if (e.code === "SLUG_RESERVED" || e.name === "SlugReservedError") {
    return "SLUG_RESERVED";
  }
  if (e.code === "SLUG_TAKEN" || e.name === "SlugTakenError") {
    return "SLUG_TAKEN";
  }
  return null;
}
