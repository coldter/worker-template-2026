# Auth Worker

Dedicated Cloudflare Worker handling all authentication for web (cookie) and native (bearer token) clients.

## Architecture

### Why auth is separated from the API worker

The auth worker isolates Better Auth and its secrets (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`) from the API worker. The API worker never has direct access to these secrets. This separation also means auth logic is independently deployable and scalable.

### Service Bindings

- **Auth Worker** binds to `API` (the `ApiEntrypoint` class in `apps/server`). It calls RPC methods on that binding from `databaseHooks` to trigger domain-side effects (onboarding workflow, device notifications, status changes).
- **API Worker** binds to `AUTH` (the `AuthEntrypoint` class in this worker). It calls `AUTH.getSession(headers, tenant)` to validate sessions per request (the resolved tenant is threaded alongside the inbound headers so per-tenant `allowedHosts` and `trustedOrigins` apply), and forwards all `/api/auth/*` HTTP traffic via `AUTH.handleAuthRequest(request, tenant)` — which sanitises the request, pins the host to the resolved tenant, and runs the BA pipeline. Direct `AUTH.fetch(request)` returns **421 Misdirected Request** by design: the auth worker is reachable only through the typed RPC surface so a `tenant: null` BA instance never gets to mint apex JWTs (Wave-1 audit finding).

### Auth Worker handles all Better Auth logic

`createAuth()` in `src/instance.ts` configures the full Better Auth instance: database adapter, session settings, rate limiting, email OTP, two-factor authentication, JWT, and all custom plugins. The Hono server in `src/server.ts` creates a new auth instance per request, using a per-request Postgres client opened via Hyperdrive.

### API Worker proxies /api/auth/* and validates sessions via RPC

In `apps/server/src/server.ts`, the route `/api/auth/*` is handled before any DB or auth middleware. The proxy resolves the tenant from the request host and forwards to the auth worker via the typed RPC entry:

```ts
authProxy.all("/*", async (c) => {
  return c.env.AUTH.handleAuthRequest(c.req.raw, c.var.tenant);
});
app.route("/api/auth", authProxy);
```

Session validation for all other API routes uses the `authContextMiddleware`, which calls `c.env.AUTH.getSession(c.req.raw.headers, tenant)` via RPC. The JWKS endpoint (`/api/auth/jwks`) is the single tenant-independent path: `handleAuthRequest` accepts `tenant === null` only on that path and serves the keys directly via `auth.api.getJwks`.

## Critical Rules

- Never expose auth secrets (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`) in responses or logs.
- Always use `ctx.waitUntil()` for background tasks (sending emails, calling `env.API.*` hooks). Never `await` them inline -- this prevents timing attacks and avoids blocking the response.
- Keep auth behavior in plugins and hooks (`src/plugins/`, `databaseHooks` in `src/instance.ts`), not scattered across ad hoc files.
- Use `@repo/shared` for shared role and authorization helpers (`SYSTEM_ROLES`, shared authorization registry/principal helpers).
- Use `@repo/db` for database schema imports and the Drizzle client type.
- Never create a global `pg.Client` or Drizzle instance. All DB access is per-request.
- Do not run `wrangler dev` or start servers (environment managed externally).
- Run `bun run fix` from repo root before addressing lint/type errors.
- No emojis in code or comments.
- No `any`, `unknown`, or non-null assertions (`!`) in handwritten code.

## Authorization Contract

The auth worker does not enforce the full resource policy model. Its job is to supply a clean principal contract to the API worker.

- Session data must expose the fields the API needs to build a principal, especially `roleSlugs`, user status, and optional org context.
- Multi-tenant apps should keep `activeOrganizationId` and the active org role in the session so the API can build an org-scoped principal without extra lookup work.
- Keep any extra session enrichment additive. The API's `authorize()` middleware remains the authoritative resource-level decision point.

See:
- [Authorization package guide](../../packages/authorization/README.md)
- [Authorization quick start](../../packages/authorization/docs/quick-start.md)

## Multi-Tenancy (Organization Plugin)

The auth worker includes Better Auth's `organization` plugin (`src/plugins/organization-setup.ts`). It is **opt-in and lazy**:

- Users are NOT required to join organizations. `activeOrganizationId` defaults to `null`.
- On login, the session hook queries the user's most recent org membership. If found, `activeOrganizationId` and `activeOrgRole` are set on the session. Otherwise the session has no org context.
- The plugin adds endpoints under `/api/auth/organization/*` for org CRUD, member management, and invitations.
- Single-tenant users coexist with multi-tenant users without friction.

Session fields: `activeOrganizationId` (managed by BA org plugin), `activeOrgRole` (custom field).

Plugin order: keep `createOrganizationPlugin()` before any plugin that depends on org session context.

## Structure

```
src/
  index.ts                        # Worker entry point: exports AuthEntrypoint (RPC) and default fetch handler
  server.ts                       # Hono app: DB middleware (per-request pg.Client) + Better Auth handler
  instance.ts                     # createAuth(): full Better Auth configuration, plugins, databaseHooks
  constants.ts                    # LOCKOUT_CONFIG, RATE_LIMIT_CONFIG, TWO_FACTOR_CONFIG and helpers
  plugins/
    admin.ts                      # adminPlugin: deactivate/activate/unlock user endpoints (permission-gated)
    login-security.ts             # loginSecurityPlugin: status checks, failed-attempt tracking, auto-lockout
    organization-setup.ts         # createOrganizationPlugin: Better Auth org plugin with project defaults
    user-status.ts                # enhancedUserPlugin: extends user schema with status, lockout, and role fields
```

## Adding a New Auth Plugin

1. Create `src/plugins/<name>.ts` exporting a factory function that returns a `BetterAuthPlugin`.
2. Accept `db: DrizzleClient` and/or `env.API` binding as constructor arguments if the plugin needs them. Do not import globals.
3. Register the plugin in the `plugins` array inside `createAuth()` in `src/instance.ts`.
4. If the plugin adds user or session fields, declare them via the `schema` key in the plugin object (see `user-status.ts` for reference).
5. If the plugin must run after all other plugins have added their fields, add it after the plugins it depends on.
6. Export any shared types or constants the plugin exposes so `instance.ts` can use them.
7. Run `bun run fix` and `bun run check-types` from the repo root.

## RPC Interface

`AuthEntrypoint` in `src/index.ts` exposes the typed surface callable via the `AUTH` service binding from `apps/server` and `apps/admin`. Tenant `/api/auth/*` traffic reaches it through `apps/server` after tenancy resolution; direct fetch is intentionally NOT a usable surface.

### `fetch(request: Request): Promise<Response>`

Returns **421 Misdirected Request** unconditionally. The auth worker has `workers_dev: false` and no public route; this default is the structural fail-safe so a leaked preview URL or accidental public binding cannot mint apex JWTs. Wave-1 audit finding.

### `handleAuthRequest(request: Request, tenant: Tenant | null): Promise<Response>`

The HTTP entrypoint for `/api/auth/*` traffic. The server worker resolves the tenant from the request host via `tenancyMiddleware` and then calls this method. `handleAuthRequest`:

1. If `tenant === null` AND the path is **not** `/api/auth/jwks`, returns 400.
2. If `tenant === null` AND the path IS `/api/auth/jwks`, serves the keys directly via `auth.api.getJwks` scoped to a sentinel apex tenant. JWKS is intrinsically tenant-independent (verifier-side public key set used by `@repo/auth-tokens`), so this is the single allowed exception.
3. Otherwise calls `sanitizedAuthRequest(request, tenant)` to pin Host/Origin to the tenant's canonical host, then dispatches into the Hono app so per-tenant `allowedHosts` and `trustedOrigins` enforce.

### `getSession(headers: Headers, tenant: Tenant | null): Promise<SessionResult | null>`

Opens a per-call Postgres connection via Hyperdrive, builds a request-scoped auth instance bound to `tenant` and the tenant's `allowedHostsSnapshot`, and delegates to `auth.api.getSession({ headers })`. Returns the full session object so the API can build a principal (`user.roleSlugs`, user status fields, `platform`, `expiresAt`, optional org context). Returns `null` when no valid session exists. The API worker calls this from `authContextMiddleware` on every `/api/*` request.

### `getToken(headers: Headers, tenant: Tenant | null): Promise<TokenResult | null>`

Same pattern as `getSession`; delegates to `auth.api.getToken({ headers })` for internal callers that need a signed token.

`getSession`, `getToken`, and `handleAuthRequest` close the Postgres client with `ctx.waitUntil(client.end())` after the call, regardless of success or failure.

## Event Hooks

`databaseHooks` in `src/instance.ts` call `env.API.*` methods via `ctx.waitUntil()` to trigger domain-side effects without blocking the auth response.

### `user.create.after` -- `env.API.onUserCreated`

Called after a new user record is persisted. Starts the onboarding workflow in the API worker (creates an `ONBOARDING_WF` instance).

### `session.create.before` -- `env.API.onNewDeviceLogin`

Called when a sign-in is detected from a different user-agent or IP than the user's previous session. Sends a security notification via the API worker's notification service.

### `adminPlugin` -- `env.API.onUserStatusChange`

Called synchronously (not via `waitUntil`) by admin status-change endpoints (`deactivateUser`, `activateUser`) so status propagation failures are surfaced to callers instead of being silently deferred.

`env.API` is typed as `AuthBindings["API"]` -- an intersection of the raw `Service` binding with the `ApiBindingRpc` interface declared in `src/instance.ts`. This avoids a circular package dependency on `apps/server`.

## Testing

Tests live in `apps/auth/src/` alongside source files and use Vitest with the Cloudflare Workers pool.

Run tests:

```sh
# From repo root
bun run test

# From apps/auth only
bun run test
```

When writing tests for auth behavior:

- Use `@cloudflare/vitest-pool-workers` to run code inside the Workers runtime.
- Mock `env.API` with a plain object implementing the `ApiBindingRpc` interface (all methods return `Promise.resolve()`).
- Mock `env.HYPERDRIVE` with `{ connectionString: "postgresql://..." }` pointing at a local or in-memory Postgres instance.
- Mock `env.CACHE` (KV) with `{ get, put, delete }` stubs.
- Instantiate `createAuth(db, env, ctx)` directly rather than going through the HTTP layer when testing plugin logic in isolation.
- For HTTP-level tests (sign-in flow, session cookies), use `app.fetch(request, env, ctx)` from `src/server.ts`.
