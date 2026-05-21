import { describe, expect, it } from "vitest";
import { principalNotActive } from "../conditions";
import { evaluate } from "../evaluator";
import type {
  Condition,
  ConditionContext,
  PolicyRule,
  Principal,
} from "../types";

function allowRule(
  roles: string[] | "*",
  actions: string[] | "*",
  conditions: Condition[] = []
): PolicyRule {
  const roleLabel = roles === "*" ? "*" : roles.join(",");
  const actionLabel = actions === "*" ? "*" : actions.join(",");
  return {
    effect: "allow",
    roles,
    actions,
    conditions,
    label: `allow:${roleLabel}:${actionLabel}`,
  };
}

function denyRule(
  roles: string[] | "*",
  actions: string[] | "*",
  conditions: Condition[] = []
): PolicyRule {
  const roleLabel = roles === "*" ? "*" : roles.join(",");
  const actionLabel = actions === "*" ? "*" : actions.join(",");
  return {
    effect: "deny",
    roles,
    actions,
    conditions,
    label: `deny:${roleLabel}:${actionLabel}`,
  };
}

const activePrincipal: Principal = {
  id: "usr_1",
  roles: ["user"],
  attributes: { status: "active" },
};

const inactivePrincipal: Principal = {
  id: "usr_2",
  roles: ["user"],
  attributes: { status: "inactive" },
};

function ownerCondition(): Condition {
  return {
    type: "whereOwner",
    effect: "requires_resource",
    label: "whereOwner",
    evaluate(ctx: ConditionContext): boolean {
      if (!ctx.resource) {
        return false;
      }
      return (ctx.resource as { ownerId: string }).ownerId === ctx.principal.id;
    },
  };
}

function selfTargetCondition(): Condition {
  return {
    type: "whereTargetIsSelf",
    effect: "requires_resource",
    label: "whereTargetIsSelf",
    evaluate(ctx: ConditionContext): boolean {
      if (!ctx.resource) {
        return false;
      }
      return (ctx.resource as { id: string }).id === ctx.principal.id;
    },
  };
}

function asyncTrueCondition(): Condition {
  return {
    type: "where",
    effect: "requires_resource",
    label: "where:asyncTrue",
    async evaluate(_ctx: ConditionContext): Promise<boolean> {
      return Promise.resolve(true);
    },
  };
}

function asyncFalseCondition(): Condition {
  return {
    type: "where",
    effect: "requires_resource",
    label: "where:asyncFalse",
    async evaluate(_ctx: ConditionContext): Promise<boolean> {
      return Promise.resolve(false);
    },
  };
}

function throwingCondition(): Condition {
  return {
    type: "where",
    effect: "principal_only",
    label: "where:throws",
    evaluate(): boolean {
      throw new Error("boom");
    },
  };
}

const defaults = {
  action: "read",
  resourceName: "document",
  globalPolicies: [] as PolicyRule[],
  resourcePolicies: [] as PolicyRule[],
  systemAdminRoles: [] as string[],
} as const;

