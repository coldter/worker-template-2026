# Server

Cloudflare Worker: Hono REST API with OpenAPI, Drizzle/Postgres via Hyperdrive, Durable Objects, Workflows, Queues, and the Cloudflare-for-SaaS custom-hostname lifecycle. The worker is **not directly addressable** from the public internet (`workers_dev: false`, no public route): tenant traffic arrives via the `apps/app` SPA worker forwarding `/api/*` through the `API` service binding; the operator console reaches it via `apps/admin`'s `API` binding (entrypoint `AdminApiEntrypoint`).

## Critical Rules
- Keep handlers thin: validate input, call service, map HTTP response.
- Keep business logic and data access in services.
- Define resource policies via `@repo/authorization` and enforce them with `authorize()` middleware. Policies that touch tenant data MUST declare `resolveOrganization` so the evaluator gets tenant context.
- For multi-step writes, use a transaction and pass `executor` down to nested writes.
- Never pass `env` as a function parameter. Use `c.env` in handlers; use `import { env } from "cloudflare:workers"` outside of handlers.
- Never create a global `pg.Client` or Drizzle instance. All DB access is per-request via `c.var.db`.
- Read `organizations` only through `liveOrganizations(...)` from `@repo/db` (or be on the documented allowlist) — soft-deleted tenants must never resurface.

## Topology

- Service bindings out: `AUTH` (`AuthEntrypoint` in apps/auth) for `getSession` / `getToken` / `handleAuthRequest`; `STATIC_ASSETS` (apps/app) for SPA fallback.
- Service bindings in: `API` (`ApiEntrypoint`) consumed by apps/auth and apps/app; `AdminApiEntrypoint` consumed by apps/admin.
- Hyperdrive (`HYPERDRIVE`) for Postgres, KV (`CACHE`) for tenant-cache version + ad-hoc cache, Analytics Engine (`ANALYTICS`) for request beacons (`PRODUCT_ANALYTICS` defined but not yet emitted).
- Durable Object: `RateLimiter`. Workflows: `OnboardingWorkflow`, `EmailNotificationWorkflow`, `PushNotificationWorkflow`. Queues: `AUDIT_LOG_QUEUE` (producer + consumer with DLQ).
- Cron `* * * * *` runs `src/cron/reconcile-hostnames.ts` to drive the CF-for-SaaS lifecycle.

## Module Map (`apps/server/src`)

| Path | Purpose |
| --- | --- |
| `auth/` | Server-side authorization wiring: `schema.ts`, `registry.ts`, `principal.ts`, `middleware.ts` (the `authorize` factory), `capabilities.ts`. |
| `cron/reconcile-hostnames.ts` | CF custom-hostname reconciler driven by the 60s cron. |
| `durable-objects/` | `RateLimiter` DO. |
| `lib/` | Request context, audit context, common response helpers, OpenAPI docs setup. |
| `middlewares/` | `host-guard`, `request-id`, `cors`, `analytics`, `rate-limit`, `db`, `tenancy`, `invalidator`, `auth-context`, `audit-context`, `auth-proxy`, `error`, `security-headers`. |
| `modules/` | Domain modules: `audit-logs`, `invitations`, `notifications`, `org-admin/sso`, `roles`, `status`, `tenancy` (CF-for-SaaS), `users`. |
| `queues/audit-log-consumer.ts` | Per-message ack/retry consumer for `AUDIT_LOG_QUEUE`. |
| `services/` | Cross-module services. |
| `workflows/` | Onboarding, email, push notification workflows. |

## Authorization Wiring

The server is the policy enforcement point.

- Define the auth schema in `src/auth/schema.ts`.
- Define app resources in `packages/shared/src/authorization.ts`.
- Register resources in `src/auth/registry.ts`.
- Build the principal in `src/auth/principal.ts`.
- Enforce policies with `authorize(resource, action, opts)` from `src/auth/middleware.ts`.
- Load concrete records with `loadResource` whenever a policy depends on ownership, tenant scope, or relationships.
- Treat the capabilities endpoint as a UI helper, not a replacement for route-level authorization.

See:
- [Authorization package guide](../../packages/authorization/README.md)
- [Authorization quick start](../../packages/authorization/docs/quick-start.md)

## Per-Request Database

`dbMiddleware` creates a `pg.Client` per request, builds a Drizzle instance, and stores it in `c.var.db`. The client is closed with `waitUntil(client.end())` after the response.

In handlers: pass `c.var.db` to service calls.
In services: accept `db: DrizzleClient` (or `executor: Executor`) as the first parameter.

## Tenancy Middleware

`tenancyMiddleware` (wraps `@repo/tenancy`'s `tenantMiddleware`) runs after `dbMiddleware` and before `authContextMiddleware`. It resolves the request host into a `Tenant`, surfacing `c.var.tenant` for downstream handlers and the auth proxy. The dev `X-Dev-Tenant-Slug` header is rejected in production unconditionally; in dev it is gated on `ALLOW_DEV_TENANT_HEADER`.

## Adding a New Endpoint

1. Create `src/modules/<name>/` with `schema.ts`, `routes.ts`, `handler.ts`, `service.ts`.
2. Service functions take `db: DrizzleClient` (or `executor: Executor`) as the first parameter.
3. Handler calls the service with `c.var.db`.
4. Register the handler in `src/server.ts`.

## Adding a New Workflow

1. Create `src/workflows/<name>.ts` exporting a class that extends `WorkflowEntrypoint<CloudflareBindings, Params>`.
2. Each `step.do` callback creates its own `pg.Client`, does its work, and calls `await client.end()` before returning.
3. Export the class from `src/index.ts`.
4. Add a `[[workflows]]` binding in `wrangler.jsonc`.

## Adding a New Durable Object

1. Create `src/durable-objects/<Name>.ts` exporting a class that extends `DurableObject`.
2. Export the class from `src/index.ts`.
3. Add a `durable_objects.bindings` entry and matching `migrations` entry in `wrangler.jsonc`.

## Audit Logging

`auditLogService.create` / `createDualScope` for critical events inside transactions; `auditLogService.enqueue(c, input)` (Context-aware) for bufferable events. See [audit logging guide](../../.agent-docs/audit-logging.md).

## Detailed Instructions
- [Architecture](.agent-docs/architecture.md)
- [Module patterns](.agent-docs/modules.md)
- [API handling](.agent-docs/api-handling.md)
- [Migrations](.agent-docs/migrations.md)
- [Background jobs](.agent-docs/background-jobs.md)
- [Observability](.agent-docs/observability.md)
- [Common mistakes](.agent-docs/common-mistakes.md)
