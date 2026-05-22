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
      .set({ status: "failed", errorMessage })
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
      type: "notification.email" as const,
      payload: { notificationId },
    };
  }
  return {
    type: "notification.push" as const,
    payload: { notificationId },
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
        notificationIds: [],
        channels: requestedChannels,
        sentChannels: [],
        failedChannels: [],
      };
    }

    const sentChannels: SendResult["sentChannels"] = [];
    const failedChannels: SendResult["failedChannels"] = [];
    const notificationIds: string[] = [];
    const { waitUntil } = options;

    for (const channel of channels) {
      let notificationId: string | undefined;
      try {
        const notification = await firstOrThrow(
          db
            .insert(notifications)
            .values({
              userId: input.userId,
              type: input.type,
              channel,
              status: "pending",
              priority,
              subject: input.subject,
              body: input.body,
              props: input.props ?? null,
            })
            .returning(),
          "Failed to create notification record"
        );
        notificationId = notification.id;
        notificationIds.push(notification.id);

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
          sentChannels.push(channel);
        } else {
          await triggerWorkflow(event);
          sentChannels.push(channel);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        failedChannels.push({ channel, error: errorMessage });
        if (notificationId) {
          await markNotificationFailed(db, notificationId, error);
        }
      }
    }

    return {
      notificationIds,
      channels: requestedChannels,
      sentChannels,
      failedChannels,
    };
  },
};
