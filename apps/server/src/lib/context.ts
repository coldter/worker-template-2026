import type { DrizzleClient } from "@/db";

export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    requestId: string;
    db: DrizzleClient;
    user: AuthUser | null;
    session: AuthSession | null;
  };
};

// Re-export for backward compat with files that import `Env`
export type Env = AppEnv;

// Auth types will be refined when auth instance is rewritten
// For now, use the existing types from better-auth
export type AuthUser = Record<string, unknown> & { id: string };
export type AuthSession = Record<string, unknown> & { id: string };
