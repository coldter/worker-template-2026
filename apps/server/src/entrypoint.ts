import { WorkerEntrypoint } from "cloudflare:workers";
import { withDrizzleClient } from "@repo/db";
import type {
  AdminStatusMutationParams,
  ApiBindingRpc,
  StatusMutationResult,
} from "@repo/shared/api-binding";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { NOTIFICATION_TYPES } from "@/modules/notifications/constants";
import { notificationDispatch } from "@/modules/notifications/dispatch";
import { UserNotFoundError } from "@/modules/users/errors";
import { userService } from "@/modules/users/service";
import { onUserStatusChange as statusChangeHook } from "@/modules/users/user-status-hooks";

function getDrizzleLogger() {
  return process.env.NODE_ENV === "development"
    ? new DrizzleLogger()
    : undefined;
}

export class ApiEntrypoint
  extends WorkerEntrypoint<CloudflareBindings>
  implements ApiBindingRpc
{
  async adminActivateUser(
    params: Omit<AdminStatusMutationParams, "reason">
  ): Promise<StatusMutationResult> {
    return this.mutateUserStatus("activate", params);
  }

  async adminDeactivateUser(
    params: AdminStatusMutationParams
  ): Promise<StatusMutationResult> {
    return this.mutateUserStatus("deactivate", params);
  }

  async adminUnlockUser(
    params: Omit<AdminStatusMutationParams, "reason">
  ): Promise<StatusMutationResult> {
    return this.mutateUserStatus("unlock", params);
  }

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

  private async mutateUserStatus(
    action: "activate" | "deactivate" | "unlock",
    params: AdminStatusMutationParams
  ): Promise<StatusMutationResult> {
    return withDrizzleClient(
      this.env.HYPERDRIVE.connectionString,
      async (db) => {
        try {
          if (action === "activate") {
            await userService.activate(db, params.userId, params.actorId, {});
          } else if (action === "deactivate") {
            await userService.deactivate(
              db,
              params.userId,
              params.reason ?? null,
              params.actorId,
              {}
            );
          } else {
            await userService.unlock(db, params.userId, params.actorId, {});
          }
          return { success: true } as const;
        } catch (error) {
          if (error instanceof UserNotFoundError) {
            return { reason: "not_found", success: false } as const;
          }
          throw error;
        }
      },
      { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
    );
  }
}
