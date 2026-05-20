// Security headers middleware (B4.8). Wraps Hono's built-in `secureHeaders`
// so we can pull the per-tenant branding CDN host (`BRANDING_HOST`) out of
// the env and add it to `img-src`. Branding logos are the ONLY cross-origin
// asset the SPA loads; everything else stays `'self'`.
//
// CSP directives are deliberately strict:
//   - `script-src 'self'` — no `unsafe-inline`. The SPA bundle is hashed.
//   - `style-src 'self'` — no `unsafe-inline`. `applyBranding()` uses
//     `style.setProperty`, not `<style>` injection (B4.4).
//   - `img-src 'self' data: https://${BRANDING_HOST}` — branding logos.
//   - `frame-ancestors 'none'` — no embedding.
import {
  apiCspProfile,
  cspProfileToHonoOption,
  HSTS_VALUE,
  OTHER_HEADERS,
} from "@repo/shared";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "@/lib/context";

// Memoise `secureHeaders(...)` per `BRANDING_HOST` — the CSP options object
// depends only on the branding host, so rebuilding it per request is wasted.
const secureHeadersCache = new Map<string, MiddlewareHandler<AppEnv>>();

function buildSecureHeaders(branding: string): MiddlewareHandler<AppEnv> {
  return secureHeaders({
    contentSecurityPolicy: cspProfileToHonoOption(apiCspProfile(branding)),
    referrerPolicy: OTHER_HEADERS.referrerPolicy,
    strictTransportSecurity: HSTS_VALUE,
  });
}

export const securityHeadersMiddleware = createMiddleware<AppEnv>(
  async (c, next) => {
    const branding = c.env.BRANDING_HOST ?? "";
    let handler = secureHeadersCache.get(branding);
    if (!handler) {
      handler = buildSecureHeaders(branding);
      secureHeadersCache.set(branding, handler);
    }
    return handler(c, next);
  }
);
