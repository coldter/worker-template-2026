import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditCreateDualScope: vi.fn(async () => ({
    globalRow: {},
    tenantRow: {},
  })),
  loadAndGuardInvitation: vi.fn(),
}));

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));

vi.mock("@/modules/audit-logs/service", () => ({
  auditLogService: {
    create: vi.fn(async () => undefined),
    enqueue: vi.fn(() => undefined),
    createDualScope: mocks.auditCreateDualScope,
  },
}));

vi.mock("@/modules/invitations/loader", () => ({
  loadAndGuardInvitation: mocks.loadAndGuardInvitation,
}));

const { auditCreateDualScope, loadAndGuardInvitation } = mocks;

import { Hono } from "hono";
import type { AppEnv } from "@/lib/context";
import handler from "@/modules/invitations/handler";

type AuthStubs = {
  createUser?: ReturnType<typeof vi.fn>;
  findUserByEmail?: ReturnType<typeof vi.fn>;
  signInEmail?: ReturnType<typeof vi.fn>;
  acceptInvitation?: ReturnType<typeof vi.fn>;
};

const tenant = {
  organizationId: "org_acme",
  slug: "acme",
  host: "acme.app.example.com",
  kind: "subdomain" as const,
  enforceSSO: false,
  sessionVersion: 1,
  suspendedAt: null,
  deletedAt: null,
};

const sampleInvitation = {
  id: "inv_1",
  email: "owner@acme.com",
  inviterId: null,
  organizationId: "org_acme",
  role: "owner",
  status: "pending",
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
};

function buildApp(stubs: AuthStubs = {}) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("tenant", tenant);
    // boundary: tests use a partial drizzle stub (only loadAndGuardInvitation
    // reads the db, and that helper is mocked above).
    c.set("db", {} as never);
    await next();
  });
  app.route("/api/invitations", handler);

  const env = {
    AUTH: {
      createUser: stubs.createUser ?? vi.fn(async () => ({ id: "usr_new" })),
      findUserByEmail: stubs.findUserByEmail ?? vi.fn(async () => null),
      signInEmail:
        stubs.signInEmail ??
        vi.fn(async () => ({
          ok: true,
          setCookies: [
            "session_token_v1=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
          ],
        })),
      acceptInvitation:
        stubs.acceptInvitation ?? vi.fn(async () => ({ ok: true })),
    },
    // The accept handler's per-(ip, invitationId) rate limit reads from
    // RATE_LIMITER (DO) first, then falls back to CACHE (KV). Tests that
    // don't override either get a permissive no-op KV stub so the
    // middleware always allows.
    CACHE: {
      get: async () => null,
      put: async () => undefined,
    },
  };
  return { app, env };
}

