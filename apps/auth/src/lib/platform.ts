import { z } from "zod";

export const platformSchema = z.enum(["web", "mobile"]);

export type Platform = "web" | "mobile";

export const SESSION_CONFIG = {
  web: {
    expiresIn: 3600,
    updateAge: 1800,
  },
  mobile: {
    expiresIn: 604_800,
    updateAge: 86_400,
  },
} as const;

const MOBILE_PATTERNS = [
  /android/i,
  /iphone/i,
  /ipad/i,
  /mobile/i,
  /okhttp/i,
  /dart/i,
  /flutter/i,
  /react-native/i,
  /expo/i,
];

export const detectPlatform = (userAgent: string | null): Platform => {
  if (!userAgent) {
    return "web";
  }
  return MOBILE_PATTERNS.some((pattern) => pattern.test(userAgent))
    ? "mobile"
    : "web";
};

export type SessionWithAdditionalFields = {
  platform: Platform;
  expiresAt: Date;
  activeOrgRole: string | null;
};
