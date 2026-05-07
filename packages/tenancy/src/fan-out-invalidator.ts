import {
  createInvalidator,
  type InvalidationSpec,
  type Invalidator,
} from "./invalidator";

export type FanOutInvalidator = Invalidator &
  Readonly<{
    fanOut(spec: InvalidationSpec): Promise<void>;
    fanOutBumpVersion(): Promise<void>;
  }>;

type PeerRpc = Readonly<{
  invalidateTenant(spec: InvalidationSpec): Promise<void>;
  bumpTenantCacheVersion?: () => Promise<void>;
}>;

type FanOutEnv = Parameters<typeof createInvalidator>[0] &
  Readonly<{
    API: PeerRpc;
    AUTH: PeerRpc;
  }>;

export function createFanOutInvalidator(env: FanOutEnv): FanOutInvalidator {
  const own = createInvalidator(env);
  return {
    ...own,
    async fanOut(spec) {
      await own.invalidateOwn(spec);
      await Promise.all([
        env.API.invalidateTenant(spec),
        env.AUTH.invalidateTenant(spec),
      ]);
    },
    async fanOutBumpVersion() {
      await own.bumpOwnVersion();
      await Promise.all([
        env.API.bumpTenantCacheVersion?.(),
        env.AUTH.bumpTenantCacheVersion?.(),
      ]);
    },
  };
}
