import {
  activateUser,
  clearUserLockout,
  type DrizzleClient,
  deactivateUser,
  deleteUserSessions,
  firstOrThrow,
} from "@repo/db";
import { accounts, members, users } from "@repo/db/schema";
import { hashPassword } from "better-auth/crypto";
import {
  and,
  arrayContains,
  count,
  eq,
  ilike,
  or,
  type SQL,
} from "drizzle-orm";
import {
  type AuditContext,
  auditTransaction,
} from "@/modules/audit-logs/auditable";
import { AUDIT_EVENTS, TARGET_TYPES } from "@/modules/audit-logs/constants";
import type { AuditLogMetadata } from "@/modules/audit-logs/types";
import {
  buildOrderBy,
  createPaginatedResponse,
  getPaginationParams,
} from "@/utils/pagination";

import { USER_STATUS, USERS_SORT_COLUMNS } from "./constants";
import { UserNotFoundError } from "./errors";
import { createChangeMetadata } from "./helpers";
import type {
  CreateUserInput,
  ListUsersQuery,
  UpdateUserInput,
  UpdateUserRolesInput,
  UserRecord,
} from "./types";
import { onUserStatusChange } from "./user-status-hooks";

export const userService = {
  async find(db: DrizzleClient, query: ListUsersQuery, organizationId: string) {
    const { search, status, role } = query;
    const { perPage, offset, sort, order } = getPaginationParams(query);

    const conditions: SQL[] = [eq(members.organizationId, organizationId)];

    if (search) {
      const searchPattern = `%${search}%`;
      const nameMatch = ilike(users.name, searchPattern);
      const emailMatch = ilike(users.email, searchPattern);
      const searchCondition = or(nameMatch, emailMatch);
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    if (status) {
      conditions.push(eq(users.status, status));
    }

    if (role) {
      conditions.push(arrayContains(users.roleSlugs, [role]));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const sortColumns = {
      [USERS_SORT_COLUMNS.name]: users.name,
      [USERS_SORT_COLUMNS.email]: users.email,
      [USERS_SORT_COLUMNS.status]: users.status,
      [USERS_SORT_COLUMNS.createdAt]: users.createdAt,
      [USERS_SORT_COLUMNS.updatedAt]: users.updatedAt,
    };

    const [data, [countResult]] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          emailVerified: users.emailVerified,
          image: users.image,
          status: users.status,
          roleSlugs: users.roleSlugs,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .innerJoin(members, eq(members.userId, users.id))
        .where(where)
        .orderBy(buildOrderBy(sortColumns, sort, order, users.createdAt))
        .limit(perPage)
        .offset(offset),
      db
        .select({ total: count() })
        .from(users)
        .innerJoin(members, eq(members.userId, users.id))
        .where(where),
    ]);

    return createPaginatedResponse({
      data,
      total: countResult?.total ?? 0,
      query,
    });
  },

  async findById(
    db: DrizzleClient,
    id: string,
    organizationId?: string
  ): Promise<UserRecord | null> {
    if (organizationId) {
      const [row] = await db
        .select({ user: users })
        .from(users)
        .innerJoin(members, eq(members.userId, users.id))
        .where(
          and(eq(users.id, id), eq(members.organizationId, organizationId))
        )
        .limit(1);
      return row?.user ?? null;
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user ?? null;
  },

  async findAccountSummaryById(db: DrizzleClient, id: string) {
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        image: users.image,
        onboardingCompletedAt: users.onboardingCompletedAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return user ?? null;
  },

  async create(
    db: DrizzleClient,
    input: CreateUserInput,
    organizationId: string,
    actorId: string,
    auditContext: AuditContext
  ): Promise<UserRecord> {
    const hashedPassword = await hashPassword(input.password);

    return auditTransaction(db, auditContext, async (tx, audit) => {
      const user = await firstOrThrow(
        tx
          .insert(users)
          .values({
            name: input.name,
            email: input.email,
            emailVerified: false,
            status: USER_STATUS.ACTIVE,
            roleSlugs: input.roleSlugs,
            failedLoginAttempts: 0,
          })
          .returning(),
        "Failed to create user"
      );

      await tx.insert(accounts).values({
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hashedPassword,
      });

      audit.record({
        event: AUDIT_EVENTS.USER.CREATED.event,
        actorId,
        organizationId,
        targetId: user.id,
        targetType: TARGET_TYPES.USER,
        metadata: {
          name: input.name,
          email: input.email,
          roleSlugs: input.roleSlugs,
        },
      });

      return user;
    });
  },

  async update(
    db: DrizzleClient,
    organizationId: string,
    id: string,
    input: UpdateUserInput,
    actorId: string,
    auditContext: AuditContext
  ): Promise<UserRecord> {
    const existingUser = await this.findById(db, id, organizationId);
    if (!existingUser) {
      throw new UserNotFoundError(id);
    }

    return auditTransaction(db, auditContext, async (tx, audit) => {
      const updatedUser = await firstOrThrow(
        tx
          .update(users)
          .set({
            ...(input.name && { name: input.name }),
            ...(input.email && { email: input.email }),
          })
          .where(eq(users.id, id))
          .returning(),
        "Failed to update user"
      );

      const metadata = createChangeMetadata(
        { name: existingUser.name, email: existingUser.email },
        input,
        ["name", "email"]
      );

      if (metadata.changedFields && metadata.changedFields.length > 0) {
        audit.record({
          event: AUDIT_EVENTS.USER.UPDATED.event,
          actorId,
          organizationId,
          targetId: id,
          targetType: TARGET_TYPES.USER,
          metadata,
        });
      }

      return updatedUser;
    });
  },

  async updateRoles(
    db: DrizzleClient,
    organizationId: string,
    id: string,
    input: UpdateUserRolesInput,
    actorId: string,
    auditContext: AuditContext
  ): Promise<UserRecord> {
    const existingUser = await this.findById(db, id, organizationId);
    if (!existingUser) {
      throw new UserNotFoundError(id);
    }

    return auditTransaction(db, auditContext, async (tx, audit) => {
      const updatedUser = await firstOrThrow(
        tx
          .update(users)
          .set({ roleSlugs: input.roleSlugs })
          .where(eq(users.id, id))
          .returning(),
        "Failed to update user roles"
      );

      const metadata: AuditLogMetadata = {
        changes: {
          roleSlugs: {
            from: existingUser.roleSlugs,
            to: input.roleSlugs,
          },
        },
        changedFields: ["roleSlugs"],
      };

      audit.record({
        event: AUDIT_EVENTS.ROLE.ASSIGNED.event,
        actorId,
        organizationId,
        targetId: id,
        targetType: TARGET_TYPES.USER,
        metadata,
      });

      return updatedUser;
    });
  },

  async deactivate(
    db: DrizzleClient,
    organizationId: string,
    id: string,
    reason: string | null,
    actorId: string,
    auditContext: AuditContext
  ): Promise<void> {
    const existingUser = await this.findById(db, id, organizationId);
    if (!existingUser) {
      throw new UserNotFoundError(id);
    }

    await auditTransaction(db, auditContext, async (tx, audit) => {
      const updated = await deactivateUser(tx, id, actorId, reason);
      if (!updated) {
        throw new UserNotFoundError(id);
      }

      await deleteUserSessions(tx, id);

      audit.record({
        event: AUDIT_EVENTS.USER.DEACTIVATED.event,
        actorId,
        organizationId,
        targetId: id,
        targetType: TARGET_TYPES.USER,
        metadata: { reason },
      });
    });

    await onUserStatusChange(
      id,
      USER_STATUS.INACTIVE,
      existingUser.status,
      reason
    );
  },

  async activate(
    db: DrizzleClient,
    organizationId: string,
    id: string,
    actorId: string,
    auditContext: AuditContext
  ): Promise<void> {
    const existingUser = await this.findById(db, id, organizationId);
    if (!existingUser) {
      throw new UserNotFoundError(id);
    }

    await auditTransaction(db, auditContext, async (tx, audit) => {
      const updated = await activateUser(tx, id);
      if (!updated) {
        throw new UserNotFoundError(id);
      }

      audit.record({
        event: AUDIT_EVENTS.USER.ACTIVATED.event,
        actorId,
        organizationId,
        targetId: id,
        targetType: TARGET_TYPES.USER,
      });
    });

    await onUserStatusChange(id, USER_STATUS.ACTIVE, existingUser.status, null);
  },

  async unlock(
    db: DrizzleClient,
    organizationId: string,
    id: string,
    actorId: string,
    auditContext: AuditContext
  ): Promise<void> {
    const existingUser = await this.findById(db, id, organizationId);
    if (!existingUser) {
      throw new UserNotFoundError(id);
    }

    await auditTransaction(db, auditContext, async (tx, audit) => {
      const updated = await clearUserLockout(tx, id);
      if (!updated) {
        throw new UserNotFoundError(id);
      }

      audit.record({
        event: AUDIT_EVENTS.USER.UNLOCKED.event,
        actorId,
        organizationId,
        targetId: id,
        targetType: TARGET_TYPES.USER,
      });
    });

    await onUserStatusChange(id, USER_STATUS.ACTIVE, existingUser.status, null);
  },
};
