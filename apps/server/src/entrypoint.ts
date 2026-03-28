import { WorkerEntrypoint } from "cloudflare:workers";
import { createDrizzleClient } from "@repo/db/client";
import { Client } from "pg";
import { NOTIFICATION_TYPES } from "@/modules/notifications/constants";
import { notificationService } from "@/modules/notifications/service";
import { onUserStatusChange as statusChangeHook } from "@/modules/users/user-status-hooks";

export class ApiEntrypoint extends WorkerEntrypoint<CloudflareBindings> {
  /** Called by Auth Worker after a new user is created */
  async onUserCreated(user: {
    id: string;
    email: string;
    name: string;
  }): Promise<{ workflowId: string }> {
    const instance = await this.env.ONBOARDING_WF.create({
      params: { userId: user.id, email: user.email, name: user.name },
    });
    return { workflowId: instance.id };
  }

  /** Called by Auth Worker when sign-in from a new device is detected */
  async onNewDeviceLogin(params: {
    userId: string;
    ipAddress: string;
    userAgent: string;
    platform: string;
  }): Promise<void> {
    const client = new Client({
      connectionString: this.env.HYPERDRIVE.connectionString,
    });
    await client.connect();
    try {
      const db = createDrizzleClient(client);
      const deviceDesc =
        params.platform === "mobile" ? "a mobile device" : "a web browser";
      await notificationService.send(db, {
        userId: params.userId,
        type: NOTIFICATION_TYPES.SECURITY_LOGIN_NEW_DEVICE,
        subject: "New device sign-in",
        body: `A new sign-in was detected from ${deviceDesc}.`,
        props: {
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          platform: params.platform,
        },
      });
    } finally {
      this.ctx.waitUntil(client.end());
    }
  }

  /** Called by Auth Worker admin plugin when user status changes */
  async onUserStatusChange(params: {
    userId: string;
    newStatus: string;
    previousStatus: string;
    reason: string | null;
  }): Promise<void> {
    await statusChangeHook(
      params.userId,
      params.newStatus as "active" | "inactive" | "locked" | "deleted",
      params.previousStatus,
      params.reason
    );
  }
}
