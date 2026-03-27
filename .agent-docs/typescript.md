# TypeScript Standards

- Prefer `as const` objects over `enum`.
- Use `import type` for type-only imports.
- Do not use the `node:` prefix for built-ins; the runtime is Cloudflare Workers, not Node.js.
- Prefer `for...of` for iteration and `Promise.all` for independent async work.
- Use strict equality (`===`, `!==`) and template literals.
- Prefer `Array.isArray` over `instanceof Array`.
- Cloudflare binding types are generated into `CloudflareBindings` (run `wrangler types --env-interface CloudflareBindings`). Reference them via `AppEnv["Bindings"]` or directly as `CloudflareBindings` in DO/Workflow class generics.
- Do not import `process` or rely on Node.js globals; use `import { env } from "cloudflare:workers"` for environment access outside of Hono handlers.
