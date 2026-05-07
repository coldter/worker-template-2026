import type { GlobalAdmin } from "@repo/db/schema";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminEnv } from "@/env";

type ResponseBody = { error?: { code?: string }; sub?: string; email?: string };

function makeFakeDb(opts: { admin?: Partial<GlobalAdmin> | null } = {}) {
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => ({ rowCount: 1 })),
    })),
  }));
  return {
    query: {
      globalAdmins: {
        findFirst: vi.fn(async () => opts.admin ?? null),
      },
    },
    update,
  };
}

function injectDb(app: Hono<AdminEnv>, admin?: Partial<GlobalAdmin> | null) {
  const fake = makeFakeDb({ admin });
  app.use("*", async (c, next) => {
    // boundary: tests inject a partial drizzle stub.
    c.set("db", fake as unknown as AdminEnv["Variables"]["db"]);
    await next();
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("cfAccessMiddleware", () => {
  it("rejects when token is missing", async () => {
    const { cfAccessMiddleware } = await import("@/middlewares/cf-access");
    const app = new Hono<AdminEnv>();
    app.use("*", cfAccessMiddleware);
    app.get("/whoami", (c) => c.json(c.get("accessIdentity")));
    const res = await app.request(
      "/whoami",
      { headers: { host: "admin.example.com" } },
      {
        ADMIN_HOST: "admin.example.com",
        NODE_ENV: "production",
        CF_ACCESS_AUD: "aud",
        CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as ResponseBody;
    expect(body.error?.code).toBe("ACCESS_TOKEN_REQUIRED");
  });

  it("normalizes the team domain (strips trailing slash) before passing to JWKSet", async () => {
    let observedUrl: string | null = null;
    vi.doMock("jose", () => ({
      createRemoteJWKSet: vi.fn((url: URL) => {
        observedUrl = url.toString();
        return { tag: "JWKS" };
      }),
      jwtVerify: vi.fn(async () => ({
        payload: { sub: "u_1", email: "OPS@CO.com", type: "org" },
      })),
    }));
    const { cfAccessMiddleware } = await import("@/middlewares/cf-access");
    const app = new Hono<AdminEnv>();
    injectDb(app, {
      id: "gad_1",
      email: "ops@co.com",
      cfAccessSub: "u_1",
      role: "support",
      deactivatedAt: null,
    });
    app.use("*", cfAccessMiddleware);
    app.get("/x", (c) => c.json(c.get("accessIdentity")));

    const res = await app.request(
      "/x",
      {
        headers: {
          host: "admin.example.com",
          "cf-access-jwt-assertion": "TOKEN",
        },
      },
      {
        ADMIN_HOST: "admin.example.com",
        NODE_ENV: "production",
        CF_ACCESS_AUD: "aud",
        CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com/",
      }
    );
    expect(res.status).toBe(200);
    expect(observedUrl).toBe(
      "https://team.cloudflareaccess.com/cdn-cgi/access/certs"
    );
    const body = (await res.json()) as ResponseBody;
    expect(body).toEqual({ sub: "u_1", email: "ops@co.com" });
  });

  it("rejects service tokens (payload.type !== 'org' OR common_name set)", async () => {
    vi.doMock("jose", () => ({
      createRemoteJWKSet: vi.fn(() => ({})),
      jwtVerify: vi.fn(async () => ({
        payload: { sub: "svc_1", common_name: "ci-bot", type: "app" },
      })),
    }));
    const { cfAccessMiddleware } = await import("@/middlewares/cf-access");
    const app = new Hono<AdminEnv>();
    app.use("*", cfAccessMiddleware);
    app.get("/x", (c) => c.text("ok"));
    const res = await app.request(
      "/x",
      {
        headers: {
          host: "admin.example.com",
          "cf-access-jwt-assertion": "TOKEN",
        },
      },
      {
        ADMIN_HOST: "admin.example.com",
        NODE_ENV: "production",
        CF_ACCESS_AUD: "aud",
        CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as ResponseBody;
    expect(body.error?.code).toBe("IDENTITY_TOKEN_REQUIRED");
  });

  it("uses the dev fallback when ALLOW_DEV_ADMIN_AUTH=true and NODE_ENV=development", async () => {
    const { cfAccessMiddleware } = await import("@/middlewares/cf-access");
    const app = new Hono<AdminEnv>();
    injectDb(app, {
      id: "gad_dev",
      email: "dev-operator@example.com",
      cfAccessSub: "local-dev-dev-operator@example.com",
      role: "super_admin",
      deactivatedAt: null,
    });
    app.use("*", cfAccessMiddleware);
    app.get("/x", (c) => c.json(c.get("accessIdentity")));
    const res = await app.request(
      "/x",
      { headers: { host: "admin.lvh.me" } },
      {
        ADMIN_HOST: "admin.lvh.me",
        NODE_ENV: "development",
        ALLOW_DEV_ADMIN_AUTH: "true",
        LOCAL_DEV_ADMIN_EMAIL: "Dev-Operator@example.com  ",
        CF_ACCESS_AUD: "aud",
        CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ResponseBody;
    expect(body).toEqual({
      sub: "local-dev-dev-operator@example.com",
      email: "dev-operator@example.com",
    });
  });

  it("fails hard when LOCAL_DEV_ADMIN_EMAIL is set in production", async () => {
    const { cfAccessMiddleware } = await import("@/middlewares/cf-access");
    const app = new Hono<AdminEnv>();
    app.use("*", cfAccessMiddleware);
    app.get("/x", (c) => c.text("ok"));
    const res = await app.request(
      "/x",
      { headers: { host: "admin.example.com" } },
      {
        ADMIN_HOST: "admin.example.com",
        NODE_ENV: "production",
        LOCAL_DEV_ADMIN_EMAIL: "leak@evil.com",
        CF_ACCESS_AUD: "aud",
        CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      }
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as ResponseBody;
    expect(body.error?.code).toBe("MISCONFIGURED");
  });
});
