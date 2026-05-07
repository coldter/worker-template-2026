/**
 * C5 / Task 28 — TenantOperations.delete.
 *
 * Soft-deletes the org row, tombstones the slug into `reserved_slugs`
 * (kind='slug', reason='deleted_org'), revokes sessions, audits dual-scope,
 * and post-commit invalidates the cache.
 *
 * Per D66 we keep this a soft-delete: setting `deleted_at` rather than
 * removing the row preserves audit / invitation history. The slug
 * tombstone is the durable signal that the slug is unavailable for
 * future tenants even after a possible hard-delete sweep.
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
    role: "super_admin",
    deactivatedAt: null,
  } as never,
};

type Op =
  | { kind: "update"; values: Record<string, unknown> }
  | { kind: "insert-reserved"; values: Record<string, unknown> }
  | { kind: "delete-sessions" }
  | { kind: "audit"; event: string };

function makeTx(ops: Op[], slug: string | null = "acme") {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => [{ id: "org_1", suspendedAt: null, slug }],
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        ops.push({ kind: "update", values });
        return { where: async () => undefined };
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          ops.push({ kind: "insert-reserved", values });
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        ops.push({ kind: "delete-sessions" });
      },
    }),
  };
}

describe("TenantOperations.delete", () => {
  it("soft-deletes, tombstones slug, revokes sessions, dual-scope audits", async () => {
    vi.mocked(auditLogService.createDualScope).mockClear();
    const ops: Op[] = [];
    // boundary: vitest mockImplementation requires the full return shape;
    // the test only inspects the input event, so we cast the lightweight
    // stub to the declared signature.
    vi.mocked(auditLogService.createDualScope).mockImplementation(
      (async (input: { event: string }) => {
        ops.push({ kind: "audit", event: input.event });
        return { globalRow: undefined, tenantRow: undefined };
      }) as never
    );

    const invalidator = {
      fanOut: vi.fn(),
      fanOutBumpVersion: vi.fn(async () => undefined),
      bumpOwnVersion: vi.fn(),
      invalidateOwn: vi.fn(),
    };
    const pending: Promise<unknown>[] = [];

    const ops_service = new TenantOperations({
      db: {
        transaction: async <T>(
          cb: (tx: ReturnType<typeof makeTx>) => Promise<T>
        ) => cb(makeTx(ops)),
      } as never,
      invalidator: invalidator as never,
      ctx: {
        waitUntil: (p: Promise<unknown>) => {
          pending.push(p);
        },
      } as never,
    });

    const result = await ops_service.delete(
      { organizationId: "org_1", reason: "operator-requested" },
      operator
    );
    await Promise.all(pending);

    expect(result.organizationId).toBe("org_1");

    // Update sets deleted_at + deleted_by + bumps session_version.
    const update = ops.find((op) => op.kind === "update");
    expect(update).toBeDefined();
    if (update?.kind !== "update") {
      throw new Error("expected update op");
    }
    expect(update.values).toHaveProperty("deletedAt");
    expect(update.values.deletedBy).toBe("gad_op_1");
    expect(update.values).toHaveProperty("sessionVersion");

    // Slug tombstone inserted with the right reason.
    const insertReserved = ops.find((op) => op.kind === "insert-reserved");
    expect(insertReserved).toBeDefined();
    if (insertReserved?.kind !== "insert-reserved") {
      throw new Error("expected insert-reserved op");
    }
    expect(insertReserved.values.slug).toBe("acme");
    expect(insertReserved.values.kind).toBe("slug");
    expect(insertReserved.values.reason).toBe("deleted_org");
    expect(insertReserved.values.organizationId).toBe("org_1");

    // Sessions revoked.
    expect(ops.find((op) => op.kind === "delete-sessions")).toBeDefined();

    // Dual-scope audit fired with `tenant.deprovisioned`.
    const audit = ops.find((op) => op.kind === "audit");
    expect(audit).toEqual({ kind: "audit", event: "tenant.deprovisioned" });

    // Cache fan-out scheduled post-commit.
    expect(invalidator.fanOutBumpVersion).toHaveBeenCalledTimes(1);
  });

  it("skips the slug tombstone when the org has no slug (defensive)", async () => {
    vi.mocked(auditLogService.createDualScope).mockClear();
    const ops: Op[] = [];

    const invalidator = {
      fanOut: vi.fn(),
      fanOutBumpVersion: vi.fn(async () => undefined),
      bumpOwnVersion: vi.fn(),
      invalidateOwn: vi.fn(),
    };

    const ops_service = new TenantOperations({
      db: {
        transaction: async <T>(
          cb: (tx: ReturnType<typeof makeTx>) => Promise<T>
        ) => cb(makeTx(ops, null)),
      } as never,
      invalidator: invalidator as never,
      ctx: { waitUntil: vi.fn() } as never,
    });

    await ops_service.delete({ organizationId: "org_1" }, operator);
    expect(ops.find((op) => op.kind === "insert-reserved")).toBeUndefined();
  });
});
