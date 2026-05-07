import { describe, expect, it } from "vitest";
import { createAuthSchema, principalAttribute } from "../schema";
import type { Principal } from "../types";

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
  ]
>("platform", {
  actions: [
    "view_audit_logs_global",
    "view_system_metrics",
    "manage_feature_flags",
    "manage_global_admins",
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
  ],
});

const registry = auth.buildRegistry({ tenant, platform });

const operator = (sub: string): Principal => ({
  id: "gad_1",
  roles: ["global_admin"],
  attributes: { status: "active", globalAdminRole: sub },
});

describe("tenant + platform resources", () => {
  it("super_admin can delete a tenant", async () => {
    expect(
      (await registry.can(operator("super_admin"), "tenant", "delete")).allowed
    ).toBe(true);
  });
  it("support cannot delete a tenant", async () => {
    expect(
      (await registry.can(operator("support"), "tenant", "delete")).allowed
    ).toBe(false);
  });
  it("read_only can view tenant + platform audit", async () => {
    expect(
      (await registry.can(operator("read_only"), "tenant", "view")).allowed
    ).toBe(true);
    expect(
      (
        await registry.can(
          operator("read_only"),
          "platform",
          "view_audit_logs_global"
        )
      ).allowed
    ).toBe(true);
  });
  it("global_admin is NOT a system-admin (regression: not in systemAdminRoles)", () => {
    expect(auth.systemAdminRoles).not.toContain("global_admin");
  });
});
