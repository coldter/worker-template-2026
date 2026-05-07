# Shared Package (`@repo/shared`)

Use explicit subpath imports and treat shared runtime constants as source of truth.

## Stable Modules
- `@repo/shared/audit`
- `@repo/shared/authorization`
- `@repo/shared/roles`
- `@repo/shared/users`
- `@repo/shared/pagination`
- `@repo/shared/logger`
- `@repo/shared/logger-drizzle`
- `@repo/shared/kv-cache`
- `@repo/shared/api-binding`
- `@repo/shared/auth-binding`
- `@repo/shared/brand`

`@repo/shared/abilities` was removed. Authorization is now handled by `@repo/authorization`.

## Usage Rules
- Reuse shared role/audit/event constants across server/admin/auth/app; do not duplicate strings.
- Derive types from runtime constants (`as const`) instead of writing separate duplicated unions.
- Use shared pagination schemas/helpers for list endpoints.
- See `packages/shared/AGENTS.md` for the per-subpath summary.
