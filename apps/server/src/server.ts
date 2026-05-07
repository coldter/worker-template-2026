import { OpenAPIHono } from "@hono/zod-openapi";
import { trimTrailingSlash } from "hono/trailing-slash";
import capabilitiesHandler from "@/auth/capabilities";
import type { AppEnv } from "@/lib/context";
import { setupDocs } from "@/lib/docs";
import { analyticsMiddleware } from "@/middlewares/analytics";
import { auditContextMiddleware } from "@/middlewares/audit-context";
import { authContextMiddleware } from "@/middlewares/auth-context";
import { authProxyMiddleware } from "@/middlewares/auth-proxy";
import { createCorsMiddleware } from "@/middlewares/cors";
import { dbMiddleware } from "@/middlewares/db";
import { errorHandler } from "@/middlewares/error";
import { hostHeaderGuard } from "@/middlewares/host-guard";
import { invalidatorMiddleware } from "@/middlewares/invalidator";
import { rateLimitMiddleware } from "@/middlewares/rate-limit";
import { requestIdMiddleware } from "@/middlewares/request-id";
import { securityHeadersMiddleware } from "@/middlewares/security-headers";
import { tenancyMiddleware } from "@/middlewares/tenancy";
import auditLogsHandler from "@/modules/audit-logs/handler";
import invitationsHandler from "@/modules/invitations/handler";
import notificationsHandler from "@/modules/notifications/handler";
import ssoProvidersHandler from "@/modules/org-admin/sso/handler";
import rolesHandler from "@/modules/roles/handler";
import statusHandler from "@/modules/status/handler";
import customHostnamesHandler from "@/modules/tenancy/custom-hostnames/handler";
import tenancyCurrentHandler from "@/modules/tenancy/handler";
import usersHandler from "@/modules/users/handler";

const app = new OpenAPIHono<AppEnv>();

// C6 / Audit-fix #7 — middleware ordering audit.
//
// Expected stack (per spec):
//   hostGuard -> request-id -> cors -> tenancy -> auth-context ->
//   audit-context -> routes
//
// Actual order (with deviations annotated):
//   1. hostHeaderGuard       — host fail-closed (D6) MUST be outermost.
//   2. trimTrailingSlash     — non-load-bearing HTTP hygiene; runs early
//                              so downstream matchers see a canonical path.
//   3. securityHeadersMiddleware — added in C5; runs before request-id so
//                              the headers it emits do not depend on a
//                              correlation id (none of them do today).
//   4. requestIdMiddleware   — establishes the X-Request-Id correlation
//                              id used by every downstream middleware.
//   5. createCorsMiddleware  — pre-flight + CORS headers.
//   6. analyticsMiddleware   — observability beacon; runs after CORS so
//                              pre-flight requests are not double-counted.
//   7. rateLimitMiddleware   — runs before tenancy so unauthenticated
//                              flooders cannot exhaust the DB lookup
//                              budget for a tenant.
//
// Scoped to /api/*:
//   8. dbMiddleware          — must precede tenancy (tenancy reads from
//                              the same client).
//   9. tenancyMiddleware     — host -> tenant resolution.
//  10. invalidatorMiddleware — tenant-scoped fan-out helper.
//  11. authContextMiddleware — session resolution; tenancy is a hard
//                              prerequisite (D34).
//  12. auditContextMiddleware — must run after auth so audit rows can
//                              attribute the actor identity.
//
// Deviations from the spec ordering:
//  - securityHeadersMiddleware (#3) sits between hostGuard and request-id.
//    Justified: security-headers is host-derived, not request-id-derived,
//    so the header set is identical regardless of the correlation id.
//    Keeping it close to the host guard simplifies reasoning about which
//    headers leave the worker on hard-failed requests.
//  - rateLimitMiddleware (#7) is pre-tenancy, which the spec does not
//    pin. This is intentional: the budget is per-IP / per-host, not
//    per-tenant, and running it after tenancy would gift unauthenticated
//    floods a free DB lookup before the rate limiter cuts them off.
//
// apps/admin/src/server.ts uses a different stack (cfAccess -> db ->
// globalAdmin -> adminOrigin) because the admin worker runs behind
// Cloudflare Access; tenancy resolution does not apply.

// TODO(wave-2D): mount the CF-for-SaaS custom-hostname challenge handler at
// the very top of the stack so HTTP-01 / DCV probes never trip the host
// guard. Once `apps/server/src/modules/tenancy/well-known-challenge.ts`
// exports `wellKnownChallengeRouter` (an OpenAPIHono / Hono), enable the
// import + mount:
// import { wellKnownChallengeRouter } from "@/modules/tenancy/well-known-challenge";
// app.route("/.well-known/cf-custom-hostname-challenge", wellKnownChallengeRouter);

// Global middleware
// request-id runs BEFORE hostHeaderGuard so even 421 host-rejection
// responses carry an X-Request-Id (otherwise the correlation chain breaks
// at the very edge of the worker).
app.use("*", requestIdMiddleware);
app.use("*", hostHeaderGuard);
app.use("*", trimTrailingSlash());
app.use("*", securityHeadersMiddleware);
app.use("*", createCorsMiddleware());
app.use("*", analyticsMiddleware);
app.use("*", rateLimitMiddleware);

// Scoped middleware -- DB + tenant for /api/*
app.use("/api/*", dbMiddleware);
app.use("/api/*", tenancyMiddleware);
// Invalidator middleware runs after tenancy so handlers under /api/* can
// fan-out cache invalidation to peer workers (D68 asymmetry).
app.use("/api/*", invalidatorMiddleware);

// Tenancy bootstrap route — reachable WITHOUT a session so the SPA can
// fetch its branding/SSO config before login. Mounted before
// authContextMiddleware so it does not require a user (D78).
app.route("/api/tenancy/current", tenancyCurrentHandler);

// Auth + audit context for everything else under /api/*.
app.use("/api/*", authContextMiddleware);
app.use("/api/*", auditContextMiddleware);

// Auth proxy - tenant-aware, runs under /api/* middleware scope so tenant is
// resolved before the request is forwarded to the auth worker (A3.6).
app.all("/api/auth/*", authProxyMiddleware);

// Routes
app.route("/", statusHandler);
app.route("/api/org-admin/sso/providers", ssoProvidersHandler);
app.route("/api/roles", rolesHandler);
app.route("/api/users", usersHandler);
app.route("/api/audit-logs", auditLogsHandler);
app.route("/api/notifications", notificationsHandler);
app.route("/api/tenancy/custom-hostnames", customHostnamesHandler);
app.route("/api/invitations", invitationsHandler);
app.route("/api/authorization/capabilities", capabilitiesHandler);

// OpenAPI docs + Scalar UI (non-production only)
setupDocs(app);

// B4 (D40, D45) — tenant-SPA fallback. Anything that did not match an
// `/api/*` route is treated as an SPA navigation and forwarded to the
// `STATIC_ASSETS` service binding (apps/app, see wrangler.jsonc). The SPA
// worker enables `not_found_handling: "single-page-application"` so deep
// links resolve to `index.html` and the SPA router hydrates.
app.all("*", async (c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Route not found" } },
      404
    );
  }
  const assets = c.env.STATIC_ASSETS;
  if (!assets) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Route not found" } },
      404
    );
  }
  return await assets.fetch(c.req.raw);
});

// Error handling
app.notFound((c) =>
  c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404)
);
app.onError(errorHandler);

export default app;
