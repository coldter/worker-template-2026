# Auth Worker

Dedicated Cloudflare Worker handling all authentication for web (cookie) and native (bearer token) clients.

## Architecture

### Why auth is separated from the API worker

The auth worker isolates Better Auth and its secrets (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`) from the API worker. The API worker never has direct access to these secrets. This separation also means auth logic is independently deployable and scalable.

### Service Bindings

- **Auth Worker** binds to `API` (the `ApiEntrypoint` class in `apps/server`). It calls RPC methods on that binding from `databaseHooks` to trigger domain-side effects (onboarding workflow, device notifications, status changes).
- **API Worker** binds to `AUTH` (the `AuthEntrypoint` class in this worker). It calls `AUTH.getSession(headers)` to validate sessions per request, and proxies all `/api/auth/*` HTTP traffic directly to `AUTH.fetch(request)`.

### Auth Worker handles all Better Auth logic

`createAuth()` in `src/instance.ts` configures the full Better Auth instance: database adapter, session settings, rate limiting, email OTP, two-factor authentication, JWT, and all custom plugins. The Hono server in `src/server.ts` creates a new auth instance per request, using a per-request Postgres client opened via Hyperdrive.

### API Worker proxies /api/auth/* and validates sessions via RPC

In `apps/server/src/server.ts`, the route `/api/auth/*` is handled before any DB or auth middleware:

```ts
authProxy.all("/*", async (c) => {
  return c.env.AUTH.fetch(c.req.raw);
});
app.route("/api/auth", authProxy);
```

Session validation for all other API routes uses the `authContextMiddleware`, which calls `c.env.AUTH.getSession(c.req.raw.headers)` via RPC.

## Critical Rules

- Never expose auth secrets (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`) in responses or logs.
- Always use `ctx.waitUntil()` for background tasks (sending emails, calling `env.API.*` hooks). Never `await` them inline -- this prevents timing attacks and avoids blocking the response.
- Keep auth behavior in plugins and hooks (`src/plugins/`, `databaseHooks` in `src/instance.ts`), not scattered across ad hoc files.
- Use `@repo/shared` for role and permission constants (`SYSTEM_ROLES`, `PERMISSIONS`).
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

Plugin order: `createOrganizationPlugin()` goes before `enhancedSessionPlugin` (which must be last content plugin).

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
    patched-custom-session.ts     # Patched customSession: fixes double-encoding bug in upstream better-auth
    session-permissions.ts        # optional session enrichment for clients that still need role-derived metadata
    user-status.ts                # enhancedUserPlugin: extends user schema with status, lockout, and role fields
```

## Adding a New Auth Plugin

1. Create `src/plugins/<name>.ts` exporting a factory function that returns a `BetterAuthPlugin`.
2. Accept `db: DrizzleClient` and/or `env.API` binding as constructor arguments if the plugin needs them. Do not import globals.
3. Register the plugin in the `plugins` array inside `createAuth()` in `src/instance.ts`.
4. If the plugin adds user or session fields, declare them via the `schema` key in the plugin object (see `user-status.ts` for reference).
5. If the plugin must run after all other plugins have added their fields (e.g. to read those fields), add it last in the plugins array (as `enhancedSessionPlugin` is placed last).
6. Export any shared types or constants the plugin exposes so `instance.ts` can use them.
7. Run `bun run fix` and `bun run check-types` from the repo root.

## RPC Interface

`AuthEntrypoint` in `src/index.ts` exposes three RPC methods callable by the API worker via the `AUTH` service binding:

### `fetch(request: Request): Promise<Response>`

Handles all HTTP auth requests (sign-in, sign-up, verify email, etc.). The API worker routes `/api/auth/*` here directly.

### `getSession(headers: Headers): Promise<SessionResult | null>`

Opens a per-call Postgres connection via Hyperdrive, creates a temporary auth instance, and delegates to `auth.api.getSession({ headers })`. Returns the full session object including the fields the API needs to build a principal, especially `user.roleSlugs`, user status fields, and session context such as `platform`, `expiresAt`, and optional org data. Returns `null` when no valid session exists. The API worker calls this from `authContextMiddleware` on every `/api/*` request.

### `getToken(headers: Headers): Promise<TokenResult | null>`

Same pattern as `getSession` but delegates to `auth.api.getToken({ headers })`. Used by internal server/auth integration paths that need a signed token derived from the current auth session context.

Both `getSession` and `getToken` close the Postgres client with `ctx.waitUntil(client.end())` after the call, regardless of success or failure.

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
