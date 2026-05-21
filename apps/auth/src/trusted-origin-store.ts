// Per-isolate snapshot of issuer origins registered by the server worker after
// a successful `createSsoProvider`. The dynamic `trustedOrigins(req)` callback
// in `instance.ts` consults this store keyed by tenant.organizationId so
// subsequent /sso/sign-in redirects to the issuer pass BA's allowed-redirect
// check without re-reading the DB on every request.
//
// Lifetime: per-isolate Map. Cold-start re-population happens on the next
// successful registration via the AuthEntrypoint.registerTrustedOrigin RPC.
// On a cold isolate that missed any prior registration, BA falls back to the
// auto-merged allowedHosts + per-tenant origin only — the worst case is a
// single failed redirect that the next registration call will heal.

const ISSUER_PROTOCOL_HTTPS = "https:";

const store = new Map<string, Set<string>>();

/**
 * Validate and normalize an issuer URL into an origin string.
 * Returns null on any rejection (https-only, no userinfo, no search/hash
 * fragments, must have a host). Paths are accepted because OIDC discovery
 * endpoints commonly use `/.well-known/openid-configuration`; Better Auth
 * trusted origins need only the URL origin.
 */
export function normalizeIssuerOrigin(rawIssuer: string): string | null {
  let url: URL;
  try {
    url = new URL(rawIssuer);
  } catch {
    return null;
  }
  if (url.protocol !== ISSUER_PROTOCOL_HTTPS) {
    return null;
  }
  if (!url.host) {
    return null;
  }
  if (url.username || url.password) {
    return null;
  }
  if (url.search || url.hash) {
    return null;
  }
  return url.origin;
}

export function registerTrustedOriginForTenant(
  tenantId: string,
  origin: string
): void {
  if (!tenantId) {
    return;
  }
  const set = store.get(tenantId) ?? new Set<string>();
  set.add(origin);
  store.set(tenantId, set);
}

export function getTrustedOriginsForTenant(
  tenantId: string | null | undefined
): readonly string[] {
  if (!tenantId) {
    return [];
  }
  const set = store.get(tenantId);
  if (!set) {
    return [];
  }
  return Array.from(set);
}

/**
 * Test-only reset hook. Not exported via the package barrel; tests import the
 * file path directly.
 */
export function __resetTrustedOriginStoreForTests(): void {
  store.clear();
}
