/**
 * A5.7 reconciler unit tests. We exercise `customHostnameLifecycle.reconcileOne`
 * with a hand-rolled drizzle-shaped stub so we don't need a real Postgres
 * connection inside the worker test pool. The stub records every UPDATE / SELECT
 * and replays a single canned row to the service.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: async () => undefined,
}));
vi.mock("cloudflare:workers", () => ({
  env: {
    AUDIT_LOG_QUEUE: { send: async () => undefined },
  },
}));

import type { FanOutInvalidator } from "@repo/tenancy";
import getActiveFixture from "@/modules/tenancy/__tests__/fixtures/cf-saas/get-active.json";
import getCaaErrorFixture from "@/modules/tenancy/__tests__/fixtures/cf-saas/get-caa-error.json";
import getMovedFixture from "@/modules/tenancy/__tests__/fixtures/cf-saas/get-moved.json";
import {
  customHostnameLifecycle,
  type LifecycleEnv,
} from "@/modules/tenancy/lifecycle";

const ENV: LifecycleEnv = {
  CLOUDFLARE_API_TOKEN: "tok",
  CLOUDFLARE_ZONE_ID: "zone",
  CUSTOM_HOST_CNAME_TARGET: "customers.example.com",
  CUSTOM_HOST_VERIFICATION_LABEL: "_app-verify",
};

type Row = {
  id: string;
  organizationId: string;
  hostname: string;
  cfHostnameId: string | null;
  lifecycleStatus:
    | "pending_txt"
    | "awaiting_cf"
    | "pre_validation"
    | "active"
    | "failed"
    | "removing"
    | "removed";
  cfStatus: string | null;
  cfSslStatus: string | null;
  verificationErrors: string[];
  verificationToken: string;
  verificationVerifiedAt: Date | null;
  lastReconciledAt: Date | null;
  lastCfPolledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// boundary: drizzle stub for the reconciler — recursive shape via `any` is
// the only way to express the chain without modeling Drizzle's full builder.
type StubDb = {
  select: () => {
    from: () => { where: () => Promise<Row[]> };
  };
  update: () => {
    set: (patch: Partial<Row>) => {
      where: () => Promise<void>;
    };
  };
  insert: () => {
    values: (v: Record<string, unknown>) => {
      onConflictDoNothing: () => Promise<void>;
      returning: () => Promise<{ id: string }[]>;
    };
  };
  transaction: <T>(cb: (tx: StubDb) => Promise<T>) => Promise<T>;
};

type StubResult = {
  stub: StubDb;
  row: Row;
  auditCalls: Record<string, unknown>[];
  updateCount: () => number;
};

function makeStubDb(initial: Row): StubResult {
  const row: Row = { ...initial };
  const auditCalls: Record<string, unknown>[] = [];
  let updateCount = 0;
  const stub: StubDb = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([row]),
      }),
    }),
    update: () => ({
      set: (patch: Partial<Row>) => ({
        where: () => {
          Object.assign(row, patch);
          updateCount += 1;
          return Promise.resolve();
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        auditCalls.push(v);
        return {
          onConflictDoNothing: () => Promise.resolve(),
          returning: () => Promise.resolve([{ id: "audit_x" }]),
        };
      },
    }),
    transaction: async <T>(cb: (tx: StubDb) => Promise<T>): Promise<T> =>
      cb(stub),
  };
  return { stub, row, auditCalls, updateCount: () => updateCount };
}

function fetchReturning(body: unknown, status = 200) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
  ) as unknown as typeof globalThis.fetch;
}

const baseRow = (overrides: Partial<Row> = {}): Row => ({
  id: "tnh_1",
  organizationId: "org_1",
  hostname: "app.acme.test",
  cfHostnameId: "0000000000000000000000000000000a",
  lifecycleStatus: "awaiting_cf",
  cfStatus: "pending",
  cfSslStatus: "pending_validation",
  verificationErrors: [],
  verificationToken: "vtok_test",
  verificationVerifiedAt: new Date("2026-05-06T10:00:00Z"),
  lastReconciledAt: null,
  lastCfPolledAt: null,
  createdAt: new Date("2026-05-06T09:00:00Z"),
  updatedAt: new Date("2026-05-06T09:00:00Z"),
  ...overrides,
});

describe("A5 reconcileOne", () => {
  it("transitions awaiting_cf -> active on first activation and emits audit once", async () => {
    const stub = makeStubDb(baseRow());
    // boundary: test fixture reflection — drizzle stub.
    const result = await customHostnameLifecycle.reconcileOne(
      stub.stub as unknown as Parameters<
        typeof customHostnameLifecycle.reconcileOne
      >[0],
      ENV,
      "tnh_1",
      {
        cfApi: {
          fetch: fetchReturning(getActiveFixture),
          sleep: async () => undefined,
        },
      }
    );
    expect(result.action).toBe("transitioned_active");
    expect(result.lifecycleStatus).toBe("active");
    expect(stub.row.lifecycleStatus).toBe("active");
    expect(stub.auditCalls).toHaveLength(1);
    expect(stub.auditCalls[0]).toMatchObject({
      event: "tenancy.custom_hostname.activated",
      actorType: "system",
    });
  });

  it("does NOT re-emit activation audit on the second reconcile (idempotent)", async () => {
    const stub = makeStubDb(baseRow({ lifecycleStatus: "active" }));
    const result = await customHostnameLifecycle.reconcileOne(
      stub.stub as unknown as Parameters<
        typeof customHostnameLifecycle.reconcileOne
      >[0],
      ENV,
      "tnh_1",
      {
        cfApi: {
          fetch: fetchReturning(getActiveFixture),
          sleep: async () => undefined,
        },
      }
    );
    // active rows ARE reconcilable so we can detect deactivations, but
    // when CF still reports active we must not re-emit the activation
    // audit — it is gated on `next === "active" && !wasActive`.
    expect(result.action).toBe("unchanged");
    expect(result.lifecycleStatus).toBe("active");
    expect(stub.auditCalls).toHaveLength(0);
  });

  it("emits deactivated audit when CF flips an active row to expired", async () => {
    const stub = makeStubDb(baseRow({ lifecycleStatus: "active" }));
    // Synthesize a CF response that flips ssl.status to `expired`.
    const expiredFixture = {
      ...getActiveFixture,
      result: {
        ...getActiveFixture.result,
        ssl: {
          ...getActiveFixture.result.ssl,
          status: "expired",
        },
      },
    };
    const result = await customHostnameLifecycle.reconcileOne(
      stub.stub as unknown as Parameters<
        typeof customHostnameLifecycle.reconcileOne
      >[0],
      ENV,
      "tnh_1",
      {
        cfApi: {
          fetch: fetchReturning(expiredFixture),
          sleep: async () => undefined,
        },
      }
    );
    expect(result.action).toBe("transitioned_failed");
    expect(stub.row.lifecycleStatus).toBe("failed");
    expect(
      stub.auditCalls.some(
        (a) => a.event === "tenancy.custom_hostname.deactivated"
      )
    ).toBe(true);
  });

  it("transitions to failed on caa_error", async () => {
    const stub = makeStubDb(baseRow());
    const result = await customHostnameLifecycle.reconcileOne(
      stub.stub as unknown as Parameters<
        typeof customHostnameLifecycle.reconcileOne
      >[0],
      ENV,
      "tnh_1",
      {
        cfApi: {
          fetch: fetchReturning(getCaaErrorFixture),
          sleep: async () => undefined,
        },
      }
    );
    expect(result.action).toBe("transitioned_failed");
    expect(stub.row.lifecycleStatus).toBe("failed");
  });

  it("transitions to failed on moved", async () => {
    const stub = makeStubDb(baseRow());
    const result = await customHostnameLifecycle.reconcileOne(
      stub.stub as unknown as Parameters<
        typeof customHostnameLifecycle.reconcileOne
      >[0],
      ENV,
      "tnh_1",
      {
        cfApi: {
          fetch: fetchReturning(getMovedFixture),
          sleep: async () => undefined,
        },
      }
    );
    expect(result.action).toBe("transitioned_failed");
  });

  it("CF 404 tombstones the row to removed and emits deleted_by_cf", async () => {
    const stub = makeStubDb(baseRow());
    const result = await customHostnameLifecycle.reconcileOne(
      stub.stub as unknown as Parameters<
        typeof customHostnameLifecycle.reconcileOne
      >[0],
      ENV,
      "tnh_1",
      {
        cfApi: {
          fetch: vi.fn(
            async () =>
              new Response(
                JSON.stringify({
                  success: false,
                  errors: [{ message: "not found" }],
                }),
                { status: 404 }
              )
          ) as unknown as typeof globalThis.fetch,
          sleep: async () => undefined,
        },
      }
    );
    expect(result.action).toBe("cf_404_tombstoned");
    expect(stub.row.lifecycleStatus).toBe("removed");
    expect(
      stub.auditCalls.some(
        (a: Record<string, unknown>) =>
          a.event === "tenancy.custom_hostname.deleted_by_cf"
      )
    ).toBe(true);
  });

  it("skips rows in pending_txt (no cfHostnameId yet)", async () => {
    const stub = makeStubDb(
      baseRow({ lifecycleStatus: "pending_txt", cfHostnameId: null })
    );
    const fetchSpy = vi.fn();
    const result = await customHostnameLifecycle.reconcileOne(
      stub.stub as unknown as Parameters<
        typeof customHostnameLifecycle.reconcileOne
      >[0],
      ENV,
      "tnh_1",
      {
        cfApi: {
          fetch: fetchSpy as unknown as typeof globalThis.fetch,
          sleep: async () => undefined,
        },
      }
    );
    expect(result.action).toBe("skipped");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls invalidator.fanOut on pre_validation -> active transition", async () => {
    const stub = makeStubDb(baseRow({ lifecycleStatus: "pre_validation" }));
    const fanOut = vi.fn(async () => undefined);
    // boundary: FanOutInvalidator has many methods; the test only asserts the
    // fan-out call so we pass a stub.
    const invalidator = {
      fanOut,
      fanOutBumpVersion: async () => undefined,
      invalidateOwn: async () => undefined,
      bumpOwnVersion: async () => undefined,
    } as unknown as FanOutInvalidator;
    const result = await customHostnameLifecycle.reconcileOne(
      stub.stub as unknown as Parameters<
        typeof customHostnameLifecycle.reconcileOne
      >[0],
      ENV,
      "tnh_1",
      {
        cfApi: {
          fetch: fetchReturning(getActiveFixture),
          sleep: async () => undefined,
        },
        invalidator,
      }
    );
    expect(result.action).toBe("transitioned_active");
    expect(fanOut).toHaveBeenCalledTimes(1);
    expect(fanOut).toHaveBeenCalledWith({
      kind: "custom",
      host: "app.acme.test",
    });
  });

  it("skips rows in removing (writer-owned)", async () => {
    const stub = makeStubDb(baseRow({ lifecycleStatus: "removing" }));
    const fetchSpy = vi.fn();
    const result = await customHostnameLifecycle.reconcileOne(
      stub.stub as unknown as Parameters<
        typeof customHostnameLifecycle.reconcileOne
      >[0],
      ENV,
      "tnh_1",
      {
        cfApi: {
          fetch: fetchSpy as unknown as typeof globalThis.fetch,
          sleep: async () => undefined,
        },
      }
    );
    expect(result.action).toBe("skipped");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
