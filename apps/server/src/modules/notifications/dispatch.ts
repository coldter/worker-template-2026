import { type DrizzleClient, firstOrThrow } from "@repo/db";
import { notifications } from "@repo/db/schema";
import { logger } from "@repo/shared/logger";
import { eq } from "drizzle-orm";
import { dispatchEvent, triggerWorkflow } from "@/lib/events";

import { NOTIFICATION_TYPE_CONFIG } from "./constants";
import { resolveEnabledChannels } from "./helpers";
import { notificationService } from "./service";
import type {
  NotificationChannel,
  SendNotificationInput,
  SendResult,
} from "./types";

type WaitUntil = (promise: Promise<unknown>) => void;

export interface DispatchOptions {
  waitUntil?: WaitUntil;
}

async function markNotificationFailed(
  db: DrizzleClient,
  notificationId: string,
  error: unknown
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  try {
    await db
      .update(notifications)
      .set({ errorMessage, status: "failed" })
      .where(eq(notifications.id, notificationId));
  } catch (updateError) {
    logger.error("Failed to mark notification as failed", {
      notificationId,
      originalError: errorMessage,
      updateError:
        updateError instanceof Error
          ? updateError.message
          : String(updateError),
    });
  }
}

function buildWorkflowEvent(
  channel: NotificationChannel,
  notificationId: string
) {
  if (channel === "email") {
    return {
      payload: { notificationId },
      type: "notification.email" as const,
    };
  }
  return {
    payload: { notificationId },
    type: "notification.push" as const,
  };
}

export const notificationDispatch = {
  async send(
    db: DrizzleClient,
    input: SendNotificationInput,
    options: DispatchOptions = {}
  ): Promise<SendResult> {
    const typeConfig = NOTIFICATION_TYPE_CONFIG[input.type];
    const requestedChannels = input.channels ??
      typeConfig?.channels ?? ["push"];
    const priority = input.priority ?? typeConfig?.priority ?? "medium";

    const preferences = await notificationService.getPreferences(
      db,
      input.userId
    );
    const channels = resolveEnabledChannels(
      preferences,
      input.type,
      requestedChannels
    );

    if (channels.length === 0) {
      return {
        channels: requestedChannels,
        failedChannels: [],
        notificationIds: [],
        sentChannels: [],
      };
    }

    const sentChannels: SendResult["sentChannels"] = [];
    const failedChannels: SendResult["failedChannels"] = [];
    const notificationIds: string[] = [];
    const { waitUntil } = options;

    const results = await Promise.all(
      channels.map(async (channel) => {
        let notificationId: string | undefined;
        try {
          const notification = await firstOrThrow(
            db
              .insert(notifications)
              .values({
                body: input.body,
                channel,
                priority,
                props: input.props ?? null,
                status: "pending",
                subject: input.subject,
                type: input.type,
                userId: input.userId,
              })
              .returning(),
            "Failed to create notification record"
          );
          notificationId = notification.id;

          const event = buildWorkflowEvent(channel, notification.id);

          if (waitUntil) {
            const deferredId = notification.id;
            dispatchEvent(
              event,
              { waitUntil },
              {
                onFailure: (error) =>
                  markNotificationFailed(db, deferredId, error),
              }
            );
            return { channel, notificationId, sent: true as const };
          }
          await triggerWorkflow(event);
          return { channel, notificationId, sent: true as const };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          if (notificationId) {
            await markNotificationFailed(db, notificationId, error);
          }
          return { channel, error: errorMessage, sent: false as const };
        }
      })
    );

    for (const result of results) {
      if (result.sent) {
        sentChannels.push(result.channel);
        if (result.notificationId) {
          notificationIds.push(result.notificationId);
        }
      } else {
        failedChannels.push({ channel: result.channel, error: result.error });
      }
    }

    return {
      channels: requestedChannels,
      failedChannels,
      notificationIds,
      sentChannels,
    };
  },
};
