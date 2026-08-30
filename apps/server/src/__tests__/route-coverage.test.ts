import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ Client: class {}, default: {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: async () => undefined,
}));

import auditLogsRoutes from "@/modules/audit-logs/routes";
import notificationsRoutes from "@/modules/notifications/routes";
import rolesRoutes from "@/modules/roles/routes";
import usersRoutes from "@/modules/users/routes";

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
