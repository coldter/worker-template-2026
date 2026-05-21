import type { GlobalAdmin } from "@repo/db/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type FakeAdmin = Partial<GlobalAdmin>;

type AuthCtxOverrides = {
  headers?: Record<string, string>;
  env?: Record<string, string>;
  waitUntil?: (p: Promise<unknown>) => void;
};

const baseEnv = {
  ADMIN_HOST: "admin.example.com",
  CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
  CF_ACCESS_AUD: "aud",
  NODE_ENV: "production",
};

function buildCtx(overrides: AuthCtxOverrides = {}) {
  const headers: Record<string, string> = overrides.headers ?? {};
  const env = { ...baseEnv, ...overrides.env };
  const waits: Promise<unknown>[] = [];
  return {
    waits,
    ctx: {
      req: {
        header: (name: string): string | undefined =>
          headers[name.toLowerCase()],
      },
      env,
      executionCtx: {
        waitUntil:
          overrides.waitUntil ??
          ((p: Promise<unknown>) => {
            waits.push(p);
          }),
      },
    },
  };
}

function makeFakeDb(opts: {
  bySub?: FakeAdmin | null;
  byEnrollment?: FakeAdmin | null;
  claimed?: FakeAdmin[];
}) {
  const updateCalls: { id?: unknown; set?: Record<string, unknown> }[] = [];
  const claimingUpdate = vi.fn(() => ({
    set: vi.fn((value: Record<string, unknown>) => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => {
          updateCalls.push({ set: value });
          return opts.claimed ?? [];
        }),
      })),
    })),
  }));
  const pingUpdate = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => ({ rowCount: 1 })),
    })),
  }));

  // The claim path uses .returning(); the subsequent waitUntil ping does not.
  let updateCount = 0;
  const update = vi.fn(() => {
    updateCount += 1;
    return updateCount === 1 && opts.byEnrollment
      ? claimingUpdate()
      : pingUpdate();
  });

  return {
    updateCalls,
    update,
    db: {
      query: {
        globalAdmins: {
          findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
            if ("enrollmentToken" in args.where) {
              return opts.byEnrollment ?? null;
            }
            if ("cfAccessSub" in args.where) {
              return opts.bySub ?? null;
            }
            return null;
          }),
        },
      },
      update,
    },
  };
}

