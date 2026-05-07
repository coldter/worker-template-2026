# Monorepo Architecture

## Workspace Layout

| Path | Purpose |
| --- | --- |
| `apps/admin` | Operator-only Hono worker. Serves the `apps/admin-ui` SPA (via `ADMIN_UI` ASSETS binding) and the operator API. CF-Access-protected. |
| `apps/admin-ui` | Operator React SPA (TanStack Router/Query, Zustand). Built into `dist/`; the bundle is shipped by `apps/admin`. |
| `apps/app` | Tenant SPA worker. Public ingress for `*.${APP_WILDCARD_HOST}`, the apex, and the CF-for-SaaS fallback origin. Forwards `/api/*` to the server worker via service binding. |
| `apps/auth` | Private Better Auth worker. `workers_dev: false`, no public route. Reachable ONLY through the `AUTH` service binding's RPC surface (`AuthEntrypoint`). |
| `apps/server` | Private API worker (Hono + OpenAPI) reached through service bindings. Hosts business logic, workflows, durable objects, audit-log queue consumer, and the Cloudflare-for-SaaS custom-hostname lifecycle. |
| `packages/auth-tokens` | Verifier-side helper for per-tenant JWTs. BA mints, this package verifies. |
| `packages/authorization` | Framework-agnostic policy engine + Hono/Drizzle adapters. |
| `packages/db` | Shared Drizzle schema, relations, typed client factory, migrations, the `liveOrganizations` read seam. |
| `packages/email` | React Email templates + Resend transport. |
| `packages/shared` | Runtime constants, audit event registry, redactor, structured logger, pagination, RPC binding shapes. |
| `packages/tenancy` | Host parsing, tenant resolution, cache invalidator, dev-tenant header guard. |

## Deployment Topology

Public hostnames are derived from `.env` (single source of truth) by `scripts/lib/host-config.ts`. The four workers split routing by host:

| Inbound host | Worker | How it is wired |
| --- | --- | --- |
| `${ADMIN_HOST}` (e.g. `admin.example.com`) | `apps/admin` | `routes` with `custom_domain: true`. CF Access in front. |
| `*.${APP_WILDCARD_HOST}` (wildcard subdomain) | `apps/app` | `routes` pattern `*.app.example.com/*`. |
| `${APP_WILDCARD_HOST}` (apex) and `${FALLBACK_HOST}` | `apps/app` | `custom_domain: true` routes. The fallback origin is the CF-for-SaaS fallback origin for tenant custom hostnames (D45, D58). |
| Tenant custom hostnames (`acme.com` etc.) | `apps/app` | Reach `apps/app` via the CF-for-SaaS fallback origin. The `apps/server` lifecycle (see below) provisions/decommissions the CF custom hostname. |
| (none) | `apps/server` | `workers_dev: false`, no public route. Reachable only via `STATIC_ASSETS`/`API` service bindings from `apps/app` and `apps/admin`. |
| (none) | `apps/auth` | `workers_dev: false`, no public route. Reachable only via the `AUTH` service binding. Direct fetches return **421 Misdirected Request** by design (`AuthEntrypoint.fetch`). |

`apps/app/src/index.ts` is intentionally tiny: it forwards `/api/*` to `env.API.fetch(req)`; everything else lands on the `ASSETS` static-assets binding (`not_found_handling: "single-page-application"`). `/api/auth/*` also goes through `apps/server` so tenancy middleware can call the private auth worker through `AuthEntrypoint.handleAuthRequest`.

`apps/server` additionally exposes a `STATIC_ASSETS` service binding back to `apps/app` so the server's catch-all route can hand non-`/api/*` paths to the SPA when it is mounted on a tenant host directly (e.g., admin-side previews).

## Cloudflare for SaaS Lifecycle

- Owner: `apps/server/src/modules/tenancy/` — `lifecycle.ts`, `cf-api.ts`, `txt-verification.ts`, `active-hostnames-snapshot.ts`. Cron `* * * * *` (declared in `apps/server/wrangler.jsonc`) drives `apps/server/src/cron/reconcile-hostnames.ts`.
- Tenant-side resolver: `packages/tenancy` parses the host header (`parse-hostname.ts`) and resolves custom hostnames through `tenant_custom_hostnames` (with `liveOrganizations` filtering) — see `resolve-tenant.ts`. We do not use CF custom metadata because it is Enterprise-only.
- `apps/auth` reads the same snapshot (`apps/auth/src/host-config.ts`) so Better Auth's `allowedHosts` and `trustedOrigins` stay in lockstep with the active tenant set.

