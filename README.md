# Worker Template

Production-ready multi-tenant Cloudflare Workers monorepo. It ships a tenant SPA shell, a private API worker reached through service bindings, a private Better Auth worker, an operator console with its own SPA, RBAC, audit logging, Cloudflare for SaaS custom-hostname lifecycle, notifications, queues, workflows, and a local harness that mirrors production host routing.

This README is the human bootstrap guide. Deeper implementation notes live in [`AGENTS.md`](AGENTS.md) and [`.agent-docs/`](.agent-docs/).

## What You Get

- `apps/app`: tenant-facing SPA worker. Public ingress for wildcard tenant subdomains, the apex app host, the Cloudflare for SaaS fallback origin, and tenant custom hostnames. It forwards every `/api/*` request to `apps/server` and serves the SPA for everything else.
- `apps/server`: private API worker. It has `workers_dev: false` and no public route; tenant traffic reaches it through the `API` service binding from `apps/app`. It owns Hono/OpenAPI routes, tenancy resolution, business modules, Durable Objects, Workflows, Queues, audit logs, and the Cloudflare for SaaS lifecycle.
- `apps/auth`: private Better Auth worker. It has no public route. All real auth traffic reaches `AuthEntrypoint` over typed RPC after `apps/server` resolves the tenant.
- `apps/admin`: operator worker protected by Cloudflare Access. It serves `apps/admin-ui`, exposes operator APIs, and talks to `apps/server`/`apps/auth` over service bindings.
- `packages/*`: shared DB schema, tenancy resolver, JWT verifier, authorization engine, email templates, audit registry, logger, and runtime helpers.

## Architecture At A Glance

```text
Tenant browser on acme.app.example.test or custom domain
        |
        v
apps/app
  |-- /api/*  -----------------------> apps/server default fetch
  |                                      |
  |                                      | tenancyMiddleware resolves Tenant
  |                                      | /api/auth/* -> AUTH.handleAuthRequest(request, tenant)
  |                                      v
  |                                   apps/auth AuthEntrypoint
  |
  `-- everything else -> ASSETS SPA
```

`apps/auth` and `apps/server` are intentionally not directly addressable from the public internet. `apps/auth` default fetch returns `421 Misdirected Request`; the useful auth surface is only the RPC methods on `AuthEntrypoint`.

Public hostnames are derived from the root `.env` by `scripts/lib/host-config.ts` and merged into each worker's `wrangler.jsonc` by `bun run setup:env`. Do not hard-code hostnames in worker configs.

## Prerequisites

- Bun `1.3.13` or newer compatible with `packageManager`.
- Node.js `25+`.
- PostgreSQL for local development and tests.
- Cloudflare account and `wrangler login` for deployment.
- Optional for host-accurate local HTTPS: `mkcert` and Caddy.
- Optional production services: Resend, Firebase Cloud Messaging, Cloudflare Access, Cloudflare for SaaS.

Cloudflare Workers projects here use `nodejs_compat`, Hyperdrive for PostgreSQL, service bindings for worker-to-worker calls, KV/Cache API for caches, Durable Objects for primary rate limiting, and Queues/Workflows for background work.

## First-Time Bootstrap

### 1. Install dependencies

```bash
bun install
```

`postinstall` generates the server OpenAPI cache if it is missing.

### 2. Personalize the template

Run this once on a new project:

```bash
bun run template:init
```

Use `--dry-run` first if you want a preview. The initializer can rename workspace scopes, set brand defaults, optionally prefix Cloudflare Worker names, then self-delete. Skip this only if you are intentionally working on the template itself.

### 3. Create the root environment file

```bash
cp .env.example .env
```

The root `.env` is the single source of truth for local secrets, local DB URLs, and host configuration. Fill at least:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app_dev
DATABASE_TEST_URL=postgresql://postgres:postgres@localhost:5432/app_test
BETTER_AUTH_SECRET=<openssl rand -hex 32>
RESEND_API_KEY=<local or real key>
FIREBASE_SERVICE_ACCOUNT_KEY_BASE64=<base64 json, if testing push>
VAULT_MASTER_KEY=<secret>
SSO_KEY=<secret for pgcrypto OIDC config encryption>
CLOUDFLARE_API_TOKEN=<zone scoped token>
CLOUDFLARE_ZONE_ID=<zone id>
CF_ACCESS_AUD=<access app audience>
CF_ACCESS_TEAM_DOMAIN=<team.cloudflareaccess.com>
```

