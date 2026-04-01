# Commands

Use Bun from repo root unless noted.

## Environment Setup

| Command | Purpose |
| --- | --- |
| `cp .env.example .env` | Create root env file (first time only) |
| `bun run setup:env` | Generate workspace `.dev.vars` and `.env` files from root `.env` |

All env vars live in the root `.env` (single source of truth). The `setup:env` script generates wrangler `.dev.vars` files for each worker and `.env` for the web app.

## Development and Deployment

| Command | Purpose |
| --- | --- |
| `bun run dev:server` | Start server worker dev flow (Turbo; wraps `wrangler dev`) |
| `bun run dev:auth` | Start auth worker dev flow |
| `bun run dev:web` | Start web app dev flow |
| `bun run preview:web` | Preview web app build locally |
| `bun run deploy:web` | Build and deploy web app |
| `turbo -F server deploy` | Deploy server worker |
| `turbo -F auth deploy` | Deploy auth worker |
| `turbo -F auth check-types` | Type-check auth worker |
| `turbo -F server cf-typegen` | Regenerate server `CloudflareBindings` type |
| `turbo -F auth cf-typegen` | Regenerate auth `CloudflareBindings` type |

## Code Quality

| Command | Purpose |
| --- | --- |
| `bun run fix` | Fix lint/format issues (run first) |
| `bun run check` | Lint + static checks without autofix |
| `bun run check-types` | Type-check all workspaces |
| `bun run test` | Run workspace tests (Turbo + Vitest) |
| `bun run test:watch` | Run tests in watch mode |
| `bun run test:coverage` | Run tests with coverage reports |
| `bun run build` | Build all workspaces |

## Database (Drizzle Kit)

Commands target `@repo/db` (not `apps/server`). Run from the repo root.

| Command | Purpose |
| --- | --- |
| `bun run db:generate` | Generate DB migration files (`@repo/db`) |
| `bun run db:migrate` | Apply DB migrations (`@repo/db`) |
| `bun run db:push` | Push schema in local development (`@repo/db`) |

Do not use `bun test`; this repo uses `bun run test`.
