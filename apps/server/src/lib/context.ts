import type { DrizzleClient } from "@repo/db";
import type { AuthBindingRpc } from "@repo/shared/auth-binding";
import type {
  AuthorizationSessionInput,
  AuthorizationUserInput,
} from "@repo/shared/authorization";
import type { FanOutInvalidator, Tenant } from "@repo/tenancy";
import type { AuditContext } from "@/lib/audit-context";

// CloudflareBindings with AUTH typed for its RPC methods.
export type AppBindings = Omit<CloudflareBindings, "AUTH"> & {
  AUTH: CloudflareBindings["AUTH"] & AuthBindingRpc;
};

export type AppEnv = {
  Bindings: AppBindings;
  Variables: {
    requestId: string;
    db: DrizzleClient;
    tenant: Tenant | null;
    user: AuthUser | null;
    session: AuthSession | null;
    auditContext: AuditContext;
    authorizedResource: unknown;
    // A2.6 / A2.9 — cross-worker tenancy cache invalidator. Server-side is
    // FanOutInvalidator (own-colo + peer RPC); auth-side is plain Invalidator.
    invalidator: FanOutInvalidator;
  };
};

// Re-export for backward compat with files that import `Env`
export type Env = AppEnv;

export type AuthUser = AuthorizationUserInput;
export type AuthSession = AuthorizationSessionInput & { id: string };
