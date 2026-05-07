import { loadHostConfigOnce, parseHostname } from "@repo/tenancy";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/lib/context";
import { getActiveCustomHostnamesSnapshot } from "@/modules/tenancy/active-hostnames-snapshot";

/**
 * Host-header guard (D29). Rejects with 421 (Misdirected Request) when the
 * inbound Host header is not in the configured allow-list. Pairs with
 * `workers_dev: false` / `preview_urls: false` in wrangler.jsonc so probes
 * targeting the auto-generated workers.dev / preview hostnames never reach
 * downstream middleware.
 *
 * Allow-list (env-derived, no per-request DB lookups):
 *   - configured admin host (HostConfig.adminHost)
 *   - configured fallback host (HostConfig.fallbackHost)
 *   - any DNS-label tenant slug under the configured wildcard suffix
 *   - configured local-dev hosts (HostConfig.localDevHosts)
 *   - any host present in the active-custom-hostnames KV snapshot (A5)
 *
 * The active-custom-hostnames snapshot is a per-isolate cached list; reads
 * never hit the DB. The list is written by the lifecycle service on every
 * transition into/out of `active`.
 */
export const hostHeaderGuard = createMiddleware<AppEnv>(async (c, next) => {
  const config = loadHostConfigOnce(c.env);
  const rawHost = c.req.header("host") ?? "";
  if (!rawHost) {
    return c.text("Misdirected Request", 421);
  }
  const lowered = rawHost.toLowerCase();
  if (config.localDevHosts.includes(lowered)) {
    return next();
  }
  const parsed = parseHostname(rawHost, config);
  if (
    parsed.kind === "subdomain" ||
    parsed.kind === "admin" ||
    parsed.kind === "fallback"
  ) {
    return next();
  }
  if (parsed.kind === "custom") {
    const snapshot = await getActiveCustomHostnamesSnapshot(c.env);
    if (snapshot.has(parsed.host)) {
      return next();
    }
  }
  return c.text("Misdirected Request", 421);
});
