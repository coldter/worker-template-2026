import { cors } from "hono/cors";

export function createCorsMiddleware() {
  // Parse the allowlist once per isolate instead of on every request. The env
  // value is immutable for an isolate's lifetime, so we only rebuild the Set if
  // the raw string changes (it does not in practice).
  let cachedRaw: string | undefined;
  let allowedOrigins = new Set<string>();

  return cors({
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    exposeHeaders: ["X-Request-Id", "X-RateLimit-Remaining"],
    maxAge: 86_400,
    origin: (origin, c) => {
      const raw = c.env.CORS_ORIGINS ?? "";
      if (raw !== cachedRaw) {
        cachedRaw = raw;
        allowedOrigins = new Set(raw.split(",").map((s: string) => s.trim()));
      }
      if (allowedOrigins.has(origin)) {
        return origin;
      }
      return "";
    },
  });
}
