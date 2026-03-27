import { env } from "cloudflare:workers";
import { logger } from "@/lib/logger";

export type AppEvent =
  | {
      type: "user.created";
      payload: { userId: string; email: string; name: string | null };
    }
  | { type: "notification.email"; payload: { notificationId: string } }
  | { type: "notification.push"; payload: { notificationId: string } };

export async function triggerWorkflow(event: AppEvent): Promise<void> {
  try {
    switch (event.type) {
      case "user.created":
        await env.ONBOARDING_WF.create({ params: event.payload });
        break;
      case "notification.email":
        await env.EMAIL_NOTIFICATION_WF.create({ params: event.payload });
        break;
      case "notification.push":
        await env.PUSH_NOTIFICATION_WF.create({ params: event.payload });
        break;
      default:
        break;
    }
    logger.debug(`Workflow triggered: ${event.type}`);
  } catch (error) {
    logger.error(`Failed to trigger workflow: ${event.type}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Keep old event name constants for reference during migration
export const EVENTS = {
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
  USER_DEACTIVATED: "user.deactivated",
  NOTIFICATION_EMAIL_SEND: "notification.email",
  NOTIFICATION_PUSH_SEND: "notification.push",
} as const;
