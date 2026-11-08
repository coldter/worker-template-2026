# Worker Template

Production-ready monorepo template for Cloudflare Workers with authentication, RBAC, user management, audit logging, notifications, and background jobs.

## Quickstart

```bash
git clone <repo-url> my-app
cd my-app
bun run template:init        # asks for app/brand details; use --dry-run to preview
cp .env.example .env         # fill in DATABASE_URL, secrets, and brand values
openssl rand -hex 32         # BETTER_AUTH_SECRET
openssl rand -hex 32         # VAULT_MASTER_KEY
bun run setup:env            # writes .dev.vars and app .env files
bun install
bun run db:push
bun run dev
```

Services:

| App         | URL                   |
| ----------- | --------------------- |
| apps/web    | http://localhost:3001 |
| apps/server | http://localhost:8787 |
| apps/auth   | http://localhost:8788 |

### Prerequisites

- Bun 1.4.4 (matches packageManager)
- Node.js ^22.18.0 || ^24.0.0 || >=26.0.0
- A reachable PostgreSQL instance
- bunx wrangler login for deploys

## Commands

```bash
bun run build            # Build the web app
bun run check            # Lint and static checks
bun run fix              # Auto-fix lint/format
bun run typecheck        # Type-check all workspaces
bun run test             # Run tests (Vitest)
bun run test:coverage    # Tests with coverage
```

## Database

```bash
bun run db:generate
bun run db:migrate
bun run db:push
bun run db:studio
```

## Deploy

Non-secret deploy values live in each wrangler.jsonc vars; override them with --var. Put secrets in wrangler secret put, never in git.

- apps/server: bunx turbo -F server deploy or cd apps/server && bun run deploy.
- apps/auth: cd apps/auth && bunx wrangler deploy --var NODE_ENV:production --var ENABLE_SIGNUP:false --var APP_URL:https://api.example.com --var CORS_ORIGINS:https://app.example.com.
- apps/web: bun run deploy:web; VITE_* brand values are baked in at build time from apps/web/.env.

## Structure

| Path                   | Purpose                                     |
| ---------------------- | ------------------------------------------- |
| apps/auth              | Better Auth worker (sessions, orgs, 2FA)    |
| apps/server            | Hono API with OpenAPI and Drizzle/Postgres  |
| apps/web               | React SPA (TanStack Router/Query, Zustand)  |
| packages/authorization | Policy/RBAC evaluation engine               |
| packages/db            | Drizzle schema, client, IDs, and migrations |
| packages/shared        | Shared constants, types, and helpers        |
| packages/email         | React Email templates and transport         |

## Tech Stack

- Runtime: Cloudflare Workers
- Package manager: Bun
- API: Hono with OpenAPI
- Database: PostgreSQL + Drizzle ORM (Hyperdrive)
- Auth: Better Auth
- Authorization: Custom RBAC
- Background jobs: Cloudflare Workflows
- Cache/state: Cloudflare KV + Durable Objects
- Email: React Email + Resend
- Web: React, TanStack Router, TanStack Query, Zustand, Tailwind CSS
- Notifications: FCM HTTP v1