describe("authenticateOperator", () => {
  it("returns missing_token failure when header absent", async () => {
    const { authenticateOperator } = await import(
      "@/middlewares/authenticate-operator"
    );
    const { JwksCache } = await import("@/middlewares/jwks-cache");
    const fake = makeFakeDb({});
    const { ctx } = buildCtx({ headers: {} });
    const r = await authenticateOperator(ctx as never, {
      jwks: new JwksCache(vi.fn() as never),
      // boundary: tests inject a partial drizzle stub.
      db: fake.db as never,
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.failure.kind).toBe("missing_token");
  });

  it("returns invalid_token when jwtVerify throws and records a failure on the cache", async () => {
    vi.doMock("jose", () => ({
      jwtVerify: vi.fn(async () => {
        throw new Error("bad signature");
      }),
    }));
    const { authenticateOperator } = await import(
      "@/middlewares/authenticate-operator"
    );
    const { JwksCache } = await import("@/middlewares/jwks-cache");
    const factory = vi.fn(async () => ({}) as never);
    const cache = new JwksCache(factory);
    const recordFailure = vi.spyOn(cache, "recordFailure");
    const fake = makeFakeDb({});
    const { ctx } = buildCtx({
      headers: { "cf-access-jwt-assertion": "TOKEN" },
    });
    const r = await authenticateOperator(ctx as never, {
      jwks: cache,
      db: fake.db as never,
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.failure.kind).toBe("invalid_token");
    expect(recordFailure).toHaveBeenCalledTimes(1);
  });

  it("returns service_token_rejected failure when payload.common_name is set", async () => {
    vi.doMock("jose", () => ({
      jwtVerify: vi.fn(async () => ({
        payload: {
          sub: "svc_1",
          email: "svc@co.com",
          common_name: "ci-bot",
          type: "app",
        },
      })),
    }));
    const { authenticateOperator } = await import(
      "@/middlewares/authenticate-operator"
    );
    const { JwksCache } = await import("@/middlewares/jwks-cache");
    const fake = makeFakeDb({});
    const { ctx } = buildCtx({
      headers: { "cf-access-jwt-assertion": "TOKEN" },
    });
    const r = await authenticateOperator(ctx as never, {
      jwks: new JwksCache(vi.fn(async () => ({}) as never)),
      db: fake.db as never,
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.failure.kind).toBe("service_token_rejected");
  });

  it("returns enrollment_required when no global_admin row + no enrollment header", async () => {
    vi.doMock("jose", () => ({
      jwtVerify: vi.fn(async () => ({
        payload: { sub: "u_1", email: "alice@co.com", type: "org" },
      })),
    }));
    const { authenticateOperator } = await import(
      "@/middlewares/authenticate-operator"
    );
    const { JwksCache } = await import("@/middlewares/jwks-cache");
    const fake = makeFakeDb({ bySub: null });
    const { ctx } = buildCtx({
      headers: { "cf-access-jwt-assertion": "TOKEN" },
    });
    const r = await authenticateOperator(ctx as never, {
      jwks: new JwksCache(vi.fn(async () => ({}) as never)),
      db: fake.db as never,
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.failure.kind).toBe("enrollment_required");
  });

  it("claims an enrollment token atomically and returns ok with admin", async () => {
    vi.doMock("jose", () => ({
      jwtVerify: vi.fn(async () => ({
        payload: { sub: "u_1", email: "alice@co.com", type: "org" },
      })),
    }));
    const candidate: FakeAdmin = {
      id: "gad_1",
      email: "alice@co.com",
      enrollmentToken: "TOK",
      enrollmentTokenExpiresAt: new Date(Date.now() + 60_000),
      cfAccessSub: null,
      deactivatedAt: null,
      role: "support",
    };
    const claimed: FakeAdmin = { ...candidate, cfAccessSub: "u_1" };
    const { authenticateOperator } = await import(
      "@/middlewares/authenticate-operator"
    );
    const { JwksCache } = await import("@/middlewares/jwks-cache");
    const fake = makeFakeDb({
      bySub: null,
      byEnrollment: candidate,
      claimed: [claimed],
    });
    const { ctx } = buildCtx({
      headers: {
        "cf-access-jwt-assertion": "TOKEN",
        "x-admin-enrollment-token": "TOK",
      },
    });
    const r = await authenticateOperator(ctx as never, {
      jwks: new JwksCache(vi.fn(async () => ({}) as never)),
      db: fake.db as never,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.admin.id).toBe("gad_1");
  });

  it("returns deactivated failure when row.deactivatedAt is set", async () => {
    vi.doMock("jose", () => ({
      jwtVerify: vi.fn(async () => ({
        payload: { sub: "u_1", email: "alice@co.com", type: "org" },
      })),
    }));
    const fakeAdmin: FakeAdmin = {
      id: "gad_1",
      email: "alice@co.com",
      cfAccessSub: "u_1",
      deactivatedAt: new Date(),
      role: "support",
    };
    const { authenticateOperator } = await import(
      "@/middlewares/authenticate-operator"
    );
    const { JwksCache } = await import("@/middlewares/jwks-cache");
    const fake = makeFakeDb({ bySub: fakeAdmin });
    const { ctx } = buildCtx({
      headers: { "cf-access-jwt-assertion": "TOKEN" },
    });
    const r = await authenticateOperator(ctx as never, {
      jwks: new JwksCache(vi.fn(async () => ({}) as never)),
      db: fake.db as never,
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.failure.kind).toBe("deactivated");
  });

  it("calls recordSuccess on verify success", async () => {
    vi.doMock("jose", () => ({
      jwtVerify: vi.fn(async () => ({
        payload: { sub: "u_1", email: "alice@co.com", type: "org" },
      })),
    }));
    const fakeAdmin: FakeAdmin = {
      id: "gad_1",
      email: "alice@co.com",
      cfAccessSub: "u_1",
      deactivatedAt: null,
      role: "support",
    };
    const { authenticateOperator } = await import(
      "@/middlewares/authenticate-operator"
    );
    const { JwksCache } = await import("@/middlewares/jwks-cache");
    const cache = new JwksCache(vi.fn(async () => ({}) as never));
    const recordSuccess = vi.spyOn(cache, "recordSuccess");
    const fake = makeFakeDb({ bySub: fakeAdmin });
    const { ctx } = buildCtx({
      headers: { "cf-access-jwt-assertion": "TOKEN" },
    });
    const r = await authenticateOperator(ctx as never, {
      jwks: cache,
      db: fake.db as never,
    });
    expect(r.ok).toBe(true);
    expect(recordSuccess).toHaveBeenCalledTimes(1);
  });

  it("schedules a lastActiveAt update via executionCtx.waitUntil on success", async () => {
    vi.doMock("jose", () => ({
      jwtVerify: vi.fn(async () => ({
        payload: { sub: "u_1", email: "alice@co.com", type: "org" },
      })),
    }));
    const fakeAdmin: FakeAdmin = {
      id: "gad_1",
      email: "alice@co.com",
      cfAccessSub: "u_1",
      deactivatedAt: null,
      role: "support",
    };
    const { authenticateOperator } = await import(
      "@/middlewares/authenticate-operator"
    );
    const { JwksCache } = await import("@/middlewares/jwks-cache");
    const fake = makeFakeDb({ bySub: fakeAdmin });
    const waitUntil = vi.fn();
    const { ctx } = buildCtx({
      headers: { "cf-access-jwt-assertion": "TOKEN" },
      waitUntil,
    });
    const r = await authenticateOperator(ctx as never, {
      jwks: new JwksCache(vi.fn(async () => ({}) as never)),
      db: fake.db as never,
    });
    expect(r.ok).toBe(true);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});
