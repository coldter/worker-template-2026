export const KV_VERSION_KEY = "cache:tenant:version";

// The Cache API keys on Request URL identity. We use a synthetic origin so the
// resolver and invalidator agree on the URL without ever colliding with a real
// fetched host (no one resolves `tenancy` as a public name).
const CACHE_NAMESPACE_ORIGIN = "https://tenancy";

export function tenantCacheKey(version: string, host: string): string {
  if (host !== host.toLowerCase()) {
    throw new Error("host must be lowercase");
  }
  if (host.includes(":")) {
    throw new Error("host must not include port");
  }
  const v = version === "" ? "v0" : version;
  return `cache:tenant:${v}:${host}`;
}

export function tenantCacheRequest(version: string, host: string): Request {
  return new Request(
    `${CACHE_NAMESPACE_ORIGIN}/${tenantCacheKey(version, host)}`
  );
}
