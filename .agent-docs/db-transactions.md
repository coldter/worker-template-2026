# Database Transactions

## Lifecycle (Hyperdrive / per-request Client)

- `dbMiddleware` creates a `pg.Client` per request, connects it to `env.HYPERDRIVE.connectionString`, and stores the Drizzle instance in `c.var.db`.
- After the response is sent the middleware calls `c.executionCtx.waitUntil(client.end())` to close the connection without blocking the response.
- Never hold a global `pg.Client`. Each request and each Workflow step must create and close its own client.

## In Handlers and Services

- In handlers use `c.var.db` and pass it to service functions.
- Service functions accept `db: DrizzleClient` (or `executor: Executor`) as their first parameter; they do not import a global singleton.
- Import DB types from `@repo/db`.

## Transactions

- Wrap multi-step write workflows in `db.transaction(async (tx) => { ... })`.
- Pass `tx` to nested write services (including audit logs) to preserve atomicity.
- Keep CPU-heavy work and external side-effects (HTTP calls, email sends) outside transaction scopes.
- Single-statement writes and read-only queries usually do not need explicit transactions.

## In Workflows

- Each `step.do` callback creates its own `pg.Client`, connects, does its work, and calls `await client.end()` before returning.
- Do not share a client across steps; Workflow steps may execute on separate isolate instances.
