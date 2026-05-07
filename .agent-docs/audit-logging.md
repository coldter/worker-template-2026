# Audit Logging

Audit records are written by `auditLogService` in `apps/server/src/modules/audit-logs/service.ts`. All event strings are defined in `packages/shared/src/audit.ts`.

## Classification rule

> Does this event occur alongside a database mutation?
> - YES → critical: use `auditLogService.create(input, executor)` inside the same `db.transaction()` call.
> - NO  → bufferable: use `auditLogService.enqueue(c, input)` (or `enqueue(input)` outside a request) anywhere in the handler.

Critical events are written atomically with the mutation they describe. If the transaction rolls back, the audit record rolls back too — no orphaned entries. Bufferable events (reads, list views, login attempts) have no accompanying write, so they are sent to a Cloudflare Queue and flushed in batches.

## Service methods

### `auditLogService.create(input, executor)`

Use for critical events. Must be called inside `db.transaction()` with the transaction `executor` passed through. The service runs `redactAuditMetadata` (alias of `redact` from `@repo/shared/logger`) over `input.metadata` before persisting so secrets never reach the row.

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

### `auditLogService.createDualScope(input, executor)`

Operator-on-tenant CRITICAL events. Writes two rows: one global-scope (`organizationId === null`) and one tenant-scope (the same `input.organizationId`). Both share event/actor/target so the pair is searchable end-to-end. Both inserts run on the same executor so they roll back atomically with the mutation.

### `auditLogService.enqueue(ctxOrInput, input?)`

Use for bufferable events. Two call shapes:

- `enqueue(c, input)` (preferred in handlers): the queue `send` is registered with `c.executionCtx.waitUntil` so the response can flush before the cross-worker queue write completes AND the runtime keeps the isolate alive long enough for the send to settle.
- `enqueue(input)` (no Hono context — workflows, cron, other queue consumers): the send is best-effort and floats. Prefer the Context form.

`redactAuditMetadata` runs on the message before it leaves the producer.

```ts
auditLogService.enqueue(c, {
  event: AUDIT_EVENTS.USER.LISTED.event,
  actorId: actor.id,
  actorType: ACTOR_TYPES.USER,
  ipAddress: c.req.header("cf-connecting-ip"),
  userAgent: c.req.header("user-agent"),
});
```

## Adding a new audit event

Add an entry to `AUDIT_EVENTS` in `packages/shared/src/audit.ts` with `kind: "critical" | "bufferable"`. The runtime arrays `CRITICAL_EVENTS` / `BUFFERABLE_EVENTS` and the `CriticalAuditEvent` / `BufferableAuditEvent` types are derived from `AUDIT_EVENTS` itself. The `satisfies Record<...>` check makes the `kind` field mandatory at compile time, so an unclassified event will not type-check.

Pick the appropriate service method in the handler (`create`/`createDualScope` for critical, `enqueue` for bufferable). New events introduced during the multi-tenant work include:

- `tenancy.custom_hostname.requested|verified|activated|deactivated|removed|deleted_by_cf|cf_create_failed`
- `operator.access.denied`
- `tenant.created|provisioned|deprovisioned|session_invalidated|suspended|suspended.noop|restored|restored.noop`
- `org.invitation.partial_failure`, `org.sso_enforced`, `org.sso_unenforced`

Refer to `AUDIT_EVENTS` for the full list and matching descriptions.

## Queue configuration

The `AUDIT_LOG_QUEUE` Cloudflare Queue is declared in `apps/server/wrangler.jsonc` under `queues.producers` and consumed by the same worker under `queues.consumers`.

Consumer settings:

| Setting           | Value          |
|-------------------|----------------|
| `max_batch_size`  | 100            |
| `max_batch_timeout` | 10 seconds   |
| `max_retries`     | 3              |
| `dead_letter_queue` | `audit-log-dlq` |

The consumer (`apps/server/src/queues/audit-log-consumer.ts`) processes each message individually:

- Per-message Zod validation against `queueMessageSchema`. A bad payload triggers `message.retry()` for that message only — it never poisons the rest of the batch.
- Per-message `db.insert(auditLogs)` inside a single shared `withDrizzleClient` connection.
- Each successful insert calls `message.ack()`; each insert/validation failure calls `message.retry()`.
- The handler does not throw, so the queue records individual outcomes rather than rolling the entire batch.

## Error handling and DLQ

After 3 retries a message is forwarded to `audit-log-dlq`. Monitor the DLQ to detect persistent write failures (e.g., schema mismatch after a migration, connectivity loss). DLQ messages can be replayed manually after the root cause is resolved.

## Auth worker events

`auth.password.changed` and `auth.session.revoked` are critical; `auth.login.success`, `auth.login.failed`, `auth.logout` are bufferable. They are defined in `AUDIT_EVENTS.AUTH` and currently emitted from auth-side databaseHooks plus the `apps/admin` operator audit feed; do not duplicate emission from `apps/server`.

## Multi-tenancy invariants

The following invariants are enforced by tests in `packages/db/__tests__/`:

- Every read of `organizations` outside `@repo/db` must go through `liveOrganizations(...)` (or be on the explicit allowlist) so `deleted_at IS NULL` is always applied.
- Operator-on-tenant audit events use `auditLogService.createDualScope(input, tx)` inside the same transaction as the mutation.
- New audit events must be added to `AUDIT_EVENTS` with a `kind` of `"critical"` or `"bufferable"`; the runtime arrays and types are derived from that field.
- Tenant resolution trusts only the public `Host` header; the dev-tenant header is fail-closed in production.
