import { env } from "cloudflare:workers";
import { logger } from "@repo/shared/logger";

export type AppEvent =
  | {
      type: "user.created";
      payload: { userId: string; email: string; name: string | null };
    }
  | { type: "notification.email"; payload: { notificationId: string } }
  | { type: "notification.push"; payload: { notificationId: string } };

export interface DeferralContext {
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface DispatchEventOptions {
  onFailure?: (error: unknown) => void | Promise<void>;
}

export async function triggerWorkflow(
  event: AppEvent
): Promise<{ workflowId: string }> {
  try {
    let workflowId: string;
    switch (event.type) {
      case "user.created": {
        const instance = await env.ONBOARDING_WF.create({
          params: event.payload,
        });
        workflowId = instance.id;
        break;
      }
      case "notification.email": {
        const instance = await env.EMAIL_NOTIFICATION_WF.create({
          params: event.payload,
        });
        workflowId = instance.id;
        break;
      }
      case "notification.push": {
        const instance = await env.PUSH_NOTIFICATION_WF.create({
          params: event.payload,
        });
        workflowId = instance.id;
        break;
      }
      default: {
        const exhaustive: never = event;
        throw new Error(
          `Unhandled workflow event type: ${JSON.stringify(exhaustive)}`
        );
      }
    }
    logger.debug(`Workflow triggered: ${event.type}`, { workflowId });
    return { workflowId };
  } catch (error) {
    logger.error(`Failed to trigger workflow: ${event.type}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function eventContext(event: AppEvent): Record<string, unknown> {
  switch (event.type) {
    case "user.created":
      return { userId: event.payload.userId };
    case "notification.email":
    case "notification.push":
      return { notificationId: event.payload.notificationId };
    default: {
      const exhaustive: never = event;
      return { event: JSON.stringify(exhaustive) };
    }
  }
}

export function dispatchEvent(
  event: AppEvent,
  ctx: DeferralContext,
  options: DispatchEventOptions = {}
): void {
  const task = triggerWorkflow(event).then(
    () => undefined,
    async (error: unknown) => {
      if (options.onFailure) {
        try {
          await options.onFailure(error);
        } catch (handlerError) {
          logger.error(`Event onFailure handler threw: ${event.type}`, {
            ...eventContext(event),
            error:
              handlerError instanceof Error
                ? handlerError.message
                : String(handlerError),
          });
        }
      }
      logger.warn(`Deferred workflow trigger failed: ${event.type}`, {
        ...eventContext(event),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  );
  ctx.waitUntil(task);
}
