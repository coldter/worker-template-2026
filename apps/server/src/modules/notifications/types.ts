import type {
  Notification,
  NotificationChannel,
  NotificationPreference,
  NotificationPriority,
  NotificationStatus,
  PushPlatform,
  PushToken,
} from "@repo/db/schema";
import type { PaginationQuery } from "@/utils/pagination";

import type { NotificationsSortColumn, NotificationType } from "./constants";

// Re-export schema types
export type {
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  PushPlatform,
};

export interface ListNotificationsQuery extends PaginationQuery {
  channel?: NotificationChannel;
  sort?: NotificationsSortColumn;
  status?: NotificationStatus;
  type?: string;
  unreadOnly?: boolean;
}

export interface SendNotificationInput {
  body: string;
  /** Override default channels */
  channels?: NotificationChannel[];
  /** Override default priority */
  priority?: NotificationPriority;
  /** Additional props for templates/deep links */
  props?: Record<string, unknown>;
  subject: string;
  type: NotificationType;
  userId: string;
}

export interface RegisterPushTokenInput {
  deviceId?: string;
  deviceName?: string;
  platform: PushPlatform;
  /** FCM/APNs token */
  token: string;
}

export interface UpdatePreferencesInput {
  emailEnabled?: boolean;
  pushEnabled?: boolean;
  smsEnabled?: boolean;
  /** Per-type pattern preferences (e.g., "security.*" -> { channels: ["push"] }) */
  typeOverrides?: Record<
    string,
    {
      channels?: NotificationChannel[];
      enabled?: boolean;
    }
  >;
}

export type NotificationRecord = Notification;

/**
 * Notification summary for API responses.
 */
export interface NotificationSummary {
  body: string | null;
  channel: NotificationChannel;
  createdAt: string;
  deliveredAt: string | null;
  id: string;
  isRead: boolean | null;
  priority: NotificationPriority;
  props: Record<string, unknown> | null;
  readAt: string | null;
  sentAt: string | null;
  status: NotificationStatus;
  subject: string | null;
  type: string;
}

/**
 * Push token record from database.
 */
export type PushTokenRecord = PushToken;

/**
 * Push token summary for API responses.
 */
export interface PushTokenSummary {
  createdAt: string;
  deviceId: string | null;
  deviceName: string | null;
  id: string;
  isActive: boolean;
  lastUsedAt: string | null;
  platform: PushPlatform;
  sessionId: string;
}

/**
 * User notification preferences.
 */
export type PreferencesRecord = NotificationPreference;

/**
 * Preferences summary for API responses.
 */
export interface PreferencesSummary {
  emailEnabled: boolean;
  pushEnabled: boolean;
  smsEnabled: boolean;
  typeOverrides: Record<
    string,
    {
      channels?: NotificationChannel[];
      enabled?: boolean;
    }
  > | null;
}

/**
 * Result of sending a notification.
 */
export interface SendResult {
  /** Channels attempted */
  channels: NotificationChannel[];
  /** Failed channels with errors */
  failedChannels: { channel: NotificationChannel; error: string }[];
  /** Notification IDs (one per channel) */
  notificationIds: string[];
  /** Successfully sent to channels */
  sentChannels: NotificationChannel[];
}
