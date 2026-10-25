/* oxlint-disable vitest/prefer-to-be-truthy, vitest/prefer-to-be-falsy -- strict boolean assertions are intentional */
import { describe, expect, it } from "vitest";

import { principalNotActive } from "../conditions";
import { AuthorizationError } from "../errors";
import { createAuthSchema } from "../schema";
import type { Principal } from "../types";

describe("integration: single-tenant", () => {
  const auth = createAuthSchema({
    globalPolicies: (p) => [
      p.deny("*").to("*").whereCondition(principalNotActive()),
    ],
    roles: ["admin", "user"],
    systemAdminRoles: ["admin"],
  });

  interface UserResource {
    createdBy: string;
    email: string;
    id: string;
  }

  const userResource = auth.createResource<UserResource>()("user", {
    actions: ["list", "view", "create", "update", "delete", "deactivate"],
    policies: (p) => [
      p.allow("admin").to("*"),
      p.allow("user").to("list"),
      p.allow("user").to("view", "update").whereOwner(),
      p.deny("*").to("delete").whereTargetIsSelf(),
      p.deny("*").to("deactivate").whereTargetIsSelf(),
    ],
    resolveOwner: (r) => r.createdBy,
  });

  const registry = auth.buildRegistry({ user: userResource });

  const admin: Principal = {
    attributes: { email: "admin@test.com", status: "active" },
    id: "usr_admin",
    roles: ["admin"],
  };

  const user1: Principal = {
    attributes: { email: "user1@test.com", status: "active" },
    id: "usr_1",
    roles: ["user"],
  };

  const inactiveUser: Principal = {
    attributes: { email: "inactive@test.com", status: "inactive" },
    id: "usr_inactive",
    roles: ["user"],
  };

  it("admin can do everything", async () => {
    const actions = ["list", "view", "create", "update", "deactivate"] as const;

    const decisions = await Promise.all(
      actions.map((action) =>
        registry.can(admin, "user", action, {
          resource: {
            createdBy: "usr_other",
            email: "other@test.com",
            id: "usr_other",
          },
        })
      )
    );

    for (const decision of decisions) {
      expect(decision.allowed).toBe(true);
    }
  });

  it("user can list but not delete", async () => {
    const listDecision = await registry.can(user1, "user", "list");
    expect(listDecision.allowed).toBe(true);

    const deleteDecision = await registry.can(user1, "user", "delete", {
      resource: { createdBy: "usr_other", email: "o@t.com", id: "usr_other" },
    });

    expect(deleteDecision).toMatchObject({
      allowed: false,
      reason: "NO_MATCHING_POLICY",
    });
  });

  it("user can view and update own profile via ownership", async () => {
    const ownResource: UserResource = {
      createdBy: "usr_1",
      email: "user1@test.com",
      id: "res_1",
    };

    const viewDecision = await registry.can(user1, "user", "view", {
      resource: ownResource,
    });

    expect(viewDecision.allowed).toBe(true);

    const updateDecision = await registry.can(user1, "user", "update", {
      resource: ownResource,
    });

    expect(updateDecision.allowed).toBe(true);
  });

  it("user cannot view or update another's profile", async () => {
    const otherResource: UserResource = {
      createdBy: "usr_other",
      email: "other@test.com",
      id: "res_other",
    };

    const viewDecision = await registry.can(user1, "user", "view", {
      resource: otherResource,
    });

    expect(viewDecision.allowed).toBe(false);

    const updateDecision = await registry.can(user1, "user", "update", {
      resource: otherResource,
    });

    expect(updateDecision.allowed).toBe(false);
  });

  it("user cannot delete themselves (deny with whereTargetIsSelf)", async () => {
    const selfResource: UserResource = {
      createdBy: "usr_admin",
      email: "admin@test.com",
      id: "usr_admin",
    };

    const decision = await registry.can(admin, "user", "delete", {
      resource: selfResource,
    });

    expect(decision).toMatchObject({ allowed: false, reason: "EXPLICIT_DENY" });
  });

  it("inactive user is denied by global policy", async () => {
    const decision = await registry.can(inactiveUser, "user", "list");
    expect(decision).toMatchObject({ allowed: false, reason: "GLOBAL_DENY" });
  });

  it("inactive user is denied even for owned resources", async () => {
    const ownResource: UserResource = {
      createdBy: "usr_inactive",
      email: "inactive@test.com",
      id: "res_1",
    };

    const decision = await registry.can(inactiveUser, "user", "view", {
      resource: ownResource,
    });

    expect(decision).toMatchObject({ allowed: false, reason: "GLOBAL_DENY" });
  });

  it("evaluateCapabilities returns all true for admin", async () => {
    const caps = await registry.evaluateCapabilities(admin);

    const keys = [
      "user:list",
      "user:view",
      "user:create",
      "user:update",
      "user:delete",
      "user:deactivate",
    ] as const;

    for (const key of keys) {
      expect(caps[key]).toBe(true);
    }
  });

  it("evaluateCapabilities returns correct map for user", async () => {
    const caps = await registry.evaluateCapabilities(user1);
    expect(caps["user:list"]).toBe(true);

    expect(caps["user:create"]).toBe(false);

    expect(caps["user:delete"]).toBe(false);

    expect(caps["user:deactivate"]).toBe(false);
  });

  it("evaluateCapabilities reports true for conditionally-allowed actions (whereOwner)", async () => {
    const caps = await registry.evaluateCapabilities(user1);

    expect(caps["user:view"]).toBe(true);
    expect(caps["user:update"]).toBe(true);
  });

  it("assertCan throws AuthorizationError on deny", async () => {
    await expect(registry.assertCan(user1, "user", "create")).rejects.toThrow(
      AuthorizationError
    );
  });

  it("assertCan does not throw on allow", async () => {
    await expect(
      registry.assertCan(admin, "user", "list")
    ).resolves.toBeUndefined();
  });

  it("can() returns allowed=true for permitted actions", async () => {
    const adminList = await registry.can(admin, "user", "list");
    const userList = await registry.can(user1, "user", "list");
    const userCreate = await registry.can(user1, "user", "create");
    const inactiveList = await registry.can(inactiveUser, "user", "list");

    expect(adminList.allowed).toBe(true);
    expect(userList.allowed).toBe(true);
    expect(userCreate.allowed).toBe(false);
    expect(inactiveList.allowed).toBe(false);
  });
});

