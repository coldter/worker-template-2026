# Shared Package (`@repo/shared`)

Runtime constants, types, and helpers shared across every worker. Import via explicit subpaths; treat the constants here as the source of truth.

## Stable Modules

| Subpath | Purpose |
| --- | --- |
| `@repo/shared/audit` | `AUDIT_EVENTS` registry, `ACTOR_TYPES`, `TARGET_TYPES`, `redactAuditMetadata`, derived `CRITICAL_EVENTS` / `BUFFERABLE_EVENTS` and `CriticalAuditEvent` / `BufferableAuditEvent` types. |
| `@repo/shared/authorization` | App resource registry consumed by `@repo/authorization`. |
| `@repo/shared/roles` | System-wide role constants and helpers. |
| `@repo/shared/users` | User-status enum constants. |
| `@repo/shared/pagination` | Schema + helpers for paginated list endpoints. |
| `@repo/shared/logger` | `logger` (structured), `redact` (sensitive-field sanitizer), `configureLogger`. |
| `@repo/shared/logger-drizzle` | `DrizzleLogger` for development DB query logging. |
| `@repo/shared/kv-cache` | Tiny KV cache wrapper. |
| `@repo/shared/api-binding` | Typed RPC contract for the `ApiEntrypoint` and `AdminApiEntrypoint` service bindings. |
| `@repo/shared/auth-binding` | Typed RPC contract for the `AuthEntrypoint` service binding (`getSession`, `getToken`, `handleAuthRequest`). |
| `@repo/shared/brand` | Brand constants for emails and SPA bootstrap. |

`@repo/shared/abilities` was removed; authorization is now handled by `@repo/authorization`.

## Logger configuration

`configureLogger(opts)` lets each worker customise the redactor key list, log level, and structured-event sink before the first log call. Every worker calls it once at module-load. The default redactor walks JSON-shaped values and replaces sensitive values (passwords, secrets, API keys, BA cookies) with `[REDACTED]`.

`redact(value)` is the same function reused by `redactAuditMetadata` so audit rows persisted to the DB carry the same sanitization as structured logs (Wave 2A/2E).

## Audit registry

`packages/shared/src/audit.ts` is the **single source of truth** for audit events. Every entry carries a `kind: "critical" | "bufferable"` field; the runtime arrays (`CRITICAL_EVENTS`, `BUFFERABLE_EVENTS`) and types (`CriticalAuditEvent`, `BufferableAuditEvent`) are derived from `AUDIT_EVENTS` itself. Adding a new event is a single edit to `AUDIT_EVENTS`. See [audit-logging.md](../../.agent-docs/audit-logging.md).

## Usage Rules

- Import via explicit subpaths (for example: `@repo/shared/audit`).
- Reuse shared role/audit/event constants across server/admin/auth — do not duplicate strings.
- Derive types from runtime constants (`as const`) instead of writing separate duplicated unions.
- Use shared pagination schemas/helpers for list endpoints.
- Add new shared exports intentionally and keep naming stable; stable subpaths are part of the package contract.