For local-only work, placeholder values are fine for services you are not exercising, but the variables must exist where scripts copy them into `.dev.vars`.

### 4. Generate local worker artifacts

```bash
bun run setup:env
```

This does two things:

- `scripts/setup-env.sh` writes local secret files such as `apps/server/.dev.vars`, `apps/auth/.dev.vars`, `apps/admin/.dev.vars`, `apps/admin-ui/.env`, and `packages/db/.env`.
- `scripts/setup-env.ts` writes host-derived fragments, merges host-derived `vars` into each `wrangler.jsonc`, and generates local harness files such as `local-harness/Caddyfile` and `local-harness/mkcert-sans.txt`.

Generated artifacts are generator-owned. Do not hand-edit `.dev.vars`, `wrangler.jsonc.fragment.json`, generated host blocks, generated SQL migrations, OpenAPI output, or generated clients. Change the source input and rerun the generator.

Verify host config drift with:

```bash
bun run check:hosts
```

`bun run check` runs this automatically.

### 5. Prepare the database

For fast local development:

```bash
bun run db:push
```

For migration-backed environments:

```bash
bun run db:generate
bun run db:migrate
```

Do not hand-edit generated migration SQL. Change handwritten schema in `packages/db/src/schema/*`, run `bun run db:generate`, then review the generated migration.

All persisted instants should use UTC semantics. In Drizzle, timestamp columns should use `timestamp(..., { withTimezone: true })` so PostgreSQL stores `timestamptz` values. Tests in `packages/db/__tests__/migrations.spec.ts` enforce the important timestamp invariants.

### 6. Seed a usable dev tenant

```bash
bun run seed:dev
```

The seed script creates or updates:

- an organization with `DEFAULT_DEV_TENANT_SLUG`,
- an owner user with `LOCAL_DEV_TENANT_EMAIL`,
- a Better Auth credential account using `LOCAL_DEV_TENANT_PASSWORD`,
- an optional active custom-hostname row from `DEFAULT_DEV_CUSTOM_HOST`.

The default `.env.example` values create:

```text
tenant slug: acme
owner email: owner@acme.test
password: changeme123
custom host: app.acme.local.test
```

### 7. Run the app locally

```bash
bun run dev
```

Default development surfaces:

| Surface | Command | Port |
| --- | --- | --- |
| Tenant SPA (`apps/app`) | `turbo -F app dev` | `3000` |
| Operator SPA (`apps/admin-ui`) | `bun run dev:admin-ui` | `3001` |
| Server worker | `bun run dev:server` | `8787` |
| Auth worker | `bun run dev:auth` | `8788` |
| Admin worker | `turbo -F admin dev` | `8789` |
| Email preview | `bun run dev:email` | React Email default |
| Storybook | `bun run dev:storybook` | Storybook default |

The root `bun run dev` starts the main workspaces through Turbo. Use the focused commands when you are iterating on one worker or UI.

## Host-Accurate Local Mode

The normal Vite/Wrangler ports are useful, but multi-tenancy is host-sensitive. For the best local DX, use the host-accurate harness after `bun run setup:env`.

Default local hosts from `.env.example`:

```text
https://acme.app.lvh.me:8443
https://admin.lvh.me:8443
https://fallback.lvh.me:8443
https://app.acme.local.test:8443
```

