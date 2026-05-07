/**
 * C5.2 / Task 25 — TenantOperations.create.
 *
 * `create` is the consolidated owner of operator-led tenant creation (D54).
 * It wraps the proven `createTenantOnBehalfOf` helper so the existing B2 +
 * B2-polish characterisation tests still guard the underlying flow; this
 * suite pins the new service surface (TenantOperator union, dual-scope
 * audit, dependency wiring).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));

vi.mock("@/modules/audit-logs/service", () => ({
  auditLogService: {
    create: vi.fn(async (input: unknown) => input),
    enqueue: vi.fn(() => undefined),
    createDualScope: vi.fn(async () => ({ globalRow: {}, tenantRow: {} })),
  },
}));

import type { Executor } from "@repo/db";
import { auditLogService } from "@/modules/audit-logs/service";
import { TenantOperations } from "@/services/tenant-operations";
import type { TenantOperator } from "@/services/tenant-operations/types";

type Insert = { index: number; values: Record<string, unknown> };

function makeFakeDb() {
  const inserts: Insert[] = [];
  let insertCount = 0;
  const tx = {
    insert(_table: unknown) {
      const index = insertCount;
      insertCount += 1;
      return {
        values: async (values: Record<string, unknown>) => {
          inserts.push({ index, values });
        },
      };
    },
    select(_columns?: unknown) {
      return {
        from(_table: unknown) {
          return {
            where(_predicate: unknown) {
              return {
                limit: async (_n: number) => [],
              };
            },
          };
        },
      };
    },
  };
  return {
    inserts,
    db: {
      transaction: async <T>(cb: (tx: Executor) => Promise<T>): Promise<T> =>
        // boundary: tests inject a partial drizzle stub matching the narrow
        // surface the service uses (insert/values, select/from/where/limit).
        cb(tx as unknown as Executor),
    },
  };
}

const globalAdminActor: TenantOperator = {
  kind: "global_admin",
  // boundary: GlobalAdmin row mock — the service only reads `id`, but the
  // type requires the full shape. Cast at the test boundary keeps the rest
  // of the suite focused on behaviour rather than DB row plumbing.
  admin: {
    id: "gad_op_1",
    email: "op@example.com",
    role: "support",
    deactivatedAt: null,
  } as never,
};

describe("TenantOperations.create", () => {
  it("inserts org + invitation in one transaction; emits dual-scope audit", async () => {
    vi.mocked(auditLogService.createDualScope).mockClear();
    const { db, inserts } = makeFakeDb();

    const ops = new TenantOperations({
      db: db as never,
      invalidator: {
        fanOut: vi.fn(async () => undefined),
        fanOutBumpVersion: vi.fn(async () => undefined),
        bumpOwnVersion: vi.fn(async () => "v2"),
        invalidateOwn: vi.fn(async () => undefined),
      } as never,
      ctx: { waitUntil: vi.fn() } as never,
    });

    const result = await ops.create(
      { slug: "acme", name: "Acme Co", primaryAdminEmail: "ADMIN@Acme.com" },
      globalAdminActor
    );

    expect(result.orgId.startsWith("org_")).toBe(true);
    expect(result.invitationId.startsWith("inv_")).toBe(true);
    expect(inserts).toHaveLength(2);
    expect(auditLogService.createDualScope).toHaveBeenCalledTimes(1);

    const call = vi.mocked(auditLogService.createDualScope).mock.calls[0];
    if (!call) {
      throw new Error("expected createDualScope call");
    }
    const [auditInput] = call;
    expect(auditInput.event).toBe("tenant.created");
    expect(auditInput.actorType).toBe("global_admin");
    expect(auditInput.actorId).toBe("gad_op_1");
    expect(auditInput.organizationId).toBe(result.orgId);
  });

  it("accepts a SystemActor (D67) and records a system-actor audit", async () => {
    vi.mocked(auditLogService.createDualScope).mockClear();
    const { db } = makeFakeDb();

    const ops = new TenantOperations({
      db: db as never,
      invalidator: {
        fanOut: vi.fn(async () => undefined),
        fanOutBumpVersion: vi.fn(async () => undefined),
        bumpOwnVersion: vi.fn(async () => "v2"),
        invalidateOwn: vi.fn(async () => undefined),
      } as never,
      ctx: { waitUntil: vi.fn() } as never,
    });

    const systemActor: TenantOperator = {
      kind: "system",
      reason: "cron-backfill",
    };

    await ops.create(
      { slug: "globex", name: "Globex", primaryAdminEmail: "x@y.com" },
      systemActor
    );

    const call = vi.mocked(auditLogService.createDualScope).mock.calls[0];
    if (!call) {
      throw new Error("expected createDualScope call");
    }
    const [auditInput] = call;
    expect(auditInput.actorType).toBe("system");
    expect(auditInput.actorId).toBeUndefined();
  });
});
