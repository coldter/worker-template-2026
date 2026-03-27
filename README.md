# Worker Template

A production-ready monorepo template with authentication, RBAC, user management, audit logging, notifications, and background jobs.

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

## Documentation

See [CLAUDE.md](CLAUDE.md) for architecture details, coding conventions, and detailed guidelines.
