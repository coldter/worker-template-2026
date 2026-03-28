import { createMiddleware } from "hono/factory";

import type { Env } from "@/lib/context";
import { getPermissionKey, type PermissionIdentifier } from "@/modules/roles";

type UserWithPermissions = { permissions?: string[] };

/**
 * Reads the pre-loaded permissions array from the session user.
 *
 * The enhancedSessionPlugin populates `user.permissions` on every
 * getSession call, so the permissions are always fresh. No DB query needed.
 */
function getUserPermissions(user: Record<string, unknown>): string[] {
  return (user as UserWithPermissions).permissions ?? [];
}

function hasPermissionKey(userPermissions: string[], key: string): boolean {
  return userPermissions.includes("*") || userPermissions.includes(key);
}

/**
 * Permission guard middleware
 *
 * Checks if the authenticated user has the specified permission.
 * Returns 401 if not authenticated, 403 if permission denied.
 *
 * Uses the pre-loaded `user.permissions` from the session (populated by
 * enhancedSessionPlugin) rather than querying the database.
 *
 * @param permission - Permission identifier (key or object)
 *
 * @example
 * ```typescript
 * app.get(
 *   "/users",
 *   isAuthenticated,
 *   requirePermission(PERMISSIONS.USERS.VIEW),
 *   handler
 * );
 * ```
 */
export const requirePermission = (permission: PermissionIdentifier) =>
  createMiddleware<Env>(async (c, next) => {
    const user = c.get("user");
    const permissionKey = getPermissionKey(permission);

    if (!user) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
        401
      );
    }

    if (!hasPermissionKey(getUserPermissions(user), permissionKey)) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Forbidden",
            details: `Missing required permission: ${permissionKey}`,
          },
        },
        403
      );
    }

    return next();
  });

/**
 * Multiple permission guard middleware (any required)
 *
 * Checks if the authenticated user has ANY of the specified permissions.
 * Returns 401 if not authenticated, 403 if no matching permission.
 *
 * @param permissions - Permission identifiers to check (user needs at least one)
 *
 * @example
 * ```typescript
 * app.get(
 *   "/content",
 *   requireAnyPermission(
 *     PERMISSIONS.USERS.VIEW,
 *     PERMISSIONS.ROLES.VIEW
 *   ),
 *   handler
 * );
 * ```
 */
export function requireAnyPermission(...permissions: PermissionIdentifier[]) {
  return createMiddleware<Env>(async (c, next) => {
    const user = c.get("user");

    if (!user) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
        401
      );
    }

    const userPermissions = getUserPermissions(user);
    const permissionKeys = permissions.map(getPermissionKey);
    const granted = permissionKeys.some((key) =>
      hasPermissionKey(userPermissions, key)
    );

    if (!granted) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Forbidden",
            details: `Missing required permission. Need one of: ${permissionKeys.join(", ")}`,
          },
        },
        403
      );
    }

    return next();
  });
}

/**
 * Multiple permission guard middleware (all required)
 *
 * Checks if the authenticated user has ALL of the specified permissions.
 * Returns 401 if not authenticated, 403 if missing any permission.
 *
 * @param permissions - Permission identifiers to check (user needs all of them)
 *
 * @example
 * ```typescript
 * app.get(
 *   "/admin/users",
 *   requireAllPermissions(
 *     PERMISSIONS.USERS.VIEW,
 *     PERMISSIONS.USERS.UPDATE
 *   ),
 *   handler
 * );
 * ```
 */
export function requireAllPermissions(...permissions: PermissionIdentifier[]) {
  return createMiddleware<Env>(async (c, next) => {
    const user = c.get("user");

    if (!user) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
        401
      );
    }

    const userPermissions = getUserPermissions(user);
    const permissionKeys = permissions.map(getPermissionKey);
    const missingPermissions = permissionKeys.filter(
      (key) => !hasPermissionKey(userPermissions, key)
    );

    if (missingPermissions.length > 0) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Forbidden",
            details: `Missing required permissions: ${missingPermissions.join(", ")}`,
          },
        },
        403
      );
    }

    return next();
  });
}
