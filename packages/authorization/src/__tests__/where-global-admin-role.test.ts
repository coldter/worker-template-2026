import { describe, expect, it } from "vitest";
import { createAuthSchema, principalAttribute } from "../schema";
import type { Principal } from "../types";

const auth = createAuthSchema({
  roles: ["global_admin", "user"],
  // global_admin is intentionally NOT in systemAdminRoles — operator policies
  // must opt in per-resource via `whereGlobalAdminRole`.
  systemAdminRoles: [],
  relations: [],
  principal: {
    status: principalAttribute<"active" | "inactive">(),
    globalAdminRole: principalAttribute<
      "super_admin" | "support" | "read_only" | "security" | undefined
    >(),
  },
  globalPolicies: () => [],
});

const tenant = auth.createResource<
  { id: string },
  readonly ["read", "suspend"]
>("tenant", {
  actions: ["read", "suspend"] as const,
  policies: (p) => [
    p.allow("global_admin").to("read").whereGlobalAdminRole(),
    p
      .allow("global_admin")
      .to("suspend")
      .whereGlobalAdminRole("super_admin", "support"),
  ],
});

const registry = auth.buildRegistry({ tenant });

const principal = (
  subRole: "super_admin" | "support" | "read_only" | "security" | undefined
): Principal => ({
  id: "gad_1",
  roles: subRole ? ["global_admin"] : ["user"],
  attributes: { status: "active", globalAdminRole: subRole },
});

describe("whereGlobalAdminRole", () => {
  it("no sub-roles passed = any global_admin role allowed", async () => {
    const r = await registry.can(principal("read_only"), "tenant", "read");
    expect(r.allowed).toBe(true);
  });

  it("one sub-role passed: matching role allowed", async () => {
    const r = await registry.can(principal("super_admin"), "tenant", "suspend");
    expect(r.allowed).toBe(true);
  });

  it("one sub-role passed: non-matching role denied", async () => {
    const r = await registry.can(principal("read_only"), "tenant", "suspend");
    expect(r.allowed).toBe(false);
  });

  it("multiple sub-roles passed: any match allowed", async () => {
    const r = await registry.can(principal("support"), "tenant", "suspend");
    expect(r.allowed).toBe(true);
  });

  it("non-global-admin actor denied regardless", async () => {
    const r = await registry.can(principal(undefined), "tenant", "read");
    expect(r.allowed).toBe(false);
  });
});
