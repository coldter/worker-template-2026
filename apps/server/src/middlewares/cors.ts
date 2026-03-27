import { cors } from "hono/cors";

export function createCorsMiddleware() {
  return cors({
    origin: (origin, c) => {
      const raw = c.env.CORS_ORIGINS ?? "";
      const allowed = raw.split(",").map((s: string) => s.trim());
      if (allowed.includes(origin)) {
        return origin;
      }
      return "";
    },
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["X-Request-Id", "X-RateLimit-Remaining"],
    maxAge: 86_400,
    credentials: true,
  });
}
