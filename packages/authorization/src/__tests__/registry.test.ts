import { describe, expect, it } from "vitest";
import { principalNotActive } from "../conditions";
import { createAuthSchema } from "../schema";
import type { Principal } from "../types";

describe("buildRegistry runtime safety", () => {
  const auth = createAuthSchema({
    globalPolicies: (p) => [
      p.deny("*").to("*").whereCondition(principalNotActive()),
    ],
    roles: ["admin", "user"],
    systemAdminRoles: ["admin"],
  });

  interface TestResource {
    createdBy: string;
    id: string;
  }

  const testResource = auth.createResource<TestResource>()("test", {
    actions: ["list", "view", "create", "update", "delete"],
    policies: (p) => [
      p.allow("admin").to("*"),
      p.allow("user").to("list"),
      p.allow("user").to("view", "update").whereOwner(),
      p.deny("*").to("delete").whereTargetIsSelf(),
    ],
    resolveOwner: (r) => r.createdBy,
  });

  const registry = auth.buildRegistry({ test: testResource });

  const adminPrincipal: Principal = {
    attributes: { status: "active" },
    id: "usr_admin",
    roles: ["admin"],
  };

  it("denies unknown actions at runtime instead of matching wildcard policies", async () => {
    // @ts-expect-error -- "fly" is not a declared action on test
    const decision = await registry.can(adminPrincipal, "test", "fly");
    expect(decision).toEqual({ allowed: false, reason: "NO_MATCHING_POLICY" });
  });

  it("denies unknown resource names without throwing", async () => {
    // @ts-expect-error -- "ghost" is not a registry resource
    const decision = await registry.can(adminPrincipal, "ghost", "list");
    expect(decision).toEqual({ allowed: false, reason: "NO_MATCHING_POLICY" });
  });

  it("denies prototype property names without throwing", async () => {
    const resourceDecision = await registry.can(
      adminPrincipal,
      // @ts-expect-error -- "toString" is not a registry resource
      "toString",
      "list"
    );
    expect(resourceDecision).toEqual({
      allowed: false,
      reason: "NO_MATCHING_POLICY",
    });

    const actionDecision = await registry.can(
      adminPrincipal,
      "test",
      // @ts-expect-error -- "toString" is not a declared action on test
      "toString"
    );
    expect(actionDecision).toEqual({
      allowed: false,
      reason: "NO_MATCHING_POLICY",
    });
  });

  it("assertCan rejects unknown actions", async () => {
    // @ts-expect-error -- "explode" is not a declared action on test
    const pending = registry.assertCan(adminPrincipal, "test", "explode");
    await expect(pending).rejects.toMatchObject({
      reason: "NO_MATCHING_POLICY",
    });
  });
});
