# Observability

Three Cloudflare-native pillars, no third-party agents:

1. **Workers Logs** - structured JSON lines + invocation logs, head-sampled at 25%, 7-day retention. For reading individual events and debugging.
2. **Analytics Engine (AE)** - every request/batch/workflow writes a data point (no head sampling), 3-month retention, SQL-queryable. The source of truth for rates, percentiles, and trends.
3. **Workers Tracing** - automatic spans for handlers, fetch, and bindings, head-sampled at 1%. For latency-shape questions.

## Where to look first

| Question | Tool | How |
|---|---|---|
| Why did request X fail? | Workers Logs | Filter `requestId = <id from X-Request-Id>` - works across both workers |
| What is the 5xx rate / p95 latency? | AE | SQL on `server_requests` / `auth_requests` (examples below) |
| Did the last deploy cause this? | Logs or AE | Filter/group by `version`; `GET /health` returns the live version id |
| Where does a slow login spend time? | Tracing | Trace view; spans cross the server-to-auth service binding |
| Is the audit queue backed up? | AE | `queue` rows: `oldest_lag_ms` rising = consumer behind; `max_attempts` rising = poison messages or DB trouble |
| Did we lose audit events? | Workers Logs | Alert/filter on `message = "Audit log message dead-lettered"` |
| Are notifications being delivered? | AE | `workflow` rows: outcome + duration per workflow |
| Live debugging in dev/prod | wrangler | `bunx wrangler tail server --format pretty` (same for `auth`) |

## Logging

- `@repo/shared/logger` exports `logger` (`debug`/`info`/`warn`/`error`). Each call emits one JSON line via `console.*`; Workers Logs extracts and indexes every JSON key, so any field below is filterable in the dashboard Query Builder.
- The Drizzle logger (`@repo/shared/logger-drizzle`) forwards SQL logs through the same `logger` (dev only).

Field conventions (keep these names so saved queries keep working):

| Field | Meaning |
|---|---|
| `level`, `message`, `ts` | Set by the logger on every line |
| `requestId` | The client-visible `X-Request-Id`; on error logs and request-scoped warnings |
| `version` | Worker version id (from `CF_VERSION_METADATA`); on error logs |
| `error` | Pass the caught value itself, never `err.message`. Error instances serialize to `{ name, message, stack, cause? }`, so `error.name` / `error.message` are filterable and stacks are never lost |
| `queue`, `event`, `count` | Queue/audit context fields |

Sampling: `observability.logs.head_sampling_rate` is 0.25 in both workers. Head sampling drops *whole invocations including their error lines*, which is why exact error rates live in AE and error lines carry their own correlation ids. Bump to 1 temporarily when actively debugging.

## Request correlation

`requestIdMiddleware` echoes or generates `X-Request-Id` -> the auth proxy forwards it (re-attaching `cf`, which `new Request()` drops) -> the error middleware logs it plus the deploy version via `correlationContext`. One id from a user report finds every log line it produced, in both workers.

## Metrics (Analytics Engine)

Datasets: `server_requests` (binding `ANALYTICS`, server worker), `auth_requests` (binding `ANALYTICS`, auth worker), `server_events` (`PRODUCT_ANALYTICS`, reserved for product events - no `trackEvent` utility exists yet).

`blob1` discriminates record types; blobs/doubles are **positional - append, never reorder**:

| Type (`blob1`) | Dataset | blob2..N | double1..N | index1 |
|---|---|---|---|---|
| `api` | server_requests | method, path, country, colo, version | status, duration_ms | path |
| `queue` | server_requests | queue, outcome, version | message_count, duration_ms, oldest_lag_ms, max_attempts | queue |
| `workflow` | server_requests | workflow, outcome, version | duration_ms | workflow |
| `auth` | auth_requests | method, path, country, colo, version | status, duration_ms | path |
| `rpc` | auth_requests | rpc method, outcome, version | duration_ms | method |

Writers: `analyticsMiddleware` (api), `recordBatchMetrics` in `src/queues/router.ts` (queue), `runWithWorkflowMetrics` in `src/lib/workflow-metrics.ts` (workflow - wrap every workflow's `run()`), the middleware in `apps/auth/src/server.ts` (auth), `AuthEntrypoint.recordRpc` (rpc - covers the per-API-request `getSession` hot path that bypasses all HTTP middleware).

AE has no head sampling, but it adaptively samples *storage* under heavy write volume - always weight by `_sample_interval` instead of counting rows:

```sql
-- 5xx by path, last hour
SELECT blob3 AS path, SUM(_sample_interval) AS requests
FROM server_requests
WHERE timestamp > NOW() - INTERVAL '1' HOUR AND blob1 = 'api' AND double1 >= 500
GROUP BY path ORDER BY requests DESC;

-- p95 latency by path
SELECT blob3 AS path, quantileWeighted(0.95)(double2, _sample_interval) AS p95_ms
FROM server_requests
WHERE timestamp > NOW() - INTERVAL '1' HOUR AND blob1 = 'api'
GROUP BY path;

-- queue health
SELECT blob2 AS queue, MAX(double3) AS oldest_lag_ms, MAX(double4) AS max_attempts
FROM server_requests
WHERE timestamp > NOW() - INTERVAL '1' HOUR AND blob1 = 'queue'
GROUP BY queue;
```

Write rules: always behind `?.` and a try/catch that demotes failures to `logger.debug` - telemetry must never break the request. Limits per point: 20 blobs (16 KB), 20 doubles, 1 index (96 bytes).

## Tracing

`observability.traces` is on in both workers at 1%. Cloudflare instruments handler/fetch/binding calls (Hyperdrive, KV, DO, queues, service bindings) automatically - no code SDK, and traces export OTLP to third parties (Honeycomb/Grafana/Axiom) via dashboard config if ever needed. Untraced requests cost nothing; raise the rate while investigating.

## Health endpoints

- `GET /health` - liveness, dependency-free, returns `{ status, version }` so monitors can confirm which deploy serves traffic.
- `GET /ready` - probes Hyperdrive (`SELECT 1`) and KV with 2s timeouts; 503 + per-check booleans on failure. Point external uptime checks here; it sits behind the global rate limiter on purpose.

## Dead letters

`handleAuditLogDlq` logs every dead-lettered audit message at error level (identifying fields only - the body carries ip/user-agent) and acks it. The `"Audit log message dead-lettered"` message is the alert hook; the log line is the forensic record.

## Cost model

Logs + traces share one quota (paid plan: included millions of events/month, then $0.60/million); head sampling is the knob, and sampled-out events are free. AE writes and the version-metadata binding are effectively free at this scale. Current posture: logs 25%, traces 1%, AE everything. Deliberately not used: Logpush, Tail Workers (paid duplicates of Workers Logs here), code-level OpenTelemetry SDKs (forbidden - platform telemetry already speaks OTel).

## Dashboard setup (account-level, not in code)

- Saved Query Builder queries: `message = "Audit log message dead-lettered"`; `level = "error"` grouped by `version`; `requestId = <reported id>`.
- Account Notifications: alert on Workers error-rate spikes.
- AE is queryable over its SQL API for external dashboards (Grafana) without log egress.

## Guidelines

- Log errors with enough context (path, method, relevant IDs); pass the raw error value under `error`, never a flattened message.
- Add logs around high-value business operations, not every helper.
- New always-on telemetry must justify its volume: prefer one AE data point over per-request log lines.
- Never delete or reorder existing AE blob/double positions; extend by appending and update the table above.
