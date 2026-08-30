import { describe, expect, it, vi } from "vitest";

// The Cloudflare Workers vitest pool cannot load `pg` (CJS) through its ESM
// shim. This test only inspects the static `middleware` array on each route,
// so the real db/postgres client is never executed -- stub the modules that
// transitively pull `pg` in so the route imports resolve.
vi.mock("pg", () => ({ Client: class {}, default: {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: async () => undefined,
}));

import auditLogsRoutes from "@/modules/audit-logs/routes";
import notificationsRoutes from "@/modules/notifications/routes";
import rolesRoutes from "@/modules/roles/routes";
import usersRoutes from "@/modules/users/routes";

// A route produced by createRouteConfig always has a non-empty middleware array
// because the required `guard` field is merged into it. This check verifies
// that every route went through createRouteConfig and not bare createRoute.
function hasGuard(route: { middleware?: unknown }): boolean {
  return Array.isArray(route.middleware) && route.middleware.length > 0;
}

describe("route authorization coverage", () => {
  it("all user routes have authorization middleware", () => {
    for (const [name, route] of Object.entries(usersRoutes)) {
      expect(
        hasGuard(route as { middleware?: unknown }),
        `users.${name} missing authorization guard`
      ).toBe(true);
    }
  });

  it("all role routes have authorization middleware", () => {
    for (const [name, route] of Object.entries(rolesRoutes)) {
      expect(
        hasGuard(route as { middleware?: unknown }),
        `roles.${name} missing authorization guard`
      ).toBe(true);
    }
  });

  it("all audit-log routes have authorization middleware", () => {
    for (const [name, route] of Object.entries(auditLogsRoutes)) {
      expect(
        hasGuard(route as { middleware?: unknown }),
        `audit-logs.${name} missing authorization guard`
      ).toBe(true);
    }
  });

  it("all notification routes have authorization middleware", () => {
    for (const [name, route] of Object.entries(notificationsRoutes)) {
      expect(
        hasGuard(route as { middleware?: unknown }),
        `notifications.${name} missing authorization guard`
      ).toBe(true);
    }
  });
});
