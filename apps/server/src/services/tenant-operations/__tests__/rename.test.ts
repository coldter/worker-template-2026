/**
 * C5 — `rename` is intentionally a stub per D66.
 *
 * Slug rename invalidates SSO callbacks registered with external IdPs:
 * `https://<slug>.app.example.com/auth/callback/sso` is the URL each
 * tenant's IdP has on file. Reintroducing rename requires a coordinated
 * update across every tenant's IdP, which is out of scope for v1.
 *
 * Pin the deferral with an explicit error so callers cannot accidentally
 * consume a no-op rename and mistake it for a successful one.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));

vi.mock("@/modules/audit-logs/service", () => ({
  auditLogService: {
    create: vi.fn(async () => undefined),
    enqueue: vi.fn(() => undefined),
    createDualScope: vi.fn(async () => undefined),
  },
}));

import { TenantOperations } from "@/services/tenant-operations";
import type { TenantOperator } from "@/services/tenant-operations/types";

const DEFERRED_RE = /deferred to v2/i;

const operator: TenantOperator = {
  kind: "global_admin",
  admin: {
    id: "gad_op_1",
    email: "op@example.com",
    role: "super_admin",
    deactivatedAt: null,
  } as never,
};

describe("TenantOperations.rename", () => {
  it("throws a deferred-to-v2 error (D66)", () => {
    const ops = new TenantOperations({
      db: { transaction: vi.fn() } as never,
      invalidator: {
        fanOut: vi.fn(),
        fanOutBumpVersion: vi.fn(),
        bumpOwnVersion: vi.fn(),
        invalidateOwn: vi.fn(),
      } as never,
      ctx: { waitUntil: vi.fn() } as never,
    });

    expect(() => ops.rename("org_1", "newslug", operator)).toThrow(DEFERRED_RE);
  });
});
