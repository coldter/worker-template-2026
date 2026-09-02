import {
  activateUser,
  clearUserLockout,
  type DrizzleClient,
  deactivateUser,
  deleteUserSessions,
  firstOrThrow,
} from "@repo/db";
import { accounts, users } from "@repo/db/schema";
import { logger } from "@repo/shared/logger";
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
import { HTTPException } from "hono/http-exception";
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

async function safeNotifyStatusChange(
  userId: string,
  newStatus: string,
  previousStatus: string,
  reason: string | null
): Promise<void> {
  try {
    await onUserStatusChange(userId, newStatus, previousStatus, reason);
  } catch (error) {
    logger.error("onUserStatusChange hook failed", {
      error,
      newStatus,
      previousStatus,
      userId,
    });
  }
}

export const userService = {
  async activate(
    db: DrizzleClient,
    id: string,
    actorId: string,
    auditContext: AuditContext
  ): Promise<void> {
    let previousStatus = USER_STATUS.ACTIVE as string;

    await auditTransaction(db, auditContext, async (tx, audit) => {
      const [existing] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (!existing) {
        throw new UserNotFoundError(id);
      }
      previousStatus = existing.status;

      const updated = await activateUser(tx, id);
      if (!updated) {
        throw new UserNotFoundError(id);
      }

      audit.record({
        actorId,
        event: AUDIT_EVENTS.USER.ACTIVATED.event,
        targetId: id,
        targetType: TARGET_TYPES.USER,
      });
    });

    await safeNotifyStatusChange(id, USER_STATUS.ACTIVE, previousStatus, null);
  },

  async create(
    db: DrizzleClient,
    input: CreateUserInput,
    actorId: string,
    auditContext: AuditContext
  ): Promise<UserRecord> {
    const hashedPassword = await hashPassword(input.password);
    const email = input.email.trim().toLowerCase();

    return auditTransaction(db, auditContext, async (tx, audit) => {
      const user = await firstOrThrow(
        tx
          .insert(users)
          .values({
            email,
            emailVerified: false,
            failedLoginAttempts: 0,
            name: input.name,
            roleSlugs: input.roleSlugs,
            status: USER_STATUS.ACTIVE,
          })
          .returning(),
        "Failed to create user"
      );

      await tx.insert(accounts).values({
        accountId: user.id,
        password: hashedPassword,
        providerId: "credential",
        userId: user.id,
      });

      audit.record({
        actorId,
        event: AUDIT_EVENTS.USER.CREATED.event,
        metadata: {
          email,
          name: input.name,
          roleSlugs: input.roleSlugs,
        },
        targetId: user.id,
        targetType: TARGET_TYPES.USER,
      });

      return user;
    });
  },

  async deactivate(
    db: DrizzleClient,
    id: string,
    reason: string | null,
    actorId: string,
    auditContext: AuditContext
  ): Promise<void> {
    let previousStatus = USER_STATUS.ACTIVE as string;

    await auditTransaction(db, auditContext, async (tx, audit) => {
      const [existing] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (!existing) {
        throw new UserNotFoundError(id);
      }
      previousStatus = existing.status;

      const updated = await deactivateUser(tx, id, actorId, reason);
      if (!updated) {
        throw new UserNotFoundError(id);
      }

      await deleteUserSessions(tx, id);

      audit.record({
        actorId,
        event: AUDIT_EVENTS.USER.DEACTIVATED.event,
        metadata: { reason },
        targetId: id,
        targetType: TARGET_TYPES.USER,
      });
    });

    await safeNotifyStatusChange(
      id,
      USER_STATUS.INACTIVE,
      previousStatus,
      reason
    );
  },
  async find(db: DrizzleClient, query: ListUsersQuery) {
    const { search, status, role } = query;
    const { perPage, offset, sort, order } = getPaginationParams(query);

    const conditions: SQL[] = [];

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
          createdAt: users.createdAt,
          email: users.email,
          emailVerified: users.emailVerified,
          id: users.id,
          image: users.image,
          name: users.name,
          roleSlugs: users.roleSlugs,
          status: users.status,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(where)
        .orderBy(buildOrderBy(sortColumns, sort, order, users.createdAt))
        .limit(perPage)
        .offset(offset),
      db.select({ total: count() }).from(users).where(where),
    ]);

    return createPaginatedResponse({
      data,
      query,
      total: countResult?.total ?? 0,
    });
  },

  async findAccountSummaryById(db: DrizzleClient, id: string) {
    const [user] = await db
      .select({
        createdAt: users.createdAt,
        email: users.email,
        emailVerified: users.emailVerified,
        id: users.id,
        image: users.image,
        name: users.name,
        onboardingCompletedAt: users.onboardingCompletedAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return user ?? null;
  },

  async findAuthSubjectById(db: DrizzleClient, id: string) {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  },

  async findById(db: DrizzleClient, id: string): Promise<UserRecord | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user ?? null;
  },

  async findDetailById(db: DrizzleClient, id: string) {
    const [user] = await db
      .select({
        createdAt: users.createdAt,
        deactivatedAt: users.deactivatedAt,
        deactivatedBy: users.deactivatedBy,
        deactivatedReason: users.deactivatedReason,
        email: users.email,
        emailVerified: users.emailVerified,
        failedLoginAttempts: users.failedLoginAttempts,
        id: users.id,
        image: users.image,
        lockedUntil: users.lockedUntil,
        name: users.name,
        roleSlugs: users.roleSlugs,
        status: users.status,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user ?? null;
  },

  async unlock(
    db: DrizzleClient,
    id: string,
    actorId: string,
    auditContext: AuditContext
  ): Promise<void> {
    let previousStatus = USER_STATUS.ACTIVE as string;

    await auditTransaction(db, auditContext, async (tx, audit) => {
      const [existing] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (!existing) {
        throw new UserNotFoundError(id);
      }
      previousStatus = existing.status;

      const updated = await clearUserLockout(tx, id);
      if (!updated) {
        throw new UserNotFoundError(id);
      }

      audit.record({
        actorId,
        event: AUDIT_EVENTS.USER.UNLOCKED.event,
        targetId: id,
        targetType: TARGET_TYPES.USER,
      });
    });

    await safeNotifyStatusChange(id, USER_STATUS.ACTIVE, previousStatus, null);
  },

  async update(
    db: DrizzleClient,
    id: string,
    input: UpdateUserInput,
    actorId: string,
    auditContext: AuditContext
  ): Promise<UserRecord> {
    return auditTransaction(db, auditContext, async (tx, audit) => {
      const [existing] = await tx
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (!existing) {
        throw new UserNotFoundError(id);
      }

      const updatedUser = await firstOrThrow(
        tx
          .update(users)
          .set({
            ...(input.name !== undefined && { name: input.name }),
          })
          .where(eq(users.id, id))
          .returning({
            createdAt: users.createdAt,
            deactivatedAt: users.deactivatedAt,
            deactivatedBy: users.deactivatedBy,
            deactivatedReason: users.deactivatedReason,
            email: users.email,
            emailVerified: users.emailVerified,
            failedLoginAttempts: users.failedLoginAttempts,
            id: users.id,
            image: users.image,
            lockedUntil: users.lockedUntil,
            name: users.name,
            roleSlugs: users.roleSlugs,
            status: users.status,
            updatedAt: users.updatedAt,
          }),
        "Failed to update user"
      );

      const metadata = createChangeMetadata({ name: existing.name }, input, [
        "name",
      ]);

      if (metadata.changedFields && metadata.changedFields.length > 0) {
        audit.record({
          actorId,
          event: AUDIT_EVENTS.USER.UPDATED.event,
          metadata,
          targetId: id,
          targetType: TARGET_TYPES.USER,
        });
      }

      return updatedUser;
    });
  },

  async updateRoles(
    db: DrizzleClient,
    id: string,
    input: UpdateUserRolesInput,
    actorId: string,
    auditContext: AuditContext
  ): Promise<UserRecord> {
    if (id === actorId) {
      throw new HTTPException(403, { message: "Forbidden" });
    }

    return auditTransaction(db, auditContext, async (tx, audit) => {
      const [existing] = await tx
        .select({ roleSlugs: users.roleSlugs })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (!existing) {
        throw new UserNotFoundError(id);
      }

      const updatedUser = await firstOrThrow(
        tx
          .update(users)
          .set({ roleSlugs: input.roleSlugs })
          .where(eq(users.id, id))
          .returning({
            createdAt: users.createdAt,
            deactivatedAt: users.deactivatedAt,
            deactivatedBy: users.deactivatedBy,
            deactivatedReason: users.deactivatedReason,
            email: users.email,
            emailVerified: users.emailVerified,
            failedLoginAttempts: users.failedLoginAttempts,
            id: users.id,
            image: users.image,
            lockedUntil: users.lockedUntil,
            name: users.name,
            roleSlugs: users.roleSlugs,
            status: users.status,
            updatedAt: users.updatedAt,
          }),
        "Failed to update user roles"
      );

      const metadata: AuditLogMetadata = {
        changedFields: ["roleSlugs"],
        changes: {
          roleSlugs: {
            from: existing.roleSlugs,
            to: input.roleSlugs,
          },
        },
      };

      audit.record({
        actorId,
        event: AUDIT_EVENTS.ROLE.ASSIGNED.event,
        metadata,
        targetId: id,
        targetType: TARGET_TYPES.USER,
      });

      return updatedUser;
    });
  },
};
