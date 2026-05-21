export type AllowedHostsSnapshot = {
  readonly wildcardSuffix: string;
  readonly adminHost: string;
  readonly customHosts: readonly string[];
  readonly localDevHosts: readonly string[];
};

type SnapshotEnv = {
  WILDCARD_SUFFIX: string;
  ADMIN_HOST: string;
  LOCAL_DEV_HOSTS?: string;
};

const snapshotCache = new WeakMap<object, AllowedHostsSnapshot>();

const HOST_PORT_SUFFIX_RE = /:\d+$/;

/**
 * Derives a per-isolate AllowedHostsSnapshot from wrangler env vars.
 * customHosts is empty here — future work will extend this with active
 * tenant_custom_hostnames loaded from the DB at isolate start.
 */
export function snapshotFromEnv(env: SnapshotEnv): AllowedHostsSnapshot {
  const cached = snapshotCache.get(env);
  if (cached) {
    return cached;
  }
  const snapshot: AllowedHostsSnapshot = Object.freeze({
    wildcardSuffix: env.WILDCARD_SUFFIX,
    adminHost: env.ADMIN_HOST,
    customHosts: Object.freeze([]),
    localDevHosts: Object.freeze(
      (env.LOCAL_DEV_HOSTS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  });
  snapshotCache.set(env, snapshot);
  return snapshot;
}

/**
 * Derives the set of hosts BA should accept for base-URL resolution.
 * wildcardSuffix must have a leading dot (e.g. ".app.example.com").
 * Returns the apex domain and the wildcard pattern separately so BA can
 * match both "app.example.com" (no subdomain) and "*.app.example.com".
 */
export function expandWildcardHosts(
  snapshot: AllowedHostsSnapshot
): readonly string[] {
  const apex = snapshot.wildcardSuffix.startsWith(".")
    ? snapshot.wildcardSuffix.slice(1)
    : snapshot.wildcardSuffix;
  return [apex, `*${snapshot.wildcardSuffix}`, ...snapshot.customHosts];
}

export function excludeAdminHost(
  hosts: readonly string[],
  adminHost: string
): readonly string[] {
  return hosts.filter((h) => h !== adminHost);
}

export function deriveAllowedHosts(
  snapshot: AllowedHostsSnapshot
): readonly string[] {
  const apex = snapshot.wildcardSuffix.startsWith(".")
    ? snapshot.wildcardSuffix.slice(1)
    : snapshot.wildcardSuffix;

  // Fail closed: admin host must not match the wildcard domain.
  if (
    snapshot.adminHost === apex ||
    snapshot.adminHost.endsWith(snapshot.wildcardSuffix)
  ) {
    throw new Error(
      `adminHost "${snapshot.adminHost}" collides with wildcardSuffix "${snapshot.wildcardSuffix}"`
    );
  }

  return excludeAdminHost(expandWildcardHosts(snapshot), snapshot.adminHost);
}

/**
 * Returns true when `rawHost` (a Host-header value, possibly with port) is in
 * the snapshot-derived allow-list. Used by the auth-worker entry to fail
 * closed with 421 (Misdirected Request) on unknown hosts.
 *
 * Matching rules:
 *   - localDevHosts are matched verbatim (they may contain ":port").
 *   - Patterns of the form "*.suffix" match any single-label subdomain.
 *   - All other entries match by case-insensitive exact equality.
 * The Host header is normalised to lowercase before comparison; the trailing
 * port (if present) is stripped only for non-localDev comparison.
 */
export function isHostAllowed(
  rawHost: string,
  snapshot: AllowedHostsSnapshot
): boolean {
  if (!rawHost) {
    return false;
  }
  const lower = rawHost.toLowerCase();
  if (snapshot.localDevHosts.includes(lower)) {
    return true;
  }
  const portStripped = lower.replace(HOST_PORT_SUFFIX_RE, "");
  if (!portStripped) {
    return false;
  }
  for (const entry of deriveAllowedHosts(snapshot)) {
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1);
      if (
        portStripped.endsWith(suffix) &&
        portStripped.length > suffix.length &&
        !portStripped.slice(0, -suffix.length).includes(".")
      ) {
        return true;
      }
      continue;
    }
    if (entry === portStripped) {
      return true;
    }
  }
  return false;
}
