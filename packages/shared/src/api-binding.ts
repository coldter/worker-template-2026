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

export interface ApiBindingRpc {
  onNewDeviceLogin(params: OnNewDeviceLoginParams): Promise<void>;
  onUserCreated(params: OnUserCreatedParams): Promise<{ workflowId: string }>;
}
