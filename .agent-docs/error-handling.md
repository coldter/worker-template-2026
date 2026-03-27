# Error Handling

- Never use empty catch blocks.
- Surface domain failures explicitly (throw or map to structured error responses).
- Log errors with enough context for debugging.
- Avoid success-shaped fallbacks in error paths.
- The global error handler lives in `apps/server/src/middlewares/error.ts`. It maps `HTTPException`, `DrizzleQueryError` (including Postgres unique-violation), and unhandled exceptions to `{ error: { code, message } }` JSON responses.
- Throw `HTTPException` from handlers and services to produce structured error responses with the correct HTTP status.
