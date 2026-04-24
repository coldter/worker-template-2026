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

## Executor pattern

Services expose an optional `executor` that defaults to the root request-scoped
`db`. When called from within an existing transaction, the caller passes its
`tx` so the service joins the outer transaction. Drizzle turns a nested
`executor.transaction` call into a savepoint, so the pattern composes safely.

```ts
import { firstOrThrow, type Executor } from "@repo/db";
import { users } from "@repo/db/schema";
import { auditLogService } from "@/modules/audit-logs/service";

export const userService = {
  async create(
    input: CreateUserInput,
    actorId: string,
    auditContext: { ipAddress?: string; userAgent?: string },
    executor: Executor,
  ) {
    return executor.transaction(async (tx) => {
      const user = await firstOrThrow(
        tx.insert(users).values(input).returning(),
        "Failed to create user",
      );

      // Thread `tx` into nested writes so they share the same transaction.
      await auditLogService.create(
        {
          event: "user.created",
          actorId,
          targetId: user.id,
          ipAddress: auditContext.ipAddress,
          userAgent: auditContext.userAgent,
        },
        tx,
      );

      return user;
    });
  },
};
```

Handlers call services with `c.var.db` as the executor; services that need to
atomically coordinate across multiple services open the outer transaction and
pass `tx` into each call:

```ts
await c.var.db.transaction(async (tx) => {
  const user = await userService.create(input, actorId, auditContext, tx);
  await notificationService.ensureDefaultPreferences(user.id, tx);
});
```

Because `db` is request-scoped on Workers, the service signature takes
`executor: Executor` explicitly rather than defaulting to a module-level
singleton. Pass `c.var.db` from the handler when no outer transaction exists.

## In Workflows

- Each `step.do` callback creates its own `pg.Client`, connects, does its work, and calls `await client.end()` before returning.
- Do not share a client across steps; Workflow steps may execute on separate isolate instances.
