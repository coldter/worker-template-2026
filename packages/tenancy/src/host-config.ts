export type HostConfig = Readonly<{
  wildcardSuffix: string;
  adminHost: string;
  fallbackHost: string;
  localDevHosts: readonly string[];
  allowDevTenantHeader: boolean;
  nodeEnv: "development" | "test" | "production";
}>;

type Env = {
  WILDCARD_SUFFIX: string;
  ADMIN_HOST: string;
  FALLBACK_HOST: string;
  LOCAL_DEV_HOSTS?: string;
  NODE_ENV: string;
  ALLOW_DEV_TENANT_HEADER?: string;
};

const configCache = new WeakMap<object, HostConfig>();

export function loadHostConfigOnce(env: Env): HostConfig {
  const cached = configCache.get(env);
  if (cached) {
    return cached;
  }
  const wildcardSuffix = env.WILDCARD_SUFFIX;
  const adminHost = env.ADMIN_HOST;
  if (!wildcardSuffix.startsWith(".")) {
    throw new Error(
      "WILDCARD_SUFFIX must have a leading dot (e.g. '.app.example.com')"
    );
  }
  if (
    adminHost !== adminHost.toLowerCase() ||
    adminHost !== adminHost.normalize("NFC")
  ) {
    throw new Error("ADMIN_HOST must be lowercase NFC");
  }
  if (
    adminHost === wildcardSuffix.slice(1) ||
    adminHost.endsWith(wildcardSuffix)
  ) {
    throw new Error("ADMIN_HOST and WILDCARD_SUFFIX collide");
  }
  const nodeEnv =
    env.NODE_ENV === "development" || env.NODE_ENV === "test"
      ? env.NODE_ENV
      : "production";
  const config: HostConfig = Object.freeze({
    wildcardSuffix,
    adminHost,
    fallbackHost: env.FALLBACK_HOST,
    localDevHosts: Object.freeze(
      (env.LOCAL_DEV_HOSTS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
    allowDevTenantHeader: env.ALLOW_DEV_TENANT_HEADER === "true",
    nodeEnv,
  });
  configCache.set(env, config);
  return config;
}
