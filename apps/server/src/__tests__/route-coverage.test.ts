import type { RouteConfig } from "@hono/zod-openapi";
import { isAuthorizationGuard } from "@repo/authorization/hono";
import { describe, expect, it } from "vitest";

import auditLogsRoutes from "@/modules/audit-logs/routes";
import notificationsRoutes from "@/modules/notifications/routes";
import rolesRoutes from "@/modules/roles/routes";
import usersRoutes from "@/modules/users/routes";

function hasAuthorizationGuard(route: RouteConfig): boolean {
  if (!route.middleware) {
    return false;
  }
  const middleware = Array.isArray(route.middleware)
    ? route.middleware
    : [route.middleware];
  return middleware.some((handler) => isAuthorizationGuard(handler));
}

describe("route authorization coverage", () => {
  it("all user routes have authorization middleware", () => {
    for (const [name, route] of Object.entries(usersRoutes)) {
      expect(
        hasAuthorizationGuard(route),
        `users.${name} missing authorization guard`
      ).toBe(true);
    }
  });

  it("all role routes have authorization middleware", () => {
    for (const [name, route] of Object.entries(rolesRoutes)) {
      expect(
        hasAuthorizationGuard(route),
        `roles.${name} missing authorization guard`
      ).toBe(true);
    }
  });

  it("all audit-log routes have authorization middleware", () => {
    for (const [name, route] of Object.entries(auditLogsRoutes)) {
      expect(
        hasAuthorizationGuard(route),
        `audit-logs.${name} missing authorization guard`
      ).toBe(true);
    }
  });

  it("all notification routes have authorization middleware", () => {
    for (const [name, route] of Object.entries(notificationsRoutes)) {
      expect(
        hasAuthorizationGuard(route),
        `notifications.${name} missing authorization guard`
      ).toBe(true);
    }
  });
});
