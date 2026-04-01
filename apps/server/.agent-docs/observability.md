# Observability

## Logging

- `src/lib/logger.ts` exports a `logger` object with `debug`, `info`, `warn`, and `error` methods.
- Each call emits a single-line JSON string via `console.log` / `console.error` / etc., which Cloudflare Workers picks up in Workers Logs and `wrangler tail`.
- The Drizzle logger (`@repo/shared/logger-drizzle`) implements `Logger` from `drizzle-orm` and forwards SQL logs through the same `logger`.

## Analytics Engine

- Use `trackEvent` from `src/utils/analytics.ts` for structured event tracking.
- Writes to `env.PRODUCT_ANALYTICS` (Workers Analytics Engine). Failures are silently swallowed to never affect requests.
- The `analyticsMiddleware` calls `trackEvent` for every HTTP request.

## Guidelines
- Log errors with enough context (path, method, relevant IDs) for debugging.
- Add spans/logs around high-value business operations, not every helper function.
- Do not use OpenTelemetry; there is no OTel setup in this project.