describe("integration: multi-tenant", () => {
  const auth = createAuthSchema({
    globalPolicies: (p) => [
      p.deny("*").to("*").whereCondition(principalNotActive()),
    ],
    organizationRoles: ["owner", "admin", "member"],
    roles: ["admin", "member"],
    systemAdminRoles: ["admin"],
  });

  interface ProjectResource {
    createdBy: string;
    id: string;
    organizationId: string;
  }

  const projectResource = auth.createResource<ProjectResource>()("project", {
    actions: ["list", "view", "create", "update", "delete"],
    policies: (p) => [
      p.allow("admin").to("*"),
      p.allow("member").to("list", "view").withOrgRole("member"),
      p.allow("member").to("*").withOrgRole("owner", "admin"),
      p.allow("member").to("update").whereOwner(),
    ],
    resolveOrganization: (r) => r.organizationId,
    resolveOwner: (r) => r.createdBy,
  });

  const registry = auth.buildRegistry({ project: projectResource });

  const orgMember: Principal = {
    attributes: { status: "active" },
    id: "usr_org_member",
    organization: { id: "org_1", role: "member" },
    roles: ["member"],
  };

  const orgOwner: Principal = {
    attributes: { status: "active" },
    id: "usr_org_owner",
    organization: { id: "org_1", role: "owner" },
    roles: ["member"],
  };

  const sysAdmin: Principal = {
    attributes: { status: "active" },
    id: "usr_sys_admin",
    roles: ["admin"],
  };

  const noOrgUser: Principal = {
    attributes: { status: "active" },
    id: "usr_no_org",
    roles: ["member"],
  };

  const project1: ProjectResource = {
    createdBy: "usr_org_member",
    id: "proj_1",
    organizationId: "org_1",
  };

  const projectOtherOrg: ProjectResource = {
    createdBy: "usr_other",
    id: "proj_2",
    organizationId: "org_2",
  };

  it("org member in matching org can list project", async () => {
    const decision = await registry.can(orgMember, "project", "list", {
      resource: project1,
    });

    expect(decision.allowed).toBe(true);
  });

  it("org owner in matching org can delete project", async () => {
    const decision = await registry.can(orgOwner, "project", "delete", {
      resource: project1,
    });

    expect(decision.allowed).toBe(true);
  });

  it("org member in wrong org is denied", async () => {
    const decision = await registry.can(orgMember, "project", "list", {
      resource: projectOtherOrg,
    });

    expect(decision.allowed).toBe(false);
  });

  it("user with no org context is denied for org-scoped resource", async () => {
    const decision = await registry.can(noOrgUser, "project", "list", {
      resource: project1,
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "ORG_CONTEXT_MISSING",
    });
  });

  it("system admin bypasses org check and can access any org resource", async () => {
    const decision = await registry.can(sysAdmin, "project", "delete", {
      resource: project1,
    });

    expect(decision.allowed).toBe(true);
  });
});
