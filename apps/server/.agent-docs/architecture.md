# Server Architecture

## Core Layout
- `src/index.ts`: exports the Hono app as default plus all DOs and Workflows required by Wrangler
- `src/server.ts`: base `OpenAPIHono<AppEnv>` app with middleware wiring and route composition
- `src/modules/*`: feature modules (schema/routes/handler/service)
- `src/lib/*`: reusable infrastructure and cross-cutting helpers
- `src/utils/*`: lightweight utilities (pagination, misc helpers)
- `src/middlewares/*`: request-id, cors, analytics, rate-limit, db, auth-context, error
- `src/workflows/*`: Cloudflare Workflow classes
- `src/durable-objects/*`: Durable Object classes

## Runtime Stack
- **HTTP layer**: Hono + `@hono/zod-openapi` for typed OpenAPI routes
- **Database**: PostgreSQL accessed via Hyperdrive. Per-request `pg.Client` created in `dbMiddleware`.
- **KV**: `env.CACHE` for caching and rate-limit fallback
- **Durable Objects**: `RateLimiter` (sliding-window, 60 s)
- **Workflows**: async multi-step tasks with automatic retries; each step owns its own DB connection
- **Analytics Engine**: `env.ANALYTICS` is written in `analyticsMiddleware`; `PRODUCT_ANALYTICS` is configured for product events and currently optional

## Module Convention
A typical module contains `schema.ts`, `routes.ts`, `handler.ts`, and `service.ts`.
Keep handlers focused on IO mapping; services own business logic and data access.
