import type { Principal } from "@repo/authorization";
import {
  type AuthorizationAttributes,
  type AuthorizationPrincipal,
  isAuthorizationOrgRole,
  isAuthorizationRole,
  VALID_STATUSES,
} from "./authorization-schema";
import { logger } from "./logger";

export type AuthorizationUserInput = {
  email?: string;
  emailVerified?: boolean;
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

  const requestedStatus = user.status ?? "active";
  const status = VALID_STATUSES.has(
    requestedStatus as AuthorizationAttributes["status"]
  )
    ? (requestedStatus as AuthorizationAttributes["status"])
    : "active";

  return {
    attributes: {
      email: user.email ?? "",
      emailVerified: user.emailVerified ?? false,
      status,
    },
    id: user.id,
    roles,
    ...(session.activeOrganizationId &&
    session.activeOrgRole &&
    isAuthorizationOrgRole(session.activeOrgRole)
      ? {
          organization: {
            id: session.activeOrganizationId,
            role: session.activeOrgRole,
          },
        }
      : {}),
  };
}

export function toBaseAuthorizationPrincipal(
  principal: AuthorizationPrincipal
): Principal {
  return {
    attributes: principal.attributes,
    id: principal.id,
    roles: principal.roles,
  };
}