Recommended flow:

```bash
bun run setup:env
local-harness/bootstrap.sh
caddy run --config local-harness/Caddyfile
```

Then run the workers/SPAs in their normal dev processes. The Caddyfile routes real-looking HTTPS hosts to the local ports so cookies, host parsing, Better Auth `allowedHosts`, SSO callback URLs, and custom-host behavior match production more closely.

Local dev tenant headers are controlled by:

```dotenv
ALLOW_DEV_TENANT_HEADER=true
ALLOW_DEV_TENANT_AUTH=false
DEFAULT_DEV_TENANT_SLUG=acme
```

These gates are fail-closed in production.

## Daily Development Workflow

Start with:

```bash
bun run fix
bun run check-types
```

When changing env or hostnames:

```bash
bun run setup:env
bun run check:hosts
```

When changing API routes:

```bash
bun run generate-openapi
bun run generate-client
```

When changing DB schema:

```bash
bun run db:generate
bun run db:migrate
```

For local-only schema sync:

```bash
bun run db:push
```

For focused tests:

```bash
bunx turbo -F server test
bunx turbo -F auth test
bunx turbo -F app test
bunx turbo -F admin test
bunx turbo -F @repo/db test
```

`bun run test` runs Turbo tests across workspaces. If multiple DB-migrating packages race against the same `DATABASE_TEST_URL`, run affected workspaces sequentially.

## Verification

Use these before opening a PR or deploying:

```bash
bun run fix
bun run check
bun run check-types
bun run test
bun run build
```

Known local warning:

- `apps/admin-ui/src/routes/_app.tenants.$slug.tsx` currently trips the filename convention warning because the filename follows TanStack Router route syntax.

Common verification notes:

- `bun run check` is lint/static checks plus host-config parity.
- `bun run check-types` type-checks all workspaces.
- `bun run test` is the aggregate Turbo/Vitest pass.
- Server tests may print Wrangler warnings about experimental `secrets` fields and missing local `SSO_KEY`/`CLOUDFLARE_API_TOKEN`; tests stub the paths that need them unless the suite explicitly exercises those integrations.

## Environment Model

Root `.env` is local truth. `wrangler.jsonc` contains committed non-secret development defaults. `.dev.vars` contains local secrets and is gitignored. Production secrets are set with `wrangler secret put`.

Do not use Wrangler `env.*` blocks unless you intentionally duplicate every binding; Wrangler environment blocks do not inherit bindings. This template uses deploy-time `--var KEY:value` overrides for production non-secrets instead.

Per-worker surface:

| Worker | Non-secret vars | Required secrets |
| --- | --- | --- |
| `apps/server` | app metadata, CORS, host config, CF for SaaS zone/config, branding, FCM provider | `FIREBASE_SERVICE_ACCOUNT_KEY_BASE64`, `RESEND_API_KEY`, `VAULT_MASTER_KEY`, `SSO_KEY`, `CLOUDFLARE_API_TOKEN` |
| `apps/auth` | app metadata, CORS, host config | `BETTER_AUTH_SECRET`, `RESEND_API_KEY` |
| `apps/admin` | `NODE_ENV`, `ADMIN_HOST` | `CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN` |
| `apps/app` | public routes plus `ASSETS` and `API` bindings | none |

See [`.agent-docs/env-vars.md`](.agent-docs/env-vars.md) for the full surface and artifact list.

## Database And Migrations

The database package owns:

- schema: `packages/db/src/schema/*`,
- migrations: `packages/db/src/migrations/*`,
- client factory: `packages/db/src/client.ts`,
- ID helpers: `packages/db/src/ids.ts`,
- live organization read seam: `liveOrganizations(executor)`.

Rules:

