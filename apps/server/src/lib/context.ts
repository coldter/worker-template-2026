import type { DrizzleClient } from "@repo/db";
import type {
  AuthorizationSessionInput,
  AuthorizationUserInput,
} from "@repo/shared/authorization";
import type { AuditContext } from "@/lib/audit-context";

export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    requestId: string;
    db: DrizzleClient;
    user: AuthUser | null;
    session: AuthSession | null;
    auditContext: AuditContext;
    authorizedResource: unknown;
  };
};

// Re-export for backward compat with files that import `Env`
export type Env = AppEnv;

export type AuthUser = AuthorizationUserInput;
export type AuthSession = AuthorizationSessionInput & { id: string };
