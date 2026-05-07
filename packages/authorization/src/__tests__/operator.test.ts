import { describe, expect, expectTypeOf, it } from "vitest";
import {
  canOperator,
  type GlobalAdmin,
  OPERATOR_PERMISSIONS,
  type OperatorAction,
} from "../operator";

const gad = (role: GlobalAdmin["role"]): GlobalAdmin => ({
  id: "gad",
  email: "a@x",
  role,
  deactivatedAt: null,
});

describe("OperatorAction is derived from OPERATOR_PERMISSIONS keys (lockstep)", () => {
  it("OperatorAction equals keyof OPERATOR_PERMISSIONS", () => {
    expectTypeOf<OperatorAction>().toEqualTypeOf<
      keyof typeof OPERATOR_PERMISSIONS
    >();
    // Runtime touch keeps the value-side import alive against
    // overly-aggressive auto-fixers that prefer type-only imports.
    expect(Object.keys(OPERATOR_PERMISSIONS).length).toBeGreaterThan(0);
  });

  it("compile-time error when matrix grows but type does not (sanity)", () => {
    // @ts-expect-error -- bogus action is rejected by the OperatorAction type
    const bogus: OperatorAction = "tenant.fly";
    expect(bogus).toBeDefined();
  });
});

describe("canOperator matrix", () => {
  it.each([
    ["super_admin", "tenant.delete", true],
    ["support", "tenant.delete", false],
    ["read_only", "tenant.view", true],
    ["read_only", "tenant.suspend", false],
    ["security", "platform.view_audit_logs_global", true],
    ["security", "platform.manage_global_admins", false],
    ["support", "platform.manage_feature_flags", true],
  ] as const)("%s + %s => %s", (role, action, allowed) => {
    expect(canOperator(gad(role), action)).toBe(allowed);
  });
});