describe("evaluate", () => {
  it("denies with UNAUTHENTICATED when principal is null", async () => {
    const result = await evaluate({ ...defaults, principal: null });
    expect(result).toEqual({ allowed: false, reason: "UNAUTHENTICATED" });
  });

  it("denies with UNAUTHENTICATED when principal is undefined", async () => {
    const result = await evaluate({ ...defaults, principal: undefined });
    expect(result).toEqual({ allowed: false, reason: "UNAUTHENTICATED" });
  });

  it("denies with GLOBAL_DENY when a global deny policy matches", async () => {
    const result = await evaluate({
      ...defaults,
      principal: inactivePrincipal,
      globalPolicies: [denyRule("*", "*", [principalNotActive()])],
    });
    expect(result).toEqual({
      allowed: false,
      reason: "GLOBAL_DENY",
      matchedPolicy: "deny:*:*",
    });
  });

  it("principalNotActive global deny fires for inactive user", async () => {
    const result = await evaluate({
      ...defaults,
      principal: inactivePrincipal,
      globalPolicies: [denyRule("*", "*", [principalNotActive()])],
      resourcePolicies: [allowRule(["user"], ["read"])],
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("GLOBAL_DENY");
    }
  });

  it("does not fire global deny when principal is active", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      globalPolicies: [denyRule("*", "*", [principalNotActive()])],
      resourcePolicies: [allowRule(["user"], ["read"])],
    });
    expect(result.allowed).toBe(true);
  });

  it("denies with EXPLICIT_DENY when a resource deny matches", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      resourcePolicies: [denyRule(["user"], ["read"])],
    });
    expect(result).toEqual({
      allowed: false,
      reason: "EXPLICIT_DENY",
      matchedPolicy: "deny:user:read",
    });
  });

  it("allows when a resource allow rule matches", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      resourcePolicies: [allowRule(["user"], ["read"])],
    });
    expect(result).toEqual({
      allowed: true,
      matchedPolicy: "allow:user:read",
    });
  });

  it("denies with NO_MATCHING_POLICY when no policies match", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      action: "delete",
      resourcePolicies: [allowRule(["admin"], ["delete"])],
    });
    expect(result).toEqual({ allowed: false, reason: "NO_MATCHING_POLICY" });
  });

  it("denies with NO_MATCHING_POLICY when policies list is empty", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
    });
    expect(result).toEqual({ allowed: false, reason: "NO_MATCHING_POLICY" });
  });

  it("deny beats allow when both match the same role and action", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      resourcePolicies: [
        allowRule(["user"], ["read"]),
        denyRule(["user"], ["read"]),
      ],
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("EXPLICIT_DENY");
    }
  });

  it("wildcard role matches any principal role", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      resourcePolicies: [allowRule("*", ["read"])],
    });
    expect(result.allowed).toBe(true);
  });

  it("wildcard action matches any requested action", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      action: "anything",
      resourcePolicies: [allowRule(["user"], "*")],
    });
    expect(result.allowed).toBe(true);
  });

  it("skips policy with resource condition when no resource provided", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      resourcePolicies: [allowRule(["user"], ["read"], [ownerCondition()])],
    });
    expect(result).toEqual({ allowed: false, reason: "NO_MATCHING_POLICY" });
  });

  it("skips deny policy with resource condition when no resource provided", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      resourcePolicies: [
        denyRule(["user"], ["read"], [ownerCondition()]),
        allowRule(["user"], ["read"]),
      ],
    });
    expect(result.allowed).toBe(true);
  });

  it("allows when owner condition matches", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      resource: { ownerId: "usr_1" },
      resourcePolicies: [allowRule(["user"], ["read"], [ownerCondition()])],
    });
    expect(result.allowed).toBe(true);
  });

  it("denies when owner condition does not match", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      resource: { ownerId: "usr_other" },
      resourcePolicies: [allowRule(["user"], ["read"], [ownerCondition()])],
    });
    expect(result).toEqual({ allowed: false, reason: "NO_MATCHING_POLICY" });
  });

  it("allows when target-is-self condition matches", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      resource: { id: "usr_1" },
      resourcePolicies: [
        allowRule(["user"], ["read"], [selfTargetCondition()]),
      ],
    });
    expect(result.allowed).toBe(true);
  });

  it("denies when target-is-self condition does not match", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      resource: { id: "usr_other" },
      resourcePolicies: [
        allowRule(["user"], ["read"], [selfTargetCondition()]),
      ],
    });
    expect(result).toEqual({ allowed: false, reason: "NO_MATCHING_POLICY" });
  });

  it("resolves async condition that returns true", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      resource: { id: "x" },
      resourcePolicies: [allowRule(["user"], ["read"], [asyncTrueCondition()])],
    });
    expect(result.allowed).toBe(true);
  });

  it("resolves async condition that returns false", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      resource: { id: "x" },
      resourcePolicies: [
        allowRule(["user"], ["read"], [asyncFalseCondition()]),
      ],
    });
    expect(result).toEqual({ allowed: false, reason: "NO_MATCHING_POLICY" });
  });

  it("returns EVALUATION_ERROR when a condition throws", async () => {
    const result = await evaluate({
      ...defaults,
      principal: activePrincipal,
      resourcePolicies: [allowRule(["user"], ["read"], [throwingCondition()])],
    });
    expect(result).toEqual({ allowed: false, reason: "EVALUATION_ERROR" });
  });

  describe("org scoping", () => {
    const orgPrincipal: Principal = {
      id: "usr_org",
      roles: ["member"],
      attributes: { status: "active" },
      organization: { id: "org_1", role: "editor" },
    };

    const noOrgPrincipal: Principal = {
      id: "usr_no_org",
      roles: ["member"],
      attributes: { status: "active" },
    };

    const sysAdminPrincipal: Principal = {
      id: "usr_sa",
      roles: ["system_admin"],
      attributes: { status: "active" },
    };

    const resolveOrganization = (
      resource: unknown
    ): string | null | undefined => {
      const r = resource as { orgId?: string | null | undefined } | undefined;
      if (!r) {
        return;
      }
      return r.orgId;
    };

    it("allows when org IDs match", async () => {
      const result = await evaluate({
        ...defaults,
        principal: orgPrincipal,
        resource: { orgId: "org_1" },
        resolveOrganization,
        resourcePolicies: [allowRule(["member"], ["read"])],
        systemAdminRoles: ["system_admin"],
      });
      expect(result.allowed).toBe(true);
    });

    it("denies with ORG_CONTEXT_MISSING when principal has no active org", async () => {
      const result = await evaluate({
        ...defaults,
        principal: noOrgPrincipal,
        resource: { orgId: "org_1" },
        resolveOrganization,
        resourcePolicies: [allowRule(["member"], ["read"])],
        systemAdminRoles: ["system_admin"],
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("ORG_CONTEXT_MISSING");
      }
    });

    it("denies with ORG_RESOLUTION_FAILED when resolveOrganization returns null", async () => {
      const result = await evaluate({
        ...defaults,
        principal: orgPrincipal,
        resource: { orgId: null },
        resolveOrganization,
        resourcePolicies: [allowRule(["member"], ["read"])],
        systemAdminRoles: ["system_admin"],
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("ORG_RESOLUTION_FAILED");
      }
    });

    it("denies with TENANT_MISMATCH when org IDs do not match", async () => {
      const result = await evaluate({
        ...defaults,
        principal: orgPrincipal,
        resource: { orgId: "org_other" },
        resolveOrganization,
        resourcePolicies: [allowRule(["member"], ["read"])],
        systemAdminRoles: ["system_admin"],
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("TENANT_MISMATCH");
      }
    });

    it("system admin bypasses org scoping", async () => {
      const result = await evaluate({
        ...defaults,
        principal: sysAdminPrincipal,
        resource: { orgId: "org_any" },
        resolveOrganization,
        resourcePolicies: [allowRule(["system_admin"], ["read"])],
        systemAdminRoles: ["system_admin"],
      });
      expect(result.allowed).toBe(true);
    });

    it("system admin bypasses org scoping even with wildcard role policy", async () => {
      const result = await evaluate({
        ...defaults,
        principal: sysAdminPrincipal,
        resource: { orgId: "org_any" },
        resolveOrganization,
        resourcePolicies: [allowRule("*", ["read"])],
        systemAdminRoles: ["system_admin"],
      });
      expect(result.allowed).toBe(true);
    });

    // Regression: system admin bypass must consider ALL principal roles, not
    // just the first role that intersects the policy's role list. Previously
    // checkOrgScoping used Array.prototype.find which picked an arbitrary
    // matched role and only consulted that one for systemAdmin membership.
    it("system admin bypasses org scoping when admin is not the first matched policy role", async () => {
      const principalWithAdminAndMember: Principal = {
        id: "usr_dual",
        roles: ["admin", "member"],
        attributes: { status: "active" },
      };
      const result = await evaluate({
        ...defaults,
        principal: principalWithAdminAndMember,
        resource: { orgId: "org_any" },
        resolveOrganization,
        // policy lists "member" first; legacy find() bug would pick "member"
        // and skip the system-admin bypass even though principal has admin.
        resourcePolicies: [allowRule(["member", "admin"], ["read"])],
        systemAdminRoles: ["admin"],
        // Note: principalWithAdminAndMember has no organization context,
        // so without the bypass this would deny with ORG_CONTEXT_MISSING.
      });
      expect(result.allowed).toBe(true);
    });

    // Org scoping only applies when resolveOrganization is provided and resource is present
    it("skips org check when resolveOrganization is not provided", async () => {
      const result = await evaluate({
        ...defaults,
        principal: noOrgPrincipal,
        resource: { orgId: "org_1" },
        // no resolveOrganization
        resourcePolicies: [allowRule(["member"], ["read"])],
        systemAdminRoles: [],
      });
      expect(result.allowed).toBe(true);
    });

    it("skips org check when resource is not provided (capabilities mode)", async () => {
      // ignoreResourceConditions = true is the capabilities path: nav/UI
      // gating runs without a concrete resource by design.
      const result = await evaluate({
        ...defaults,
        principal: noOrgPrincipal,
        resolveOrganization,
        // no resource
        resourcePolicies: [allowRule(["member"], ["read"])],
        systemAdminRoles: [],
        ignoreResourceConditions: true,
      });
      expect(result.allowed).toBe(true);
    });

    // RESOURCE_REQUIRED -- routes that forget loadResource() must fail closed
    // when the resource declares resolveOrganization. Without this guard a
    // broad role-only allow could leak across tenants.
    it("denies with RESOURCE_REQUIRED when resolveOrganization is set but no resource provided", async () => {
      const result = await evaluate({
        ...defaults,
        principal: orgPrincipal,
        resolveOrganization,
        // no resource provided
        resourcePolicies: [allowRule(["member"], ["read"])],
        systemAdminRoles: [],
      });
      expect(result).toEqual({ allowed: false, reason: "RESOURCE_REQUIRED" });
    });

    // Cross-tenant deny: when a deny policy WOULD have matched but the
    // resource lives in a different tenant, the result must short-circuit to
    // a DENY (TENANT_MISMATCH), not silently skip.
    it("short-circuits a cross-tenant deny to TENANT_MISMATCH", async () => {
      const result = await evaluate({
        ...defaults,
        principal: orgPrincipal,
        resource: { orgId: "org_other" },
        resolveOrganization,
        resourcePolicies: [
          denyRule(["member"], ["read"]),
          allowRule(["member"], ["read"]),
        ],
        systemAdminRoles: [],
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("TENANT_MISMATCH");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Evaluation order
  // -----------------------------------------------------------------------

  describe("evaluation order", () => {
    it("checks global deny before resource deny", async () => {
      const result = await evaluate({
        ...defaults,
        principal: inactivePrincipal,
        globalPolicies: [denyRule("*", "*", [principalNotActive()])],
        resourcePolicies: [denyRule(["user"], ["read"])],
      });
      // Global deny fires first
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("GLOBAL_DENY");
      }
    });

    it("checks resource deny before resource allow", async () => {
      const result = await evaluate({
        ...defaults,
        principal: activePrincipal,
        resourcePolicies: [
          allowRule(["user"], ["read"]),
          denyRule(["user"], ["read"]),
        ],
      });
      // Deny is checked first regardless of array order
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("EXPLICIT_DENY");
      }
    });

    it("global deny only fires for deny effect policies", async () => {
      // An allow rule in globalPolicies is not checked in the global deny phase
      const result = await evaluate({
        ...defaults,
        principal: activePrincipal,
        globalPolicies: [allowRule("*", "*")],
        resourcePolicies: [],
      });
      // The global allow is ignored; no resource policies match -> default deny
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("NO_MATCHING_POLICY");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Multiple conditions (AND logic)
  // -----------------------------------------------------------------------

  describe("multiple conditions (AND)", () => {
    it("requires all conditions to pass for a policy to match", async () => {
      const result = await evaluate({
        ...defaults,
        principal: activePrincipal,
        resource: { id: "usr_1", ownerId: "usr_1" },
        resourcePolicies: [
          allowRule(
            ["user"],
            ["read"],
            [ownerCondition(), selfTargetCondition()]
          ),
        ],
      });
      expect(result.allowed).toBe(true);
    });

    it("fails when one of multiple conditions does not pass", async () => {
      const result = await evaluate({
        ...defaults,
        principal: activePrincipal,
        resource: { id: "usr_other", ownerId: "usr_1" },
        resourcePolicies: [
          allowRule(
            ["user"],
            ["read"],
            [ownerCondition(), selfTargetCondition()]
          ),
        ],
      });
      expect(result).toEqual({ allowed: false, reason: "NO_MATCHING_POLICY" });
    });
  });
});
