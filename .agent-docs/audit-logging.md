# Audit Logging

Audit records are written by `auditLogService` in `apps/server/src/modules/audit-logs/service.ts`. All event strings are defined in `packages/shared/src/audit.ts`.

## Classification rule

> Does this event occur alongside a database mutation?
> - YES -> critical: use `auditLogService.create(input, executor)` inside the same `db.transaction()` call
> - NO  -> bufferable: use `recordBufferableAuditEvent(c, input)` anywhere in the request handler

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

### `recordBufferableAuditEvent(c, input)`

Use for bufferable events. Fire-and-forget — call it outside any transaction. The helper (`apps/server/src/modules/audit-logs/buffer.ts`) timestamps the event, enriches it with the request's IP/user-agent from `c.var.auditContext`, and enqueues it to `env.AUDIT_LOG_QUEUE` via `c.executionCtx.waitUntil`, so a queue outage never affects the response.

```ts
recordBufferableAuditEvent(c, {
  event: AUDIT_EVENTS.USER.LISTED.event,
  actorId: c.get("user")?.id,
  actorType: ACTOR_TYPES.USER,
  metadata: { count: result.data.length },
});
```

The low-level `auditLogService.enqueue(queue, messages)` sends a batch of pre-built `AuditLogQueueMessage`s directly; prefer the helper, which fills in the timestamp and request context for you.

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

The worker exposes a single `queue` export (Cloudflare delivers every queue's batches to it). `src/queues/router.ts` dispatches each batch to the consumer registered for `batch.queue`, so batches from different queues stay isolated. To add another queue: write its consumer in the owning module, register it in `QUEUE_CONSUMERS`, and add the producer/consumer entries to `wrangler.jsonc`.

The audit consumer (`handleAuditLogQueue` in `src/modules/audit-logs/queue.ts`) re-validates each message against `auditLogQueueMessageSchema` and writes the valid ones to the database using a single insert statement, preserving each event's original `occurredAt` as its `createdAt`.

## Error handling and DLQ

The consumer acks and retries per message so one bad message never sinks the batch:

- **Malformed messages** (fail schema validation) are acked and dropped with a `warn` log. A message that does not parse will never parse on retry, so retrying it would only waste a DLQ slot.
- **A successful batch insert** acks every valid message.
- **A failed batch insert** falls back to per-row inserts: healthy rows are acked and only the genuinely failing rows are retried (and eventually dead-lettered) in isolation.
- **An unreachable database** (the connection could not be acquired) retries the whole batch, so nothing is lost.

After 3 retries a message is forwarded to `audit-log-dlq`. Monitor the DLQ to detect persistent write failures. DLQ messages can be replayed manually after the root cause is resolved.

## Auth worker events (future scope)

The events `auth.password.changed`, `auth.session.revoked`, `auth.login.success`, and `auth.login.failed` are defined in `AUDIT_EVENTS.AUTH` but currently originate in `apps/auth`, which does not write audit logs yet. These events are reserved; do not emit them from `apps/server`. When `apps/auth` gains audit logging support, it will use the same shared event definitions.
