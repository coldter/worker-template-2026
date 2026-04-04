# Audit Logging

Audit records are written by `auditLogService` in `apps/server/src/modules/audit-logs/service.ts`. All event strings are defined in `packages/shared/src/audit.ts`.

## Classification rule

> Does this event occur alongside a database mutation?
> - YES -> critical: use `auditLogService.create(input, executor)` inside the same `db.transaction()` call
> - NO  -> bufferable: use `auditLogService.enqueue(input)` anywhere in the request handler

Critical events are written atomically with the mutation they describe. If the transaction rolls back, the audit record rolls back too — no orphaned entries. Bufferable events (reads, list views, login attempts) have no accompanying write, so they are sent to a Cloudflare Queue and flushed in batches.

## Service methods

### `auditLogService.create(input, executor)`

Use for critical events. Must be called inside `db.transaction()` with the transaction `executor` passed through.

```ts
await db.transaction(async (tx) => {
  const user = await userService.create(tx, data);
  await auditLogService.create(
    {
      event: AUDIT_EVENTS.USER.CREATED.event,
      actorId: actor.id,
      actorType: ACTOR_TYPES.USER,
      targetId: user.id,
      targetType: TARGET_TYPES.USER,
      ipAddress: c.req.header("cf-connecting-ip"),
      userAgent: c.req.header("user-agent"),
    },
    tx,
  );
});
```

### `auditLogService.enqueue(input)`

Use for bufferable events. Fire-and-forget — call it outside any transaction. Internally sends a timestamped message to `env.AUDIT_LOG_QUEUE`.

```ts
auditLogService.enqueue({
  event: AUDIT_EVENTS.USER.LISTED.event,
  actorId: actor.id,
  actorType: ACTOR_TYPES.USER,
  ipAddress: c.req.header("cf-connecting-ip"),
  userAgent: c.req.header("user-agent"),
});
```

## Adding a new audit event

1. Add the event entry to `AUDIT_EVENTS` in `packages/shared/src/audit.ts`:

   ```ts
   INVITE: {
     SENT: { event: "invite.sent", description: "Invite sent to user" },
   },
   ```

2. Add the event string to either `CRITICAL_EVENTS` or `BUFFERABLE_EVENTS` in the same file:

   ```ts
   // CRITICAL_EVENTS — written inside a db.transaction()
   export const CRITICAL_EVENTS = [
     // ...existing entries
     "invite.sent",
   ] as const;
   ```

   or

   ```ts
   // BUFFERABLE_EVENTS — sent to the queue
   export const BUFFERABLE_EVENTS = [
     // ...existing entries
     "invite.sent",
   ] as const;
   ```

3. Use the appropriate service method (`create` or `enqueue`) in the handler or service.

4. If the event string is absent from both classification arrays, the TypeScript types will not compile — this is intentional to prevent unclassified events from slipping through.

## Queue configuration

The `AUDIT_LOG_QUEUE` Cloudflare Queue is declared in `wrangler.jsonc` under `queues.producers` and consumed by the same worker under `queues.consumers`.

Consumer settings:

| Setting           | Value          |
|-------------------|----------------|
| `max_batch_size`  | 100            |
| `max_batch_timeout` | 10 seconds   |
| `max_retries`     | 3              |
| `dead_letter_queue` | `audit-log-dlq` |

The consumer handler (`queue` export in `src/index.ts`) writes each batch to the database using a single insert statement.

## Error handling and DLQ

If a queue batch fails after 3 retries, messages are forwarded to `audit-log-dlq`. Monitor the DLQ to detect persistent write failures (e.g., schema mismatch after a migration, connectivity loss). DLQ messages can be replayed manually after the root cause is resolved.

Within the consumer, do not throw from individual message processing — catch errors per-message and call `message.retry()` to allow selective retry without failing the entire batch.

## Auth worker events (future scope)

The events `auth.password.changed`, `auth.session.revoked`, `auth.login.success`, and `auth.login.failed` are defined in `AUDIT_EVENTS.AUTH` but currently originate in `apps/auth`, which does not write audit logs yet. These events are reserved; do not emit them from `apps/server`. When `apps/auth` gains audit logging support, it will use the same shared event definitions.
