import { describe, expect, it } from "vitest";
import {
  assertOperatorMatrixMatchesPolicies,
  OPERATOR_PERMISSIONS,
  type OperatorMatrixRegistryLike,
} from "../operator";
import { createAuthSchema, principalAttribute } from "../schema";

// Mirror the operator-resources.test.ts fixture so the lockstep helper is
// exercised against the same shape consumers use to author operator
// resource policies. If the matrix in operator.ts drifts from the
// `whereGlobalAdminRole(...)` rules below, the helper reports the
// offending action by name.
function buildOperatorRegistry() {
  const auth = createAuthSchema({
    roles: ["global_admin", "user"],
    systemAdminRoles: [],
    relations: [],
    principal: {
      status: principalAttribute<"active">(),
      globalAdminRole: principalAttribute<string | undefined>(),
    },
    globalPolicies: () => [],
  });

  const tenant = auth.createResource<
    { id: string },
    readonly [
      "create",
      "suspend",
      "restore",
      "delete",
      "invite_admin",
      "list",
      "view",
    ]
  >("tenant", {
    actions: [
      "create",
      "suspend",
      "restore",
      "delete",
      "invite_admin",
      "list",
      "view",
    ] as const,
    policies: (p) => [
      p
        .allow("global_admin")
        .to("create", "suspend", "restore", "invite_admin")
        .whereGlobalAdminRole("super_admin", "support"),
      p.allow("global_admin").to("delete").whereGlobalAdminRole("super_admin"),
      p.allow("global_admin").to("list", "view").whereGlobalAdminRole(),
    ],
  });

  const platform = auth.createResource<
    Record<string, never>,
    readonly [
      "view_audit_logs_global",
      "view_system_metrics",
      "manage_feature_flags",
      "manage_global_admins",
      "support_query",
    ]
  >("platform", {
    actions: [
      "view_audit_logs_global",
      "view_system_metrics",
      "manage_feature_flags",
      "manage_global_admins",
      "support_query",
    ] as const,
    policies: (p) => [
      p
        .allow("global_admin")
        .to("view_audit_logs_global", "view_system_metrics")
        .whereGlobalAdminRole(),
      p
        .allow("global_admin")
        .to("manage_feature_flags")
        .whereGlobalAdminRole("super_admin", "support"),
      p
        .allow("global_admin")
        .to("manage_global_admins")
        .whereGlobalAdminRole("super_admin"),
      p
        .allow("global_admin")
        .to("support_query")
        .whereGlobalAdminRole("super_admin", "support"),
    ],
  });

  return auth.buildRegistry({ tenant, platform });
}

describe("assertOperatorMatrixMatchesPolicies (D72 lockstep)", () => {
  it("OPERATOR_PERMISSIONS matches the fixture resource policies", async () => {
    const registry = buildOperatorRegistry();
    // boundary: registry.can has typed action unions per resource;
    // the lockstep helper iterates string keys from the matrix.
    const probe = registry as unknown as OperatorMatrixRegistryLike;
    const report = await assertOperatorMatrixMatchesPolicies(
      OPERATOR_PERMISSIONS,
      probe
    );
    if (!report.ok) {
      // Surface a readable failure list -- the helper already builds a
      // per-action detail string. Joining them gives a single error message
      // that names every drifted action.
      throw new Error(
        `Operator matrix drift:\n${report.mismatches
          .map((m) => `  - ${m.detail}`)
          .join("\n")}`
      );
    }
    expect(report.mismatches).toEqual([]);
  });

  it("reports drift with a per-action detail string when matrix and policy disagree", async () => {
    const registry = buildOperatorRegistry();
    const probe = registry as unknown as OperatorMatrixRegistryLike;
    // Mutate a single matrix entry to disagree with the fixture (the fixture
    // grants tenant.delete to super_admin only; flip it to also include
    // support and verify the helper names the action).
    const drifted = {
      ...OPERATOR_PERMISSIONS,
      "tenant.delete": ["super_admin", "support"],
    } as const;
    const report = await assertOperatorMatrixMatchesPolicies(drifted, probe);
    expect(report.ok).toBe(false);
    expect(report.mismatches).toHaveLength(1);
    const [first] = report.mismatches;
    expect(first?.action).toBe("tenant.delete");
    expect(first?.detail).toContain("tenant.delete");
    expect(first?.detail).toContain("matrix=");
    expect(first?.detail).toContain("policy=");
  });

  it("flags malformed matrix keys", async () => {
    const registry = buildOperatorRegistry();
    const probe = registry as unknown as OperatorMatrixRegistryLike;
    const malformed = { malformed_key: ["super_admin"] } as const;
    const report = await assertOperatorMatrixMatchesPolicies(malformed, probe);
    expect(report.ok).toBe(false);
    expect(report.mismatches[0]?.detail).toContain('"malformed_key"');
  });
});
