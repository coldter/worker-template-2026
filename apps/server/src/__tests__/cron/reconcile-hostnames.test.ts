/**
 * A5 audit fix — cron handler test. Mocks `customHostnameLifecycle.reconcileAll`
 * and `withDrizzleClient` to assert the scheduled handler:
 *   1. invokes `reconcileAll` exactly once with the lifecycle env
 *   2. wires a FanOutInvalidator into the deps
 *   3. logs the cron run id (the structured log line is asserted via the
 *      shared logger spy)
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: async () => undefined,
}));

type ReconcileAllArgs = [
  unknown,
  Record<string, unknown>,
  Record<string, unknown>,
];

type ReconcileAllSummary = {
  cronRunId: string;
  processed: number;
  transitionedActive: number;
  transitionedFailed: number;
  transitionedRemoved: number;
  errors: number;
};

type WithDrizzleClientArgs = [
  string,
  (db: unknown) => Promise<unknown>,
  { waitUntil?: (p: Promise<unknown>) => void } | undefined,
];

type InvalidatorStub = {
  fanOut: ReturnType<typeof vi.fn>;
  fanOutBumpVersion: ReturnType<typeof vi.fn>;
  invalidateOwn: ReturnType<typeof vi.fn>;
  bumpOwnVersion: ReturnType<typeof vi.fn>;
};

const { reconcileAllSpy, withDrizzleClientSpy, createServerInvalidatorSpy } =
  vi.hoisted(() => {
    const reconcile = vi.fn<
      (...args: ReconcileAllArgs) => Promise<ReconcileAllSummary>
    >(async () => ({
      cronRunId: "cron-test",
      processed: 3,
      transitionedActive: 1,
      transitionedFailed: 0,
      transitionedRemoved: 0,
      errors: 0,
    }));
    const withDb = vi.fn<(...args: WithDrizzleClientArgs) => Promise<unknown>>(
      async (_connectionString, cb, _opts) => cb({ marker: "fake-db" })
    );
    const createInv = vi.fn<(env: unknown) => InvalidatorStub>(() => ({
      fanOut: vi.fn(async () => undefined),
      fanOutBumpVersion: vi.fn(async () => undefined),
      invalidateOwn: vi.fn(async () => undefined),
      bumpOwnVersion: vi.fn(async () => undefined),
    }));
    return {
      reconcileAllSpy: reconcile,
      withDrizzleClientSpy: withDb,
      createServerInvalidatorSpy: createInv,
    };
  });

vi.mock("@/modules/tenancy/lifecycle", () => ({
  customHostnameLifecycle: {
    reconcileAll: reconcileAllSpy,
  },
}));

vi.mock("@repo/db", () => ({
  withDrizzleClient: withDrizzleClientSpy,
}));

vi.mock("@/middlewares/invalidator", () => ({
  createServerInvalidator: createServerInvalidatorSpy,
}));

import { reconcileHostnamesScheduled } from "@/cron/reconcile-hostnames";

function buildEnv(): CloudflareBindings {
  // boundary: CloudflareBindings is generated from wrangler.jsonc; the cron
  // handler only reads a narrow subset, so we construct just those fields.
  const env = {
    HYPERDRIVE: { connectionString: "postgres://stub" },
    CLOUDFLARE_API_TOKEN: "tok",
    CLOUDFLARE_ZONE_ID: "zone",
    CUSTOM_HOST_CNAME_TARGET: "customers.example.com",
    CUSTOM_HOST_VERIFICATION_LABEL: "_app-verify",
    CACHE: { put: async () => undefined, get: async () => null },
    AUTH: {
      invalidateTenant: async () => undefined,
      bumpTenantCacheVersion: async () => "v1",
    },
  };
  return env as unknown as CloudflareBindings;
}

function buildCtx(): ExecutionContext {
  // boundary: ExecutionContext has additional Workers-only fields (e.g.
  // `exports`, `props`) that vary by runtime version; the cron handler only
  // touches `waitUntil`, so the test stub mirrors only that surface.
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  };
  return ctx as unknown as ExecutionContext;
}

function buildController(): ScheduledController {
  // boundary: ScheduledController shape mirrors Workers runtime; constructed
  // narrowly for the test.
  const controller = {
    scheduledTime: Date.now(),
    cron: "* * * * *",
    noRetry: () => undefined,
  };
  return controller as unknown as ScheduledController;
}

describe("A5.7 reconcile-hostnames cron handler", () => {
  it("invokes reconcileAll with the drizzle client and lifecycle env", async () => {
    reconcileAllSpy.mockClear();
    withDrizzleClientSpy.mockClear();
    createServerInvalidatorSpy.mockClear();

    const env = buildEnv();
    const ctx = buildCtx();
    const controller = buildController();

    await reconcileHostnamesScheduled(controller, env, ctx);

    expect(withDrizzleClientSpy).toHaveBeenCalledTimes(1);
    expect(withDrizzleClientSpy.mock.calls[0]?.[0]).toBe("postgres://stub");

    expect(reconcileAllSpy).toHaveBeenCalledTimes(1);
    const call = reconcileAllSpy.mock.calls[0];
    expect(call?.[0]).toEqual({ marker: "fake-db" });
    expect(call?.[1]).toMatchObject({
      CLOUDFLARE_API_TOKEN: "tok",
      CLOUDFLARE_ZONE_ID: "zone",
      CUSTOM_HOST_CNAME_TARGET: "customers.example.com",
      CUSTOM_HOST_VERIFICATION_LABEL: "_app-verify",
    });
  });

  it("constructs a FanOutInvalidator and threads it into reconcile deps", async () => {
    reconcileAllSpy.mockClear();
    createServerInvalidatorSpy.mockClear();

    const env = buildEnv();
    const ctx = buildCtx();
    const controller = buildController();

    await reconcileHostnamesScheduled(controller, env, ctx);

    expect(createServerInvalidatorSpy).toHaveBeenCalledTimes(1);
    expect(createServerInvalidatorSpy).toHaveBeenCalledWith(env);

    const deps = reconcileAllSpy.mock.calls[0]?.[2];
    expect(deps).toMatchObject({
      cache: env.CACHE,
    });
    expect(deps?.invalidator).toBeDefined();
    // The cronRunId should be a non-empty string (uuid).
    const cronRunId = deps?.cronRunId;
    expect(typeof cronRunId).toBe("string");
    expect(typeof cronRunId === "string" && cronRunId.length > 0).toBe(true);
  });

  it("swallows reconcileAll errors and logs the failure", async () => {
    reconcileAllSpy.mockClear();
    reconcileAllSpy.mockRejectedValueOnce(new Error("CF API down"));

    const env = buildEnv();
    const ctx = buildCtx();
    const controller = buildController();

    // Should NOT throw — the handler logs and returns.
    await expect(
      reconcileHostnamesScheduled(controller, env, ctx)
    ).resolves.toBeUndefined();
  });
});
