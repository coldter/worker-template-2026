/**
 * D71 / D72 — operator authorization. Production-grade matrix that replaces
 * Phase B1's `OPERATOR_PERMISSIONS_LITE` shim. Keys are `${resource}.${action}`
 * strings; values list the `global_admin` sub-roles that may invoke the action.
 *
 * The `OperatorAction` type is derived from the keys of this object so the
 * matrix and the type cannot drift. Adding a new action is a single map entry;
 * adding a new role is a one-line type union update plus matrix bumps.
 *
 * This module is intentionally framework-agnostic. The Hono adapter that
 * surfaces the matrix as a per-route middleware lives in `./hono-operator.ts`.
 */
export type GlobalAdminRole =
  | "super_admin"
  | "support"
  | "read_only"
  | "security";

/**
 * Minimal global-admin shape consumed by `canOperator` / `requireOperator`.
 * Mirrors the durable subset of `@repo/db`'s `globalAdmins.$inferSelect` so
 * authorization stays decoupled from the DB row layout.
 */
export type GlobalAdmin = {
  id: string;
  email: string;
  role: GlobalAdminRole;
  deactivatedAt: Date | null;
};

/**
 * D72 — declarative permission matrix. Coexists with `whereGlobalAdminRole`
 * in resource policies; this matrix powers the per-route Hono middleware
 * gate while resource policies power service-layer assertions.
 */
export const OPERATOR_PERMISSIONS = {
  "tenant.create": ["super_admin", "support"],
  "tenant.suspend": ["super_admin", "support"],
  "tenant.restore": ["super_admin", "support"],
  "tenant.delete": ["super_admin"],
  "tenant.invite_admin": ["super_admin", "support"],
  "tenant.list": ["super_admin", "support", "read_only", "security"],
  "tenant.view": ["super_admin", "support", "read_only", "security"],
  "platform.view_audit_logs_global": [
    "super_admin",
    "support",
    "read_only",
    "security",
  ],
  "platform.view_system_metrics": [
    "super_admin",
    "support",
    "read_only",
    "security",
  ],
  "platform.manage_feature_flags": ["super_admin", "support"],
  "platform.manage_global_admins": ["super_admin"],
  "platform.support_query": ["super_admin", "support"],
} as const satisfies Record<string, readonly GlobalAdminRole[]>;

/** D71 — derived from `OPERATOR_PERMISSIONS` keys; no manual sync. */
export type OperatorAction = keyof typeof OPERATOR_PERMISSIONS;

export type OperatorMatrix = Record<string, readonly GlobalAdminRole[]>;

/**
 * Pure boolean check used by `requireOperator` and any service-layer code that
 * needs the operator gate without an HTTP context.
 */
export function canOperator(
  admin: GlobalAdmin,
  action: OperatorAction
): boolean {
  if (admin.deactivatedAt) {
    return false;
  }
  const allowed: readonly GlobalAdminRole[] = OPERATOR_PERMISSIONS[action];
  return allowed.includes(admin.role);
}

/**
 * Result reported by `assertOperatorMatrixMatchesPolicies`. `mismatches`
 * lists operator-actions whose matrix-derived allow-set differs from the
 * resource-policy allow-set computed via `whereGlobalAdminRole`.
 */
export interface OperatorMatrixDriftReport {
  mismatches: Array<{
    action: string;
    matrix: readonly GlobalAdminRole[];
    policy: readonly GlobalAdminRole[];
    detail: string;
  }>;
  ok: boolean;
}

/**
 * Registry-shaped input accepted by the lockstep helper. Restated as a
 * structural type so the helper does not pull `RegistryInstance`'s heavier
 * per-resource action unions. The helper iterates matrix keys at runtime,
 * so it must call `can(...)` with arbitrary `string` actions; we accept a
 * loosely-typed `can` here and the concrete registry's stricter signature
 * is widened via a single cast at the call site.
 */
export interface OperatorMatrixRegistryLike {
  // boundary: callers pass a `RegistryInstance` whose `can` is generic
  // over typed action unions per resource. The helper iterates `string`
  // keys from the matrix at runtime, so the public input type widens to
  // `string` here and the assignment is performed via `as unknown as
  // OperatorMatrixRegistryLike` at the call site (the runtime registry
  // tolerates string actions and returns `NO_MATCHING_POLICY` for
  // unknown ones).
  can(
    principal: {
      id: string;
      roles: string[];
      attributes: Record<string, unknown>;
    },
    resource: string,
    action: string
  ): Promise<{ allowed: boolean }>;
}

const ALL_ROLES: readonly GlobalAdminRole[] = [
  "super_admin",
  "support",
  "read_only",
  "security",
];

function operatorPrincipal(role: GlobalAdminRole) {
  return {
    id: "lockstep-probe",
    roles: ["global_admin"],
    attributes: { status: "active", globalAdminRole: role },
  };
}

function setsEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const aSet = new Set<T>(a);
  for (const item of b) {
    if (!aSet.has(item)) {
      return false;
    }
  }
  return true;
}

/**
 * Lockstep guard for D72: compares the declarative `OPERATOR_PERMISSIONS`
 * matrix to the allow-set produced by a resource registry's policies. For
 * each `${resource}.${action}` key in the matrix, the helper probes the
 * registry with each `GlobalAdminRole` in turn and asserts that the
 * resulting allow-set matches the matrix entry. Drift is reported per-action
 * with a human-readable detail string.
 *
 * Use this in a test that boots the consumer's resource registry with the
 * same fixture (or production policies) it wires into Hono.
 */
export async function assertOperatorMatrixMatchesPolicies(
  matrix: OperatorMatrix,
  registry: OperatorMatrixRegistryLike
): Promise<OperatorMatrixDriftReport> {
  const mismatches: OperatorMatrixDriftReport["mismatches"] = [];

  for (const [key, expectedRoles] of Object.entries(matrix)) {
    const dot = key.indexOf(".");
    if (dot < 0) {
      mismatches.push({
        action: key,
        matrix: expectedRoles,
        policy: [],
        detail: `Matrix key "${key}" is not in "<resource>.<action>" form.`,
      });
      continue;
    }
    const resource = key.slice(0, dot);
    const action = key.slice(dot + 1);

    const policyAllow: GlobalAdminRole[] = [];
    for (const role of ALL_ROLES) {
      const decision = await registry.can(
        operatorPrincipal(role),
        resource,
        action
      );
      if (decision.allowed) {
        policyAllow.push(role);
      }
    }

    if (!setsEqual(expectedRoles, policyAllow)) {
      const matrixSorted = [...expectedRoles].sort();
      const policySorted = [...policyAllow].sort();
      mismatches.push({
        action: key,
        matrix: expectedRoles,
        policy: policyAllow,
        detail:
          `Operator matrix vs policy drift for "${key}": ` +
          `matrix=[${matrixSorted.join(",")}] policy=[${policySorted.join(",")}]`,
      });
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}
