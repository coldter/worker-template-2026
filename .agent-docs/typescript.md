# TypeScript Standards

## Baseline

- `strict: true`, `noUncheckedIndexedAccess: true`, `isolatedModules: true`. No per-package overrides.
- Prefer `as const` objects over `enum`.
- Use `import type` for type-only imports.
- `nodejs_compat` is enabled, so Node built-ins are allowed when needed. Prefer platform-native APIs (`crypto`, `fetch`, Web Streams) first, and avoid Node-only assumptions in shared runtime code.
- Prefer `for...of` for iteration and `Promise.all` for independent async work.
- Use strict equality (`===`, `!==`) and template literals.
- Prefer `Array.isArray` over `instanceof Array`.
- Cloudflare binding types are generated into `CloudflareBindings` (run `wrangler types --env-interface CloudflareBindings`). Reference them via `AppEnv["Bindings"]` or directly as `CloudflareBindings` in DO/Workflow class generics.
- Do not import `process` or rely on Node.js globals; use `import { env } from "cloudflare:workers"` for environment access outside of Hono handlers.

## Null-safe row access

`noUncheckedIndexedAccess: true` means `arr[i]` returns `T | undefined`. Drizzle query results are arrays, so destructures need explicit guards.

Instead of this (will not compile under strict rules):

```ts
const [user] = await db.select().from(users).where(eq(users.id, id));
return user.name; // error: user is T | undefined
```

Use the helpers exported from `@repo/db`:

```ts
import { firstOrNull, firstOrThrow } from "@repo/db";

// returns T | null — caller handles the absent case
const user = await firstOrNull(
  db.select().from(users).where(eq(users.id, id))
);

// returns T — throws with the given message if the row is missing
const user = await firstOrThrow(
  db.select().from(users).where(eq(users.id, id)),
  "User not found"
);
```

When the destructure pattern is unavoidable (for example because you need more than one column object), keep the explicit `if (!row)` guard or `?? null` fallback — TypeScript will narrow it correctly.

## Allowed casts

No `any`. No `!` (non-null assertions). `unknown` and `as unknown as <T>` are permitted only at validated boundaries:

- Zod input parsing (the cast precedes a `.parse()`)
- OpenAPI response parsing
- Structured-log redaction (for example OTEL sensitive-field sanitization)
- Vendor-SDK generic variance (Better Auth `Session`, Cloudflare Workflow class generics)
- Test fixture reflection

Outside these categories, refactor the code. If you must keep the cast, annotate with `// boundary: <reason>` on the same line and justify in review.

Prefer `satisfies` over `as` whenever a literal is being narrowed against a type.

## Executor pattern for transactions

Services that perform multi-step writes accept an optional `executor` parameter so callers can pass in an active transaction. The executor type is exported from `@repo/db` (re-exported from `@repo/db/client`):

```ts
import { firstOrThrow, type Executor } from "@repo/db";

async function createUser(input, executor: Executor = c.var.db) {
  return executor.transaction(async (tx) => {
    const user = await firstOrThrow(
      tx.insert(users).values(input).returning(),
      "Failed to create user"
    );
    await auditLogService.create({ ... }, tx);
    return user;
  });
}
```

In Cloudflare Workers the root `db` is request-scoped and lives on `c.var.db` (see `apps/server/src/middlewares/db.ts`). Callers that need to compose multiple service calls into one atomic unit wrap with `c.var.db.transaction(async (tx) => { ... })` and pass `tx` into each service. When no executor is supplied, the service uses `c.var.db` and creates its own transaction. See `.agent-docs/db-transactions.md` for the full example.
