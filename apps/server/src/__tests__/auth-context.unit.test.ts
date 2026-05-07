// Unit coverage for `authContextMiddleware`. Asserts the bearer-JWT fast
// path / AUTH RPC fallback ordering required by Audit Wave 2 task 2:
//   - bearer-success           => verifier produces context, RPC NOT called
//   - bearer-bad-signature     => anonymous, RPC NOT called
//   - bearer-expired           => RPC IS called (refresh path)
//   - no-bearer                => RPC IS called
//   - RPC failure / null       => session/user nulled, request continues
//
// We exercise the middleware against a hand-rolled Hono context-shaped stub
// rather than the full app pipeline so the JWKS resolver / Drizzle client
// stay out of the test surface.

import type {
  AuthorizedClaims,
  VerifyError,
  VerifyOpts,
} from "@repo/auth-tokens";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "@/lib/context";
import {
  authContextMiddleware,
  type IncomingTenantJwtVerifier,
} from "@/middlewares/auth-context";

const TENANT = {
  organizationId: "org_acme",
  slug: "acme",
  host: "acme.app.localhost",
  kind: "subdomain" as const,
  enforceSSO: false,
  sessionVersion: 0,
  suspendedAt: null,
  deletedAt: null,
};

const VALID_CLAIMS: AuthorizedClaims = {
  sub: "user_1",
  email: "u@example.com",
  roleSlugs: ["member"],
  platform: "web",
  org: { id: "org_acme", host: "acme.app.localhost", sessionVersion: 0 },
};

type GetSessionFn = (
  headers: Headers,
  tenant: typeof TENANT | null
) => Promise<{
  user: Record<string, unknown>;
  session: Record<string, unknown>;
} | null>;

type CapturedVars = {
  user: unknown;
  session: unknown;
};

function buildApp(opts: {
  getSession: GetSessionFn;
  verify?: IncomingTenantJwtVerifier;
}) {
  const captured: CapturedVars = { user: undefined, session: undefined };

  const app = new Hono<AppEnv>();

  // Inject tenant + db. The verifier path can ask for organization session
  // version data, so the fixture includes the minimal query method it needs.
  app.use("*", async (c, next) => {
    // boundary: test fixture — Hono context vars are typed loosely in test
    // harnesses; we set the structural shape the middleware reads.
    c.set("tenant", TENANT as unknown as AppEnv["Variables"]["tenant"]);
    c.set("db", {
      query: {
        organizations: {
          findFirst: async () => ({ sessionVersion: 0 }),
        },
      },
    } as unknown as AppEnv["Variables"]["db"]);
    await next();
  });

  app.use("*", async (c, next) => {
    // Patch env on every request — vitest creates fresh app per test.
    Object.assign(c.env, {
      AUTH_JWKS_URL: "https://auth.example/.well-known/jwks.json",
      AUTH: {
        getSession: opts.getSession,
      } as unknown as AppEnv["Bindings"]["AUTH"],
    });
    await next();
  });

  // Inject the middleware under test, with the verifier override threaded
  // through a wrapper module-level patch.
  app.use("*", authContextMiddleware);

  app.get("/probe", (c) => {
    captured.user = c.var.user;
    captured.session = c.var.session;
    return c.json({ ok: true });
  });

  return { app, captured };
}

const successVerifier: IncomingTenantJwtVerifier = async () => VALID_CLAIMS;
const badSigVerifier: IncomingTenantJwtVerifier = async () =>
  ({ kind: "bad_signature" }) satisfies VerifyError;
const expiredVerifier: IncomingTenantJwtVerifier = async () =>
  ({ kind: "expired" }) satisfies VerifyError;

// The middleware imports the verifier at module init time, so we replace the
// module export with a controllable stub before each test.
let activeVerifier: IncomingTenantJwtVerifier = badSigVerifier;

vi.mock("@repo/auth-tokens", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    verifyTenantJwt: (
      token: string,
      opts: VerifyOpts & { db: AppEnv["Variables"]["db"] }
    ) => activeVerifier(token, opts),
    createRemoteJwksResolver: () => async () => new Uint8Array(0),
  };
});

describe("authContextMiddleware", () => {
  beforeEach(() => {
    activeVerifier = badSigVerifier;
  });

  it("populates user/session on bearer-success and skips RPC", async () => {
    activeVerifier = successVerifier;
    const getSession = vi.fn<GetSessionFn>();
    const { app, captured } = buildApp({ getSession });

    const res = await app.request(
      "/probe",
      { headers: { Authorization: "Bearer fake.jwt.token" } },
      // boundary: Miniflare-free unit test — we pass the env via c.env mutation
      // in the seeding middleware above.
      {} as AppEnv["Bindings"]
    );
    expect(res.status).toBe(200);
    expect(getSession).not.toHaveBeenCalled();
    expect(captured.user).toMatchObject({
      id: "user_1",
      email: "u@example.com",
    });
    expect(captured.session).toMatchObject({
      activeOrganizationId: "org_acme",
      platform: "web",
    });
  });

  it("nulls session on bearer-bad-signature and skips RPC", async () => {
    activeVerifier = badSigVerifier;
    const getSession = vi.fn<GetSessionFn>();
    const { app, captured } = buildApp({ getSession });

    const res = await app.request(
      "/probe",
      { headers: { Authorization: "Bearer fake.jwt.token" } },
      {} as AppEnv["Bindings"]
    );
    expect(res.status).toBe(200);
    expect(getSession).not.toHaveBeenCalled();
    expect(captured.user).toBeNull();
    expect(captured.session).toBeNull();
  });

  it("falls back to AUTH RPC on bearer-expired", async () => {
    activeVerifier = expiredVerifier;
    const getSession = vi.fn<GetSessionFn>(async () => ({
      user: { id: "user_2" },
      session: { id: "sess_2", activeOrganizationId: "org_acme" },
    }));
    const { app, captured } = buildApp({ getSession });

    const res = await app.request(
      "/probe",
      { headers: { Authorization: "Bearer expired.jwt.token" } },
      {} as AppEnv["Bindings"]
    );
    expect(res.status).toBe(200);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(captured.user).toMatchObject({ id: "user_2" });
    expect(captured.session).toMatchObject({ id: "sess_2" });
  });

  it("uses AUTH RPC when no bearer is present", async () => {
    const getSession = vi.fn<GetSessionFn>(async () => ({
      user: { id: "user_3" },
      session: { id: "sess_3" },
    }));
    const { app, captured } = buildApp({ getSession });

    const res = await app.request("/probe", {}, {} as AppEnv["Bindings"]);
    expect(res.status).toBe(200);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(captured.user).toMatchObject({ id: "user_3" });
    expect(captured.session).toMatchObject({ id: "sess_3" });
  });

  it("nulls user/session when AUTH RPC returns null (failure passthrough)", async () => {
    const getSession = vi.fn<GetSessionFn>(async () => null);
    const { app, captured } = buildApp({ getSession });

    const res = await app.request("/probe", {}, {} as AppEnv["Bindings"]);
    expect(res.status).toBe(200);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(captured.user).toBeNull();
    expect(captured.session).toBeNull();
  });
});
