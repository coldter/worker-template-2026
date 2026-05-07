/**
 * C5 / Task 27 — pin the post-commit cache invalidation invariant.
 *
 * Specifically: the response (i.e. `await ops.suspend(...)`) MUST resolve
 * before a slow invalidation completes, AND the invalidation MUST still
 * happen once the harness drains `ctx.waitUntil`. A regression that
 * accidentally `await`s the invalidation inline would block tenant suspend
 * by ~peer-RPC round-trip latency on every operator-driven suspend.
 *
 * The contract is identical for `restore` and `delete`; we keep one canonical
 * test here on the `suspend` path and rely on the suspend / restore /
 * delete tests to cover the per-method specifics.
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

import { TenantOperations } from "@/services/tenant-operations";
import type { TenantOperator } from "@/services/tenant-operations/types";

const systemActor: TenantOperator = { kind: "system", reason: "test" };

const SLOW_MS = 80;
const MAX_INLINE_MS = 40;

type StubTx = {
  select: () => {
    from: () => { where: () => { for: () => Promise<unknown[]> } };
  };
  update: () => { set: () => { where: () => Promise<undefined> } };
  delete: () => { where: () => Promise<undefined> };
};

function makeDb() {
  const tx: StubTx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => [{ id: "org_1", suspendedAt: null, slug: "acme" }],
        }),
      }),
    }),
    update: () => ({
      set: () => ({ where: async () => undefined }),
    }),
    delete: () => ({ where: async () => undefined }),
  };
  return {
    transaction: async <T>(cb: (tx: StubTx) => Promise<T>) => cb(tx),
  };
}

describe("TenantOperations.suspend post-commit invalidation", () => {
  it("response resolves before invalidation completes; invalidation still happens", async () => {
    let invalidationStarted = false;
    let invalidationDone = false;
    const slowInvalidate = new Promise<void>((resolve) => {
      setTimeout(() => {
        invalidationDone = true;
        resolve();
      }, SLOW_MS);
    });

    const invalidator = {
      fanOut: vi.fn(),
      fanOutBumpVersion: vi.fn(async () => {
        invalidationStarted = true;
        await slowInvalidate;
      }),
      bumpOwnVersion: vi.fn(),
      invalidateOwn: vi.fn(),
    };

    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p);
      },
    };

    const ops = new TenantOperations({
      db: makeDb() as never,
      invalidator: invalidator as never,
      ctx: ctx as never,
    });

    const start = Date.now();
    await ops.suspend({ organizationId: "org_1" }, systemActor);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(MAX_INLINE_MS);
    expect(invalidationStarted).toBe(true);
    expect(invalidationDone).toBe(false);

    // Drain `ctx.waitUntil` — the harness in production is the Workers
    // runtime; here we manually settle the promises the service handed off.
    await Promise.all(pending);
    expect(invalidationDone).toBe(true);
  });
});
