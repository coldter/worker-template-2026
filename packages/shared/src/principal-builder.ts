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
  const droppedRoles = allSlugs.filter((role) => !isAuthorizationRole(role));

  if (droppedRoles.length > 0) {
    logger.warn("Dropped unknown roles for user", {
      userId: user.id,
      droppedRoles,
    });
  }

  const requestedStatus = user.status ?? "active";
  const status = VALID_STATUSES.has(
    requestedStatus as AuthorizationAttributes["status"]
  )
    ? (requestedStatus as AuthorizationAttributes["status"])
    : "active";

  return {
    id: user.id,
    roles,
    attributes: {
      status,
      email: user.email ?? "",
      emailVerified: user.emailVerified ?? false,
    },
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
    id: principal.id,
    roles: principal.roles,
    attributes: principal.attributes,
  };
}
