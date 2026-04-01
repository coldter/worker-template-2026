import type { RoleSlug, SystemRoleSlug } from "./constants";
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