- Hand-edit schema, not generated SQL.
- Run `bun run db:generate` after schema changes.
- Review generated migrations before applying them.
- Use `bun run db:push` only for local development.
- Use `bun run db:migrate` for migration-backed environments.
- Keep all persisted instants UTC/timestamptz (`withTimezone: true` in Drizzle).
- Read live organizations through `liveOrganizations`; a structural test flags direct organization reads outside the allowlist.

## Authentication Model

Better Auth lives only in `apps/auth`. `apps/server` calls it through `AUTH` service-binding RPC.

Important invariants:

- `/api/auth/*` must go `apps/app -> apps/server -> AUTH.handleAuthRequest`.
- `AuthEntrypoint.fetch` returns 421 by design.
- `tenant === null` is accepted only for `/api/auth/jwks`.
- Better Auth `basePath` is `/api/auth`.
- Cookies are host-only, not cross-subdomain.
- Web sessions are short-lived; mobile sessions use the bearer plugin.
- `session.storeSessionInDatabase: true` is required because secondary storage/session behavior depends on DB persistence.
- JWT `aud` and `iss` are tenant URL-shaped. The `org` claim carries `{ id, host, sessionVersion }`.
- SSO callbacks are guarded under `/api/auth/sso/callback/:providerId`.

See [`.agent-docs/auth-architecture.md`](.agent-docs/auth-architecture.md).

## Tenancy And Cloudflare For SaaS

Tenant resolution is host-based:

- wildcard tenant subdomains resolve by slug,
- custom hostnames resolve through `tenant_custom_hostnames`,
- dev tenant headers are allowed only behind local gates,
- suspended tenants resolve distinctly from not-found tenants.

### Cloudflare For SaaS Architecture

Cloudflare for SaaS lets tenants attach their own hostnames, such as `app.customer.com`, to this platform without giving them access to your Cloudflare zone. Cloudflare terminates TLS for each custom hostname, validates the hostname/certificate, and routes traffic to the fallback origin you control. In this repo the fallback origin is served by `apps/app`, which then forwards `/api/*` to `apps/server`.

```mermaid
flowchart TD
  CustomerDNS["Customer DNS<br/>app.customer.com CNAME customers.example.test"]
  CFTenant["Cloudflare for SaaS<br/>Custom Hostname: app.customer.com"]
  Target["CNAME target<br/>customers.example.test"]
  Fallback["Fallback origin<br/>fallback.example.test"]
  App["apps/app<br/>tenant SPA edge shell"]
  Server["apps/server<br/>tenant API + tenancy resolver"]
  Auth["apps/auth<br/>Better Auth RPC only"]
  DB["PostgreSQL via Hyperdrive"]

  CustomerDNS --> CFTenant
  CFTenant --> Target
  Target --> Fallback
  Fallback --> App
  App -->|"/api/*"| Server
  App -->|"SPA assets"| App
  Server -->|"AUTH.handleAuthRequest"| Auth
  Server --> DB
  Auth --> DB
```

The application never trusts Cloudflare custom metadata for tenant lookup. Custom hostnames resolve through the `tenant_custom_hostnames` table, filtered to active rows and live organizations.

### Cloudflare For SaaS Setup

One-time Cloudflare setup:

1. Add your SaaS zone to Cloudflare.
2. Enable Cloudflare for SaaS on that zone.
3. Create a proxied fallback origin DNS record, for example `fallback.example.test`.
4. Configure that record as the zone's Cloudflare for SaaS fallback origin.
5. Create a proxied CNAME target, for example `customers.example.test -> fallback.example.test`. This is what customers point their hostnames at.
6. Create a zone-scoped API token with only:
   - `Zone:Read`
   - `SSL and Certificates:Edit`
   - `Custom Hostnames:Edit`
7. Put the token and zone id in `.env`, then run `bun run setup:env`.

Relevant `.env` keys:

```dotenv
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ZONE_ID=
FALLBACK_HOST=fallback.example.test
CUSTOM_HOST_CNAME_TARGET=customers.example.test
CUSTOM_HOST_VERIFICATION_LABEL=_app-example-verify
```

