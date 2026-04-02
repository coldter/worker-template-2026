import type { DrizzleClient } from "@repo/db";
import type {
  AuthorizationSessionInput,
  AuthorizationUserInput,
} from "@repo/shared/authorization";

export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    requestId: string;
    db: DrizzleClient;
    user: AuthUser | null;
    session: AuthSession | null;
    authorizedResource: unknown;
  };
};

// Re-export for backward compat with files that import `Env`
export type Env = AppEnv;

export type AuthUser = AuthorizationUserInput & {
  deactivatedAt?: Date | null;
  deactivatedBy?: string | null;
  deactivatedReason?: string | null;
  failedLoginAttempts?: number;
  image?: string | null;
  lockedUntil?: Date | null;
  name?: string;
  onboardingCompletedAt?: Date | null;
  twoFactorEnabled?: boolean;
};
export type AuthSession = AuthorizationSessionInput & {
  expiresAt?: Date;
  id: string;
  platform?: string;
  userId?: string;
};
