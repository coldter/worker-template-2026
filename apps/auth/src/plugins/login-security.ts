import {
  clearUserLockout,
  type DrizzleClient,
  resetFailedLoginAttemptsByEmail,
  setUserFailedAttempts,
  setUserLocked,
} from "@repo/db";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { z } from "zod";

import {
  calculateLockoutExpiry,
  isLockoutExpired,
  LOCKOUT_CONFIG,
} from "../constants";
import { userStatusSchema } from "./user-status";

// createAuthMiddleware does not propagate endpoint body types; re-validate the field we need.
const emailBodySchema = z
  .object({
    email: z.string().email().optional(),
  })
  .passthrough();

function readEmailFromBody(body: unknown): string | undefined {
  const parsed = emailBodySchema.safeParse(body ?? {});
  return parsed.success ? parsed.data.email : undefined;
}

// 2FA users get `{ twoFactorRedirect: true }` -- not yet fully authenticated, so don't clear failed-attempt counters.
const twoFactorRedirectSchema = z
  .object({
    twoFactorRedirect: z.boolean().optional(),
  })
  .passthrough();

function isTwoFactorRedirect(returned: unknown): boolean {
  const parsed = twoFactorRedirectSchema.safeParse(returned);
  return parsed.success && parsed.data.twoFactorRedirect === true;
}

const twoFactorVerifySuccessSchema = z
  .object({
    user: z
      .object({
        email: z.string().email().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function readEmailFromTwoFactorVerifyResponse(
  returned: unknown
): string | undefined {
  const parsed = twoFactorVerifySuccessSchema.safeParse(returned);
  return parsed.success ? parsed.data.user?.email : undefined;
}

export const AUTH_ERROR_CODES = {
  ACCOUNT_DELETED: "ACCOUNT_DELETED",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
} as const;

export const loginSecurityPlugin = (db: DrizzleClient) => {
  return {
    id: "login-security",

    hooks: {
      before: [
        {
          matcher: (context) => context.path === "/sign-up/email",
          handler: createAuthMiddleware(async (ctx) => {
            const email = readEmailFromBody(ctx.body);
            if (!email) {
              return;
            }

            const existingUser = await db.query.users.findFirst({
              where: { email: { eq: email } },
              columns: { id: true },
            });

            if (existingUser) {
              throw new APIError("BAD_REQUEST", {
                message: "Unable to create account with this email",
              });
            }
          }),
        },
        {
          matcher: (context) => context.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const email = readEmailFromBody(ctx.body);
            if (!email) {
              return;
            }

            const user = await db.query.users.findFirst({
              where: { email: { eq: email } },
            });

            if (!user) {
              return;
            }

            const statusResult = userStatusSchema.safeParse(user.status);
            const status = statusResult.success ? statusResult.data : "active";

            if (status === "deleted") {
              throw new APIError("FORBIDDEN", {
                message: "This account has been deleted",
                code: AUTH_ERROR_CODES.ACCOUNT_DELETED,
              });
            }

            if (status === "inactive") {
              throw new APIError("FORBIDDEN", {
                message:
                  "This account has been deactivated. Please contact support.",
                code: AUTH_ERROR_CODES.ACCOUNT_INACTIVE,
              });
            }

            if (status === "locked") {
              if (!isLockoutExpired(user.lockedUntil)) {
                const remainingMinutes = user.lockedUntil
                  ? Math.ceil(
                      (user.lockedUntil.getTime() - Date.now()) / 60_000
                    )
                  : LOCKOUT_CONFIG.lockoutDurationMinutes;

                throw new APIError("TOO_MANY_REQUESTS", {
                  message: `Account is locked. Please try again in ${remainingMinutes} minute(s) or reset your password.`,
                  code: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
                });
              }

              await clearUserLockout(db, user.id);
            }
          }),
        },
      ],
      after: [
        {
          matcher: (context) => context.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const email = readEmailFromBody(ctx.body);
            if (!email) {
              return;
            }

            const returned = ctx.context.returned;
            const isFailure = returned instanceof APIError;

            if (isFailure) {
              const user = await db.query.users.findFirst({
                where: { email: { eq: email } },
              });

              if (!user) {
                return;
              }

              const newFailedAttempts = (user.failedLoginAttempts ?? 0) + 1;
              const shouldLock =
                newFailedAttempts >= LOCKOUT_CONFIG.maxFailedAttempts;

              if (shouldLock) {
                await setUserLocked(
                  db,
                  user.id,
                  calculateLockoutExpiry(),
                  newFailedAttempts
                );
                throw new APIError("TOO_MANY_REQUESTS", {
                  message: `Account locked after ${LOCKOUT_CONFIG.maxFailedAttempts} failed attempts. Try again in ${LOCKOUT_CONFIG.lockoutDurationMinutes} minutes.`,
                  code: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
                });
              }

              await setUserFailedAttempts(db, user.id, newFailedAttempts);

              throw new APIError("UNAUTHORIZED", {
                message: "Invalid credentials",
                code: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
              });
            }

            // Hold counter open across 2FA redirect; reset happens in the /two-factor/verify-otp after-hook.
            if (isTwoFactorRedirect(ctx.context.returned)) {
              return;
            }

            await resetFailedLoginAttemptsByEmail(db, email);
          }),
        },
        {
          matcher: (context) => context.path === "/two-factor/verify-otp",
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned;
            if (returned instanceof APIError) {
              return;
            }

            const email = readEmailFromTwoFactorVerifyResponse(returned);
            if (!email) {
              return;
            }

            await resetFailedLoginAttemptsByEmail(db, email);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
};
