import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminEnv } from "@/env";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type ResponseBody = { error?: { code?: string }; sub?: string; email?: string };

describe("cfAccessMiddleware (characterization)", () => {
  it("returns 403 ACCESS_TOKEN_REQUIRED when no JWT header is present", async () => {
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
        CF_ACCESS_AUD: "aud",
        CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as ResponseBody;
    expect(body.error?.code).toBe("ACCESS_TOKEN_REQUIRED");
  });

  it("returns 403 IDENTITY_TOKEN_REQUIRED for service tokens (common_name set OR type !== 'org')", async () => {
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

  it("returns 403 ACCESS_TOKEN_INVALID when jwtVerify throws", async () => {
    vi.doMock("jose", () => ({
      createRemoteJWKSet: vi.fn(() => ({})),
      jwtVerify: vi.fn(async () => {
        throw new Error("bad signature");
      }),
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
    expect(body.error?.code).toBe("ACCESS_TOKEN_INVALID");
  });

  it("on success sets accessIdentity{sub,email} (lowercased+trimmed) and calls next()", async () => {
    vi.doMock("jose", () => ({
      createRemoteJWKSet: vi.fn(() => ({})),
      jwtVerify: vi.fn(async () => ({
        payload: { sub: "u_1", email: "  Ops@Co.com ", type: "org" },
      })),
    }));
    const { cfAccessMiddleware } = await import("@/middlewares/cf-access");
    const app = new Hono<AdminEnv>();
    const fakeDb = {
      query: {
        globalAdmins: {
          findFirst: vi.fn(async () => ({
            id: "gad_1",
            email: "ops@co.com",
            cfAccessSub: "u_1",
            role: "support",
            deactivatedAt: null,
          })),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => ({ rowCount: 1 })),
        })),
      })),
    };
    app.use("*", async (c, next) => {
      // boundary: characterization test injects a partial drizzle stub.
      c.set("db", fakeDb as unknown as AdminEnv["Variables"]["db"]);
      await next();
    });
    app.use("*", cfAccessMiddleware);
    app.get("/whoami", (c) => c.json(c.get("accessIdentity")));
    const res = await app.request(
      "/whoami",
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
    expect(res.status).toBe(200);
    const body = (await res.json()) as ResponseBody;
    expect(body).toEqual({ sub: "u_1", email: "ops@co.com" });
  });

  it("returns 500 MISCONFIGURED if LOCAL_DEV_ADMIN_EMAIL is set in non-development env", async () => {
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
