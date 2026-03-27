import { HTTPException } from "hono/http-exception";

import type { DrizzleClient } from "@/db";

import {
  getPermissionKey,
  type PermissionIdentifier,
  type PermissionKey,
  type RoleSlug,
  SYSTEM_ROLES,
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

/**
 * Check if user is an admin (system role)
 */
export function isAdmin(user: UserWithRoles): boolean {
  return hasRole(user, SYSTEM_ROLES.ADMIN.slug);
}

/**
 * Check if user is a standard user (system role)
 */
export function isUser(user: UserWithRoles): boolean {
  return hasRole(user, SYSTEM_ROLES.USER.slug);
}

/**
 * Check if user has ANY of the specified roles
 */
export function hasAnyRole(user: UserWithRoles, roleList: RoleSlug[]): boolean {
  return roleList.some((role) => hasRole(user, role));
}

/**
 * Check if user has ALL of the specified roles
 */
export function hasAllRoles(
  user: UserWithRoles,
  roleList: RoleSlug[]
): boolean {
  return roleList.every((role) => hasRole(user, role));
}

/**
 * Throws HTTPException(403) if user lacks the specified role
 * Overloaded for type safety
 */
export function ensureRole(
  user: UserWithRoles,
  role: SystemRoleSlug | RoleSlug | string
): void {
  if (!hasRole(user, role)) {
    throw new HTTPException(403, { message: "Forbidden" });
  }
}

// ============================================
// PERMISSION CHECKS
// ============================================

/**
 * Check if a role has a specific permission
 */
export function isPermissionGrantedToRole(
  role: { permissions: PermissionKey[] },
  permission: PermissionIdentifier
): boolean {
  const permissionKey = getPermissionKey(permission) as PermissionKey;
  return (
    role.permissions.includes("*") || role.permissions.includes(permissionKey)
  );
}

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
 * Throws HTTPException(403) if user lacks the specified permission
 *
 * @param db - Drizzle database client
 * @param user - User object with roleSlugs
 * @param permission - Permission key or object to check
 */
export async function ensurePermission(
  db: DrizzleClient,
  user: UserWithRoles,
  permission: PermissionIdentifier
): Promise<void> {
  const granted = await hasPermission(db, user, permission);
  if (!granted) {
    throw new HTTPException(403, { message: "Forbidden" });
  }
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

/**
 * Check if user has ALL of the specified permissions
 */
export async function hasAllPermissions(
  db: DrizzleClient,
  user: UserWithRoles,
  permissionList: PermissionIdentifier[]
): Promise<boolean> {
  for (const permission of permissionList) {
    if (!(await hasPermission(db, user, permission))) {
      return false;
    }
  }
  return true;
}
