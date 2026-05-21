import { createInvalidator, type Invalidator } from "@repo/tenancy";

// boundary: vendor-SDK generic variance — Cloudflare Workers exposes
// `caches.default` at runtime, but the DOM `CacheStorage` typing doesn't model
// it. Safe in Workers only.
const tenancyCache = (caches as unknown as { default: Cache }).default;

/**
 * Build the auth worker's own-colo Invalidator. Auth never fans out — the
 * server side initiates tenancy mutations; auth only accepts fan-in via the
 * RPC entrypoint.
 */
export function createAuthInvalidator(env: {
  CACHE: KVNamespace;
}): Invalidator {
  return createInvalidator({
    CACHE: env.CACHE,
    tenancyCache: {
      match: (req) => tenancyCache.match(req),
      put: (req, res) => tenancyCache.put(req, res),
      delete: (req) => tenancyCache.delete(req),
    },
  });
}
