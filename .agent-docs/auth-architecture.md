# Auth Architecture

## System Overview

The authentication system is split into a dedicated Cloudflare Worker (`apps/auth`) that runs separately from the main API server (`apps/server`). The two workers communicate via Cloudflare Service Bindings - direct in-process calls with no network hop.

```
Browser / Mobile Client
        |
        | HTTP
        v
  apps/server (Hono)
        |
        |-- /api/auth/* --> AUTH Service Binding (fetch proxy) --> apps/auth (Better Auth)
        |
        |-- /api/*      --> AUTH Service Binding (RPC: getSession) --> apps/auth
        |                     |
        |                     v
        |               PostgreSQL (via Hyperdrive)
        |
        v
  PostgreSQL (via Hyperdrive)
```

Both workers connect to the same PostgreSQL database through separate Hyperdrive bindings, using the shared `@repo/db` package for schema, relations, and the Drizzle client factory.

## Communication Patterns

### HTTP Proxy for /api/auth/*

The server worker acts as a transparent HTTP proxy for all authentication routes. In `apps/server/src/server.ts`:

- A Hono sub-app is mounted at `/api/auth`
- Every request to `/api/auth/*` is forwarded verbatim via `c.env.AUTH.fetch(c.req.raw)`
- This runs before the database middleware, so no server-side DB connection is opened for auth requests
- The auth worker handles the request entirely: session creation, cookie setting, token issuance

This means the client always talks to a single origin (the server worker). The auth worker is never exposed directly.

### RPC for Session Validation

The server worker calls the auth worker via RPC on every authenticated API request. In `apps/server/src/middlewares/auth-context.ts`:

- `c.env.AUTH.getSession(c.req.raw.headers)` is called as an RPC method
- The auth worker's `AuthEntrypoint` class (extends `WorkerEntrypoint`) exposes `getSession` and `getToken` as typed methods
- Each RPC call opens its own `pg.Client` connection to the database (via Hyperdrive), calls `auth.api.getSession`, then closes the connection in `waitUntil`
- The returned session object (user + session data) is stored in Hono context variables for downstream route handlers

### Event Hooks for User Lifecycle

The auth worker calls back into the server worker using the `API` Service Binding when lifecycle events occur. The server's `ApiEntrypoint` class exposes three RPC methods:

- `onUserCreated(user)` - triggered after a new user record is created in the `databaseHooks.user.create.after` hook; starts the onboarding workflow
- `onNewDeviceLogin(params)` - triggered in the session create hook when sign-in is detected from a different device or IP; sends a security notification
- `onUserStatusChange(params)` - triggered by the admin plugin when an admin changes a user's status; runs status-change business logic in the server

All event hook calls are wrapped in `ctx.waitUntil(...)` so they do not block the auth response. Errors are caught and logged but do not fail the auth operation.

## Session Model

### Web Sessions (Cookie-based)

- Better Auth issues an `HttpOnly`, `SameSite=lax` cookie named `session_token_v1`
- Web sessions expire after 1 hour (3600 seconds); the rolling window is 30 minutes
- The session record in the database carries a `platform` field set to `"web"`
- Cookie secure flag is auto-detected from `APP_URL` (https = secure)

### Native / Mobile Sessions (Bearer Token)

- Mobile clients authenticate using the `bearer` Better Auth plugin (`requireSignature: true`)
- Mobile sessions expire after 7 days (604800 seconds); rolling window is 1 day
- Platform detection uses the request `User-Agent` header (see Platform Detection below)
- The `bearer` plugin validates the token signature on each request
- The `getToken` RPC method on `AuthEntrypoint` is available for the server to retrieve a signed token for a session

### JWT for Downstream Services

- The `jwt` Better Auth plugin issues short-lived JWTs (15-minute expiry)
- JWT payload includes: `sub` (user id), `email`, `roleSlugs`, `permissions`, `platform`
- JWKS rotation interval is 30 days
- JWTs are intended for downstream service-to-service calls where a full session lookup is too expensive

## Social Sign-in Flow

Social sign-in (OAuth) is handled entirely through the HTTP proxy pattern:

1. Client navigates to `/api/auth/sign-in/<provider>` on the server worker
2. Server proxy forwards the request to the auth worker via the `AUTH` Service Binding fetch
3. Auth worker redirects the browser to the OAuth provider
4. Provider redirects back to `/api/auth/callback/<provider>` on the server worker
5. Server proxy forwards the callback to the auth worker
6. Auth worker exchanges the code, creates/updates the user record, fires `databaseHooks`, and sets the session cookie
7. Auth worker redirects the browser to the app URL

Because all redirects go through the server worker's public URL, the OAuth callback URL registered with providers is always the server worker's domain, not the auth worker's.

## Service Binding Security Model

Service Bindings in Cloudflare Workers provide a zero-network-hop RPC mechanism:

- Calls between `apps/server` and `apps/auth` are in-process (same isolate context on the same machine)
- There is no HTTP round-trip, no TLS, and no public network exposure
- The auth worker (`apps/auth`) does not need a public route; it is only reachable via the server's binding
- The server's `AUTH` binding targets the `AuthEntrypoint` class exported from `apps/auth/src/index.ts`
- The auth worker's `API` binding targets the `ApiEntrypoint` class exported from `apps/server/src/index.ts`
- This bidirectional binding means each worker can call typed RPC methods on the other

Wrangler configuration in `apps/server/wrangler.jsonc`:
```jsonc
"services": [{ "binding": "AUTH", "service": "auth", "entrypoint": "AuthEntrypoint" }]
```

Wrangler configuration in `apps/auth/wrangler.jsonc`:
```jsonc
"services": [{ "binding": "API", "service": "server", "entrypoint": "ApiEntrypoint" }]
```

## Database Sharing Strategy

Both workers use the `@repo/db` package, which provides:

- `createDrizzleClient(pgClient)` - creates a Drizzle ORM instance with the shared schema and relations
- `@repo/db/schema` - all table definitions (auth tables, notifications, audit logs, etc.)
- `@repo/db/client` - the client factory and type exports
- `@repo/db/ids` - prefixed CUID generators per model

Each worker has its own Hyperdrive binding pointing to the same PostgreSQL database. Connections are created per request (not pooled at the worker level) and closed asynchronously via `ctx.waitUntil(client.end())`. This is the standard Cloudflare Workers pattern since isolates do not maintain long-lived connections across requests.

The `@repo/db` package is a pure TypeScript library (no runtime worker code). It is consumed by both `apps/server` and `apps/auth` as a workspace dependency (`@repo/db: workspace:*`). Schema migrations are managed exclusively through `packages/db` using Drizzle Kit.

## Platform Detection Logic

Platform is detected from the `User-Agent` header in the session create and session update database hooks within `apps/auth/src/instance.ts`.

Detection matches against these patterns (case-insensitive):
- `android`, `iphone`, `ipad`, `mobile` - standard mobile browser/OS strings
- `okhttp`, `dart`, `flutter`, `react-native`, `expo` - common mobile SDK user agents

If the user agent is absent or does not match any pattern, platform defaults to `"web"`.

Platform affects:
- Session expiry: web = 1 hour, mobile = 7 days
- New-device detection: the `platform` value is included in the `onNewDeviceLogin` event payload
- JWT payload: `platform` field is included so downstream services can distinguish session types
- Session cookie handling: mobile clients typically ignore cookies and use the bearer token instead

The `SESSION_CONFIG` object in `apps/auth/src/instance.ts` maps each platform to `expiresIn` and `updateAge` values. Session expiry is recalculated on every session update (rolling refresh) using the same detection logic.
