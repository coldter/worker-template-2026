import { describe, expect, expectTypeOf, it } from "vitest";
import { principalNotActive } from "../conditions";
import { createAuthSchema, principalAttribute } from "../schema";

describe("createAuthSchema", () => {
  it("infers role literal types", () => {
    const auth = createAuthSchema({
      globalPolicies: () => [],
      principal: { status: principalAttribute<string>() },
      relations: [],
      roles: ["admin", "user"],
      systemAdminRoles: ["admin"],
    });

    expect(auth.roleValues).toEqual(["admin", "user"]);
    expectTypeOf(auth.roleValues).toEqualTypeOf<
      readonly ("admin" | "user")[]
    >();
  });

  it("infers relation literal types", () => {
    const auth = createAuthSchema({
      globalPolicies: () => [],
      principal: { status: principalAttribute<string>() },
      relations: ["owner", "member"],
      roles: ["admin"],
      systemAdminRoles: ["admin"],
    });

    expect(auth.relationValues).toEqual(["owner", "member"]);
  });

  it("supports optional organizationRoles", () => {
    const auth = createAuthSchema({
      globalPolicies: () => [],
      organizationRoles: ["owner", "admin", "member"],
      principal: { status: principalAttribute<string>() },
      relations: [],
      roles: ["admin"],
      systemAdminRoles: ["admin"],
    });

    expect(auth.orgRoleValues).toEqual(["owner", "admin", "member"]);
  });

  it("createResource method exists", () => {
    const auth = createAuthSchema({
      globalPolicies: () => [],
      principal: { status: principalAttribute<string>() },
      relations: [],
      roles: ["admin"],
      systemAdminRoles: ["admin"],
    });

    expect(typeof auth.createResource).toBe("function");
    expect(typeof auth.buildRegistry).toBe("function");
  });

  it("global policies are stored", () => {
    const auth = createAuthSchema({
      globalPolicies: (p) => [p.deny("*").to("*").where(principalNotActive())],
      principal: { status: principalAttribute<string>() },
      relations: [],
      roles: ["admin"],
      systemAdminRoles: ["admin"],
    });

    expect(auth.globalPolicies).toHaveLength(1);
    expect(auth.globalPolicies[0]?.effect).toBe("deny");
  });
});
