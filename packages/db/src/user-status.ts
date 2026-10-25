import { and, eq, gt, isNotNull, or, sql } from "drizzle-orm";

import type { Executor } from "./client";
import { sessions, users } from "./schema";

export const setUserLocked = async (
  executor: Executor,
  userId: string,
  lockedUntil: Date,
  failedLoginAttempts: number
): Promise<void> => {
  await executor
    .update(users)
    .set({ failedLoginAttempts, lockedUntil, status: "locked" })
    .where(eq(users.id, userId));
};

export const setUserFailedAttempts = async (
  executor: Executor,
  userId: string,
  failedLoginAttempts: number
): Promise<void> => {
  await executor
    .update(users)
    .set({ failedLoginAttempts })
    .where(eq(users.id, userId));
};

export const resetFailedLoginAttemptsByEmail = async (
  executor: Executor,
  email: string
): Promise<void> => {
  await executor
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null })
    .where(
      and(
        eq(users.email, email),
        or(gt(users.failedLoginAttempts, 0), isNotNull(users.lockedUntil))
      )
    );
};

export const clearUserLockout = async (
  executor: Executor,
  userId: string
): Promise<boolean> => {
  const result = await executor
    .update(users)
    .set({
      failedLoginAttempts: 0,
      lockedUntil: null,
      status: sql`case when ${users.status} = 'locked' then 'active' else ${users.status} end`,
    })
    .where(eq(users.id, userId))
    .returning({ id: users.id });

  return result.length > 0;
};

export const deactivateUser = async (
  executor: Executor,
  userId: string,
  actorId: string,
  reason: string | null
): Promise<boolean> => {
  const result = await executor
    .update(users)
    .set({
      deactivatedAt: new Date(),
      deactivatedBy: actorId,
      deactivatedReason: reason,
      status: "inactive",
    })
    .where(eq(users.id, userId))
    .returning({ id: users.id });

  return result.length > 0;
};

export const activateUser = async (
  executor: Executor,
  userId: string
): Promise<boolean> => {
  const result = await executor
    .update(users)
    .set({
      deactivatedAt: null,
      deactivatedBy: null,
      deactivatedReason: null,
      status: "active",
    })
    .where(eq(users.id, userId))
    .returning({ id: users.id });

  return result.length > 0;
};

export const deleteUserSessions = async (
  executor: Executor,
  userId: string
): Promise<void> => {
  await executor.delete(sessions).where(eq(sessions.userId, userId));
};