Customer setup for each hostname:

1. In the tenant UI/API, request the hostname, for example `app.customer.com`.
2. The server creates a `tenant_custom_hostnames` row in `pending_txt` and returns the TXT verification token.
3. The customer adds:

   ```text
   _app-example-verify.app.customer.com TXT <verification_token>
   app.customer.com CNAME customers.example.test
   ```

4. The tenant/admin verifies TXT. Only after TXT pre-verification does `apps/server` call the Cloudflare Custom Hostnames API.
5. The reconciler polls Cloudflare until hostname status and certificate status are ready.

```mermaid
sequenceDiagram
  participant Tenant as Tenant Admin
  participant API as apps/server
  participant DNS as Customer DNS
  participant CF as Cloudflare API
  participant Cron as Reconciler Cron

  Tenant->>API: Request custom hostname
  API->>API: Insert pending_txt + verification token
  API-->>Tenant: Return TXT instructions
  Tenant->>DNS: Add TXT + CNAME
  Tenant->>API: Verify TXT
  API->>DNS: Resolve TXT over DoH
  API->>CF: POST /custom_hostnames ssl.method=txt
  API->>API: Store cfHostnameId, awaiting_cf
  Cron->>CF: GET custom hostname details
  Cron->>API: Map CF status to lifecycle state
  API-->>Tenant: active when hostname + certificate are active
```

The create request intentionally stays small and non-Enterprise compatible:

```json
{
  "hostname": "app.customer.com",
  "ssl": {
    "method": "txt",
    "type": "dv",
    "settings": {
      "min_tls_version": "1.2"
    }
  }
}
```

This repo does not send `certificate_authority`, `custom_metadata`, uploaded certificates, wildcard flags, or custom origin metadata.

### Lifecycle States

```mermaid
stateDiagram-v2
  [*] --> pending_txt
  pending_txt --> awaiting_cf: TXT verified + CF hostname created
  awaiting_cf --> pre_validation: CF pending validation/issuance/deployment
  pre_validation --> active: hostname active + SSL active
  awaiting_cf --> failed: CF validation error
  pre_validation --> failed: CF validation error
  active --> removing: tenant removes hostname
  failed --> removing: tenant removes hostname
  removing --> removed: CF delete succeeds or 404 tombstone
```

State meanings:

| State | Meaning | Operator/customer action |
| --- | --- | --- |
| `pending_txt` | Tenant requested a hostname; app is waiting for your pre-verification TXT. | Customer adds TXT at `${CUSTOM_HOST_VERIFICATION_LABEL}.<host>`. |
| `awaiting_cf` | TXT pre-verification passed and the Cloudflare hostname row exists. | Wait for Cloudflare validation. |
| `pre_validation` | Cloudflare is validating hostname/certificate or deploying certs. | Ensure CNAME points to `CUSTOM_HOST_CNAME_TARGET`. |
| `active` | Cloudflare hostname and certificate are usable. | Traffic can use the custom hostname. |
| `failed` | Cloudflare returned validation errors or CAA/DNS problems. | Fix DNS/CAA, then retry through the lifecycle/reconciler. |
| `removing` | Delete requested; app is deleting/tombstoning Cloudflare state. | Wait for reconciler/delete completion. |
| `removed` | Terminal tombstone. | Hostname is no longer routed. |

### Plan Limits And Feature Boundaries

The implementation is intentionally compatible with Cloudflare for SaaS on Free, Pro, and Business plans:

| Capability | Free/Pro/Business | Enterprise |
| --- | --- | --- |
| Cloudflare for SaaS availability | Yes | Yes |
| Included custom hostnames | 100 | Custom |
| Maximum custom hostnames | 50,000 | Unlimited, but contact sales over 50,000 |
| Additional hostnames | Listed by Cloudflare as paid per additional hostname | Custom pricing |
| Custom analytics | Yes | Yes |
| Custom origin | Yes | Yes |
| Selectable certificate authority | No | Yes |
| Custom certificates / CSR support | No | Yes |
| Wildcard custom hostnames | No | Yes |
| mTLS for SaaS | No | Yes |
| Apex proxying/BYOIP | No | Paid add-on |
| Custom metadata | No | Paid add-on |

