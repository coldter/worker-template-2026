# Server Architecture

## Core Layout
- `src/index.ts`: exports the Hono app as default plus all DOs and Workflows required by Wrangler
- `src/server.ts`: base `OpenAPIHono<AppEnv>` app with middleware wiring and route composition
- `src/modules/*`: feature modules (schema/routes/handler/service)
- `src/lib/*`: reusable infrastructure and cross-cutting helpers
- `src/utils/*`: lightweight utilities (analytics, kv-cache)
- `src/db/*`: Drizzle type definitions, schema, and relations (no singleton client)
- `src/middlewares/*`: request-id, cors, analytics, rate-limit, db, auth-context, error
- `src/workflows/*`: Cloudflare Workflow classes
- `src/durable-objects/*`: Durable Object classes

## Runtime Stack
- **HTTP layer**: Hono + `@hono/zod-openapi` for typed OpenAPI routes
- **Database**: PostgreSQL accessed via Hyperdrive. Per-request `pg.Client` created in `dbMiddleware`.
- **KV**: `env.KV` for caching and rate-limit fallback
- **Durable Objects**: `RateLimiter` (sliding-window, 60 s)
- **Workflows**: async multi-step tasks with automatic retries; each step owns its own DB connection
- **Analytics Engine**: `env.PRODUCT_ANALYTICS`; written fire-and-forget via `trackEvent`

## Module Convention
A typical module contains `schema.ts`, `routes.ts`, `handler.ts`, and `service.ts`.
Keep handlers focused on IO mapping; services own business logic and data access.
