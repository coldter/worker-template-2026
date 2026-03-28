# Monorepo Architecture

## Workspace Layout

| Path | Purpose |
| --- | --- |
| `apps/server` | Cloudflare Worker: Hono API with OpenAPI, Drizzle/Postgres via Hyperdrive |
| `apps/auth` | Cloudflare Worker: Better Auth with bearer tokens, JWT, Service Binding RPC |
| `apps/web` | React SPA (TanStack Router/Query, Zustand) |
| `packages/db` | Shared database schema, relations, client, and migrations (Drizzle ORM) |
| `packages/shared` | Shared runtime constants, types, and helpers |
| `packages/email` | React Email templates + Resend transport |

## Service Bindings

`apps/server` and `apps/auth` are linked via Cloudflare Service Bindings (no network hop):

- `apps/server` binds `AUTH` -> `apps/auth` (`AuthEntrypoint`): used to proxy `/api/auth/*` requests and to call `getSession` / `getToken` RPC methods per request.
- `apps/auth` binds `API` -> `apps/server` (`ApiEntrypoint`): used to fire lifecycle event hooks (`onUserCreated`, `onNewDeviceLogin`, `onUserStatusChange`).

See [Auth architecture](.agent-docs/auth-architecture.md) for the full technical reference.

## Server Runtime (Cloudflare Workers)

- **HTTP**: Hono on `OpenAPIHono`, exported as `default` from `src/index.ts`.
- **Database**: PostgreSQL via Hyperdrive. A `pg.Client` is created per request in `dbMiddleware`, connected to `env.HYPERDRIVE.connectionString`, and closed with `waitUntil(client.end())` after the response is sent.
- **KV**: Used for caching and as a rate-limit fallback when the RateLimiter DO is unavailable (`env.KV`).
- **Durable Objects**: `RateLimiter` (sliding-window rate limiting per key). Exported from `src/index.ts` and bound in `wrangler.jsonc`.
- **Workflows**: `OnboardingWorkflow`, `EmailNotificationWorkflow`, `PushNotificationWorkflow`. Each step creates its own `pg.Client` connection and closes it synchronously. Exported from `src/index.ts`.
- **Analytics Engine**: `env.PRODUCT_ANALYTICS` (Workers Analytics Engine dataset). Written via `trackEvent` in `src/utils/analytics.ts`.
- **Email**: Resend via `@repo/email`. Call `sendEmail({ apiKey, from, to, subject, template, props })`.

## Environment Access

Use `import { env } from "cloudflare:workers"` for access outside of a Hono handler. Inside a handler, use `c.env`. Never pass `env` as a function parameter.

## Server Modules (`apps/server/src/modules`)
- `analytics`, `audit-logs`, `cards`, `controls`, `mcc-catalog`, `mobile-dashboard`, `notifications`, `roles`, `shares`, `status`, `transactions`, `users`
- Authentication is handled by `apps/auth` (a separate worker), not a module in `apps/server`. The server proxies `/api/auth/*` to the auth worker and validates sessions via Service Binding RPC.

## Import Aliases
- In app workspaces, `@/*` maps to `src/*`.
- Shared package imports use explicit subpaths (for example: `@repo/shared/permissions`).
