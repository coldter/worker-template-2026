# apps/app — tenant-facing SPA worker

Tenant SPA served via Cloudflare Workers Static Assets. Public ingress for `*.${APP_WILDCARD_HOST}` (wildcard subdomain), `${APP_WILDCARD_HOST}` (apex), `${FALLBACK_HOST}` (CF-for-SaaS fallback origin used by tenant custom hostnames), and the custom hostnames themselves.

`apps/server` and `apps/auth` are NOT directly addressable from the public internet. They are reachable only through this worker's service bindings (D40, D45, D58).

## Worker entrypoint

`src/index.ts` is intentionally minimal: every request is routed by path prefix:

```ts
if (url.pathname.startsWith("/api/"))      return env.API.fetch(req);    // -> apps/server
return env.ASSETS.fetch(req);                                            // -> static SPA
```

`/api/auth/*` is intentionally included in the `/api/*` branch. The server worker must resolve the tenant first, then re-issue the call as `AuthEntrypoint.handleAuthRequest(req, tenant)`. Direct `AUTH.fetch(req)` reaches `AuthEntrypoint.fetch`, which returns 421 by design.

`apps/app/wrangler.jsonc` sets `assets.not_found_handling: "single-page-application"` so deep links resolve to `index.html` and the SPA router hydrates. There is no `run_worker_first` for `/api/*` because the worker entrypoint already short-circuits those paths before consulting `ASSETS`.

## SPA layout

- `src/lib/auth-client.ts` — Better Auth client. `baseURL: window.location.origin` so cookies stay scoped per-tenant (host-only, no `Domain` attribute) (D44, D47).
- `src/lib/tenant.ts` — `resolveTenant()` calls `${origin}/api/tenancy/current` before the router mounts. In dev the `x-dev-tenant-slug` header is injected from `VITE_DEV_TENANT_SLUG`.
- `src/lib/branding.ts` — `applyBranding()` uses `setProperty`; never injects a `<style>` tag (CSP-safe).
- `src/main.tsx` — bootstrap order: resolve tenant, apply branding, mount router. When the tenant is unknown the SPA renders `TenantNotFound`.
- `src/routes/accept-invite/$invitationId.tsx` — public route (D48). Orchestrates the BA invitation accept flow against `/api/invitations/accept/:invitationId`.
- `public/apex/index.html` — static "Find your team" page served on the apex of `APP_WILDCARD_HOST` (D76). Vite copies it to `dist/apex/`.

`/sso/callback` is NOT an `apps/app` route — it lives on the auth worker (D64). The SSO callback URL template comes from `scripts/lib/host-config.ts#oidcCallbackTemplate`.

## Cookies

Sessions use a single host-only cookie (`session_token_v1`, `HttpOnly`, `SameSite=lax`, no `Domain` attribute). Cross-subdomain cookie scope and apex sign-in are explicitly NOT supported — each tenant host gets isolated session state (D15 / D65). The auth worker's `sanitizedAuthRequest` pins Host/Origin to the tenant's canonical host before BA sees the request, so cookies never leak between tenants.

## Build

`bun run build` from `apps/app` builds the Vite bundle into `dist/`. The `deploy` script runs the build then `wrangler deploy`.

Coordinate with [b4 plan](../../docs/superpowers/plans/2026-05-06-multi-tenancy/b4-apps-app-spa.md).
