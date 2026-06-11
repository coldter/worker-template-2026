# Status Module

Public health-check endpoints.

## Essentials
- `GET /health` is liveness: keep it lightweight and dependency-free, with a stable response shape (`{ status: "ok", version }`) for monitoring integrations; `version` is the Worker version id serving traffic.
- `GET /ready` is readiness: probes Postgres (per-request client via `dbMiddleware`) and KV with short timeouts and returns 503 when a probe fails. External healthchecks gate on it.
