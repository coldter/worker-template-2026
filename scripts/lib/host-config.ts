// Pure helpers shared by `setup-env.ts`, `check-hosts.ts`, and `seed-dev.ts`.
// All functions are I/O-free except `loadRootEnv`. Renderers return strings
// so callers can either write or diff them.

import { readFileSync } from "node:fs";

const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const SLUG_RE = /^[a-z0-9-]+$/;

export type RootHostEnv = Readonly<{
  rootDomain: string;
  appWildcardHost: string;
  adminHost: string;
  fallbackHost: string;
  customHostCnameTarget: string;
  customHostVerificationLabel: string;
  brandingHost: string;
  localAppWildcardHost: string;
  localAdminHost: string;
  localFallbackHost: string;
  defaultDevTenantSlug: string;
  defaultDevCustomHost: string;
}>;

function requireHost(name: string, value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`host-config: ${name} is required`);
  }
  if (!HOST_RE.test(value)) {
    throw new Error(
      `host-config: ${name} must be lowercase, no leading/trailing dot (got "${value}")`
    );
  }
  return value;
}

function requireNonEmpty(name: string, value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`host-config: ${name} is required`);
  }
  return value;
}

function requireSlug(name: string, value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`host-config: ${name} is required`);
  }
  if (!SLUG_RE.test(value)) {
    throw new Error(
      `host-config: ${name} must be slug-shaped (got "${value}")`
    );
  }
  return value;
}

export function parseRootHostEnv(input: Record<string, string>): RootHostEnv {
  return Object.freeze({
    rootDomain: requireHost("ROOT_DOMAIN", input.rootDomain),
    appWildcardHost: requireHost("APP_WILDCARD_HOST", input.appWildcardHost),
    adminHost: requireHost("ADMIN_HOST", input.adminHost),
    fallbackHost: requireHost("FALLBACK_HOST", input.fallbackHost),
    customHostCnameTarget: requireHost(
      "CUSTOM_HOST_CNAME_TARGET",
      input.customHostCnameTarget
    ),
    customHostVerificationLabel: requireNonEmpty(
      "CUSTOM_HOST_VERIFICATION_LABEL",
      input.customHostVerificationLabel
    ),
    brandingHost: requireHost("BRANDING_HOST", input.brandingHost),
    localAppWildcardHost: requireHost(
      "LOCAL_APP_WILDCARD_HOST",
      input.localAppWildcardHost
    ),
    localAdminHost: requireHost("LOCAL_ADMIN_HOST", input.localAdminHost),
    localFallbackHost: requireHost(
      "LOCAL_FALLBACK_HOST",
      input.localFallbackHost
    ),
    defaultDevTenantSlug: requireSlug(
      "DEFAULT_DEV_TENANT_SLUG",
      input.defaultDevTenantSlug
    ),
    defaultDevCustomHost: input.defaultDevCustomHost ?? "",
  });
}

// Local port map kept in one place so the Caddyfile and any future docs
// reference the same numbers.
export const LOCAL_PORTS = Object.freeze({
  web: 3001,
  adminUi: 3002,
  server: 8787,
  auth: 8788,
});

const ENV_KEY_MAP: Record<keyof RootHostEnv, string> = {
  rootDomain: "ROOT_DOMAIN",
  appWildcardHost: "APP_WILDCARD_HOST",
  adminHost: "ADMIN_HOST",
  fallbackHost: "FALLBACK_HOST",
  customHostCnameTarget: "CUSTOM_HOST_CNAME_TARGET",
  customHostVerificationLabel: "CUSTOM_HOST_VERIFICATION_LABEL",
  brandingHost: "BRANDING_HOST",
  localAppWildcardHost: "LOCAL_APP_WILDCARD_HOST",
  localAdminHost: "LOCAL_ADMIN_HOST",
  localFallbackHost: "LOCAL_FALLBACK_HOST",
  defaultDevTenantSlug: "DEFAULT_DEV_TENANT_SLUG",
  defaultDevCustomHost: "DEFAULT_DEV_CUSTOM_HOST",
};

