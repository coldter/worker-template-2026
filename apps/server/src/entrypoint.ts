import { WorkerEntrypoint } from "cloudflare:workers";
import { withDrizzleClient } from "@repo/db";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { NOTIFICATION_TYPES } from "@/modules/notifications/constants";
import { notificationDispatch } from "@/modules/notifications/dispatch";
import { onUserStatusChange as statusChangeHook } from "@/modules/users/user-status-hooks";

function getDrizzleLogger() {
  return process.env.NODE_ENV === "development"
    ? new DrizzleLogger()
    : undefined;
}

export class ApiEntrypoint extends WorkerEntrypoint<CloudflareBindings> {
  async onUserCreated(user: {
    id: string;
    email: string;
    name: string;
  }): Promise<{ workflowId: string }> {
    const instance = await this.env.ONBOARDING_WF.create({
      params: { email: user.email, name: user.name, userId: user.id },
    });
    return { workflowId: instance.id };
  }

  async onNewDeviceLogin(params: {
    userId: string;
    ipAddress: string;
    userAgent: string;
    platform: string;
  }): Promise<void> {
    await withDrizzleClient(
      this.env.HYPERDRIVE.connectionString,
      async (db) => {
        const deviceDesc =
          params.platform === "mobile" ? "a mobile device" : "a web browser";
        await notificationDispatch.send(db, {
          body: `A new sign-in was detected from ${deviceDesc}.`,
          props: {
            ipAddress: params.ipAddress,
            platform: params.platform,
            userAgent: params.userAgent,
          },
          subject: "New device sign-in",
          type: NOTIFICATION_TYPES.SECURITY_LOGIN_NEW_DEVICE,
          userId: params.userId,
        });
      },
      { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
    );
  }

  async onUserStatusChange(params: {
    userId: string;
    newStatus: string;
    previousStatus: string;
    reason: string | null;
  }): Promise<void> {
    await statusChangeHook(
      params.userId,
      params.newStatus,
      params.previousStatus,
      params.reason
    );
  }
}
