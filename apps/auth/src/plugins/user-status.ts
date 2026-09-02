import type { DrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import { logger } from "@repo/shared/logger";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";
import { z } from "zod";

export const USER_STATUS = {
  ACTIVE: "active",
  DELETED: "deleted",
  INACTIVE: "inactive",
  LOCKED: "locked",
} as const;

export const USER_STATUS_VALUES = Object.values(USER_STATUS) as [
  (typeof USER_STATUS)[keyof typeof USER_STATUS],
  ...(typeof USER_STATUS)[keyof typeof USER_STATUS][],
];

export const userStatusSchema = z.enum(USER_STATUS_VALUES);

export type UserWithStatusFields = {
  status: z.infer<typeof userStatusSchema>;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  deactivatedReason: string | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  roleSlugs: string[];
  onboardingCompletedAt: Date | null;
  twoFactorEnabled: boolean;
};

async function setTwoFactorEnabled(
  db: DrizzleClient,
  userId: string,
  enabled: boolean
) {
  try {
    await db
      .update(schema.users)
      .set({ twoFactorEnabled: enabled })
      .where(eq(schema.users.id, userId));
  } catch (error) {
    logger.warn("Failed to sync twoFactorEnabled", {
      error: error instanceof Error ? error.message : String(error),
      userId,
    });
  }
}

export const enhancedUserPlugin = (db: DrizzleClient) =>
  ({
    hooks: {
      after: [
        {
          handler: createAuthMiddleware(async (ctx) => {
            const { returned } = ctx.context;
            if (returned instanceof APIError) {
              return;
            }

            const userId = ctx.context.session?.user.id;
            if (!userId) {
              return;
            }

            if (ctx.path === "/two-factor/enable") {
              await setTwoFactorEnabled(db, userId, true);
              return;
            }

            if (ctx.path === "/two-factor/disable") {
              await setTwoFactorEnabled(db, userId, false);
            }
          }),
          matcher: (context) =>
            context.path === "/two-factor/enable" ||
            context.path === "/two-factor/disable",
        },
      ],
    },
    id: "user-status",
    schema: {
      user: {
        fields: {
          deactivatedAt: {
            fieldName: "deactivatedAt",
            input: false,
            required: false,
            type: "date",
          },
          deactivatedBy: {
            fieldName: "deactivatedBy",
            input: false,
            required: false,
            type: "string",
          },
          deactivatedReason: {
            fieldName: "deactivatedReason",
            input: false,
            required: false,
            type: "string",
          },
          failedLoginAttempts: {
            defaultValue: 0,
            fieldName: "failedLoginAttempts",
            input: false,
            required: true,
            type: "number",
          },
          lockedUntil: {
            fieldName: "lockedUntil",
            input: false,
            required: false,
            type: "date",
          },
          onboardingCompletedAt: {
            fieldName: "onboardingCompletedAt",
            input: false,
            required: false,
            type: "date",
          },
          roleSlugs: {
            defaultValue: [],
            fieldName: "roleSlugs",
            input: false,
            required: true,
            type: "string[]",
          },
          status: {
            defaultValue: "active",
            fieldName: "status",
            input: false,
            required: true,
            type: "string",
          },

          twoFactorEnabled: {
            defaultValue: false,
            fieldName: "twoFactorEnabled",
            input: false,
            required: true,
            type: "boolean",
          },
        },
      },
    },
  }) satisfies BetterAuthPlugin;
