/* eslint-disable */
// Hand-rolled placeholder. The full file is regenerated via
// `wrangler types --env-interface CloudflareBindings`. We only need the
// runtime globals here so tsgo / tsc can compile the worker without the
// Cloudflare runtime installed.
//
// Re-generate with:
//   bunx wrangler types --env-interface CloudflareBindings
declare namespace Cloudflare {
  interface Env {
    HYPERDRIVE: Hyperdrive;
    CACHE: KVNamespace;
    ADMIN_UI?: Fetcher;
    API: Fetcher;
    AUTH: Fetcher;
    NODE_ENV: string;
    ADMIN_HOST: string;
    CF_ACCESS_AUD: string;
    CF_ACCESS_TEAM_DOMAIN: string;
    ALLOW_DEV_ADMIN_AUTH?: string;
    LOCAL_DEV_ADMIN_EMAIL?: string;
  }
}

interface CloudflareBindings extends Cloudflare.Env {}