export function parseDotenv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadRootEnv(envPath: string): RootHostEnv {
  const raw = readFileSync(envPath, "utf8");
  const parsed = parseDotenv(raw);
  const candidate: Record<string, string> = {};
  for (const [field, key] of Object.entries(ENV_KEY_MAP) as [
    keyof RootHostEnv,
    string,
  ][]) {
    const value = parsed[key];
    if (value !== undefined) {
      candidate[field] = value;
    }
  }
  return parseRootHostEnv(candidate);
}

export type DerivedHostConfig = Readonly<{
  env: RootHostEnv;
  wildcardSuffix: string; // ".app.example.com" — leading dot per HostConfig contract
  localWildcardSuffix: string; // ".app.lvh.me"
  routePatterns: Readonly<{
    server: readonly string[];
    auth: readonly string[];
  }>;
  cspAllowlist: readonly string[];
  jwtIssuer: string;
  jwtAudience: string;
  oidcCallbackTemplate: string;
  cnameInstructions: string;
  mkcertSans: readonly string[];
}>;

export function deriveHostConfig(env: RootHostEnv): DerivedHostConfig {
  const wildcardSuffix = `.${env.appWildcardHost}`;
  const localWildcardSuffix = `.${env.localAppWildcardHost}`;
  const sans: string[] = [
    `*.${env.localAppWildcardHost}`,
    env.localAdminHost,
    env.localFallbackHost,
    "lvh.me",
  ];
  if (env.defaultDevCustomHost.length > 0) {
    sans.push(env.defaultDevCustomHost);
  }
  return Object.freeze({
    env,
    wildcardSuffix,
    localWildcardSuffix,
    routePatterns: Object.freeze({
      server: Object.freeze([
        `*.${env.appWildcardHost}/api/*`,
        `${env.fallbackHost}/api/*`,
      ]),
      auth: Object.freeze([
        `*.${env.appWildcardHost}/api/auth/*`,
        `${env.fallbackHost}/api/auth/*`,
        `${env.adminHost}/api/auth/*`,
      ]),
    }),
    cspAllowlist: Object.freeze([
      `https://*.${env.appWildcardHost}`,
      `https://${env.adminHost}`,
      `https://${env.brandingHost}`,
      `https://${env.fallbackHost}`,
    ]),
    jwtIssuer: `https://${env.adminHost}`,
    jwtAudience: `https://${env.appWildcardHost}`,
    oidcCallbackTemplate: `https://{slug}.${env.appWildcardHost}/api/auth/sso/callback/{providerId}`,
    cnameInstructions: `CNAME ${env.customHostCnameTarget}; TXT ${env.customHostVerificationLabel}=<token>`,
    mkcertSans: Object.freeze(sans),
  });
}

const GENERATED_BANNER =
  "// GENERATED by bun run setup:env from root .env — do not hand-edit. Run bun run check:hosts to verify.";
const GENERATED_BANNER_HASH =
  "# GENERATED by bun run setup:env from root .env — do not hand-edit. Run bun run check:hosts to verify.";

export type RenderTarget = "server" | "auth" | "admin";

