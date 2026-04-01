# Observability

## Logging

- `src/lib/logger.ts` exports a `logger` object with `debug`, `info`, `warn`, and `error` methods.
- Each call emits a single-line JSON string via `console.log` / `console.error` / etc., which Cloudflare Workers picks up in Workers Logs and `wrangler tail`.
- The Drizzle logger (`@repo/shared/logger-drizzle`) implements `Logger` from `drizzle-orm` and forwards SQL logs through the same `logger`.

## Analytics Engine

- `analyticsMiddleware` writes request metrics to `env.ANALYTICS` via `writeDataPoint`.
- `PRODUCT_ANALYTICS` is also configured in Wrangler for product-specific events, but there is no shared `trackEvent` utility in the current server source tree.
- Analytics should remain non-blocking for request flow.

## Guidelines
- Log errors with enough context (path, method, relevant IDs) for debugging.
- Add spans/logs around high-value business operations, not every helper function.
- Do not use OpenTelemetry; there is no OTel setup in this project.
