import { logger } from "@repo/shared/logger";
import { env } from "cloudflare:workers";
import { z } from "zod";

import type { ServiceAccount } from "./firebase-token";
import { getAccessToken, parseServiceAccount } from "./firebase-token";

interface PushMessage {
  data: Record<string, string>;
  token: string;
}

interface PushSendResult {
  error?: string;
  invalidToken?: boolean;
  messageId?: string;
  success: boolean;
}

interface PushProvider {
  send: (message: PushMessage) => Promise<PushSendResult>;
}

const fcmSuccessSchema = z.object({
  name: z.string().min(1),
});

const fcmErrorDetailSchema = z
  .object({
    "@type": z.string().optional(),
    errorCode: z.string().optional(),
  })
  .passthrough();

const fcmErrorSchema = z.object({
  error: z
    .object({
      code: z.number().optional(),
      details: z.array(fcmErrorDetailSchema).optional(),
      message: z.string().optional(),
    })
    .optional(),
});

const createConsolePushProvider = (): PushProvider => ({
  send: (message) => {
    logger.info("Console push provider: would send push notification", {
      body: message.data.body,
      title: message.data.title,
      token: `${message.token.slice(0, 12)}...`,
      type: message.data.type,
    });

    return Promise.resolve({
      messageId: `console_${Date.now()}`,
      success: true,
    });
  },
});

const INVALID_TOKEN_ERROR_CODES = new Set([
  "UNREGISTERED",
  "INVALID_ARGUMENT",
  "SENDER_ID_MISMATCH",
]);

const createFcmPushProvider = (
  serviceAccount: ServiceAccount
): PushProvider => ({
  send: async (message) => {
    const accessToken = await getAccessToken(serviceAccount);
    const url = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

    const response = await fetch(url, {
      body: JSON.stringify({
        message: {
          data: message.data,
          token: message.token,
        },
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (response.ok) {
      const rawResult: unknown = await response.json();
      const parsedResult = fcmSuccessSchema.safeParse(rawResult);

      if (!parsedResult.success) {
        throw new Error("FCM success response did not match expected shape");
      }

      return { messageId: parsedResult.data.name, success: true };
    }

    const rawError: unknown = await response.json();
    const parsedError = fcmErrorSchema.safeParse(rawError);

    if (!parsedError.success) {
      throw new Error("FCM error response did not match expected shape");
    }

    const errorBody = parsedError.data;

    const fcmErrorCode = errorBody.error?.details?.find(
      (d) =>
        d["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError"
    )?.errorCode;

    const isInvalidToken = fcmErrorCode
      ? INVALID_TOKEN_ERROR_CODES.has(fcmErrorCode)
      : false;

    return {
      error:
        errorBody.error?.message ?? `FCM request failed (${response.status})`,
      invalidToken: isInvalidToken,
      success: false,
    };
  },
});

let pushProvider: PushProvider | null = null;

export const getPushProvider = (): PushProvider => {
  if (pushProvider) {
    return pushProvider;
  }

  const configuredProvider = String(env.FCM_PROVIDER).toLowerCase();

  const wantsFcm =
    configuredProvider === "fcm" || configuredProvider === "firebase";

  if (wantsFcm && env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64) {
    pushProvider = createFcmPushProvider(parseServiceAccount());
    logger.info("FCM HTTP v1 push provider initialized");
  } else {
    pushProvider = createConsolePushProvider();
    logger.warn("Console push provider initialized", {
      configuredProvider,
      hasServiceAccount: Boolean(env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64),
    });
  }

  return pushProvider;
};

export type { PushMessage, PushProvider, PushSendResult };
