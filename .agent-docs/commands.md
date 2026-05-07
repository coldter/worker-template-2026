# Commands

Use Bun from repo root unless noted. Do not use `bun test`; this repo uses `bun run test` (Turbo + Vitest).

## Environment Setup

| Command | Purpose |
| --- | --- |
| `cp .env.example .env` | Create root env file (first time only) |
| `bun run setup:env` | Run `scripts/setup-env.sh` (writes `.dev.vars` + `apps/admin-ui/.env` from secrets) AND `bun scripts/setup-env.ts` (writes host-derived fragments + merges into each `wrangler.jsonc`). |
| `bun run setup:env:hosts` | Re-run only the TypeScript host-config generator (skips the secret copy). |
| `bun run check:hosts` | Verify generated host config matches the active `.env`; chained from `bun run check`. |
| `bun run template:init` | Personalise the template (rename `@repo/*` scope, brand defaults, optionally prefix worker names). One-shot, self-deletes. |

All env vars live in the root `.env` (single source of truth). See [env-vars.md](env-vars.md) for the fragment-merge details.

## Development

| Command | Purpose |
| --- | --- |
| `bun run dev` | Run every workspace in dev (Turbo, except `@repo/email`). |
| `bun run dev:server` | `apps/server` only (`wrangler dev` on :8787, inspector :9229). |
| `bun run dev:auth` | `apps/auth` only (`wrangler dev` on :8788, inspector :9230). |
| `bun run dev:admin-ui` | Vite dev server for the operator SPA. |
| `bun run dev:email` | React Email dev server. |
| `bun run dev:storybook` | Storybook for `apps/admin-ui`. |
| `turbo -F app dev` | `apps/app` Vite dev server. |
| `turbo -F admin dev` | `apps/admin` worker (`wrangler dev` on :8789). |

## Deploy

| Command | Purpose |
| --- | --- |
| `bun run deploy:admin` | Build `apps/admin-ui` then `wrangler deploy` for `apps/admin`. |
| `turbo -F server deploy` | Deploy `apps/server` (`--var NODE_ENV:production`). |
| `turbo -F auth deploy` | Deploy `apps/auth`. |
| `turbo -F app deploy` | Build SPA and deploy `apps/app`. |
| `turbo -F admin deploy` | Deploy operator worker only (skip SPA build). |
| `turbo -F server cf-typegen` | Regenerate server `CloudflareBindings`. |
| `turbo -F auth cf-typegen` | Regenerate auth `CloudflareBindings`. |

Production overrides for non-secret vars (`APP_URL`, `CORS_ORIGINS`, etc.) are passed via `--var KEY:value` at deploy time. Secrets use `wrangler secret put`. See [env-vars.md](env-vars.md).

## Database (Drizzle Kit)

Commands target `@repo/db`. Run from repo root.

| Command | Purpose |
| --- | --- |
| `bun run db:generate` | Generate migration files. |
| `bun run db:migrate` | Apply migrations. |
| `bun run db:push` | Push schema (local dev only). |
| `bun run db:studio` | Open Drizzle Studio. |
| `bun run seed:dev` | Provision the baseline dev tenant + owner user (`scripts/seed-dev.ts`). |

## Code Quality and Tests

| Command | Purpose |
| --- | --- |
| `bun run fix` | Run Ultracite autofixer (lint + format). Run first when issues appear. |
| `bun run check` | Lint + static checks + `check:hosts`. |
| `bun run check-types` | Type-check every workspace. |
| `bun run build` | Build all workspaces. |
| `bun run test` | Vitest across workspaces (Turbo). |
| `bun run test:watch` | Watch mode. |
| `bun run test:coverage` | Coverage reports. |
| `bun run test:scripts` | Run only `scripts/__tests__/`. |
| `bun run knip` | Detect unused exports / files. |

## OpenAPI / Generated Client

| Command | Purpose |
| --- | --- |
| `bun run generate-openapi` | Regenerate `apps/server/openapi.cache.json`. |
| `bun run generate-client` | Regenerate the `apps/admin-ui` HTTP client from the OpenAPI cache. |
