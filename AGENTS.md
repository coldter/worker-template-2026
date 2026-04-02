# Project Guidelines

Monorepo with a Cloudflare Worker API (`apps/server`), a dedicated auth worker (`apps/auth`), React web app (`apps/web`), and shared packages (`packages/*`). The database schema, Drizzle client, and migrations live in `packages/db` and are shared by both workers.

## Critical Rules
- Do not run `wrangler dev` or `bun dev` or start/stop servers (environment managed externally).
- Run `bun run fix` from repo root before addressing lint/type errors.
- No emojis in code or comments.
- Do not introduce new `any`, `unknown`, or non-null assertions (`!`) in handwritten code.

## Quick Reference
- Package manager: Bun
- Commands: see [.agent-docs/commands.md](.agent-docs/commands.md)
- Shared database package: `packages/db` (`@repo/db`) - schema, Drizzle client, migrations
- Authorization package: `packages/authorization` (`@repo/authorization`) - schema, resources, evaluator, Hono and Drizzle adapters

## Scoped Guides
- [Server](apps/server/AGENTS.md)
- [Auth](apps/auth/AGENTS.md)
- [Web](apps/web/AGENTS.md)
- [Authorization package](packages/authorization/AGENTS.md)
- [Email package](packages/email/AGENTS.md)
- [Shared package](packages/shared/AGENTS.md)



## Detailed Instructions
- [Monorepo architecture](.agent-docs/architecture.md)
- [Auth architecture](.agent-docs/auth-architecture.md)
- [TypeScript standards](.agent-docs/typescript.md)
- [Error handling](.agent-docs/error-handling.md)
- [Shared package usage](.agent-docs/shared-package.md)
- [Response shapes](.agent-docs/response-shapes.md)
- [Database transactions](.agent-docs/db-transactions.md)
