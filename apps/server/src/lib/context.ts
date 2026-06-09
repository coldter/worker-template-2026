import type { Principal } from "@repo/authorization";
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
    // Memoized per request so repeated authorize() guards and the capabilities
    // route reuse one built Principal instead of rebuilding it each call.
    principal?: Principal | null;
  };
};

// Re-export for backward compat with files that import `Env`
export type Env = AppEnv;

export type AuthUser = AuthorizationUserInput;
export type AuthSession = AuthorizationSessionInput & { id: string };
