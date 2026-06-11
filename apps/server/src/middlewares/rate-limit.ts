import { logger } from "@repo/shared/logger";
import { createMiddleware } from "hono/factory";
import { getClientIp } from "@/lib/audit-context";
import type { AppEnv } from "@/lib/context";

const WINDOW_SECONDS = 60;
const GUEST_LIMIT = 60;

export const rateLimitMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return next();
  }

  // Only `CF-Connecting-IP` is trusted; `X-Forwarded-For` is client-controllable and would let an attacker mint unlimited buckets.
  const ip = getClientIp(c) ?? "unknown";

  const identifier = `ip:${ip}`;
  const limit = GUEST_LIMIT;

  const doBinding = c.env.RATE_LIMITER;
  if (doBinding) {
    try {
      const doId = doBinding.idFromName(identifier);
      const stub = doBinding.get(doId);
      const { allowed, remaining } = await stub.checkLimit(limit);

      if (!allowed) {
        return c.json(
          { error: { code: "RATE_LIMITED", message: "Too many requests" } },
          429
        );
      }

      c.header("X-RateLimit-Remaining", String(remaining));
      return next();
    } catch (err) {
      logger.warn("Rate limiter DO unavailable, falling back to KV", {
        error: err,
        requestId: c.get("requestId"),
      });
    }
  }

  const windowKey = `rl:${identifier}:${Math.floor(Date.now() / (WINDOW_SECONDS * 1000))}`;
  const raw = await c.env.CACHE.get(windowKey, "text");
  const count = raw ? Number.parseInt(raw, 10) : 0;

  if (count >= limit) {
    return c.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests" } },
      429
    );
  }

  try {
    c.executionCtx.waitUntil(
      (async () => {
        const current = await c.env.CACHE.get(windowKey, "text");
        const n = current ? Number.parseInt(current, 10) : 0;
        await c.env.CACHE.put(windowKey, String(n + 1), {
          expirationTtl: WINDOW_SECONDS * 2,
        });
      })()
    );
  } catch (err) {
    logger.debug("Rate limiter KV waitUntil unavailable", {
      error: err,
    });
  }

  await next();
});
