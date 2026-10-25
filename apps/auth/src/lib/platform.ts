import { z } from "zod";

export const platformSchema = z.enum(["web", "mobile"]);

export type Platform = "web" | "mobile";

export const SESSION_CONFIG = {
  mobile: {
    expiresIn: 604_800,
    updateAge: 86_400,
  },
  web: {
    expiresIn: 3600,
    updateAge: 1800,
  },
} as const;

const MOBILE_PATTERNS = [
  /android/iu,
  /iphone/iu,
  /ipad/iu,
  /mobile/iu,
  /okhttp/iu,
  /dart/iu,
  /flutter/iu,
  /react-native/iu,
  /expo/iu,
];

export const detectPlatform = (userAgent: string | null): Platform => {
  if (!userAgent) {
    return "web";
  }

  return MOBILE_PATTERNS.some((pattern) => pattern.test(userAgent))
    ? "mobile"
    : "web";
};

export interface SessionWithAdditionalFields {
  platform: Platform;
  expiresAt: Date;
  activeOrgRole: string | null;
}
