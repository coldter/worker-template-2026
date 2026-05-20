import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

/**
 * Drizzle Relations v2 - Centralized relations definition
 *
 * All table relations are defined in one place using defineRelations.
 * @see https://orm.drizzle.team/docs/relations-v1-v2
 */
export const relations = defineRelations(schema, (r) => ({
  users: {
    deactivatedByUser: r.one.users({
      from: r.users.deactivatedBy,
      to: r.users.id,
    }),
    sessions: r.many.sessions({
      from: r.users.id,
      to: r.sessions.userId,
    }),
    accounts: r.many.accounts({
      from: r.users.id,
      to: r.accounts.userId,
    }),
    // auditLogs relation removed: actor_id is now polymorphic (users, global_admins, system)
    // and no longer carries a FK to users. Query audit_logs.actor_id directly when needed.
    notifications: r.many.notifications({
      from: r.users.id,
      to: r.notifications.userId,
    }),
    notificationPreferences: r.many.notificationPreferences({
      from: r.users.id,
      to: r.notificationPreferences.userId,
    }),
    pushTokens: r.many.pushTokens({
      from: r.users.id,
      to: r.pushTokens.userId,
    }),
    members: r.many.members({
      from: r.users.id,
      to: r.members.userId,
    }),
    ssoProviders: r.many.ssoProviders({
      from: r.users.id,
      to: r.ssoProviders.userId,
    }),
  },
  sessions: {
    user: r.one.users({
      from: r.sessions.userId,
      to: r.users.id,
    }),
  },
  accounts: {
    user: r.one.users({
      from: r.accounts.userId,
      to: r.users.id,
    }),
  },
  // No auditLogs entry: actor_id is polymorphic (users, global_admins, system) and has no FK.
  notifications: {
    user: r.one.users({
      from: r.notifications.userId,
      to: r.users.id,
    }),
  },
  notificationPreferences: {
    user: r.one.users({
      from: r.notificationPreferences.userId,
      to: r.users.id,
    }),
  },
  pushTokens: {
    user: r.one.users({
      from: r.pushTokens.userId,
      to: r.users.id,
    }),
  },
  organizations: {
    members: r.many.members({
      from: r.organizations.id,
      to: r.members.organizationId,
    }),
    invitations: r.many.invitations({
      from: r.organizations.id,
      to: r.invitations.organizationId,
    }),
    tenantCustomHostnames: r.many.tenantCustomHostnames({
      from: r.organizations.id,
      to: r.tenantCustomHostnames.organizationId,
    }),
    ssoProviders: r.many.ssoProviders({
      from: r.organizations.id,
      to: r.ssoProviders.organizationId,
    }),
    reservedSlugs: r.many.reservedSlugs({
      from: r.organizations.id,
      to: r.reservedSlugs.organizationId,
    }),
  },
  members: {
    user: r.one.users({
      from: r.members.userId,
      to: r.users.id,
    }),
    organization: r.one.organizations({
      from: r.members.organizationId,
      to: r.organizations.id,
    }),
  },
  invitations: {
    inviter: r.one.users({
      from: r.invitations.inviterId,
      to: r.users.id,
      optional: true,
    }),
    organization: r.one.organizations({
      from: r.invitations.organizationId,
      to: r.organizations.id,
    }),
  },
  tenantCustomHostnames: {
    organization: r.one.organizations({
      from: r.tenantCustomHostnames.organizationId,
      to: r.organizations.id,
    }),
  },
  ssoProviders: {
    organization: r.one.organizations({
      from: r.ssoProviders.organizationId,
      to: r.organizations.id,
      optional: true,
    }),
    user: r.one.users({
      from: r.ssoProviders.userId,
      to: r.users.id,
      optional: true,
    }),
  },
  reservedSlugs: {
    organization: r.one.organizations({
      from: r.reservedSlugs.organizationId,
      to: r.organizations.id,
      optional: true,
    }),
  },
  globalAdmins: {
    createdByAdmin: r.one.globalAdmins({
      from: r.globalAdmins.createdBy,
      to: r.globalAdmins.id,
      alias: "createdBy",
      optional: true,
    }),
    deactivatedByAdmin: r.one.globalAdmins({
      from: r.globalAdmins.deactivatedBy,
      to: r.globalAdmins.id,
      alias: "deactivatedBy",
      optional: true,
    }),
  },
}));
