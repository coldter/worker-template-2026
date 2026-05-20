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

// Fail-closed gate (Audit-fix #8): dev-auth flags only valid on a dev host.
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

// Outermost: production fail-closed guard, shared HTTP hygiene, host guard.
app.use("*", productionDevFlagGuard);
app.use("*", trimTrailingSlash());
// admin-ui Vite injects runtime <style> tags — 'unsafe-inline' on style-src.
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: cspProfileToHonoOption(ADMIN_CONSOLE_CSP),
    strictTransportSecurity: HSTS_VALUE,
  })
);
app.use("*", hostGuardMiddleware);

// Auth perimeter (D19 / D26 / D31). DB attaches first so cfAccessMiddleware
// can resolve the global-admin row (production CF Access path AND dev-mode
// email lookup) in the same request via `authenticateOperator` /
// `authenticateOperatorByEmail`.
app.use("/api/admin/*", dbMiddleware);
app.use("/api/admin/*", cfAccessMiddleware);
app.use("/api/admin/*", adminOriginMiddleware);

// Routes (full handler bodies arrive in B2; B1 ships read stubs).
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

// SPA fallback (D63): non-/api/* requests are forwarded to the ADMIN_UI
// assets binding which serves the admin-ui Vite build (../admin-ui/dist).
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
