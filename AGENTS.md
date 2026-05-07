# Project Guidelines

Multi-tenant Cloudflare Workers monorepo. Four workers: a tenant SPA shell (`apps/app`), a private API worker reached through service bindings (`apps/server`), a private auth worker (`apps/auth`), and an operator console (`apps/admin`) that serves `apps/admin-ui`. Shared packages (`packages/*`) carry the Drizzle schema, tenancy resolver, JWT verifier, authorization engine, and runtime helpers.

## Critical Rules
- Do not run `wrangler dev` or `bun dev` or start/stop servers (environment managed externally).
- Run `bun run fix` from repo root before addressing lint/type errors.
- No emojis in code or comments.
- Do not use `any` in handwritten code.
- Do not use non-null assertions (`!`) — use explicit guards (`if (!x) throw ...`) or the `firstOrThrow()` helper from `packages/db/src/helpers.ts` (`@repo/db`).
- `unknown` and `as unknown as <T>` are permitted ONLY at validated boundaries: Zod input parsing, OpenAPI response parsing, structured-log redaction (e.g., OTEL sensitive-field sanitization), vendor-SDK generic variance (Better Auth Session, Cloudflare Workflow class generics), and test fixture reflection. At any such site, either the adjacent runtime has a validator (Zod parse, typeof check, guard) OR the SDK's generics make the cast unavoidable. If you add a cast outside these categories, refactor or annotate with `// boundary: <reason>` and justify in review.

## Quick Reference
- Package manager: Bun
- Commands: see [.agent-docs/commands.md](.agent-docs/commands.md)
- Shared database package: `packages/db` (`@repo/db`) — schema, Drizzle client, migrations, `liveOrganizations` read seam.
- Tenancy package: `packages/tenancy` (`@repo/tenancy`) — host parsing, tenant resolution, cache invalidation.
- Auth-tokens package: `packages/auth-tokens` (`@repo/auth-tokens`) — verifier-side JWT helpers.
- Authorization package: `packages/authorization` (`@repo/authorization`) — schema, resources, evaluator, Hono and Drizzle adapters.
- Generated host config — never hand-edit. Re-run `bun run setup:env`. CI fails on drift via `bun run check:hosts` (chained from `bun run check`).
- Host-accurate local mode: `bun run setup:env && local-harness/bootstrap.sh && caddy run --config local-harness/Caddyfile`.

## Scoped Guides
- [Admin worker](apps/admin/AGENTS.md)
- [Admin UI](apps/admin-ui/AGENTS.md)
- [App worker (tenant SPA shell)](apps/app/AGENTS.md)
- [Auth worker](apps/auth/AGENTS.md)
- [Server worker](apps/server/AGENTS.md)
- [Auth-tokens package](packages/auth-tokens/AGENTS.md)
- [Authorization package](packages/authorization/AGENTS.md)
- [DB package](packages/db/AGENTS.md)
- [Email package](packages/email/AGENTS.md)
- [Shared package](packages/shared/AGENTS.md)
- [Tenancy package](packages/tenancy/AGENTS.md)

## Detailed Instructions
- [Monorepo architecture (deployment topology)](.agent-docs/architecture.md)
- [Auth architecture (multi-tenant, RPC-only auth worker)](.agent-docs/auth-architecture.md)
- [TypeScript standards](.agent-docs/typescript.md)
- [Error handling](.agent-docs/error-handling.md)
- [Shared package usage](.agent-docs/shared-package.md)
- [Response shapes](.agent-docs/response-shapes.md)
- [Database transactions](.agent-docs/db-transactions.md)
- [Audit logging](.agent-docs/audit-logging.md)
- [Environment variables and host-config fragments](.agent-docs/env-vars.md)
- [Commands](.agent-docs/commands.md)
