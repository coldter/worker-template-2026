/**
 * Per-tenant JWT configuration helpers (D12).
 *
 * Spec deviation note: the multi-tenancy spec narrative uses
 * `urn:tenant:${organizationId}` as a conceptual identifier for the issuer /
 * audience. The actual JWT shape produced here uses URL-form `iss`/`aud`
 * (`https://${tenant.host}`) to match the BA 1.6+ JWT plugin and the
 * verifier list documented in spec 09 §JWT scoping. The stable URN-style
 * identifier lives in the `org.id` claim — verifiers (Phase C) read both:
 * `iss`/`aud` for transport-level scoping and `org.id` for org identity that
 * is independent of host changes (custom hostname swaps). Do NOT add a
 * redundant URN-form claim here.
 */
import type { Tenant } from "@repo/tenancy";
import type { UserWithStatusFields } from "./plugins/user-status";

export type JwtConfigEnv = {
  /**
   * Apex / fallback URL when the request resolves to no tenant (admin host or
   * apex page). Read straight off the worker's environment binding.
   */
  APP_URL: string;
};

export type JwtOrgClaim = {
  id: string;
  host: string;
  sessionVersion: number;
};

export type JwtPayload = {
  sub: string;
  email: string;
  roleSlugs: string[];
  platform: string | undefined;
  org: JwtOrgClaim | null;
};

type JwtPayloadUser = {
  id: string;
  email?: string;
} & Partial<UserWithStatusFields>;

type JwtPayloadSession = {
  platform?: string;
  tenantOrgId?: string;
  tenantHost?: string;
  tenantSessionVersion?: number;
};

/**
 * Derives the JWT `iss` claim. URL-form per BA 1.6+ JWT plugin shape (D12).
 * Falls back to `env.APP_URL` when there is no tenant context (apex page or
 * admin host).
 */
export function deriveJwtIssuer(
  tenant: Tenant | null,
  env: JwtConfigEnv
): string {
  return tenant ? `https://${tenant.host}` : env.APP_URL;
}

/**
 * Derives the JWT `aud` claim. Same URL-form rule as `iss` (D12).
 */
export function deriveJwtAudience(
  tenant: Tenant | null,
  env: JwtConfigEnv
): string {
  return tenant ? `https://${tenant.host}` : env.APP_URL;
}

/**
 * Builds the BA `definePayload` return value. The `org.sessionVersion` is the
 * revocation primitive: verifiers (Phase C) check
 * `claim.sessionVersion >= db.organization.session_version` and reject when
 * the claim is older. Prefer the session fields written by
 * `session.create.before`, because that hook reads the fresh organization row
 * even when the resolver snapshot was served from cache.
 */
export function buildJwtPayload(
  user: JwtPayloadUser,
  session: JwtPayloadSession,
  tenant: Tenant | null
): JwtPayload {
  return {
    sub: user.id,
    email: user.email ?? "",
    roleSlugs: user.roleSlugs ?? [],
    platform: session.platform,
    org: tenant
      ? {
          // `org.id` stores the raw `organizationId` string per the plan
          // README's spec deviation #2: "URN-style stable identity" means a
          // stable identifier that is independent of host (custom hostname
          // swaps must not invalidate JWTs), NOT a literal `urn:tenant:`
          // prefixed URI. C1 verifier consumers compare `claim.org.id`
          // against the raw orgId on the organizations row.
          id: session.tenantOrgId ?? tenant.organizationId,
          host: session.tenantHost ?? tenant.host,
          sessionVersion: session.tenantSessionVersion ?? tenant.sessionVersion,
        }
      : null,
  };
}
