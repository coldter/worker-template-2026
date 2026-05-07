# @repo/db — Package Guide

## Responsibility

Single source of truth for the database. Holds the Drizzle schema, the typed client factory (`createDrizzleClient`), the relations object, the prefixed CUID id generators, and the `liveOrganizations` read seam. All workers (`apps/server`, `apps/auth`, `apps/admin`) depend on this package.

## Public surface (`src/index.ts`)

- `createDrizzleClient`, `withDrizzleClient`, types `DrizzleClient`, `Executor`, `Transaction`, `WithDrizzleClientOptions`.
- `firstOrNull`, `firstOrThrow` — null-safe `await` helpers.
- `liveOrganizations(executor)` — sanctioned read seam for the `organization` table.
- `relations` — Drizzle relational config.
- `generateIdForModel`, `generatePrefixedCuid`, `ID_PREFIXES`, plus branded id types (`UserId`, `SessionId`, `AccountId`, `VerificationId`).
- User-status helpers: `activateUser`, `deactivateUser`, `clearUserLockout`, `deleteUserSessions`, `resetFailedLoginAttemptsByEmail`, `setUserFailedAttempts`, `setUserLocked`.
- Re-exports the full schema (`@repo/db/schema`).

## Schema overview (`src/schema/`)

| File | Tables |
| --- | --- |
| `auth.ts` | Better Auth: `users`, `sessions`, `accounts`, `verifications` (+ extensions for status / lockout / role slugs). |
| `auth-relations.ts` | Drizzle relations for the BA tables. |
| `audit-logs.ts` | `audit_logs` (polymorphic actor + tenant scope; FKs deliberately omitted for cross-tenant retention). |
| `organizations.ts` | `organization`, `member`, `invitation` plus tenant-scope columns (`enforceSSO`, `suspendedAt`, `suspendedBy`, `suspendedReason`, `deletedAt`, `deletedBy`, `sessionVersion`, `branding`). |
| `tenant-custom-hostnames.ts` | `tenant_custom_hostnames` lifecycle rows (CF-for-SaaS). |
| `global-admins.ts` | Operator directory; CHECK constraints lock the role enum (Wave 2E). |
| `notification-preferences.ts`, `notifications.ts`, `push-tokens.ts` | Notifications subsystem. |
| `roles.ts` | Tenant-scoped RBAC roles (CHECK constraints on slug shape). |
| `sso-providers.ts` | Per-tenant SSO providers and verified domains. |
| `reserved-slugs.ts` | Slug deny-list (e.g. `admin`, `app`, `www`, system reserved names). |

## Soft-delete and `liveOrganizations`

The `organization.deleted_at` column carries timezone info; soft-deleted rows must never resurface in tenant resolution, the auth pipeline, or any operator-facing listing.

**All reads of `organizations` outside `@repo/db` MUST go through `liveOrganizations(executor)`** (or be on the documented allowlist in `__tests__/live-organizations.spec.ts`). The helper exposes `select(columns, extraWhere?)`, `selectById`, `selectBySlug`, and a relational `findFirst` passthrough — every shape pre-binds `WHERE deleted_at IS NULL`. The structural test in `packages/db/__tests__/` enforces this at CI.

## Append-only `audit_logs`

`audit_logs` is append-only at the database level. A trigger blocks `UPDATE` and `DELETE`; rows must remain immutable so the operator audit feed is trustworthy. Migrations adding new event kinds change the application-side enums (`@repo/shared/audit`) but never alter existing rows.

`actor_id` and `organization_id` deliberately have **no FK** so the row can outlive a hard-deleted user or tenant (D30). The composite indexes cover the operator filter UI (`organization_id, event, created_at DESC`) and per-actor recency feeds.

## Role CHECK constraints (Wave 2E)

`roles` and `global_admins` rely on Postgres CHECK constraints to lock allowed role values. Adding a new role requires:

1. Add the value to the runtime constant in `@repo/shared/roles` (or operator role matrix).
2. Generate a migration that drops + recreates the CHECK with the new value.
3. Update lockstep tests in `packages/authorization`.

## Rules

- No `any` in handwritten code. No non-null assertions (`!`).
- `unknown` and `as unknown as <T>` only at validated boundaries with `// boundary:` annotations (e.g., Drizzle generic variance in `live-organizations.ts`).
- Every workspace is a per-request consumer: open a `pg.Client` via Hyperdrive, build the Drizzle instance with `createDrizzleClient`, close in `waitUntil`. Never hold a global client.
- Tests live in `packages/db/__tests__/`. Adding a schema change adds (or updates) a regression test alongside the migration.
