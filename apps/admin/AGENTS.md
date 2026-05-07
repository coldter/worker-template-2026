# apps/admin — operator-only Hono worker

Operator perimeter for the platform. Serves the `apps/admin-ui` SPA via the `ADMIN_UI` ASSETS binding (`../admin-ui/dist`) and exposes the operator API at `/api/admin/*`. Mounted on a single custom domain (`${ADMIN_HOST}`) with `workers_dev: false` and `preview_urls: false` — no other route reaches this worker.

## Auth Model

Operator identity is asserted by **Cloudflare Access**. There is no Better Auth session and no tenant cookie on this perimeter (D19 / D26).

Request pipeline:

1. `productionDevFlagGuard` — fails closed with 500 if `ALLOW_DEV_ADMIN_AUTH` or `LOCAL_DEV_ADMIN_EMAIL` ever leak into a production env (Wave-2 audit fix / D52).
2. `trimTrailingSlash`, `secureHeaders`.
3. `hostGuardMiddleware` — rejects requests whose normalized `Host` is not `${ADMIN_HOST}`.
4. `dbMiddleware` — per-request Drizzle client on `c.var.db`.
5. `cfAccessMiddleware` — verifies `cf-access-jwt-assertion` against the Access team JWKS with `aud` and `iss` checks (D38). Service tokens (`type: "app"` or `common_name` set) are rejected; only user-identity tokens may proceed (D19). Then resolves the `global_admins` row (by JWT `sub` in production, by email in dev mode) through `authenticate-operator.ts`, applies the enrollment-token claim flow (D31), gates deactivated rows, and pings `lastActiveAt`.
6. `adminOriginMiddleware` — mutation `Origin` header check.
7. Per-route `requireOperator(action)` — typed permission gate from `@repo/authorization`. The operator role matrix lives in `packages/authorization/docs/` and is exercised by lockstep tests in `packages/authorization/src/__tests__/`.

## RPC to apps/server

The admin worker calls the server worker through the `API` service binding with entrypoint `AdminApiEntrypoint`. This is a separate operator-scoped surface from the tenant-facing `ApiEntrypoint`. The `AUTH` binding (`AuthEntrypoint`) is also wired but unused at runtime today; it is in place for any future operator-impersonation flow.

## Modules

| Path | Purpose |
| --- | --- |
| `src/modules/tenants/` | Operator CRUD on tenants (create, list, suspend, restore, deprovision). |
| `src/modules/global-admins/` | Operator directory + role transitions. |
| `src/modules/audit-logs/` | Operator-scope audit log feed (global rows + tenant rows when scoped). |
| `src/modules/system/` | System health / config endpoints. |
| `src/scheduled/inactivity-sweep.ts` | Cron `0 12 * * *` deactivates global-admins idle ≥ 90 days; emits `global_admin.deactivated` audit events. |

## Audit Events

Operator mutations against tenant data MUST use `auditLogService.createDualScope(input, tx)` so both a global-scope row and a tenant-scope row are written atomically with the mutation. Operator authentication failures (CF Access reject / role gate reject) emit the bufferable `operator.access.denied` event. See [audit-logging.md](../../.agent-docs/audit-logging.md).

## Critical Rules

- No emojis in code or comments.
- No `any`, no non-null assertions (`!`).
- Every mutation handler attaches a `requireOperator(action)` guard — the role matrix is the source of truth.
- All `organizations` reads go through `liveOrganizations(...)` from `@repo/db`.

Coordinate with [b1 plan](../../docs/superpowers/plans/2026-05-06-multi-tenancy/b1-apps-admin-worker.md).