export function renderWorkerVars(
  cfg: DerivedHostConfig,
  target: RenderTarget
): string {
  const { env, localWildcardSuffix } = cfg;
  if (target === "server") {
    const vars = {
      WILDCARD_SUFFIX: localWildcardSuffix,
      ADMIN_HOST: env.localAdminHost,
      FALLBACK_HOST: env.localFallbackHost,
      LOCAL_DEV_HOSTS: `localhost:${LOCAL_PORTS.web},localhost:${LOCAL_PORTS.adminUi}`,
      CUSTOM_HOST_CNAME_TARGET: env.customHostCnameTarget,
      CUSTOM_HOST_VERIFICATION_LABEL: env.customHostVerificationLabel,
      BRANDING_HOST: env.brandingHost,
    };
    return `${GENERATED_BANNER}\n${JSON.stringify({ vars }, null, 2)}\n`;
  }
  if (target === "admin") {
    // The admin worker only needs ADMIN_HOST today, but keeping the same
    // shape as server/auth lets future fields (FALLBACK_HOST, etc.) ride in
    // without a renderer rewrite.
    const vars = {
      ADMIN_HOST: env.localAdminHost,
    };
    return `${GENERATED_BANNER}\n${JSON.stringify({ vars }, null, 2)}\n`;
  }
  const vars = {
    WILDCARD_SUFFIX: localWildcardSuffix,
    ADMIN_HOST: env.localAdminHost,
    FALLBACK_HOST: env.localFallbackHost,
    LOCAL_DEV_HOSTS: `localhost:${LOCAL_PORTS.web},localhost:${LOCAL_PORTS.adminUi}`,
  };
  return `${GENERATED_BANNER}\n${JSON.stringify({ vars }, null, 2)}\n`;
}

export function renderDevVars(
  cfg: DerivedHostConfig,
  target: RenderTarget
): string {
  // .dev.vars is dotenv-shaped; only secrets and dev-only flags belong here.
  // Real secrets are populated by the existing setup-env.sh from the root .env
  // (BETTER_AUTH_SECRET, RESEND_API_KEY, etc.). The TS generator only owns
  // the dev-tenant header gate flags so the gate stays fail-closed by default.
  const lines: string[] = [GENERATED_BANNER_HASH];
  if (target === "server") {
    lines.push("ALLOW_DEV_TENANT_HEADER=true");
    lines.push("ALLOW_DEV_TENANT_AUTH=false");
  } else {
    lines.push("ALLOW_DEV_TENANT_HEADER=true");
    lines.push("ALLOW_DEV_TENANT_AUTH=false");
  }
  // The `cfg` arg is reserved for future expansion (per-target host
  // overrides). Keep it on the signature; the body is intentionally constant.
  if (cfg === undefined) {
    throw new Error("renderDevVars: cfg is required");
  }
  return `${lines.join("\n")}\n`;
}