## Worker-to-Worker Bindings

| Caller | Binding | Target | Purpose |
| --- | --- | --- | --- |
| `apps/server` | `AUTH` | `AuthEntrypoint` (apps/auth) | RPC: `getSession`, `getToken`, `handleAuthRequest` (sanitises + tenant-pins `/api/auth/*`). |
| `apps/server` | `STATIC_ASSETS` | `apps/app` | SPA fallback for non-`/api/*` paths the server happens to serve. |
| `apps/auth` | `API` | `ApiEntrypoint` (apps/server) | RPC hooks: `onUserCreated`, `onNewDeviceLogin`, `onUserStatusChange`. |
| `apps/admin` | `API` | `AdminApiEntrypoint` (apps/server) | Operator-side RPC. |
| `apps/admin` | `AUTH` | `AuthEntrypoint` (apps/auth) | Required for any operator-impersonation BA flow. |
| `apps/app` | `API` | Default fetch handler (apps/server) | Forwards `/api/*` from the SPA, including `/api/auth/*`. |

See [auth architecture](auth-architecture.md) for the auth-specific RPC contract and the JWKS-only `tenant: null` exception.

## `apps/server` Runtime

- **HTTP**: `OpenAPIHono<AppEnv>` in `src/server.ts`, exported from `src/index.ts`.
- **Database**: PostgreSQL via Hyperdrive (`env.HYPERDRIVE.connectionString`) with per-request `pg.Client` lifecycle in `dbMiddleware`.
- **Cache**: KV namespace bound as `CACHE` (token/cache utilities, rate-limit fallback, tenant-cache version key).
- **Durable Object**: `RateLimiter` for per-host primary request throttling.
- **Workflows**: `OnboardingWorkflow`, `EmailNotificationWorkflow`, `PushNotificationWorkflow`.
- **Queues**: `AUDIT_LOG_QUEUE` (producer + consumer with DLQ).
- **Cron**: `* * * * *` reconciles non-terminal CF custom hostnames.
- **Analytics**: `ANALYTICS` dataset is written by `analyticsMiddleware`; `PRODUCT_ANALYTICS` is configured but not yet emitted.
- **Email**: transactional send path via `@repo/email`.

Active modules under `src/modules/`: `audit-logs`, `invitations`, `notifications`, `org-admin`, `roles`, `status`, `tenancy`, `users`.

## `apps/auth` Runtime

- Better Auth is built per request in `src/server.ts` using a request-scoped Drizzle client.
- The default Hono fallback returns 421 — every legitimate request must arrive through `AuthEntrypoint.handleAuthRequest` with a resolved `Tenant` (or `null` for the JWKS path only).
- Plugins live in `src/plugins/`: `admin`, `login-security`, `organization-setup`, `provision-user`, `sso-callback-guard`, `user-status`. Per-tenant SSO is wired via `@better-auth/sso`.
- BA rate-limit storage is `database` (Postgres via Hyperdrive). KV-backed counters were ruled out because eventual consistency lets attackers bypass the window across colos.

## `apps/admin` Runtime

- CF Access perimeter (`cfAccessMiddleware`) verifies `cf-access-jwt-assertion` against the team JWKS and resolves the `global_admins` row.
- 90-day inactivity sweep cron at `0 12 * * *` runs `src/scheduled/inactivity-sweep.ts`.
- No Better Auth session and no tenant cookie — operator identity comes only from CF Access.

## Environment Access Patterns

- Hono handlers: use `c.env`.
- `WorkerEntrypoint` / `WorkflowEntrypoint` / `DurableObject` classes: use `this.env` and `this.ctx`.
- Utility modules outside handler/class context: use `import { env } from "cloudflare:workers"` when binding access is required.

## Import Aliases

- In app workspaces, `@/*` maps to `src/*`.
- Shared imports use explicit subpaths (for example: `@repo/shared/audit`, `@repo/db/schema`).
