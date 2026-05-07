# Auth Architecture

## System Overview

Authentication runs in a dedicated Cloudflare Worker (`apps/auth`) that is **never publicly addressable**. The worker has `workers_dev: false` and no public route. The default Hono fallback returns **421 Misdirected Request** on every direct fetch (`AuthEntrypoint.fetch`). All real tenant auth traffic arrives through the typed RPC surface on `AuthEntrypoint`, which is reached from `apps/server` after tenancy resolution.

```
Browser / Mobile Client
          |
          | HTTP — tenant host, e.g. acme.app.example.com
          v
   apps/app (SPA worker)
          |
          |-- /api/*      --> env.API.fetch(...)          │  service binding,
          \-- everything  --> env.ASSETS.fetch(...)       │  no public network hop
                                                          v
                              ┌──────────────┐    ┌──────────────┐
                              │ apps/server  │    │  apps/auth   │
                              │ (HTTP API +  │<──>│ (Better Auth │
                              │ tenancy MW)  │    │  + plugins)  │
                              └──────┬───────┘    └──────┬───────┘
                                     │                    │
                                     v                    v
                            PostgreSQL via Hyperdrive (single DB, two bindings)
```

`apps/server` resolves the tenant from the request host via the `tenancyMiddleware` (`@repo/tenancy`), then forwards `/api/auth/*` to the auth worker through `AuthEntrypoint.handleAuthRequest(request, tenant)`. `handleAuthRequest` sanitises the request and pins the host so Better Auth only sees the tenant's canonical host — that is what makes per-tenant `allowedHosts` and `trustedOrigins` enforce correctly.

`apps/admin` does not use Better Auth sessions at all: it relies on Cloudflare Access. The `AUTH` binding is wired so any operator-impersonation BA flow that may land later still has the same RPC surface available.

## Communication Patterns

### Service-binding RPC for `/api/auth/*`

`apps/server/src/server.ts` mounts `authProxyMiddleware` after `tenancyMiddleware` so every auth request has a resolved `Tenant`:

```ts
// apps/server (sketch)
app.all("/api/auth/*", async (c) => {
  return c.env.AUTH.handleAuthRequest(c.req.raw, c.var.tenant);
});
```

`handleAuthRequest` lives on `AuthEntrypoint` (`apps/auth/src/index.ts`):

- If `tenant === null` and the path is **not** `/api/auth/jwks`, returns 400 (`tenant required`).
- If `tenant === null` and the path **is** `/api/auth/jwks`, serves the keys directly via `auth.api.getJwks` scoped to a sentinel "apex" tenant — JWKS is intrinsically tenant-independent (it is the verifier-side public key set used by `packages/auth-tokens/src/jwks.ts`), so this is the single allowed exception.
- Otherwise `sanitizedAuthRequest(request, tenant)` rewrites the request so BA sees the tenant's canonical host, and the request is dispatched into the Hono app.

The legacy `c.env.AUTH.fetch(c.req.raw)` proxy pattern is **gone**: the auth worker's default fetch returns 421 by design so a `tenant: null` BA instance can never mint apex JWTs (Wave-1 audit finding).

### RPC for session validation

