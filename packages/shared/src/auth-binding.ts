// Structural type matching @repo/tenancy Tenant — avoids circular dep since
// @repo/tenancy already depends on @repo/shared.
export type TenantRef = {
  organizationId: string;
  slug: string | null;
  host: string;
  kind: "subdomain" | "custom";
  enforceSSO: boolean;
  sessionVersion: number;
  suspendedAt: Date | null;
  deletedAt: Date | null;
};

// Structural copy of @repo/tenancy InvalidationSpec — kept here to avoid the
// shared package depending on @repo/tenancy (dependency direction is
// tenancy -> shared).
export type InvalidationSpecRef = {
  kind: "subdomain" | "custom";
  host: string;
};

export interface AuthBindingRpc {
  acceptInvitation(input: {
    invitationId: string;
    sessionCookie: string;
    tenant: TenantRef | null;
  }): Promise<{ ok: boolean }>;
  bumpTenantCacheVersion(): Promise<string>;
  createUser(input: {
    email: string;
    password: string;
    name: string;
    emailVerified: boolean;
    tenant: TenantRef | null;
  }): Promise<{ id: string }>;
  findUserByEmail(
    email: string
  ): Promise<{ id: string; email: string; name: string } | null>;
  getSession(
    headers: Headers,
    tenant: TenantRef | null
  ): Promise<{
    user: Record<string, unknown>;
    session: Record<string, unknown>;
  } | null>;
  getToken(
    headers: Headers,
    tenant: TenantRef | null
  ): Promise<{ token: string } | null>;
  handleAuthRequest(
    request: Request,
    tenant: TenantRef | null
  ): Promise<Response>;
  // Cross-worker tenancy cache invalidation RPC. The server's
  // FanOutInvalidator calls this on the AUTH binding to evict the auth
  // worker's own-colo Cache API entry and bump its KV version.
  invalidateTenant(spec: InvalidationSpecRef): Promise<void>;
  // Discovery-time trusted-origin registration. Invalid issuers are silently
  // rejected (`{ ok: false }`).
  registerTrustedOrigin(
    tenantId: string,
    issuerUrl: string
  ): Promise<{ ok: boolean; origin: string | null }>;
  // signInEmail returns the array of `Set-Cookie` strings emitted by BA so
  // multi-cookie responses (session + CSRF rotation) survive forwarding.
  // `Headers.get("Set-Cookie")` collapses them with `, ` which corrupts any
  // cookie whose Expires attribute carries an RFC 7231 date comma.
  signInEmail(input: {
    email: string;
    password: string;
    tenant: TenantRef | null;
  }): Promise<{ ok: boolean; setCookies: string[] }>;
}
