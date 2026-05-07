# @repo/tenancy — Package Guide

## Responsibility

Host parsing, tenant resolution, cache keying, and cross-worker cache invalidation. Every request that needs a tenant context passes through this package's middleware before any business logic.

## Public surface (`src/index.ts`)

- `tenantMiddleware(deps)` — Hono middleware that resolves the host and sets `c.var.tenant`.
- `parseHostname(rawHost, config)` — pure host parser (`SLUG_RE`, `BUILTIN_RESERVED_SLUGS`, `isValidSlug`).
- `resolveTenant(rawHost, deps)` — DB-backed resolver with Cache API + KV-versioned tenant-cache.
- `loadHostConfigOnce(env)` — Phase-0 snapshot-once lock keyed on `env` identity.
- `tenantCacheKey`, `KV_VERSION_KEY` — cache key shape and KV version key.
- `createInvalidator`, `createFanOutInvalidator` — own-colo invalidator + admin-side fan-out wrapper.
- `resolveDevTenantHeader` — pure helper for the `X-Dev-Tenant-Slug` flow.
- `normalizeHostHeader` — shared host normaliser (NFC, lowercase, strip port).
- Types: `Tenant`, `TenantNotFound`, `TenantSuspended`, `TenantResolution`, `HostConfig`, `ParsedHost`, `ParseRejectReason`, `TenancyEnv`, `Invalidator`, `FanOutInvalidator`, `InvalidationSpec`, `DevHeaderResult`.

## Rules

- Pure functions where possible. Cache and KV are always injected as deps — never imported at module scope.
- No module-scope mutable state except the `WeakMap` in `host-config.ts` (keyed on `env` object identity; acceptable per Phase 0 snapshot-once lock).
- No `any` in handwritten code.
- No non-null assertions (`!`). Use explicit guards or `firstOrNull` / `firstOrThrow` from `@repo/db`.
- `unknown` and `as unknown as <T>` only at validated boundaries. Each site must carry `// boundary: <reason>`.
- Tests exercise the public boundary (the exported functions); internal helpers are tested through the public surface.
- The only `// boundary:` annotation expected in this package is in `resolve-tenant.ts` for the JSON parse from the Cache API.

## Config snapshot (Phase 0 lock)

`loadHostConfigOnce(env)` is called once per Worker isolate at the first request. The returned `HostConfig` is frozen and identity-cached on the `env` object via `WeakMap`. Never call `loadHostConfigOnce` more than once per env-object identity; never mutate the result.

## Host resolution precedence (`parseHostname`)

1. NFC + lowercase + strip port + strip trailing dot.
2. Reject `xn--` prefix on any label.
3. Reject `*`, whitespace, non-ASCII not covered by NFC.
4. **Admin host wins** over wildcard suffix even if names overlap.
5. **Fallback host** (CF-for-SaaS fallback origin).
6. **Wildcard subdomain** (`<slug>.${appWildcardHost}`).
7. Anything else → **custom hostname** (resolver validates against DB).

The middleware then looks up the resolved host in this order:

1. Cache API hit (`cache:tenant:v<version>:<host>`).
2. DB lookup via `liveOrganizations(...)` (subdomain) or `lookupByCustomHost` (custom hostname; explicitly carries `isNull(organizations.deletedAt)`).

Returns one of:

- `Tenant` (live) — also written to the cache (positive TTL 60s).
- `{ kind: "not_found", host }` — written with negative TTL 5s; middleware emits 404.
- `{ kind: "suspended", tenant }` — written with positive TTL 60s; middleware emits 503 with `Retry-After: 60`.

## Dev-header guard (production fail-closed)

`resolveDevTenantHeader` and the middleware's gate together enforce a **production fail-closed** posture (Wave 2D):

- The middleware never reads `X-Dev-Tenant-Slug` when `config.nodeEnv === "production"`. The structural skip is the outer fail-safe — even if the inner `nodeEnv` check were removed, the production middleware never consults the header.
- `resolveDevTenantHeader` independently rejects with `kind: "ignore", reason: "node_env"` in production.
- Dev gating additionally requires `config.allowDevTenantHeader === true` (`ALLOW_DEV_TENANT_HEADER` flag) and slug validation against `SLUG_RE`.

## Cache key shape

`cache:tenant:v<version>:<host>` — version sourced from KV key `cache:tenant:version` (defaults to `v0` when absent).

## Invalidation asymmetry (D68)

- `Invalidator` — own-colo Cache API delete + KV version bump. Used by `apps/server` and `apps/auth`.
- `FanOutInvalidator` — extends `Invalidator` with `fanOut` and `fanOutBumpVersion` that call peer worker RPC bindings. Used by the admin worker.
