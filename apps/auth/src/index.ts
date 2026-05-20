import { WorkerEntrypoint } from "cloudflare:workers";
import { withDrizzleClient } from "@repo/db";
import { users } from "@repo/db/schema";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import type { InvalidationSpec, Tenant } from "@repo/tenancy";
import { eq } from "drizzle-orm";
import { snapshotFromEnv } from "./host-config";
import { type AuthBindings, createAuth } from "./instance";
import { createAuthInvalidator } from "./invalidator";
import { sanitizedAuthRequest } from "./sanitized-request";
import {
  normalizeIssuerOrigin,
  registerTrustedOriginForTenant,
} from "./trusted-origin-store";

export { sanitizedAuthRequest } from "./sanitized-request";

/**
 * Path served by Better Auth's JWT plugin (basePath + plugin path). JWKS is
 * intrinsically tenant-independent: it is the public key set used by the
 * server's verifier (`packages/auth-tokens/src/jwks.ts`). We allow this one
 * path through `handleAuthRequest` with `tenant === null`.
 */
const JWKS_PATH = "/api/auth/jwks";

function getDrizzleLogger() {
  return process.env.NODE_ENV === "development"
    ? new DrizzleLogger()
    : undefined;
}

// Fallback sentinel for the no-tenant case (admin host or apex page). BA will
// still throw via allowedHosts unless the host is whitelisted in the snapshot.
function apexTenantFor(env: AuthBindings): Tenant {
  const snapshot = snapshotFromEnv(env);
  const apex = snapshot.wildcardSuffix.startsWith(".")
    ? snapshot.wildcardSuffix.slice(1)
    : snapshot.wildcardSuffix;
  return {
    organizationId: "",
    slug: null,
    host: apex,
    kind: "subdomain",
    enforceSSO: false,
    sessionVersion: 0,
    suspendedAt: null,
    deletedAt: null,
  };
}

export class AuthEntrypoint extends WorkerEntrypoint<CloudflareBindings> {
  /**
   * The auth worker is reachable ONLY via service-binding RPC from the
   * server / admin workers. Direct edge fetches (workers.dev probes, leaked
   * preview hosts) must fail closed: they have no resolved tenant context
   * and would otherwise mint apex JWTs / bypass tenant membership.
   *
   * Returns 421 (Misdirected Request).
   */
  fetch(_request: Request): Promise<Response> {
    return Promise.resolve(
      new Response("Misdirected Request", { status: 421 })
    );
  }