Because of those limits, this repo follows these rules:

- use Custom Hostnames with TXT validation,
- never send `certificate_authority`,
- never use `custom_metadata`,
- do not rely on custom certificates, mTLS for SaaS, wildcard custom hostnames, or apex proxying/BYOIP.

For apex customer domains, non-Enterprise Cloudflare for SaaS does not support pointing an A record at the SaaS target through apex proxying. Customers should use a subdomain such as `app.customer.com` with a CNAME to `CUSTOM_HOST_CNAME_TARGET`, unless the deployment has an Enterprise/apex-proxying add-on and the code/docs are explicitly updated for that.

### Operational Notes

- Source of truth for hostname readiness is Cloudflare's custom-hostname details endpoint: both hostname `status` and `ssl.status` should be `active`.
- A TLS handshake can succeed before Cloudflare reports `ssl.status = active`; the API state is what the app uses for onboarding.
- The `CLOUDFLARE_API_TOKEN` belongs only on `apps/server`; neither `apps/app` nor `apps/auth` needs it.
- `request.cf.hostMetadata` is not used. It depends on custom metadata, which is not available on non-Enterprise plans.
- The API token should be zone-scoped and rotated regularly. Do not use an account-wide token.
- If Cloudflare returns 429, `apps/server/src/modules/tenancy/cf-api.ts` retries with bounded exponential backoff.
- The reconciler is the recovery path for transient Cloudflare/API failures; it polls rows with Cloudflare IDs and maps Cloudflare status back to internal lifecycle states.

The server worker owns lifecycle code in `apps/server/src/modules/tenancy/` and reconciles via cron every minute.

## Authorization And Tenant Isolation

`@repo/authorization` is the policy engine. Hono routes call `authorize(resource, action, options)`.

Tenant-scoped resources must provide a resource loader so the policy engine can resolve ownership or organization:

- SSO provider routes load `{ id, organizationId }`.
- Custom hostname routes load the row scoped to the current tenant.
- User routes filter and load users through `member.organization_id`.
- Tenant audit-log listing is scoped to the current tenant; global/operator views belong in `apps/admin`.

This keeps role checks and data filters aligned instead of relying on route shape alone.

## Audit Logging

Audit events are registered in `packages/shared/src/audit.ts`.

- `critical`: written in the same DB transaction as the mutation.
- `bufferable`: sent through `AUDIT_LOG_QUEUE` and consumed asynchronously.

Tenant-visible audit rows must carry `organizationId`. Operator-driven tenant mutations may write dual-scope rows where needed: one global row for operator attribution and one tenant row for tenant visibility.

Audit metadata is redacted with the shared logger redactor before persistence.

## Rate Limiting

Primary request rate limiting uses a Durable Object backed by SQLite. The object key includes IP and host so one tenant cannot exhaust another tenant's shared-IP budget.

Production should not use KV as the enforcement path. KV is eventually consistent; the current middleware fails closed with a 503 if the Durable Object limiter is unavailable in production. KV fallback is retained only for development/test environments.

The Durable Object alarm prunes stale rows and stops rescheduling when empty. It does not call `storage.deleteAll()` because that can delete the SQLite schema on a warm object.

## Background Work

- Workflows: onboarding, email notification, push notification.
- Queue: audit log buffer plus DLQ.
- Cron:
  - `apps/server`: custom-hostname reconciliation every minute.
  - `apps/admin`: global-admin inactivity sweep at `0 12 * * *`.

