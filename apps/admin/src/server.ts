import { OpenAPIHono } from "@hono/zod-openapi";
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

// Fail-closed startup gate (Audit-fix #8). If a production deploy ever ships
// with `ALLOW_DEV_ADMIN_AUTH` or `LOCAL_DEV_ADMIN_EMAIL` set the dev-mode
// operator bypass in `cfAccessMiddleware` would skip CF Access entirely. Both
// flags are stripped from the committed wrangler.jsonc and only injected by
// the dev fragment, but a misconfigured secret store could still surface them
// in env. This middleware refuses every request before any auth code runs so
// the worker boots into a permanent 500 state until the misconfiguration is
// removed.
const productionDevFlagGuard = createMiddleware<AdminEnv>(async (c, next) => {
  if (
    c.env.NODE_ENV === "production" &&
    (c.env.ALLOW_DEV_ADMIN_AUTH || c.env.LOCAL_DEV_ADMIN_EMAIL)
  ) {
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
app.use("*", secureHeaders());
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