  async getSession(headers: Headers, tenant: Tenant | null) {
    return withDrizzleClient(
      this.env.HYPERDRIVE.connectionString,
      async (db) => {
        const snapshot = snapshotFromEnv(this.env as AuthBindings);
        const auth = createAuth(db, this.env as AuthBindings, this.ctx, {
          tenant,
          allowedHostsSnapshot: snapshot,
        });
        return await auth.api.getSession({ headers });
      },
      { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
    );
  }

  /**
   * Service-binding entry for `/api/auth/*` traffic. The server worker
   * resolves the tenant from the request host before invoking this method;
   * the only legal `tenant === null` case is the JWKS endpoint which serves
   * the public key set used by tenant JWT verifiers (the keys themselves
   * are not tenant-scoped).
   *
   * For the JWKS path we sidestep the Hono pipeline (which always 421s now)
   * and serve the keys directly via Better Auth's `auth.api.getJwks` API,
   * scoped to an apex tenant for `allowedHosts` resolution.
   */
  async handleAuthRequest(
    request: Request,
    tenant: Tenant | null
  ): Promise<Response> {
    const env = this.env as AuthBindings;
    const url = new URL(request.url);

    if (!tenant) {
      if (url.pathname !== JWKS_PATH) {
        return new Response(
          JSON.stringify({
            error: "tenant required for non-jwks auth routes",
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }
      // JWKS is read-only; reject non-GET/HEAD with 405 before BA sees it.
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
      }
      return this.serveJwks();
    }

    const sanitized = sanitizedAuthRequest(request, tenant);
    return withDrizzleClient(
      env.HYPERDRIVE.connectionString,
      async (db) => {
        const snapshot = snapshotFromEnv(env);
        const auth = createAuth(db, env, this.ctx, {
          tenant,
          allowedHostsSnapshot: snapshot,
        });
        return auth.handler(sanitized);
      },
      { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
    );
  }

  /**
   * Tenant-independent JWKS endpoint. Opens a per-call Drizzle client and
   * delegates to BA's JWT plugin via `auth.api.getJwks` so key rotation,
   * grace-period semantics, and key formats stay owned by BA.
   */
  private async serveJwks(): Promise<Response> {
    const env = this.env as AuthBindings;
    return withDrizzleClient(
      env.HYPERDRIVE.connectionString,
      async (db) => {
        const snapshot = snapshotFromEnv(env);
        const auth = createAuth(db, env, this.ctx, {
          tenant: apexTenantFor(env),
          allowedHostsSnapshot: snapshot,
        });
        // boundary: BA's typed api surface uses generic variance that loses
        // method-level inference once the auth instance is built behind
        // CreateAuthOptions; narrow the call shape here.
        const apiAny = auth.api as unknown as {
          getJwks: () => Promise<{ keys: unknown[] }>;
        };
        const jwks = await apiAny.getJwks();
        return new Response(JSON.stringify(jwks), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "public, max-age=300",
          },
        });
      },
      { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
    );
  }

  async getToken(headers: Headers, tenant: Tenant | null) {
    return withDrizzleClient(
      this.env.HYPERDRIVE.connectionString,
      async (db) => {
        const snapshot = snapshotFromEnv(this.env as AuthBindings);
        const auth = createAuth(db, this.env as AuthBindings, this.ctx, {
          tenant,
          allowedHostsSnapshot: snapshot,
        });
        return await auth.api.getToken({ headers });
      },
      { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
    );
  }

  /**
   * A2.6 / A2.9 — fan-in invalidation entrypoint. Called by the server's
   * FanOutInvalidator after a tenancy mutation so the auth worker drops its
   * own-colo Cache API entry for the given host. Auth never fans out further
   * (D28/D68 asymmetry).
   */
  async invalidateTenant(spec: InvalidationSpec): Promise<void> {
    const invalidator = createAuthInvalidator(this.env);
    await invalidator.invalidateOwn(spec);
  }

  /**
   * A2.6 / A2.9 — fan-in version-bump entrypoint. Bumps the auth worker's KV
   * version key, invalidating all cached tenant lookups in this colo without
   * scanning. Returns the new version so callers can confirm propagation.
   */
  async bumpTenantCacheVersion(): Promise<string> {
    const invalidator = createAuthInvalidator(this.env);
    return invalidator.bumpOwnVersion();
  }

  /**
   * A4.4 — discovery-time trustedOrigins registration. The server worker
   * calls this RPC after a successful `createSsoProvider` so the auth
   * worker's per-tenant `trustedOrigins(req)` callback admits redirects to
   * the registered IdP issuer origin on subsequent /sso/sign-in calls.
   *
   * The issuer URL is validated and normalized to a bare origin
   * (https-only, no userinfo, no path beyond root). Invalid issuers are
   * silently ignored — the server-side validator already rejected the row,
   * so this is a defense-in-depth filter.
   *
   * State is per-isolate. A cold isolate that missed registration falls
   * back to the auto-merged allowedHosts + per-tenant origin only; the next
   * registration call heals the snapshot.
   */
  async registerTrustedOrigin(
    tenantId: string,
    issuerUrl: string
  ): Promise<{ ok: boolean; origin: string | null }> {
    if (!tenantId) {
      return { ok: false, origin: null };
    }
    const origin = normalizeIssuerOrigin(issuerUrl);
    if (!origin) {
      return { ok: false, origin: null };
    }
    registerTrustedOriginForTenant(tenantId, origin);
    return { ok: true, origin };
  }

  /**
   * B2 / Task 2.3 — invitation orchestration RPCs called by the server worker
   * during the `POST /api/invitations/accept/:invitationId` flow. Each method
   * opens a fresh Drizzle client and constructs a BA instance scoped to the
   * supplied tenant (or apex when null) so per-tenant trustedOrigins +
   * allowedHosts apply correctly.
   *
   * `createUser` is non-idempotent in BA: if the email already exists it
   * throws `USER_ALREADY_EXISTS`. The server-side handler treats that as a
   * recoverable case via `findUserByEmail` (D60).
   *
   * boundary: CSRF / throttle / disableSignUp middleware bypass — INTENTIONAL.
   * The four RPC methods below (`createUser`, `signInEmail`,
   * `acceptInvitation`, `findUserByEmail`) drive Better Auth's `auth.api.*`
   * entry points directly, deliberately bypassing BA's HTTP-layer CSRF token
   * check, `/sign-in/email` rate-limit window, and the `disableSignUp` /
   * `disable-org-create` `before` hooks (those hooks gate the public HTTP
   * surface; the operator-led path is the supported escape valve per D32 /
   * D35 / D60).
   *
   * Because the bypass is unconditional, these methods MUST NEVER be exposed
   * over HTTP — they are reachable only via the Cloudflare service-binding
   * RPC surface from:
   *   - apps/server `POST /api/invitations/accept/:invitationId` (caller is
   *     authenticated by the per-IP-and-per-invitationId rate limit added in
   *     fix 3 below; the invitee proves they hold the unguessable `inv_*`
   *     id), and
   *   - apps/admin `POST /api/admin/tenants` (caller is authenticated by
   *     Cloudflare Access in front of the admin worker plus `requireOperator`
   *     middleware; only global admins reach the binding).
   *
   * Adding any new caller — especially anything that takes user input and
   * relays it to these methods without an equivalent gate — re-opens the
   * very abuse vectors BA's middleware exists to prevent. Audit accordingly.
   */
  async createUser(input: {
    email: string;
    password: string;
    name: string;
    emailVerified: boolean;
    tenant: Tenant | null;
  }): Promise<{ id: string }> {
    return withDrizzleClient(
      this.env.HYPERDRIVE.connectionString,
      async (db) => {
        const snapshot = snapshotFromEnv(this.env as AuthBindings);
        const auth = createAuth(db, this.env as AuthBindings, this.ctx, {
          tenant: input.tenant,
          allowedHostsSnapshot: snapshot,
        });
        // boundary: BA's typed api surface uses generic variance that loses
        // method-level inference once the auth instance is built behind
        // CreateAuthOptions; we narrow the call shape here.
        const apiAny = auth.api as unknown as {
          createUser: (args: {
            body: {
              email: string;
              password: string;
              name: string;
              emailVerified: boolean;
            };
          }) => Promise<{ user: { id: string } }>;
        };
        const result = await apiAny.createUser({
          body: {
            email: input.email,
            password: input.password,
            name: input.name,
            emailVerified: input.emailVerified,
          },
        });
        return { id: result.user.id };
      },
      { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
    );
  }

  /**
   * Sign in via email + password and return BA's `Set-Cookie` headers verbatim
   * so the calling worker can forward each one to the browser. Cookie
   * domain/path are governed by the auth worker's BA cookie config (D15/D65);
   * we do NOT rewrite them here.
   *
   * BA may emit multiple Set-Cookie headers in a single response (e.g. the
   * session cookie plus a CSRF rotation). `Headers.get("Set-Cookie")`
   * collapses them with `, ` which corrupts cookies whose Expires attribute
   * contains a comma (RFC 7231 date format). Use `getSetCookie()` which
   * returns the array verbatim — the server-side accept handler then sets
   * each one individually via Hono's `c.header(name, value, { append: true })`
   * so the browser receives them as separate Set-Cookie response headers.
   */
  async signInEmail(input: {
    email: string;
    password: string;
    tenant: Tenant | null;
  }): Promise<{ ok: boolean; setCookies: string[] }> {
    return withDrizzleClient(
      this.env.HYPERDRIVE.connectionString,
      async (db) => {
        const snapshot = snapshotFromEnv(this.env as AuthBindings);
        const auth = createAuth(db, this.env as AuthBindings, this.ctx, {
          tenant: input.tenant,
          allowedHostsSnapshot: snapshot,
        });
        const apiAny = auth.api as unknown as {
          signInEmail: (args: {
            body: { email: string; password: string };
            asResponse: true;
          }) => Promise<Response>;
        };
        const response = await apiAny.signInEmail({
          body: { email: input.email, password: input.password },
          asResponse: true,
        });
        const setCookies = response.headers.getSetCookie();
        return { ok: response.ok, setCookies };
      },
      { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
    );
  }

  /**
   * Accept a BA org-plugin invitation. The caller must already have a valid
   * session cookie (from `signInEmail`) — we forward it on the inner request.
   */
  async acceptInvitation(input: {
    invitationId: string;
    sessionCookie: string;
    tenant: Tenant | null;
  }): Promise<{ ok: boolean }> {
    return withDrizzleClient(
      this.env.HYPERDRIVE.connectionString,
      async (db) => {
        const snapshot = snapshotFromEnv(this.env as AuthBindings);
        const auth = createAuth(db, this.env as AuthBindings, this.ctx, {
          tenant: input.tenant,
          allowedHostsSnapshot: snapshot,
        });
        const apiAny = auth.api as unknown as {
          acceptInvitation: (args: {
            body: { invitationId: string };
            headers: Headers;
          }) => Promise<unknown>;
        };
        const result = await apiAny.acceptInvitation({
          body: { invitationId: input.invitationId },
          headers: new Headers({ cookie: input.sessionCookie }),
        });
        return { ok: Boolean(result) };
      },
      { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
    );
  }

  /**
   * Direct DB lookup by email — used by the server's accept handler to
   * recover from BA's non-idempotent `USER_ALREADY_EXISTS` (D60). Email is
   * lowercased + trimmed before the lookup, mirroring BA's normalization.
   */
  async findUserByEmail(
    email: string
  ): Promise<{ id: string; email: string; name: string } | null> {
    const normalized = email.toLowerCase().trim();
    return withDrizzleClient(
      this.env.HYPERDRIVE.connectionString,
      async (db) => {
        const rows = await db
          .select({ id: users.id, email: users.email, name: users.name })
          .from(users)
          .where(eq(users.email, normalized))
          .limit(1);
        return rows[0] ?? null;
      },
      { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
    );
  }
}

/**
 * SECURITY: the default fetch export always responds 421. The auth worker
 * is only reachable via the `AUTH` service binding from the server / admin
 * workers — those callers go through `AuthEntrypoint.handleAuthRequest`
 * (which enforces tenant context + sanitises the request) or the typed
 * RPC methods. Direct fetches (workers.dev probes, leaked preview hosts,
 * an accidental public route) must fail closed; otherwise the BA instance
 * would run with `tenant: null`, mint apex JWTs, and skip tenant
 * membership enforcement (Wave-1 audit finding).
 *
 * Even a request with a perfectly-matching host returns 421 here — the
 * tenant context that protects mintable JWTs only exists on the RPC path.
 */
export default {
  fetch: (
    _req: Request,
    _env: CloudflareBindings,
    _ctx: ExecutionContext
  ): Promise<Response> =>
    Promise.resolve(new Response("Misdirected Request", { status: 421 })),
};
