import type { DrizzleClient } from "@repo/db";

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

// Loose auth types - the AUTH service binding returns these via RPC
export type AuthUser = Record<string, unknown> & { id: string };
export type AuthSession = Record<string, unknown> & { id: string };
