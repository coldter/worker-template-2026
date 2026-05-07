import type { HostConfig } from "./host-config";
import { SLUG_RE } from "./parse-hostname";

export type DevHeaderResult =
  | { kind: "rewrite"; host: string }
  | {
      kind: "ignore";
      reason: "empty" | "node_env" | "secret_missing" | "slug_format";
    };

export function resolveDevTenantHeader(
  slug: string,
  config: HostConfig
): DevHeaderResult {
  if (!slug) {
    return { kind: "ignore", reason: "empty" };
  }
  if (config.nodeEnv === "production") {
    return { kind: "ignore", reason: "node_env" };
  }
  if (!config.allowDevTenantHeader) {
    return { kind: "ignore", reason: "secret_missing" };
  }
  if (!SLUG_RE.test(slug)) {
    return { kind: "ignore", reason: "slug_format" };
  }
  return { kind: "rewrite", host: `${slug}${config.wildcardSuffix}` };
}
