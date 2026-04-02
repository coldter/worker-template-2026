# Shared Package (`@repo/shared`)

Use explicit subpath imports and treat shared runtime constants as source of truth.

## Stable Modules
- `@repo/shared/permissions`
- `@repo/shared/roles`
- `@repo/shared/pagination`
- `@repo/shared/audit`
- `@repo/shared/users`
- `@repo/shared/logger`
- `@repo/shared/kv-cache`

Note: `@repo/shared/abilities` was removed. Authorization is now handled by `@repo/authorization`.

## Usage Rules
- Reuse shared role constants across server and web; do not duplicate strings.
- Derive types from runtime constants (`as const`) instead of writing separate duplicated unions.
- Use shared pagination schemas/helpers for list endpoints and list UIs.
