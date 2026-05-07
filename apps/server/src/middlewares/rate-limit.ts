import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/lib/context";

const WINDOW_SECONDS = 60;
const GUEST_LIMIT = 60;

function isProductionEnv(nodeEnv: string): boolean {
  return nodeEnv === "production";
}

export const rateLimitMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return next();
  }

  const ip =
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown";

  const host = (c.req.header("host") ?? "unknown").toLowerCase();

  // Include the host in the identifier so a noisy tenant cannot exhaust the
  // shared-IP budget for neighboring tenants (e.g., two sister tenants
  // behind a corporate proxy that shares a single CF-Connecting-IP).
  const identifier = `ip:${ip}:${host}`;
  const limit = GUEST_LIMIT;

  // DO-first approach
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
      const { logger } = await import("@repo/shared/logger");
      logger.warn("Rate limiter DO unavailable", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (isProductionEnv(c.env.NODE_ENV)) {
        return c.json(
          {
            error: {
              code: "RATE_LIMIT_UNAVAILABLE",
              message: "Rate limit unavailable",
            },
          },
          503
        );
      }
    }
  } else if (isProductionEnv(c.env.NODE_ENV)) {
    return c.json(
      {
        error: {
          code: "RATE_LIMIT_UNAVAILABLE",
          message: "Rate limit unavailable",
        },
      },
      503
    );
  }

  // Development/test fallback only. KV is eventually consistent and must not
  // be used as the production enforcement path.
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
  } catch {
    // executionCtx not available in test environment
  }

  await next();
});
