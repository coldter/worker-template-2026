# Worker Template

A production-ready monorepo template with authentication, RBAC, user management, audit logging, notifications, and background jobs.

## Quickstart

1. Clone the template:

   ```bash
   git clone <repo-url> my-app
   cd my-app
   ```

2. Personalize the template (renames `@repo/*` workspaces to your scope, rewrites brand defaults in `.env.example` and the brand `vars` in each `wrangler.jsonc`, optionally prefixes Cloudflare Worker names, then self-deletes):

   ```bash
   bun run template:init
   ```

   The script asks for an app name, package scope, company name, and support email. Pass `--dry-run` first if you want to preview changes.

3. Configure environment (the root `.env` is the source of truth; `bun run setup:env` propagates `VITE_*`/`APP_URL` to `apps/web/.env` and secrets to each `.dev.vars`):

   ```bash
   cp .env.example .env
   # Fill in DATABASE_URL, BETTER_AUTH_SECRET, RESEND_API_KEY, etc.
   # Generate a 32-byte auth secret:
   openssl rand -hex 32   # paste into BETTER_AUTH_SECRET
   ```

4. Generate per-workspace `.dev.vars` / `.env` files from the root `.env`:

   ```bash
   bun run setup:env
   ```

5. Install and push the database schema:

   ```bash
   bun install
   bun run db:push              # or: bun run db:generate && bun run db:migrate
   ```

6. Run everything in dev (turbo orchestrates all workers + the web app):

   ```bash
   bun run dev
   ```

   Services:

   | App           | URL                     |
   | ------------- | ----------------------- |
   | `apps/web`    | http://localhost:3001   |
   | `apps/server` | http://localhost:8787   |
   | `apps/auth`   | http://localhost:8788   |

### Prerequisites

- Bun 1.4+ (pinned to 1.4.2 via `packageManager`)
- Node.js `^22.18.0 || ^24.0.0 || >=26.0.0`
- A reachable PostgreSQL instance (local or remote)
- `wrangler login` for deploys (not required for local dev)

## Build

```bash
bun install                          # Install dependencies
bun run build                        # Build all workspaces
bun run check                        # Lint + static checks
bun run fix                          # Auto-fix lint/format issues
bun run check-types                  # Type-check all workspaces
bun run test                         # Run tests (Vitest)
bun run test:coverage                # Run tests with coverage
```

## Database

The root scripts delegate to the `@repo/db` workspace:

```bash
bun run db:generate                  # Generate migration files
bun run db:migrate                   # Apply migrations
bun run db:push                      # Push schema (local dev)
bun run db:studio                    # Open Drizzle Studio
```

## Deploy

Non-secret deploy values live in each `wrangler.jsonc` `vars` and default to localhost for local dev. Override them with `--var` flags at deploy time; never commit secrets (use `wrangler secret put` for those).

- `apps/server` deploy reads `APP_URL` and `CORS_ORIGINS` from the root `.env` and forwards them: run `bunx turbo -F server deploy` or `cd apps/server && bun run deploy`.
- `apps/auth` deploy keeps localhost defaults unless overridden, for example: `cd apps/auth && wrangler deploy --var NODE_ENV:production --var ENABLE_SIGNUP:false --var APP_URL:https://api.example.com --var CORS_ORIGINS:https://app.example.com`.
- `apps/web` deploys static assets and has no runtime `vars`; its `VITE_*` brand values are baked in at build time from `apps/web/.env` (`bun run deploy:web`).

## Requirements

- Bun 1.4+ (pinned to 1.4.2 via `packageManager`)
- Node.js `^22.18.0 || ^24.0.0 || >=26.0.0`
- PostgreSQL

## Structure

| Path                      | Purpose                                      |
| ------------------------- | -------------------------------------------- |
| `apps/auth`               | Better-Auth worker (sessions, orgs, 2FA)      |
| `apps/server`             | Main Hono API with OpenAPI + Drizzle/Postgres |
| `apps/web`                | React SPA (TanStack Router/Query, Zustand)    |
| `packages/authorization`  | Policy/RBAC evaluation engine                 |
| `packages/db`             | Drizzle schema, client, IDs, and migrations   |
| `packages/shared`         | Shared runtime constants, types, and helpers  |
| `packages/email`          | React Email templates + transport utilities   |

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Package Manager**: Bun
- **API**: Hono with OpenAPI
- **Database**: PostgreSQL + Drizzle ORM (via Hyperdrive)
- **Auth**: Better-Auth
- **Authorization**: Custom RBAC
- **Background Jobs**: Cloudflare Workflows
- **Cache/State**: Cloudflare KV + Durable Objects
- **Email**: React Email + Resend
- **Web**: React, TanStack Router, TanStack Query, Zustand, Tailwind CSS
- **Notifications**: FCM HTTP v1 (Workers-native, no firebase-admin)
