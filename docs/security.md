# Security Posture

This document describes security-relevant defaults that ship with the template unchanged. They are intentionally left to the template consumer to tune based on deployment topology and threat model. Treat this page as required reading before deploying to production.

---

## 1. Single-session-per-user enforcement

**Where:** `apps/auth/src/instance.ts` — the `databaseHooks.session.create.before` handler deletes all existing sessions for a user on every new sign-in (`db.delete(schema.sessions).where(eq(schema.sessions.userId, session.userId))`).

**Behavior:** A user who signs in on web immediately loses their mobile session (and vice versa). There is no multi-device support.

**Why it ships this way:** Some security-conscious apps (banking, compliance-heavy workflows) genuinely want single-session enforcement. The template takes this as its default.

**If you want multi-device:** Delete the `.delete(schema.sessions)` block in `instance.ts`. Better Auth will then allow concurrent sessions per user, and your UI can expose an explicit "sign out everywhere" endpoint that calls it on demand.

**Recommended mitigation path:** Gate the enforcement behind an `AUTH_SINGLE_SESSION` env flag so both paths are supported:

```ts
if (env.AUTH_SINGLE_SESSION) {
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, session.userId));
}
```

---

## 2. Trusted origins configuration

**Where:** `apps/auth/src/instance.ts` — `trustedOrigins` is derived from the `CORS_ORIGINS` env var (`env.CORS_ORIGINS.split(",").map(s => s.trim())`).

**Behavior:** Unlike the Node template, the Cloudflare Worker auth build does NOT include a User-Agent-based mobile bypass. Only the origins explicitly listed in `CORS_ORIGINS` are trusted; requests from other origins are rejected by Better Auth's CORS check.

**Threat model:** Safe by default — there is no UA-spoofable path to auto-trust a request. The risk instead becomes operational: mis-configured `CORS_ORIGINS` (e.g. accidentally including `*` or a dev host) is the only way to widen the trust set.

**Recommended posture for production:**

- Keep `CORS_ORIGINS` limited to the exact hostnames of your deployed web and mobile-gateway origins.
- Do not re-introduce UA-based bypasses. If mobile clients cannot set an `Origin`, route them through a gateway that attaches one, or require signed client headers (`X-Client-Id` + `X-Client-Signature` verified against a server secret).
- Verify `CORS_ORIGINS` values at deploy time (type-checked Zod schema in `apps/auth/src/env.d.ts` / wrangler vars).

---

## 3. Rate limiter: Durable Object + Better Auth in-memory

Two independent rate limiters are in play. Both should be reviewed before production.

### 3a. App-level rate limiter (Durable Object)

**Where:** `apps/server/src/durable-objects/rate-limiter.ts` and `apps/server/src/middlewares/rate-limit.ts`.

**Design:** `RateLimiter` is a `DurableObject` keyed per identifier (e.g. `ip:1.2.3.4`). It holds a sliding window of request timestamps (`private timestamps: number[]`) in memory on the DO instance and trims entries older than `WINDOW_MS` (60s) on each `checkLimit` call.

**State & persistence semantics:**

- State is **in-memory on the DO**, not persisted to DO storage. If the DO is evicted (cold start, deploy, inactivity), the counter resets to zero.
- A single DO is globally consistent (one instance per identifier across all colos), so unlike per-colo caches there is no multi-replica undercounting.
- The `timestamps` array grows unbounded within the window — a sustained flood of requests could inflate memory for that single DO until the window slides.

**Fallback:** If the DO binding is unavailable, the middleware falls back to a KV-backed window counter (`apps/server/src/middlewares/rate-limit.ts`). KV is eventually consistent, so the fallback can undercount.

**Tradeoffs / hardening ideas:**

- Persist counters via `this.ctx.storage` so evictions do not zero the counter. Alarms can be used to expire old entries.
- Cap `timestamps.length` to protect against runaway memory.
- Differentiate per-route limits inside the DO (e.g. separate buckets for `/auth/*` vs general API) rather than relying on a single guest limit (`GUEST_LIMIT = 60`).

### 3b. Better Auth built-in rate limiter

**Where:** `apps/auth/src/instance.ts`, `rateLimit.storage: "secondary-storage"`.

**Behavior:** Better Auth's limiter currently points at `secondary-storage`, which the instance wires to the `CACHE` KV namespace via `secondaryStorage.{get,set,delete}`. This means the Better Auth rate counters share KV with the session cache — globally readable, eventually consistent. In a rapid burst scenario, KV propagation delay can let an attacker exceed `RATE_LIMIT_CONFIG.signIn.max` for a few seconds across colos before counters converge.

**Recommended mitigation path:** Move the Better Auth rate limiter onto the same DO design used in 3a, or switch to a shared backend with stronger consistency (D1 with a unique index, or a dedicated rate-limit DO per identifier). Treat the current `secondary-storage` setting as "good enough for dev, needs review for prod".

---

## 4. IP keying for rate limits

**Where:** `apps/server/src/middlewares/rate-limit.ts` — the `keyGenerator` logic:

```ts
const ip =
  c.req.header("CF-Connecting-IP") ??
  c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
  "unknown";
```

**Behavior:** `CF-Connecting-IP` is set by the Cloudflare edge and is NOT client-controllable for traffic ingressing through a Cloudflare zone — any value a client tries to send is overwritten. So on a Worker served through Cloudflare, this path is trusted.

The `X-Forwarded-For` fallback is present for environments where the Worker is invoked without the edge rewriting `CF-Connecting-IP` (local dev, direct worker-to-worker calls via service bindings). In that case the header is client-controllable. The code takes the leftmost hop, which is the client-asserted address in a forwarding chain.

The final `"unknown"` fallback means that when neither header is present, every unheadered caller shares one rate-limit bucket. That is effectively a trivial DoS vector against anonymous traffic.

**Status:** Partially mitigated (CF-Connecting-IP is trusted in prod). Remaining gaps:

- `"unknown"` shared bucket when both headers are absent — consider failing closed (`429`) instead of sharing a single bucket.
- `X-Forwarded-For` leftmost-hop parsing is spoofable off-platform; if you run the Worker behind another proxy, pick the last *trusted* hop instead of the first.

**Recommended mitigation path:**

```ts
const ip = c.req.header("CF-Connecting-IP");
if (!ip) {
  // Off-platform: decide between failing closed or logging + lenient fallback.
  return c.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, 429);
}
```

---

## Summary

| # | Issue | Severity | Action before production |
|---|-------|----------|--------------------------|
| 1 | Single-session enforcement | Product-behavior | Decide: keep, remove, or gate behind env flag. |
| 2 | Trusted origins | Safe default | Audit `CORS_ORIGINS`; do not re-introduce UA bypass. |
| 3a | Rate-limit DO state | Ops-correctness | Persist via DO storage; cap array growth. |
| 3b | Better Auth KV rate limiter | Ops-correctness | Move to DO or consistent backend for prod. |
| 4 | IP keying fallback | **Security bug** | Remove `"unknown"` shared bucket; fail closed. |

Items marked **Security bug** should be fixed before any public exposure — documentation alone does not mitigate them.
