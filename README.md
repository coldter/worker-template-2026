# Worker Template

A production-ready monorepo template with authentication, RBAC, user management, audit logging, notifications, and background jobs.

## Quickstart

1. Clone the template:

   ```bash
   git clone <repo-url> my-app
   cd my-app
   ```

2. Personalize the template (renames `@repo/*` workspaces to your scope, sets brand defaults in `.env.example`, optionally prefixes Cloudflare Worker names in each `wrangler.jsonc`, then self-deletes):

   ```bash
   bun run template:init
   ```

   The script asks for an app name, package scope, company name, and support email. Pass `--dry-run` first if you want to preview changes.

3. Configure environment (single source of truth at the repo root):

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

- Bun 1.3+
- Node.js 25+
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

```bash
bun run db:generate                  # Generate migration files
bun run db:migrate                   # Apply migrations
bun run db:push                      # Push schema (local dev)
bun run db:studio                    # Open Drizzle Studio
```

## Requirements

- Bun 1.3+
- Node.js 25+
- PostgreSQL

## Structure

| Path              | Purpose                                      |
| ----------------- | -------------------------------------------- |
| `apps/server`     | Main Hono API with OpenAPI + Drizzle/Postgres |
| `apps/web`        | React SPA (TanStack Router/Query, Zustand)    |
| `packages/shared` | Shared runtime constants, types, and helpers  |
| `packages/email`  | React Email templates + transport utilities   |

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