describe("POST /api/invitations/accept/:invitationId", () => {
  it("creates user, signs in, accepts invitation, and forwards Set-Cookie", async () => {
    loadAndGuardInvitation.mockResolvedValueOnce({
      kind: "ok",
      invitation: sampleInvitation,
    });
    const { app, env } = buildApp();
    const res = await app.request(
      "/api/invitations/accept/inv_1",
      {
        method: "POST",
        headers: {
          host: "acme.app.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Owner", password: "Sup3rSecret!" }),
      },
      // boundary: tests inject a partial bindings record
      env as never
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("session_token_v1=abc");
    expect(env.AUTH.createUser).toHaveBeenCalledTimes(1);
    expect(env.AUTH.signInEmail).toHaveBeenCalledTimes(1);
    expect(env.AUTH.acceptInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId: "inv_1" })
    );
  });

  it("recovers from BA's USER_ALREADY_EXISTS by looking up the existing user", async () => {
    loadAndGuardInvitation.mockResolvedValueOnce({
      kind: "ok",
      invitation: sampleInvitation,
    });
    const createUser = vi.fn(async () => {
      throw Object.assign(new Error("dup"), { code: "USER_ALREADY_EXISTS" });
    });
    const findUserByEmail = vi.fn(async () => ({
      id: "usr_existing",
      email: "owner@acme.com",
      name: "Owner",
    }));
    const { app, env } = buildApp({ createUser, findUserByEmail });
    const res = await app.request(
      "/api/invitations/accept/inv_1",
      {
        method: "POST",
        headers: {
          host: "acme.app.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Owner", password: "Sup3rSecret!" }),
      },
      env as never
    );
    expect(res.status).toBe(200);
    expect(findUserByEmail).toHaveBeenCalledWith("owner@acme.com");
    expect(env.AUTH.signInEmail).toHaveBeenCalled();
  });

  it("returns 401 and writes partial_failure audit when sign-in fails", async () => {
    auditCreateDualScope.mockClear();
    loadAndGuardInvitation.mockResolvedValueOnce({
      kind: "ok",
      invitation: sampleInvitation,
    });
    const signInEmail = vi.fn(async () => ({ ok: false, setCookies: [] }));
    const { app, env } = buildApp({ signInEmail });
    const res = await app.request(
      "/api/invitations/accept/inv_1",
      {
        method: "POST",
        headers: {
          host: "acme.app.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Owner", password: "Sup3rSecret!" }),
      },
      env as never
    );
    expect(res.status).toBe(401);
    expect(auditCreateDualScope).toHaveBeenCalledTimes(1);
    const call = auditCreateDualScope.mock.calls[0];
    if (!call) {
      throw new Error("expected audit call");
    }
    const [auditInput] = call as unknown as [
      { event: string; actorType: string; organizationId: string },
    ];
    expect(auditInput.event).toBe("org.invitation.partial_failure");
    expect(auditInput.actorType).toBe("system");
    expect(auditInput.organizationId).toBe("org_acme");
  });

  it("does NOT mark invitation accepted when AUTH.acceptInvitation throws (and emits partial_failure audit)", async () => {
    auditCreateDualScope.mockClear();
    loadAndGuardInvitation.mockResolvedValueOnce({
      kind: "ok",
      invitation: sampleInvitation,
    });
    const acceptInvitation = vi.fn(async () => {
      throw new Error("boom");
    });
    const { app, env } = buildApp({ acceptInvitation });
    const res = await app.request(
      "/api/invitations/accept/inv_1",
      {
        method: "POST",
        headers: {
          host: "acme.app.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Owner", password: "Sup3rSecret!" }),
      },
      env as never
    );
    expect(res.status).toBe(500);
    expect(auditCreateDualScope).toHaveBeenCalledTimes(1);
    const call = auditCreateDualScope.mock.calls[0];
    if (!call) {
      throw new Error("expected audit call");
    }
    const [auditInput] = call as unknown as [
      { event: string; metadata?: { stage?: string } },
    ];
    expect(auditInput.event).toBe("org.invitation.partial_failure");
    expect(auditInput.metadata?.stage).toBe("accept_invitation");
  });

  it("returns 404 when no tenant is resolved", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("tenant", null);
      await next();
    });
    app.route("/api/invitations", handler);
    const env = {
      CACHE: {
        get: async () => null,
        put: async () => undefined,
      },
    };
    const res = await app.request(
      "/api/invitations/accept/inv_1",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "X", password: "passpass" }),
      },
      env as never
    );
    expect(res.status).toBe(404);
  });

  it("forwards every Set-Cookie returned by AUTH.signInEmail (no comma collapsing)", async () => {
    loadAndGuardInvitation.mockResolvedValueOnce({
      kind: "ok",
      invitation: sampleInvitation,
    });
    const signInEmail = vi.fn(async () => ({
      ok: true,
      setCookies: [
        "session_token_v1=abc; Path=/; Expires=Wed, 09 Jun 2027 10:18:14 GMT; HttpOnly; Secure; SameSite=Lax",
        "csrf_v1=xyz; Path=/; HttpOnly; Secure; SameSite=Lax",
      ],
    }));
    const acceptInvitation = vi.fn(async (args: { sessionCookie: string }) => {
      // Verify the wire-format Cookie header was reduced to name=value pairs.
      // boundary: vitest mock arg type
      expect(args.sessionCookie).toBe("session_token_v1=abc; csrf_v1=xyz");
      return { ok: true };
    });
    const { app, env } = buildApp({ signInEmail, acceptInvitation });
    const res = await app.request(
      "/api/invitations/accept/inv_1",
      {
        method: "POST",
        headers: {
          host: "acme.app.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Owner", password: "Sup3rSecret!" }),
      },
      env as never
    );
    expect(res.status).toBe(200);
    // Headers.getSetCookie returns each appended cookie verbatim.
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("session_token_v1=abc");
    expect(cookies[0]).toContain("Expires=Wed, 09 Jun 2027");
    expect(cookies[1]).toContain("csrf_v1=xyz");
  });

  it("rate-limits to 5 attempts per (ip, invitationId) per 5 minutes via the DO binding", async () => {
    // Each test invocation should always allow up to ACCEPT_RATE_LIMIT
    // attempts and then deny with 429. We share one DO stub across requests
    // by keying on the identifier string the middleware passes to
    // idFromName, so the per-tuple sliding-window state accumulates.
    type StubKey = string;
    const tuples = new Map<StubKey, number[]>();
    const ACCEPT_RATE_LIMIT = 5;
    const ACCEPT_RATE_WINDOW_MS = 5 * 60 * 1000;
    const stubFactory = (name: string) => ({
      checkLimit: async (limit: number, windowMs: number) => {
        const now = Date.now();
        const start = now - windowMs;
        const list = (tuples.get(name) ?? []).filter((t) => t > start);
        if (list.length >= limit) {
          tuples.set(name, list);
          return { allowed: false, remaining: 0 };
        }
        list.push(now);
        tuples.set(name, list);
        return { allowed: true, remaining: limit - list.length };
      },
    });

    loadAndGuardInvitation.mockResolvedValue({
      kind: "ok",
      invitation: sampleInvitation,
    });

    const { app, env } = buildApp();
    const RATE_LIMITER = {
      idFromName: (s: string) => ({ __name: s }),
      get: (id: { __name: string }) => stubFactory(id.__name),
    };
    // boundary: tests inject a partial bindings record covering only the
    // surface the accept handler reads (AUTH RPC + RATE_LIMITER + CACHE).
    const envWithRl = {
      ...env,
      RATE_LIMITER,
      CACHE: { get: async () => null, put: async () => undefined },
    } as never;

    for (let i = 0; i < ACCEPT_RATE_LIMIT; i++) {
      const res = await app.request(
        "/api/invitations/accept/inv_1",
        {
          method: "POST",
          headers: {
            host: "acme.app.example.com",
            "content-type": "application/json",
            "CF-Connecting-IP": "10.0.0.1",
          },
          body: JSON.stringify({ name: "Owner", password: "Sup3rSecret!" }),
        },
        envWithRl
      );
      expect([200, 401, 500]).toContain(res.status);
    }

    // 6th attempt within the window → 429.
    const blocked = await app.request(
      "/api/invitations/accept/inv_1",
      {
        method: "POST",
        headers: {
          host: "acme.app.example.com",
          "content-type": "application/json",
          "CF-Connecting-IP": "10.0.0.1",
        },
        body: JSON.stringify({ name: "Owner", password: "Sup3rSecret!" }),
      },
      envWithRl
    );
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many invitation accept attempts",
      },
    });

    // A different invitationId from the same IP is not blocked — the limiter
    // is keyed per (ip, invitationId) tuple. Reset the loader mock since
    // mockResolvedValueOnce was consumed by the loop above.
    expect(ACCEPT_RATE_WINDOW_MS).toBeGreaterThan(0);
    const otherId = await app.request(
      "/api/invitations/accept/inv_other",
      {
        method: "POST",
        headers: {
          host: "acme.app.example.com",
          "content-type": "application/json",
          "CF-Connecting-IP": "10.0.0.1",
        },
        body: JSON.stringify({ name: "Owner", password: "Sup3rSecret!" }),
      },
      envWithRl
    );
    expect(otherId.status).not.toBe(429);
  });

  it("returns 410 when the invitation has expired", async () => {
    loadAndGuardInvitation.mockResolvedValueOnce({ kind: "expired" });
    const { app, env } = buildApp();
    const res = await app.request(
      "/api/invitations/accept/inv_1",
      {
        method: "POST",
        headers: {
          host: "acme.app.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Owner", password: "Sup3rSecret!" }),
      },
      env as never
    );
    expect(res.status).toBe(410);
    expect(env.AUTH.createUser).not.toHaveBeenCalled();
  });
});
