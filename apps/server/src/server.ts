import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";
import { methodNotAllowed } from "hono/method-not-allowed";
import { secureHeaders } from "hono/secure-headers";
import { trimTrailingSlash } from "hono/trailing-slash";
import capabilitiesHandler from "@/auth/capabilities";
import type { AppEnv } from "@/lib/context";
import { setupDocs } from "@/lib/docs";
import { analyticsMiddleware } from "@/middlewares/analytics";
import { auditContextMiddleware } from "@/middlewares/audit-context";
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

app.use("*", trimTrailingSlash());
app.use("*", secureHeaders());
app.use("*", requestIdMiddleware);
app.use("*", createCorsMiddleware());
app.use("*", analyticsMiddleware);
app.use("*", rateLimitMiddleware);
app.use(
  "*",
  methodNotAllowed({
    app,
    onMethodNotAllowed: (c, methods) =>
      c.json(
        {
          error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
        },
        405,
        { Allow: methods.join(", ") }
      ),
  })
);

const authProxy = new Hono<AppEnv>();
authProxy.all("/*", async (c) => {
  const request = new Request(c.req.raw, { cf: c.req.raw.cf });
  request.headers.set("X-Request-Id", c.get("requestId"));
  return c.env.AUTH.fetch(request);
});
app.route("/api/auth", authProxy);

app.use("/api/*", dbMiddleware);
app.use("/api/*", authContextMiddleware);
app.use("/api/*", auditContextMiddleware);

app.route("/", statusHandler);
app.route("/api/roles", rolesHandler);
app.route("/api/users", usersHandler);
app.route("/api/audit-logs", auditLogsHandler);
app.route("/api/notifications", notificationsHandler);
app.route("/api/authorization/capabilities", capabilitiesHandler);

setupDocs(app);

app.notFound((c) =>
  c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404)
);
app.onError(errorHandler);

export default app;
