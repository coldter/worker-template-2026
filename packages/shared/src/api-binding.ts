export type OnUserCreatedParams = {
  id: string;
  email: string;
  name: string;
};

export type OnNewDeviceLoginParams = {
  userId: string;
  ipAddress: string;
  userAgent: string;
  platform: string;
};

export type AdminStatusMutationParams = {
  userId: string;
  actorId: string;
  reason?: string | null;
};

export type StatusMutationResult =
  | { success: true }
  | { success: false; reason: "not_found" };

export interface ApiBindingRpc {
  adminActivateUser(
    params: Omit<AdminStatusMutationParams, "reason">
  ): Promise<StatusMutationResult>;
  adminDeactivateUser(
    params: AdminStatusMutationParams
  ): Promise<StatusMutationResult>;
  adminUnlockUser(
    params: Omit<AdminStatusMutationParams, "reason">
  ): Promise<StatusMutationResult>;
  onNewDeviceLogin(params: OnNewDeviceLoginParams): Promise<void>;
  onUserCreated(params: OnUserCreatedParams): Promise<{ workflowId: string }>;
}
