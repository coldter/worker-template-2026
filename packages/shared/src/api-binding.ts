export interface OnUserCreatedParams {
  id: string;
  email: string;
  name: string;
}

export interface OnNewDeviceLoginParams {
  userId: string;
  ipAddress: string;
  userAgent: string;
  platform: string;
}

export interface ApiBindingRpc {
  onNewDeviceLogin: (params: OnNewDeviceLoginParams) => Promise<void>;
  onUserCreated: (
    params: OnUserCreatedParams
  ) => Promise<{ workflowId: string }>;
}
