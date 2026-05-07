import { KV_VERSION_KEY, tenantCacheRequest } from "./cache-key";

export type InvalidationSpec = Readonly<{
  kind: "subdomain" | "custom";
  host: string;
}>;

export type Invalidator = Readonly<{
  invalidateOwn(spec: InvalidationSpec): Promise<void>;
  bumpOwnVersion(): Promise<string>;
}>;

type InvalidatorEnv = Readonly<{
  CACHE: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
  tenancyCache: {
    match(req: Request): Promise<Response | undefined>;
    put(req: Request, res: Response): Promise<void>;
    delete(req: Request): Promise<boolean>;
  };
}>;

export function createInvalidator(env: InvalidatorEnv): Invalidator {
  return {
    async invalidateOwn(spec) {
      const version = (await env.CACHE.get(KV_VERSION_KEY)) ?? "v0";
      await env.tenancyCache.delete(tenantCacheRequest(version, spec.host));
    },
    async bumpOwnVersion() {
      const next = `v${Date.now()}`;
      await env.CACHE.put(KV_VERSION_KEY, next);
      return next;
    },
  };
}
