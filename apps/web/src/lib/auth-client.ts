import {
  inferAdditionalFields,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const parsedUrl = new URL(
  import.meta.env.VITE_SERVER_URL || "http://localhost:8787"
);
const { pathname } = parsedUrl;

export const authClient = createAuthClient({
  basePath: pathname === "/" ? "/api/auth" : `${pathname}/api/auth`,
  baseURL: parsedUrl.origin,
  plugins: [
    organizationClient(),
    twoFactorClient(),
    inferAdditionalFields({
      session: {
        activeOrgRole: { type: "string" },
        platform: { type: "string" },
      },
      user: {
        deactivatedAt: { type: "date" },
        deactivatedBy: { type: "string" },
        deactivatedReason: { type: "string" },
        failedLoginAttempts: { type: "number" },
        lockedUntil: { type: "date" },
        roleSlugs: { type: "string[]" },
        status: { type: "string" },
        twoFactorEnabled: { type: "boolean" },
      },
    }),
  ],
});

export type Session = typeof authClient.$Infer.Session;
export type SessionUser = Session["user"];
export type SessionData = Session["session"];
