import { type DrizzleClient, firstOrThrow } from "@repo/db";
import {
  notificationPreferences,
  notifications,
  pushTokens,
} from "@repo/db/schema";
import { and, asc, count, desc, eq, type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  buildOrderBy,
  createPaginatedResponse,
  getPaginationParams,
} from "@/utils/pagination";

import { NOTIFICATIONS_SORT_COLUMNS } from "./constants";
import type {
  ListNotificationsQuery,
  NotificationRecord,
  PreferencesRecord,
  PushTokenRecord,
  RegisterPushTokenInput,
  UpdatePreferencesInput,
} from "./types";

const SORT_COLUMNS = {
  [NOTIFICATIONS_SORT_COLUMNS.createdAt]: notifications.createdAt,
  [NOTIFICATIONS_SORT_COLUMNS.status]: notifications.status,
  [NOTIFICATIONS_SORT_COLUMNS.type]: notifications.type,
} as const;

export const notificationService = {
  async deactivatePushToken(
    db: DrizzleClient,
    tokenId: string,
    userId: string
  ): Promise<boolean> {
    const result = await db
      .update(pushTokens)
      .set({ isActive: false })
      .where(and(eq(pushTokens.id, tokenId), eq(pushTokens.userId, userId)))
      .returning({ id: pushTokens.id });
    return result.length > 0;
  },

  // remove tokens that FCM reports as invalid
  async deletePushTokenByToken(
    db: DrizzleClient,
    token: string
  ): Promise<boolean> {
    const result = await db
      .delete(pushTokens)
      .where(eq(pushTokens.token, token))
      .returning({ id: pushTokens.id });
    return result.length > 0;
  },

  async ensureDefaultPreferences(
    db: DrizzleClient,
    userId: string
  ): Promise<PreferencesRecord[]> {
    const existing = await this.getPreferences(db, userId);
    if (existing.length === 0) {
      return this.updatePreferences(db, userId, {
        emailEnabled: true,
        pushEnabled: true,
        smsEnabled: false,
      });
    }
    return existing;
  },

  async findById(
    db: DrizzleClient,
    notificationId: string
  ): Promise<NotificationRecord | null> {
    const [notification] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .limit(1);
    return notification ?? null;
  },

  async findByIdAndUser(
    db: DrizzleClient,
    notificationId: string,
    userId: string
  ): Promise<NotificationRecord | null> {
    const [notification] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId)
        )
      )
      .limit(1);
    return notification ?? null;
  },

  async getPreferences(
    db: DrizzleClient,
    userId: string
  ): Promise<PreferencesRecord[]> {
    return db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .orderBy(asc(notificationPreferences.typePattern));
  },

  async getUnreadCount(db: DrizzleClient, userId: string): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.channel, "push"),
          sql`${notifications.readAt} IS NULL`,
          sql`${notifications.status} IN ('sent', 'delivered')`
        )
      );
    return result?.count ?? 0;
  },
  async listByUser(
    db: DrizzleClient,
    userId: string,
    query: ListNotificationsQuery
  ) {
    const { perPage, offset, sort, order } = getPaginationParams(query);

    const conditions: SQL[] = [eq(notifications.userId, userId)];

    if (query.type) {
      conditions.push(eq(notifications.type, query.type));
    }

    if (query.status) {
      // explicit status filter takes precedence over unreadOnly
      conditions.push(eq(notifications.status, query.status));
    } else if (query.unreadOnly) {
      conditions.push(eq(notifications.channel, "push"));
      conditions.push(sql`${notifications.readAt} IS NULL`);
      conditions.push(sql`${notifications.status} IN ('sent', 'delivered')`);
    }

    if (query.channel) {
      conditions.push(eq(notifications.channel, query.channel));
    }

    const where = and(...conditions);

    const notificationsList = await db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(buildOrderBy(SORT_COLUMNS, sort, order, SORT_COLUMNS.createdAt))
      .limit(perPage)
      .offset(offset);

    const [countResult] = await db
      .select({ total: count() })
      .from(notifications)
      .where(where);

    return createPaginatedResponse({
      data: notificationsList,
      query,
      total: countResult?.total ?? 0,
    });
  },

  async listPushTokens(
    db: DrizzleClient,
    userId: string
  ): Promise<PushTokenRecord[]> {
    return db
      .select()
      .from(pushTokens)
      .where(and(eq(pushTokens.userId, userId), eq(pushTokens.isActive, true)))
      .orderBy(desc(pushTokens.createdAt));
  },

  async markAllAsRead(db: DrizzleClient, userId: string): Promise<number> {
    const result = await db
      .update(notifications)
      .set({
        readAt: new Date(),
      })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.channel, "push"),
          sql`${notifications.readAt} IS NULL`,
          sql`${notifications.status} IN ('sent', 'delivered')`
        )
      )
      .returning({ id: notifications.id });
    return result.length;
  },

  async markAsRead(
    db: DrizzleClient,
    notificationId: string,
    userId: string
  ): Promise<NotificationRecord | null> {
    const [updated] = await db
      .update(notifications)
      .set({
        readAt: new Date(),
      })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
          eq(notifications.channel, "push"),
          sql`${notifications.readAt} IS NULL`
        )
      )
      .returning();
    return updated ?? null;
  },

  async registerPushToken(
    db: DrizzleClient,
    userId: string,
    sessionId: string,
    input: RegisterPushTokenInput
  ): Promise<PushTokenRecord> {
    const [existing] = await db
      .select()
      .from(pushTokens)
      .where(eq(pushTokens.token, input.token))
      .limit(1);

    // The token column is unique, so updating here would silently rebind
    // another user's push token to the caller (cross-user take-over).
    if (existing && existing.userId !== userId) {
      throw new HTTPException(409, {
        message: "Token already registered to a different user",
      });
    }

    if (existing) {
      const [updated] = await db
        .update(pushTokens)
        .set({
          deviceId: input.deviceId ?? existing.deviceId,
          deviceName: input.deviceName ?? existing.deviceName,
          isActive: true,
          lastUsedAt: new Date(),
          platform: input.platform,
          sessionId,
          userId,
        })
        .where(eq(pushTokens.id, existing.id))
        .returning();
      return updated ?? existing;
    }

    const newToken = await firstOrThrow(
      db
        .insert(pushTokens)
        .values({
          deviceId: input.deviceId ?? null,
          deviceName: input.deviceName ?? null,
          isActive: true,
          platform: input.platform,
          sessionId,
          token: input.token,
          userId,
        })
        .returning(),
      "Failed to create push token"
    );

    return newToken;
  },

  async updatePreferences(
    db: DrizzleClient,
    userId: string,
    input: UpdatePreferencesInput
  ): Promise<PreferencesRecord[]> {
    return db.transaction(async (tx) => {
      const globalValues = {
        emailEnabled: input.emailEnabled ?? true,
        pushEnabled: input.pushEnabled ?? true,
        smsEnabled: input.smsEnabled ?? false,
        typePattern: "*",
        userId,
      };

      await tx
        .insert(notificationPreferences)
        .values(globalValues)
        .onConflictDoUpdate({
          set: {
            emailEnabled: sql`EXCLUDED.email_enabled`,
            pushEnabled: sql`EXCLUDED.push_enabled`,
            smsEnabled: sql`EXCLUDED.sms_enabled`,
          },
          target: [
            notificationPreferences.userId,
            notificationPreferences.typePattern,
          ],
        });

      if (input.typeOverrides) {
        await Promise.all(
          Object.entries(input.typeOverrides).map(
            async ([typePattern, override]) => {
              const channels = override.channels ?? [];
              const typeValues = {
                emailEnabled: channels.includes("email"),
                pushEnabled: channels.includes("push"),
                smsEnabled: channels.includes("sms"),
                typePattern,
                userId,
              };

              await tx
                .insert(notificationPreferences)
                .values(typeValues)
                .onConflictDoUpdate({
                  set: {
                    emailEnabled: sql`EXCLUDED.email_enabled`,
                    pushEnabled: sql`EXCLUDED.push_enabled`,
                    smsEnabled: sql`EXCLUDED.sms_enabled`,
                  },
                  target: [
                    notificationPreferences.userId,
                    notificationPreferences.typePattern,
                  ],
                });
            }
          )
        );
      }

      // Read back inside the tx so callers see the post-upsert state atomically.
      return tx
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId))
        .orderBy(asc(notificationPreferences.typePattern));
    });
  },
};
