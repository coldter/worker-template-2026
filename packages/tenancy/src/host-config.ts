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

function requireLowercaseNFC(name: string, value: string): string {
  if (value !== value.toLowerCase() || value !== value.normalize("NFC")) {
    throw new Error(`${name} must be lowercase NFC`);
  }
  return value;
}

export function loadHostConfigOnce(env: Env): HostConfig {
  const cached = configCache.get(env);
  if (cached) {
    return cached;
  }
  const wildcardSuffix = env.WILDCARD_SUFFIX;
  const adminHost = env.ADMIN_HOST;
  const fallbackHost = env.FALLBACK_HOST;
  if (!wildcardSuffix.startsWith(".")) {
    throw new Error(
      "WILDCARD_SUFFIX must have a leading dot (e.g. '.app.example.com')"
    );
  }
  requireLowercaseNFC("ADMIN_HOST", adminHost);
  requireLowercaseNFC("FALLBACK_HOST", fallbackHost);
  const wildcardBase = wildcardSuffix.slice(1);
  if (adminHost === wildcardBase || adminHost.endsWith(wildcardSuffix)) {
    throw new Error("ADMIN_HOST and WILDCARD_SUFFIX collide");
  }
  if (fallbackHost === adminHost) {
    throw new Error("FALLBACK_HOST and ADMIN_HOST collide");
  }
  if (fallbackHost === wildcardBase || fallbackHost.endsWith(wildcardSuffix)) {
    throw new Error("FALLBACK_HOST and WILDCARD_SUFFIX collide");
  }
  const localDevHostsRaw = (env.LOCAL_DEV_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const localDevHosts = localDevHostsRaw.map((host) =>
    requireLowercaseNFC("LOCAL_DEV_HOSTS entry", host)
  );
  const nodeEnv =
    env.NODE_ENV === "development" || env.NODE_ENV === "test"
      ? env.NODE_ENV
      : "production";
  const config: HostConfig = Object.freeze({
    wildcardSuffix,
    adminHost,
    fallbackHost,
    localDevHosts: Object.freeze(localDevHosts),
    allowDevTenantHeader: env.ALLOW_DEV_TENANT_HEADER === "true",
    nodeEnv,
  });
  configCache.set(env, config);
  return config;
}