`apps/server/src/middlewares/auth-context.ts` resolves the session via `c.env.AUTH.getSession(c.req.raw.headers, tenant)` on every authenticated `/api/*` request. The auth worker opens a per-call `pg.Client` through Hyperdrive, builds a request-scoped Better Auth instance (with the resolved tenant's `allowedHostsSnapshot`), calls `auth.api.getSession({ headers })`, and closes the client via `ctx.waitUntil(client.end())`.

`getToken(headers, tenant)` mirrors the same pattern for callers that need a signed JWT for downstream service-to-service work.

### Forwarding from `apps/app`

`apps/app/src/index.ts` is intentionally minimal:

```ts
if (url.pathname.startsWith("/api/"))      return env.API.fetch(req);
return env.ASSETS.fetch(req);
```

`/api/auth/*` is part of the `/api/*` branch. It must go through `apps/server`, where tenancy middleware resolves a `Tenant` before `authProxyMiddleware` calls `AUTH.handleAuthRequest`. Direct `apps/app -> apps/auth` fetch traffic is not used because `AuthEntrypoint.fetch` is deliberately 421-only.

### Event hooks for user lifecycle

The auth worker calls back into the server worker through the `API` Service Binding. The server's `ApiEntrypoint` exposes:

- `onUserCreated(user)` — `databaseHooks.user.create.after`. Starts the onboarding workflow (wrapped in `ctx.waitUntil`).
- `onNewDeviceLogin(params)` — `databaseHooks.session.create.before` when sign-in comes from a new UA/IP. Sends a security notification (wrapped in `ctx.waitUntil`).
- `onUserStatusChange(params)` — invoked synchronously from the `adminPlugin` (deactivate/activate) so failures surface to the operator.

## Session Model

### Web Sessions (Cookie-based)

- `HttpOnly`, `SameSite=lax` cookie named `session_token_v1`.
- Web sessions expire after 1 hour; rolling window is 30 minutes.
- The session record carries `platform: "web"`.
- Cookies are **host-only** (no `Domain` attribute). The auth worker's `sanitizedAuthRequest` pins the host to the tenant's canonical host, so each tenant gets isolated cookies — there is no cross-subdomain cookie scope by design (D15 / D65). Apex sign-in is not supported.

### Native / Mobile Sessions (Bearer Token)

- Mobile clients use the `bearer` BA plugin (`requireSignature: true`).
- Mobile sessions expire after 7 days; rolling window 1 day.
- Platform detection from `User-Agent`; see `apps/auth/src/instance.ts#SESSION_CONFIG`.

### Organization Context (Multi-Tenancy)

`apps/auth/src/plugins/organization-setup.ts` is opt-in and lazy:

- On login, `session.create.before` queries the user's latest org membership; `activeOrganizationId` and `activeOrgRole` end up on the session (or `null`).
- `POST /api/auth/organization/set-active` updates `activeOrganizationId`; the hook updates `activeOrgRole` to match.
- The server's `buildPrincipal` reads these fields and includes them in `Principal.organization`.
- Resources with `resolveOrganization` get automatic tenant isolation via `@repo/authorization`.
- DB tables: `organization`, `member`, `invitation`. Read-only Drizzle schemas in `packages/db/src/schema/organizations.ts`. Live reads must go through `liveOrganizations` (`@repo/db`).

### JWT for Downstream Services

- The `jwt` BA plugin issues short-lived JWTs (15 minutes).
- `aud` and `iss` are URL-form, scoped per-tenant (`https://${tenant.host}`). `org` claim carries `{ id, host, sessionVersion }` (D12).
- Verifier helpers live in `@repo/auth-tokens` — `verifyTenantJwt` (DB-backed) and `verifyTenantJwtStateless` (caller-supplied).
- JWKS rotation cadence: 30 days. `/api/auth/jwks` is the single tenant-independent path.

## Provider Sign-in / SSO

`@better-auth/sso` plus `apps/auth/src/plugins/provision-user.ts` and `sso-callback-guard.ts` handle per-tenant SSO. SSO providers and domains are managed via `apps/server/src/modules/org-admin/sso/`. Callback path is `/api/auth/sso/callback/{providerId}` on the tenant host (see `scripts/lib/host-config.ts#oidcCallbackTemplate`). `/sso/callback` is **not** an `apps/app` route — it lives on the auth worker (D64).

## Service Binding Security Model

- All RPC calls between workers ride the internal Cloudflare service-binding path. No TLS, no public network exposure.
- `apps/auth` has no public route. `AuthEntrypoint.fetch` returns 421. There is no `app.all("/*")` fallback that would hand a request to a `tenant: null` BA instance — the structural fail-safe is enforced in `apps/auth/src/server.ts`.
- `apps/server`'s `AUTH` binding targets `AuthEntrypoint`. `apps/auth`'s `API` binding targets `ApiEntrypoint`. `apps/admin`'s `API` binding targets `AdminApiEntrypoint`.

`apps/server/wrangler.jsonc`:
```jsonc
"services": [
  { "binding": "AUTH", "service": "auth", "entrypoint": "AuthEntrypoint" },
  { "binding": "STATIC_ASSETS", "service": "app" }
]
```

`apps/auth/wrangler.jsonc`:
```jsonc
"services": [
  { "binding": "API", "service": "server", "entrypoint": "ApiEntrypoint" }
]
```

## Database Sharing

Both workers consume `@repo/db`: `createDrizzleClient(pgClient)`, the `Executor` type, the schema (`@repo/db/schema`), and the prefixed CUID generator. Each worker has its own Hyperdrive binding pointing at the same Postgres. Per-request clients (never global) are closed via `ctx.waitUntil(client.end())`.

## Rate-limit storage

Better Auth's rate-limit counters use `storage: "database"` (Postgres via Hyperdrive). The KV-backed alternative was ruled out: KV is eventually consistent and write-coalesced, which let attackers bypass the window by spreading requests across colos. Hyperdrive linearises counter writes. The same Drizzle adapter is wired below, so no extra plumbing is needed. (See the comment in `apps/auth/src/instance.ts` near the `rateLimit:` block.)

## Platform Detection

Platform is detected from `User-Agent` in the session create/update database hooks (`apps/auth/src/instance.ts`). Patterns: `android`, `iphone`, `ipad`, `mobile`, `okhttp`, `dart`, `flutter`, `react-native`, `expo`. Default is `"web"`. Platform affects session expiry, new-device detection, and the JWT `platform` claim.
