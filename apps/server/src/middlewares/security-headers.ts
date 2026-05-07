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
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "@/lib/context";

export const securityHeadersMiddleware = createMiddleware<AppEnv>(
  async (c, next) => {
    const branding = c.env.BRANDING_HOST;
    const imgSrc = ["'self'", "data:"];
    if (branding) {
      imgSrc.push(`https://${branding}`);
    }
    return secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc,
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
      referrerPolicy: "strict-origin-when-cross-origin",
      // 1y HSTS with subdomain coverage. Preload omitted intentionally so
      // operators can opt-in only after confirming every wildcard subdomain
      // serves HTTPS — the preload list is non-trivial to undo.
      strictTransportSecurity: "max-age=31536000; includeSubDomains",
    })(c, next);
  }
);
