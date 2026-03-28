import type { DrizzleClient } from "@repo/db";

import {
  getPermissionKey,
  type PermissionIdentifier,
  type PermissionKey,
  type RoleSlug,
  type SystemRoleSlug,
} from "./constants";
import type { UserWithRoles } from "./types";

// ============================================
// ROLE CHECKS
// ============================================

/**
 * Check if user has a specific role
 * Overloaded for type safety - system roles get autocomplete
 */
export function hasRole(
  user: UserWithRoles,
  role: SystemRoleSlug | RoleSlug | string
): boolean {
  return user.roleSlugs.includes(role);
}

// ============================================
// PERMISSION CHECKS
// ============================================

/**
 * Check if user has a specific permission
 * Fetches user's roles from DB and checks their permissions
 *
 * @param db - Drizzle database client
 * @param user - User object with roleSlugs
 * @param permission - Permission key or object to check
 * @returns true if user has the permission (directly or via wildcard)
 */
export async function hasPermission(
  db: DrizzleClient,
  user: UserWithRoles,
  permission: PermissionIdentifier
): Promise<boolean> {
  if (!user.roleSlugs.length) {
    return false;
  }

  const userRoles = await db.query.roles.findMany({
    where: { slug: { in: user.roleSlugs }, deletedAt: { isNull: true } },
    columns: { permissions: true },
  });

  const castedUserRoles = userRoles as Array<{ permissions: PermissionKey[] }>;

  const permissionKey = getPermissionKey(permission) as PermissionKey;

  for (const role of castedUserRoles) {
    // Wildcard grants all permissions
    if (role.permissions.includes("*")) {
      return true;
    }
    if (role.permissions.includes(permissionKey)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if user has ANY of the specified permissions
 */
export async function hasAnyPermission(
  db: DrizzleClient,
  user: UserWithRoles,
  permissionList: PermissionIdentifier[]
): Promise<boolean> {
  for (const permission of permissionList) {
    if (await hasPermission(db, user, permission)) {
      return true;
    }
  }
  return false;
}
