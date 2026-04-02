import { describe, expect, it } from "vitest";

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
