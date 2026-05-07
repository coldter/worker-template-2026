import { cors } from "hono/cors";

type CorsEnv = {
  CORS_ORIGINS?: string;
  WILDCARD_SUFFIX: string;
  ADMIN_HOST: string;
  FALLBACK_HOST: string;
  APP_WILDCARD_HOST?: string;
  NODE_ENV: string;
};

/**
 * Decide whether an inbound `Origin` is permitted for cross-origin requests.
 * Returns the origin string when allowed (echoed in `Access-Control-Allow-Origin`)
 * or `null` when rejected — `null` causes Hono's CORS helper to omit the
 * header entirely rather than echo an empty string. In production we reject
 * any `http://` scheme; the browser's CORS rules then fail closed.
 */
function isOriginAllowed(rawOrigin: string, env: CorsEnv): string | null {
  if (!rawOrigin) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    return null;
  }
  const isProd = env.NODE_ENV === "production";
  if (isProd && parsed.protocol !== "https:") {
    return null;
  }
  if (!isProd && parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const host = parsed.host.toLowerCase();

  // Static allow-list (CSV).
  const staticAllowed = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (staticAllowed.includes(rawOrigin)) {
    return rawOrigin;
  }

  // Tenant subdomain wildcard: any host under WILDCARD_SUFFIX (which is
  // stored with a leading dot, e.g. ".app.example.com") plus the admin and
  // fallback hosts.
  const wildcard = env.WILDCARD_SUFFIX;
  if (wildcard && host.endsWith(wildcard)) {
    return rawOrigin;
  }

  // Optional secondary app wildcard (mobile / split origin).
  const appWildcard = env.APP_WILDCARD_HOST;
  if (appWildcard && host.endsWith(appWildcard)) {
    return rawOrigin;
  }

  if (env.ADMIN_HOST && host === env.ADMIN_HOST.toLowerCase()) {
    return rawOrigin;
  }
  if (env.FALLBACK_HOST && host === env.FALLBACK_HOST.toLowerCase()) {
    return rawOrigin;
  }
  return null;
}

export function createCorsMiddleware() {
  return cors({
    origin: (origin, c) => {
      // boundary: hono/cors origin callback receives `origin` as a string;
      // the CloudflareBindings env shape is structurally compatible with the
      // `CorsEnv` subset we read here.
      const allowed = isOriginAllowed(origin ?? "", c.env as CorsEnv);
      // Returning `null` (vs `""`) makes Hono omit the
      // Access-Control-Allow-Origin header entirely for unauthorized origins.
      return allowed;
    },
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["X-Request-Id", "X-RateLimit-Remaining"],
    maxAge: 86_400,
    credentials: true,
  });
}
