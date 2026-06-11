import { and, eq, gt, isNotNull, or } from "drizzle-orm";
import type { Executor } from "./client";
import { sessions, users } from "./schema";

export async function setUserLocked(
  executor: Executor,
  userId: string,
  lockedUntil: Date,
  failedLoginAttempts: number
): Promise<void> {
  await executor
    .update(users)
    .set({ status: "locked", lockedUntil, failedLoginAttempts })
    .where(eq(users.id, userId));
}

export async function setUserFailedAttempts(
  executor: Executor,
  userId: string,
  failedLoginAttempts: number
): Promise<void> {
  await executor
    .update(users)
    .set({ failedLoginAttempts })
    .where(eq(users.id, userId));
}

export async function resetFailedLoginAttemptsByEmail(
  executor: Executor,
  email: string
): Promise<void> {
  // Guard the reset so clean sign-ins skip a no-op write (one dead tuple per
  // login otherwise).
  await executor
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null })
    .where(
      and(
        eq(users.email, email),
        or(gt(users.failedLoginAttempts, 0), isNotNull(users.lockedUntil))
      )
    );
}

export async function clearUserLockout(
  executor: Executor,
  userId: string
): Promise<boolean> {
  const result = await executor
    .update(users)
    .set({ status: "active", lockedUntil: null, failedLoginAttempts: 0 })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return result.length > 0;
}

export async function deactivateUser(
  executor: Executor,
  userId: string,
  actorId: string,
  reason: string | null
): Promise<boolean> {
  const result = await executor
    .update(users)
    .set({
      status: "inactive",
      deactivatedAt: new Date(),
      deactivatedBy: actorId,
      deactivatedReason: reason,
    })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return result.length > 0;
}

export async function activateUser(
  executor: Executor,
  userId: string
): Promise<boolean> {
  const result = await executor
    .update(users)
    .set({
      status: "active",
      deactivatedAt: null,
      deactivatedBy: null,
      deactivatedReason: null,
    })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return result.length > 0;
}

export async function deleteUserSessions(
  executor: Executor,
  userId: string
): Promise<void> {
  await executor.delete(sessions).where(eq(sessions.userId, userId));
}
