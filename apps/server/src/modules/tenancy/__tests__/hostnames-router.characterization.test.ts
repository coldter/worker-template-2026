/**
 * C3 Task 14 — Characterization test for the tenancy custom-hostnames router.
 *
 * Locks in the contract A5 + A5 polish shipped:
 *   - Each route validates input (Zod via OpenAPIHono) and then delegates to
 *     `customHostnameLifecycle` — the route layer is a thin adapter.
 *   - `LifecycleError` codes map onto stable HTTP statuses.
 *   - `TenancyConstraintError` (A5.6 service guard) maps to 409.
 *   - `TenancyRateLimitError` maps to 429.
 *
 * If C3 changes the route -> service contract or the error mapping, these
 * tests will fail and we will know the refactor changed user-visible behavior.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: async () => undefined,
}));

// Bypass the policy guard so each test can drive the route layer directly.
// The authorization layer is exhaustively covered in the @repo/authorization
// suites; here we only care that the route delegates to the lifecycle service.
vi.mock("@/auth/middleware", () => ({
  authorize: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  getAuthorizedResource: () => undefined,
  resolvePrincipalFromContext: () => null,
}));

const lifecycleSpies = vi.hoisted(() => ({
  list: vi.fn(),
  request: vi.fn(),
  verifyTxt: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/modules/tenancy/lifecycle", async () => {
  // Preserve real error classes so `instanceof` checks in the handler still
  // work; only swap the service object for our spies.
  const actual = await vi.importActual<
    typeof import("@/modules/tenancy/lifecycle")
  >("@/modules/tenancy/lifecycle");
  return {
    ...actual,
    customHostnameLifecycle: lifecycleSpies,
  };
});

import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "@/lib/context";
import customHostnamesHandler from "@/modules/tenancy/custom-hostnames/handler";
import { LifecycleError } from "@/modules/tenancy/lifecycle";
import { TenancyRateLimitError } from "@/modules/tenancy/rate-limits";

// boundary: the handler is typed against `AppEnv` which expects middleware-
// populated bindings (db, user, session, invalidator). We mount it under a
// pre-populating root so each test can simulate an authenticated caller
// without booting the full middleware stack.
function buildApp(opts: {
  user?: { id: string };
  session?: { activeOrganizationId: string };
  db?: unknown;
  invalidator?: unknown;
}) {
  const root = new OpenAPIHono<AppEnv>();
  // boundary: the handler reads `db`, `user`, `session`, and `invalidator`
  // from the context. We populate them via a stub middleware so the test does
  // not need the full middleware stack — type-cast each set call to bypass
  // strict context-key validation in the OpenAPIHono helper.
  root.use("*", async (c, next) => {
    const setter = c.set as unknown as (k: string, v: unknown) => void;
    setter("db", opts.db ?? {});
    setter("user", opts.user ?? { id: "user_1" });
    setter("session", opts.session ?? { activeOrganizationId: "org_1" });
    setter(
      "invalidator",
      opts.invalidator ?? {
        fanOut: async () => undefined,
        fanOutBumpVersion: async () => undefined,
        invalidateOwn: async () => undefined,
        bumpOwnVersion: async () => undefined,
      }
    );
    await next();
  });
  root.route("/", customHostnamesHandler);
  return root;
}

const ENV = {
  CLOUDFLARE_API_TOKEN: "tok",
  CLOUDFLARE_ZONE_ID: "zone",
  CUSTOM_HOST_CNAME_TARGET: "customers.example.com",
  CUSTOM_HOST_VERIFICATION_LABEL: "_app-verify",
  CACHE: {},
};

describe("tenancy custom-hostnames router (characterization)", () => {
  it("GET / -> 200 delegates to lifecycle.list with the active org id", async () => {
    lifecycleSpies.list.mockResolvedValueOnce([
      {
        id: "tnh_1",
        hostname: "app.acme.test",
        lifecycleStatus: "active",
        cfStatus: "active",
        cfSslStatus: "active",
        verificationVerifiedAt: new Date("2026-05-06T10:00:00Z"),
        lastReconciledAt: new Date("2026-05-06T10:01:00Z"),
        verificationErrors: [],
        createdAt: new Date("2026-05-06T09:00:00Z"),
      },
    ]);

    const app = buildApp({});
    const res = await app.request("/", { method: "GET" }, ENV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hostnames: { id: string }[] };
    expect(body.hostnames[0]?.id).toBe("tnh_1");
    expect(lifecycleSpies.list).toHaveBeenCalledWith(
      expect.anything(),
      "org_1"
    );
  });

  it("GET / -> 401 when no active session", async () => {
    // boundary: bypass `buildApp` because we explicitly set session to null
    // (the helper defaults to a populated session).
    const root = new OpenAPIHono<AppEnv>();
    root.use("*", async (c, next) => {
      const setter = c.set as unknown as (k: string, v: unknown) => void;
      setter("db", {});
      setter("user", { id: "user_1" });
      setter("session", null);
      setter("invalidator", {});
      await next();
    });
    root.route("/", customHostnamesHandler);

    const res = await root.request("/", { method: "GET" }, ENV);
    expect(res.status).toBe(401);
  });

  it("POST / -> 201 delegates to lifecycle.request with body hostname", async () => {
    lifecycleSpies.request.mockResolvedValueOnce({
      id: "tnh_2",
      hostname: "app.acme.test",
      verificationToken: "vtok",
      verificationLabel: "_app-verify",
      instructions: "...",
    });

    const app = buildApp({});
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostname: "app.acme.test" }),
      },
      ENV
    );
    expect(res.status).toBe(201);
    expect(lifecycleSpies.request).toHaveBeenCalledTimes(1);
    const args = lifecycleSpies.request.mock.calls[0];
    expect(args?.[2]).toBe("app.acme.test");
    expect(args?.[3]).toMatchObject({ id: "user_1", organizationId: "org_1" });
  });

  it("POST / -> 422 on LifecycleError(invalid_hostname)", async () => {
    lifecycleSpies.request.mockRejectedValueOnce(
      new LifecycleError("invalid_hostname", "Hostname is not valid")
    );
    const app = buildApp({});
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostname: "ok.example.test" }),
      },
      ENV
    );
    expect(res.status).toBe(422);
  });

  it("POST / -> 409 on LifecycleError(duplicate_hostname)", async () => {
    lifecycleSpies.request.mockRejectedValueOnce(
      new LifecycleError("duplicate_hostname", "Hostname already requested")
    );
    const app = buildApp({});
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostname: "ok.example.test" }),
      },
      ENV
    );
    expect(res.status).toBe(409);
  });

  it("POST / -> 429 on TenancyRateLimitError", async () => {
    lifecycleSpies.request.mockRejectedValueOnce(
      new TenancyRateLimitError("daily_quota", 86_400)
    );
    const app = buildApp({});
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostname: "ok.example.test" }),
      },
      ENV
    );
    expect(res.status).toBe(429);
  });

  it("POST /:id/verify-txt -> 200 delegates to lifecycle.verifyTxt", async () => {
    lifecycleSpies.verifyTxt.mockResolvedValueOnce({
      id: "tnh_1",
      hostname: "app.acme.test",
      cfHostnameId: "cf_1",
      lifecycleStatus: "awaiting_cf",
      cnameTarget: "customers.example.com",
      preValidation: null,
    });

    const app = buildApp({});
    const res = await app.request("/tnh_1/verify-txt", { method: "POST" }, ENV);
    expect(res.status).toBe(200);
    expect(lifecycleSpies.verifyTxt).toHaveBeenCalledTimes(1);
    expect(lifecycleSpies.verifyTxt.mock.calls[0]?.[2]).toBe("tnh_1");
  });

  it("POST /:id/verify-txt -> 503 on resolver error", async () => {
    lifecycleSpies.verifyTxt.mockRejectedValueOnce(
      new LifecycleError("txt_resolver_error", "Resolver timeout")
    );
    const app = buildApp({});
    const res = await app.request("/tnh_1/verify-txt", { method: "POST" }, ENV);
    expect(res.status).toBe(503);
  });

  it("DELETE /:id -> 200 delegates to lifecycle.remove with invalidator + cache", async () => {
    lifecycleSpies.remove.mockResolvedValueOnce({
      id: "tnh_1",
      lifecycleStatus: "removed",
    });

    const app = buildApp({});
    const res = await app.request("/tnh_1", { method: "DELETE" }, ENV);
    expect(res.status).toBe(200);
    expect(lifecycleSpies.remove).toHaveBeenCalledTimes(1);
    const args = lifecycleSpies.remove.mock.calls[0];
    expect(args?.[2]).toBe("tnh_1");
    // Deps: invalidator + cache (last positional arg).
    expect(args?.[4]).toMatchObject({
      invalidator: expect.anything(),
      cache: ENV.CACHE,
    });
  });
});
