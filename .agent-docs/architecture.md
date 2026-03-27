# Monorepo Architecture

## Workspace Layout

| Path | Purpose |
| --- | --- |
| `apps/server` | Cloudflare Worker: Hono API with OpenAPI, Drizzle/Postgres via Hyperdrive |
| `apps/web` | React SPA (TanStack Router/Query, Zustand) |
| `packages/shared` | Shared runtime constants, types, and helpers |
| `packages/email` | React Email templates + Resend transport |

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
- `analytics`, `audit-logs`, `auth`, `cards`, `controls`, `mcc-catalog`, `mobile-dashboard`, `notifications`, `shares`, `status`, `transactions`, `users`

## Import Aliases
- In app workspaces, `@/*` maps to `src/*`.
- Shared package imports use explicit subpaths (for example: `@repo/shared/permissions`).
