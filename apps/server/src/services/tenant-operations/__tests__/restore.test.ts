/**
 * C5 / Task 28 — TenantOperations.restore.
 *
 * Restore clears `suspended_at` only — `session_version` is intentionally
 * left untouched (D34) so previously revoked JWTs stay revoked even after
 * the tenant is unblocked. Audit lands inside the transaction; cache
 * invalidation runs post-commit.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));

vi.mock("@/modules/audit-logs/service", () => ({
  auditLogService: {
    create: vi.fn(async () => undefined),
    enqueue: vi.fn(() => undefined),
    createDualScope: vi.fn(async () => ({ globalRow: {}, tenantRow: {} })),
  },
}));

import { auditLogService } from "@/modules/audit-logs/service";
import { TenantOperations } from "@/services/tenant-operations";
import type { TenantOperator } from "@/services/tenant-operations/types";

const operator: TenantOperator = {
  kind: "global_admin",
  admin: {
    id: "gad_op_1",
    email: "op@example.com",
    role: "support",
    deactivatedAt: null,
  } as never,
};

type Updates = Record<string, unknown>[];

function makeTx(row: { suspendedAt: Date | null }, updates: Updates) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => [
            { id: "org_1", suspendedAt: row.suspendedAt, slug: "acme" },
          ],
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: async () => undefined };
      },
    }),
    delete: () => ({ where: async () => undefined }),
  };
}

describe("TenantOperations.restore", () => {
  it("clears suspended_at without touching session_version; audits + invalidates", async () => {
    vi.mocked(auditLogService.createDualScope).mockClear();
    const updates: Updates = [];
    const invalidator = {
      fanOut: vi.fn(),
      fanOutBumpVersion: vi.fn(async () => undefined),
      bumpOwnVersion: vi.fn(),
      invalidateOwn: vi.fn(),
    };
    const pending: Promise<unknown>[] = [];

    const ops = new TenantOperations({
      db: {
        transaction: async <T>(
          cb: (tx: ReturnType<typeof makeTx>) => Promise<T>
        ) =>
          cb(
            makeTx({ suspendedAt: new Date("2026-01-01T00:00:00Z") }, updates)
          ),
      } as never,
      invalidator: invalidator as never,
      ctx: {
        waitUntil: (p: Promise<unknown>) => {
          pending.push(p);
        },
      } as never,
    });

    const result = await ops.restore({ organizationId: "org_1" }, operator);
    await Promise.all(pending);

    expect(result.changed).toBe(true);
    expect(updates).toHaveLength(1);
    const update = updates[0] ?? {};
    expect(update.suspendedAt).toBeNull();
    expect(update.suspendedBy).toBeNull();
    expect(update.suspendedReason).toBeNull();
    // session_version MUST NOT appear — restore intentionally does not
    // decrement / reset the bump from suspend.
    expect(update).not.toHaveProperty("sessionVersion");

    expect(auditLogService.createDualScope).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tenant.restored",
        actorType: "global_admin",
        actorId: "gad_op_1",
      }),
      expect.anything()
    );
    expect(invalidator.fanOutBumpVersion).toHaveBeenCalledTimes(1);
  });

  it("is a no-op on a non-suspended tenant; emits BUFFERABLE noop audit", async () => {
    vi.mocked(auditLogService.enqueue).mockClear();
    const updates: Updates = [];
    const invalidator = {
      fanOut: vi.fn(),
      fanOutBumpVersion: vi.fn(async () => undefined),
      bumpOwnVersion: vi.fn(),
      invalidateOwn: vi.fn(),
    };

    const ops = new TenantOperations({
      db: {
        transaction: async <T>(
          cb: (tx: ReturnType<typeof makeTx>) => Promise<T>
        ) => cb(makeTx({ suspendedAt: null }, updates)),
      } as never,
      invalidator: invalidator as never,
      ctx: { waitUntil: vi.fn() } as never,
    });

    const result = await ops.restore({ organizationId: "org_1" }, operator);
    expect(result.changed).toBe(false);
    expect(updates).toHaveLength(0);
    expect(auditLogService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ event: "tenant.restored.noop" })
    );
    expect(invalidator.fanOutBumpVersion).not.toHaveBeenCalled();
  });
});
