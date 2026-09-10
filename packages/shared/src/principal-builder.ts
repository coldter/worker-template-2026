import {
  type AuthorizationPrincipal,
  isAuthorizationOrgRole,
  isAuthorizationRole,
} from "./authorization-schema";
import { logger } from "./logger";
import { isUserStatus } from "./users";

export type AuthorizationUserInput = {
  id: string;
  roleSlugs?: string[] | null;
  status?: string;
};

export type AuthorizationSessionInput = {
  activeOrganizationId?: string | null;
  activeOrgRole?: string | null;
};

export function buildAuthorizationPrincipal(
  user: AuthorizationUserInput,
  session: AuthorizationSessionInput = {}
): AuthorizationPrincipal {
  const allSlugs = user.roleSlugs ?? [];
  const roles = allSlugs.filter(isAuthorizationRole);

  if (roles.length !== allSlugs.length) {
    const droppedRoles = allSlugs.filter((role) => !isAuthorizationRole(role));
    logger.warn("Dropped unknown roles for user", {
      droppedRoles,
      userId: user.id,
    });
  }

  const requestedStatus = user.status;
  const status =
    requestedStatus !== undefined && isUserStatus(requestedStatus)
      ? requestedStatus
      : "deleted";

  const principal: AuthorizationPrincipal = {
    attributes: { status },
    id: user.id,
    roles,
  };

  if (
    session.activeOrganizationId &&
    session.activeOrgRole &&
    isAuthorizationOrgRole(session.activeOrgRole)
  ) {
    principal.organization = {
      id: session.activeOrganizationId,
      role: session.activeOrgRole,
    };
  }

  return principal;
}
