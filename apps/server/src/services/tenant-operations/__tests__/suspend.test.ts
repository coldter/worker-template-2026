/**
 * C5.3 / Task 26 — TenantOperations.suspend atomicity contract.
 *
 * Pin two invariants:
 *
 *  1. Happy path: dual-scope audit lands BEFORE the transaction commits;
 *     the post-commit cache fan-out is scheduled via `ctx.waitUntil` AFTER
 *     the commit returns.
 *  2. Mid-tx failure: an exception thrown by any in-tx step (here, the
 *     UPDATE on `organizations`) rolls back the transaction AND short-
 *     circuits the audit, the session DELETE, the version bump, and the
 *     cache invalidation. Peers must NEVER receive an invalidation for an
 *     org whose suspended_at write rolled back.
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

const SIMULATED_RE = /simulated/;

const operator: TenantOperator = {
  kind: "global_admin",
  admin: {
    id: "gad_op_1",
    email: "op@example.com",
    role: "support",
    deactivatedAt: null,
  } as never,
};

type Trace = string[];

function makeTx(trace: Trace, opts: { failOnUpdate?: boolean } = {}) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => [{ id: "org_1", suspendedAt: null, slug: "acme" }],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          if (opts.failOnUpdate) {
            trace.push("update");
            throw new Error("simulated DB failure on update");
          }
          trace.push("update");
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        trace.push("delete-sessions");
      },
    }),
  };
}

function makeDb(trace: Trace, opts: { failOnUpdate?: boolean } = {}) {
  return {
    transaction: async <T>(
      cb: (tx: ReturnType<typeof makeTx>) => Promise<T>
    ) => {
      trace.push("tx-begin");
      try {
        const result = await cb(makeTx(trace, opts));
        trace.push("tx-commit");
        return result;
      } catch (err) {
        trace.push("tx-rollback");
        throw err;
      }
    },
  };
}

describe("TenantOperations.suspend — atomicity", () => {
  it("happy path: audit before commit; invalidation scheduled after commit", async () => {
    vi.mocked(auditLogService.createDualScope).mockClear();
    const trace: Trace = [];
    const pending: Promise<unknown>[] = [];
    // boundary: see delete.test.ts — full audit-row return shape is not
    // load-bearing for this test.
    vi.mocked(auditLogService.createDualScope).mockImplementation((async () => {
      trace.push("audit");
      return { globalRow: undefined, tenantRow: undefined };
    }) as never);

    let releaseInvalidate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseInvalidate = resolve;
    });
    const invalidator = {
      fanOut: vi.fn(),
      fanOutBumpVersion: vi.fn(async () => {
        await gate;
        trace.push("invalidate");
      }),
      bumpOwnVersion: vi.fn(),
      invalidateOwn: vi.fn(),
    };

    const ops = new TenantOperations({
      // boundary: db stub matches the narrow surface used by the service
      // (transaction + select/update/delete chains).
      db: makeDb(trace) as never,
      invalidator: invalidator as never,
      ctx: {
        waitUntil: (p: Promise<unknown>) => {
          pending.push(p);
        },
      } as never,
    });

    await ops.suspend({ organizationId: "org_1", reason: "ToS" }, operator);

    expect(trace.indexOf("audit")).toBeLessThan(trace.indexOf("tx-commit"));
    // The fan-out is gated on `releaseInvalidate`; the suspend call must NOT
    // await it. If `suspend` ran the invalidation inline, this test would
    // hang on `await ops.suspend(...)` instead of reaching this assertion.
    expect(trace.includes("invalidate")).toBe(false);
    releaseInvalidate();
    await Promise.all(pending);
    expect(trace.indexOf("invalidate")).toBeGreaterThan(
      trace.indexOf("tx-commit")
    );
  });

  it("mid-tx failure: rollback skips audit, session revoke, and cache invalidation", async () => {
    vi.mocked(auditLogService.createDualScope).mockClear();
    const trace: Trace = [];
    // boundary: see delete.test.ts — full audit-row return shape is not
    // load-bearing for this test.
    vi.mocked(auditLogService.createDualScope).mockImplementation((async () => {
      trace.push("audit");
      return { globalRow: undefined, tenantRow: undefined };
    }) as never);

    const invalidator = {
      fanOut: vi.fn(),
      fanOutBumpVersion: vi.fn(async () => {
        trace.push("invalidate");
      }),
      bumpOwnVersion: vi.fn(),
      invalidateOwn: vi.fn(),
    };

    const ops = new TenantOperations({
      db: makeDb(trace, { failOnUpdate: true }) as never,
      invalidator: invalidator as never,
      ctx: { waitUntil: vi.fn() } as never,
    });

    await expect(
      ops.suspend({ organizationId: "org_1", reason: "ToS" }, operator)
    ).rejects.toThrow(SIMULATED_RE);

    expect(trace).toContain("tx-rollback");
    expect(trace).not.toContain("audit");
    expect(trace).not.toContain("delete-sessions");
    expect(trace).not.toContain("invalidate");
    expect(invalidator.fanOutBumpVersion).not.toHaveBeenCalled();
  });
});
