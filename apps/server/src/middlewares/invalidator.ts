import { createFanOutInvalidator, type FanOutInvalidator } from "@repo/tenancy";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/lib/context";

// boundary: vendor-SDK generic variance — Cloudflare Workers exposes
// `caches.default` at runtime, but the DOM `CacheStorage` typing doesn't model
// it. Safe in Workers only.
const tenancyCache = (caches as unknown as { default: Cache }).default;

type ServerEnv = {
  CACHE: KVNamespace;
  AUTH: {
    invalidateTenant: (spec: {
      kind: "subdomain" | "custom";
      host: string;
    }) => Promise<void>;
    bumpTenantCacheVersion?: () => Promise<string>;
  };
};

/**
 * Build the server worker's FanOutInvalidator. The server is the canonical
 * origin for tenancy mutations — it always fans out to peer workers (auth)
 * over RPC service bindings.
 *
 * `bumpTenantCacheVersion` on the auth binding returns `Promise<string>`
 * (the new version) but `FanOutInvalidator` only needs `Promise<void>`; the
 * adapter discards the return value to satisfy the structural contract.
 */
export function createServerInvalidator(env: ServerEnv): FanOutInvalidator {
  return createFanOutInvalidator({
    CACHE: env.CACHE,
    tenancyCache: {
      match: (req) => tenancyCache.match(req),
      put: (req, res) => tenancyCache.put(req, res),
      delete: (req) => tenancyCache.delete(req),
    },
    // The server has no peer "API" binding (it IS the API). Fan-out targets
    // only AUTH; the API peer is wired as a no-op so the structural contract
    // from `FanOutEnv` is satisfied without a sibling worker.
    API: {
      invalidateTenant: async () => {
        // no-op: the API peer is this same worker
      },
      bumpTenantCacheVersion: async () => {
        // no-op
      },
    },
    AUTH: {
      invalidateTenant: (spec) => env.AUTH.invalidateTenant(spec),
      bumpTenantCacheVersion: async () => {
        await env.AUTH.bumpTenantCacheVersion?.();
      },
    },
  });
}

export const invalidatorMiddleware = createMiddleware<AppEnv>(
  async (c, next) => {
    c.set("invalidator", createServerInvalidator(c.env));
    await next();
  }
);
