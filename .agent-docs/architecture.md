# Monorepo Architecture

## Workspace Layout

| Path | Purpose |
| --- | --- |
| `apps/server` | Cloudflare Worker API (Hono + OpenAPI), workflows, and durable objects |
| `apps/auth` | Dedicated Cloudflare Worker for Better Auth and auth lifecycle hooks |
| `apps/web` | React SPA (TanStack Router, TanStack Query, Zustand) |
| `packages/db` | Shared Drizzle schema, relations, typed client factory, and migrations |
| `packages/shared` | Shared runtime constants, permissions, logging, pagination, and helpers |
| `packages/email` | Shared React Email templates + Resend transport wrapper |

## Worker-to-Worker Topology

`apps/server` and `apps/auth` communicate through Cloudflare Service Bindings:

- `apps/server` -> `AUTH` (`AuthEntrypoint`): HTTP proxy for `/api/auth/*` and RPC (`getSession`, `getToken`).
- `apps/auth` -> `API` (`ApiEntrypoint`): RPC hooks for auth lifecycle events (`onUserCreated`, `onNewDeviceLogin`, `onUserStatusChange`).

This keeps auth internal while exposing a single public API origin.

## `apps/server` Runtime

- **HTTP**: `OpenAPIHono<AppEnv>` in `src/server.ts`, exported from `src/index.ts`.
- **Database**: PostgreSQL via Hyperdrive (`env.HYPERDRIVE.connectionString`) with per-request `pg.Client` lifecycle in `dbMiddleware`.
- **Cache**: KV namespace bound as `CACHE` (token/cache utilities, rate-limit fallback).
- **Durable Object**: `RateLimiter` for primary request throttling.
- **Workflows**: `OnboardingWorkflow`, `EmailNotificationWorkflow`, `PushNotificationWorkflow`.
- **Analytics**: `ANALYTICS` dataset is written by `analyticsMiddleware`; `PRODUCT_ANALYTICS` is configured but currently not written by server runtime code.
- **Email**: transactional send path via `@repo/email`.

## `apps/auth` Runtime

- Better Auth is created per request in `src/server.ts` using a request-scoped Drizzle client.
- Session and user lifecycle behavior is implemented in `src/instance.ts` plugins and `databaseHooks`.
- Auth worker owns auth secrets and does not expose a separate public origin.

## Environment Access Patterns

- Hono handlers: use `c.env`.
- `WorkerEntrypoint` / `WorkflowEntrypoint` / `DurableObject` classes: use `this.env` and `this.ctx`.
- Utility modules outside handler/class context: use `import { env } from "cloudflare:workers"` when binding access is required.

## Active Server Modules (`apps/server/src/modules`)

- `audit-logs`
- `notifications`
- `roles`
- `status`
- `users`

## Import Aliases

- In app workspaces, `@/*` maps to `src/*`.
- Shared imports use explicit subpaths (for example: `@repo/shared/permissions`).
