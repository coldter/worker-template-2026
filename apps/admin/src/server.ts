import { OpenAPIHono } from "@hono/zod-openapi";
import {
  ADMIN_CONSOLE_CSP,
  cspProfileToHonoOption,
  HSTS_VALUE,
} from "@repo/shared";
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import { trimTrailingSlash } from "hono/trailing-slash";
import type { AdminEnv } from "@/env";
import { cfAccessMiddleware } from "@/middlewares/cf-access";
import { dbMiddleware } from "@/middlewares/db";
import { hostGuardMiddleware } from "@/middlewares/host-guard";
import { adminOriginMiddleware } from "@/middlewares/origin";
import auditLogsHandler from "@/modules/audit-logs/handler";
import globalAdminsHandler from "@/modules/global-admins/handler";
import systemHandler from "@/modules/system/handler";
import tenantsHandler from "@/modules/tenants/handler";

const app = new OpenAPIHono<AdminEnv>();

// Dev-auth flags must only be active on dev hosts; production must fail closed.
const DEV_HOST_PATTERNS: readonly RegExp[] = [
  /\.lvh\.me(?::\d+)?$/i,
  /\.localhost(?::\d+)?$/i,
  /^localhost(?::\d+)?$/i,
  /^127\.0\.0\.1(?::\d+)?$/,
];

function isDevHost(host: string): boolean {
  return DEV_HOST_PATTERNS.some((re) => re.test(host));
}

const productionDevFlagGuard = createMiddleware<AdminEnv>(async (c, next) => {
  const devFlagOn = Boolean(
    c.env.ALLOW_DEV_ADMIN_AUTH || c.env.LOCAL_DEV_ADMIN_EMAIL
  );
  if (c.env.NODE_ENV === "production" && devFlagOn) {
    return c.json(
      {
        error: {
          code: "MISCONFIGURED",
          message: "Dev-mode operator-auth flags must not be set in production",
        },
      },
      500
    );
  }
  if (devFlagOn && !isDevHost(c.env.ADMIN_HOST.toLowerCase())) {
    return c.json(
      {
        error: {
          code: "MISCONFIGURED",
          message: "Dev-mode operator-auth flags must not be set in production",
        },
      },
      500
    );
  }
  return await next();
});

app.use("*", productionDevFlagGuard);
app.use("*", trimTrailingSlash());
// admin-ui Vite injects runtime <style> tags, requiring 'unsafe-inline' on style-src.
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: cspProfileToHonoOption(ADMIN_CONSOLE_CSP),
    strictTransportSecurity: HSTS_VALUE,
  })
);
app.use("*", hostGuardMiddleware);

// DB must attach before cfAccessMiddleware so the operator lookup (production
// CF Access path and dev-mode email lookup) can resolve in the same request.
app.use("/api/admin/*", dbMiddleware);
app.use("/api/admin/*", cfAccessMiddleware);
app.use("/api/admin/*", adminOriginMiddleware);

app.get("/api/admin/me", (c) => {
  const admin = c.get("globalAdmin");
  return c.json({
    id: admin.id,
    email: admin.email,
    role: admin.role,
    status: admin.deactivatedAt ? "deactivated" : "active",
  });
});
app.route("/api/admin/tenants", tenantsHandler);
app.route("/api/admin/global-admins", globalAdminsHandler);
app.route("/api/admin/audit-logs", auditLogsHandler);
app.route("/api/admin/system", systemHandler);

// /api/* paths fall through to the OpenAPI notFound below so unknown API
// routes still return JSON errors rather than the SPA shell.
app.get("*", async (c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.notFound();
  }
  return c.env.ADMIN_UI.fetch(c.req.raw);
});

app.notFound((c) =>
  c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404)
);

export default app;