Use `ctx.waitUntil()` for post-response work. Do not destructure `ctx`; call `ctx.waitUntil(...)` directly.

## Generated Artifacts

Common generated files:

| Artifact | Generator |
| --- | --- |
| `apps/*/.dev.vars` | `bun run setup:env` |
| `apps/*/wrangler.jsonc.fragment.json` | `bun run setup:env` |
| host-derived `wrangler.jsonc` vars | `bun run setup:env` |
| `local-harness/Caddyfile` | `bun run setup:env` |
| `packages/db/src/migrations/*` | `bun run db:generate` |
| `apps/server/openapi.cache.json` | `bun run generate-openapi` |
| generated HTTP clients | `bun run generate-client` |
| worker binding types | `turbo -F <worker> cf-typegen` where available |

If generated output is stale, rerun its generator. Do not patch generated output by hand unless the generator itself is broken and the exception is called out in review.

## Deployment

Build and deploy workers:

```bash
turbo -F server deploy
turbo -F auth deploy
turbo -F app deploy
bun run deploy:admin
```

Set production secrets once per worker:

```bash
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put SSO_KEY
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put CF_ACCESS_AUD
wrangler secret put CF_ACCESS_TEAM_DOMAIN
```

Use `--var KEY:value` for production non-secret overrides such as `NODE_ENV`, `APP_URL`, `CORS_ORIGINS`, `EMAIL_FROM`, hostnames, and branding. The deploy scripts already set `NODE_ENV:production` where needed.

Before production deploy:

```bash
bun run setup:env
bun run check
bun run check-types
bun run test
bun run build
```

## Troubleshooting

### Host config drift

Run:

```bash
bun run setup:env
bun run check:hosts
```

If it still fails, check the root `.env`; do not patch fragment files by hand.

### Auth returns 421

You are hitting `apps/auth` through fetch instead of `AuthEntrypoint.handleAuthRequest`. Tenant auth traffic must go through `apps/server`.

### Tenant cannot be resolved locally

Check:

- `DEFAULT_DEV_TENANT_SLUG`,
- `ALLOW_DEV_TENANT_HEADER`,
- `LOCAL_APP_WILDCARD_HOST`,
- whether `bun run seed:dev` has created the tenant,
- whether host-accurate Caddy routes are running.

### Wrangler complains about missing secrets in tests

The warning is expected when a suite does not exercise those secret-backed paths. Add real local values to `.env` and rerun `bun run setup:env` if you are testing SSO encryption or Cloudflare API calls directly.

### Future compatibility date in Miniflare

Keep `compatibility_date` current, but not newer than the installed Miniflare/workerd version supports. This repo currently uses the latest supported date for its installed toolchain. Upgrade Wrangler/Miniflare before moving the date forward.

### DB tests race in aggregate Turbo runs

Some packages create/drop schemas against `DATABASE_TEST_URL`. If an aggregate `bun run test` races those packages, run DB-touching workspaces sequentially:

```bash
bunx turbo -F @repo/db test
bunx turbo -F @repo/tenancy test
bunx turbo -F server test
```

## Documentation Map

- [`AGENTS.md`](AGENTS.md): root AI/developer guide and repo rules.
- [`.agent-docs/architecture.md`](.agent-docs/architecture.md): deployment topology and worker runtime architecture.
- [`.agent-docs/auth-architecture.md`](.agent-docs/auth-architecture.md): Better Auth worker and RPC model.
- [`.agent-docs/env-vars.md`](.agent-docs/env-vars.md): environment variable ownership and generated artifacts.
- [`.agent-docs/commands.md`](.agent-docs/commands.md): command reference.
- [`.agent-docs/audit-logging.md`](.agent-docs/audit-logging.md): audit event semantics.
- [`.agent-docs/db-transactions.md`](.agent-docs/db-transactions.md): transaction guidance.
- [`.agent-docs/error-handling.md`](.agent-docs/error-handling.md): API error shape and handling.
