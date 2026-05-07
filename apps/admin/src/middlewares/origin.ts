import { createMiddleware } from "hono/factory";
import type { AdminEnv } from "@/env";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SAFE_FETCH_SITES = new Set(["same-origin", "none"]);

function rejectOrigin() {
  return Response.json(
    {
      error: {
        code: "ORIGIN_MISMATCH",
        message: "Origin not permitted",
      },
    },
    { status: 403 }
  );
}

/**
 * Mutation `Origin` header check (Audit-fix #5).
 *
 * - Safe methods skip the check (no CSRF surface).
 * - Non-safe methods MUST present an `Origin` matching `ADMIN_HOST`. When
 *   `Origin` is absent we fall back to `sec-fetch-site`: only `same-origin`
 *   and `none` are accepted; any other value (including missing) is rejected.
 * - `http://` is only accepted in non-production environments. Production
 *   demands `https://` so a stray dev-mode caller cannot CSRF the worker.
 */
export const adminOriginMiddleware = createMiddleware<AdminEnv>(
  async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) {
      return await next();
    }
    const origin = c.req.header("origin");
    const expectedHttps = `https://${c.env.ADMIN_HOST}`;
    const isProd = c.env.NODE_ENV === "production";

    if (!origin) {
      const fetchSite = c.req.header("sec-fetch-site");
      if (fetchSite && SAFE_FETCH_SITES.has(fetchSite)) {
        return await next();
      }
      return rejectOrigin();
    }

    if (origin === expectedHttps) {
      return await next();
    }
    if (!isProd && origin === `http://${c.env.ADMIN_HOST}`) {
      return await next();
    }
    return rejectOrigin();
  }
);
