import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { trimTrailingSlash } from "hono/trailing-slash";
import capabilitiesHandler from "@/auth/capabilities";
import type { AppEnv } from "@/lib/context";
import { setupDocs } from "@/lib/docs";
import { analyticsMiddleware } from "@/middlewares/analytics";
import { authContextMiddleware } from "@/middlewares/auth-context";
import { createCorsMiddleware } from "@/middlewares/cors";
import { dbMiddleware } from "@/middlewares/db";
import { errorHandler } from "@/middlewares/error";
import { rateLimitMiddleware } from "@/middlewares/rate-limit";
import { requestIdMiddleware } from "@/middlewares/request-id";
import auditLogsHandler from "@/modules/audit-logs/handler";
import notificationsHandler from "@/modules/notifications/handler";
import rolesHandler from "@/modules/roles/handler";
import statusHandler from "@/modules/status/handler";
import usersHandler from "@/modules/users/handler";

const app = new OpenAPIHono<AppEnv>();

// Global middleware
app.use("*", trimTrailingSlash());
app.use("*", secureHeaders());
app.use("*", requestIdMiddleware);
app.use("*", createCorsMiddleware());
app.use("*", analyticsMiddleware);
app.use("*", rateLimitMiddleware);

// Auth proxy - BEFORE db/auth middleware (no DB needed for auth requests)
const authProxy = new Hono<AppEnv>();
authProxy.all("/*", async (c) => {
  return c.env.AUTH.fetch(c.req.raw);
});
app.route("/api/auth", authProxy);

// Scoped middleware -- DB + auth for /api/*
app.use("/api/*", dbMiddleware);
app.use("/api/*", authContextMiddleware);

// Routes
app.route("/", statusHandler);
app.route("/api/roles", rolesHandler);
app.route("/api/users", usersHandler);
app.route("/api/audit-logs", auditLogsHandler);
app.route("/api/notifications", notificationsHandler);
app.route("/api/authorization/capabilities", capabilitiesHandler);

// OpenAPI docs + Scalar UI (non-production only)
setupDocs(app);

// Error handling
app.notFound((c) =>
  c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404)
);
app.onError(errorHandler);

export default app;
