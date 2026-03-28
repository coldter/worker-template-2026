# Commands

Use Bun from repo root unless noted.

## Development and Deployment

| Command | Purpose |
| --- | --- |
| `wrangler dev` | Local development (run from `apps/server`) |
| `wrangler deploy --minify` | Deploy server to Cloudflare (run from `apps/server`) |
| `bun run deploy:web` | Build and deploy web app to Cloudflare (or `bun run deploy` from `apps/web`) |
| `wrangler types --env-interface CloudflareBindings` | Regenerate `CloudflareBindings` type from `wrangler.jsonc` |

## Code Quality

| Command | Purpose |
| --- | --- |
| `bun run fix` | Fix lint/format issues (run first) |
| `bun run check` | Lint + static checks without autofix |
| `bun run check-types` | Type-check all workspaces |
| `bun run test` | Run workspace tests (Turbo + Vitest) |
| `bun run build` | Build all workspaces |

## Database (Drizzle Kit)

| Command | Purpose |
| --- | --- |
| `bun run db:generate` | Generate server DB migration files |
| `bun run db:migrate` | Apply server DB migrations |
| `bun run db:push` | Push server schema in local development |

Do not use `bun test`; this repo uses `bun run test`.
