import type { DrizzleClient } from "@repo/db";
import { notifications } from "@repo/db/schema";
import { triggerWorkflow } from "@/lib/events";

import { NOTIFICATION_TYPE_CONFIG } from "./constants";
import { resolveEnabledChannels } from "./helpers";
import { notificationService } from "./service";
import type { SendNotificationInput, SendResult } from "./types";

/**
 * Notification Dispatch Module
 *
 * Owns the delivery pipeline: preference filtering, per-channel persistence,
 * and workflow triggering. Callers get a small interface (`dispatch`) that
 * hides the internal channel loop and side effects.
 */
export const notificationDispatch = {
  async send(
    db: DrizzleClient,
    input: SendNotificationInput
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

    for (const channel of channels) {
      try {
        const [notification] = await db
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
          .returning();

        if (notification) {
          notificationIds.push(notification.id);
          sentChannels.push(channel);

          triggerWorkflow(
            channel === "email"
              ? {
                  type: "notification.email",
                  payload: { notificationId: notification.id },
                }
              : {
                  type: "notification.push",
                  payload: { notificationId: notification.id },
                }
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        failedChannels.push({ channel, error: errorMessage });
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