export function renderWebEnv(cfg: DerivedHostConfig): string {
  const { env } = cfg;
  const lines = [
    GENERATED_BANNER_HASH,
    `VITE_APP_WILDCARD_HOST=${env.localAppWildcardHost}`,
    `VITE_ADMIN_HOST=${env.localAdminHost}`,
    `VITE_FALLBACK_HOST=${env.localFallbackHost}`,
    `VITE_DEV_TENANT_SLUG=${env.defaultDevTenantSlug}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function renderCaddyfile(cfg: DerivedHostConfig): string {
  const { env } = cfg;
  const apiHost = `localhost:${LOCAL_PORTS.server}`;
  const authHost = `localhost:${LOCAL_PORTS.auth}`;
  const webHost = `localhost:${LOCAL_PORTS.web}`;
  const adminHost = `localhost:${LOCAL_PORTS.adminUi}`;
  const customBlock =
    env.defaultDevCustomHost.length > 0
      ? `\n${env.defaultDevCustomHost} {\n  tls ./certs/cert.pem ./certs/key.pem\n  header_up Host {host}\n  handle /api/auth/* { reverse_proxy ${authHost} }\n  handle /api/* { reverse_proxy ${apiHost} }\n  handle /* { reverse_proxy ${webHost} }\n}\n`
      : "";
  const lines = [
    GENERATED_BANNER_HASH,
    "{",
    "  auto_https off",
    "  admin off",
    "}",
    "",
    `*.${env.localAppWildcardHost} {`,
    "  tls ./certs/cert.pem ./certs/key.pem",
    "  header_up Host {host}",
    `  handle /api/auth/* { reverse_proxy ${authHost} }`,
    `  handle /api/* { reverse_proxy ${apiHost} }`,
    `  handle /* { reverse_proxy ${webHost} }`,
    "}",
    "",
    `${env.localAdminHost} {`,
    "  tls ./certs/cert.pem ./certs/key.pem",
    "  header_up Host {host}",
    `  handle /api/auth/* { reverse_proxy ${authHost} }`,
    `  handle /api/* { reverse_proxy ${apiHost} }`,
    `  handle /* { reverse_proxy ${adminHost} }`,
    "}",
    customBlock,
  ];
  return `${lines.filter((l) => l !== "").join("\n")}\n`;
}

export function renderMkcertSans(cfg: DerivedHostConfig): string {
  return `${cfg.mkcertSans.join("\n")}\n`;
}

export type Artifact = Readonly<{
  // Path relative to the repo root.
  path: string;
  // Encoded contents the generator would emit.
  content: string;
}>;

export function renderAllArtifacts(cfg: DerivedHostConfig): Artifact[] {
  return [
    {
      path: "apps/server/wrangler.jsonc.fragment.json",
      content: renderWorkerVars(cfg, "server"),
    },
    {
      path: "apps/auth/wrangler.jsonc.fragment.json",
      content: renderWorkerVars(cfg, "auth"),
    },
    {
      path: "apps/admin/wrangler.jsonc.fragment.json",
      content: renderWorkerVars(cfg, "admin"),
    },
    {
      path: "apps/server/.dev.vars.tenancy",
      content: renderDevVars(cfg, "server"),
    },
    {
      path: "apps/auth/.dev.vars.tenancy",
      content: renderDevVars(cfg, "auth"),
    },
    {
      path: "apps/admin-ui/.env.development",
      content: renderWebEnv(cfg),
    },
    {
      path: "local-harness/Caddyfile",
      content: renderCaddyfile(cfg),
    },
    {
      path: "local-harness/mkcert-sans.txt",
      content: renderMkcertSans(cfg),
    },
  ];
}

export type HardcodedHit = Readonly<{
  path: string;
  line: number;
  value: string;
}>;

export function findHardcodedHosts(
  artifacts: readonly Artifact[],
  baselineEnv: RootHostEnv,
  activeEnv: RootHostEnv
): HardcodedHit[] {
  // Find any baseline value that leaked into an artifact when the active env
  // does NOT also use that exact value. This catches forgotten string
  // interpolation in the renderers.
  const hits: HardcodedHit[] = [];
  const baselineFields: (keyof RootHostEnv)[] = [
    "appWildcardHost",
    "adminHost",
    "fallbackHost",
    "customHostCnameTarget",
    "brandingHost",
    "customHostVerificationLabel",
    "rootDomain",
  ];
  // Sort by length descending so the longest baseline literal wins when a
  // shorter one (e.g. `example.com` vs `app.example.com`) is a substring.
  const candidates = baselineFields
    .map((field) => ({
      field,
      baseline: baselineEnv[field],
      active: activeEnv[field],
    }))
    .filter(
      (
        c
      ): c is { field: keyof RootHostEnv; baseline: string; active: string } =>
        typeof c.baseline === "string" &&
        c.baseline.length > 0 &&
        c.baseline !== c.active
    )
    .sort((a, b) => b.baseline.length - a.baseline.length);

  for (const artifact of artifacts) {
    const lines = artifact.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) {
        continue;
      }
      // Track the spans of `line` already matched by a longer literal so a
      // shorter substring on the same span doesn't double-report.
      const masked: boolean[] = new Array(line.length).fill(false);
      for (const c of candidates) {
        let from = 0;
        while (from <= line.length) {
          const idx = line.indexOf(c.baseline, from);
          if (idx === -1) {
            break;
          }
          let already = false;
          for (let j = idx; j < idx + c.baseline.length; j++) {
            if (masked[j]) {
              already = true;
              break;
            }
          }
          if (!already) {
            hits.push({
              path: artifact.path,
              line: i + 1,
              value: c.baseline,
            });
            for (let j = idx; j < idx + c.baseline.length; j++) {
              masked[j] = true;
            }
          }
          from = idx + c.baseline.length;
        }
      }
    }
  }
  return hits;
}
