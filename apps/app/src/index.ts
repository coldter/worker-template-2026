// apps/app — tenant-facing SPA worker (D40, D45, D58).
//
// Public ingress for tenant traffic. Reachable via Cloudflare routes on
// `*.${APP_WILDCARD_HOST}` (the wildcard subdomain), the apex of
// `${APP_WILDCARD_HOST}`, and `${FALLBACK_HOST}` (CF for SaaS fallback origin
// for tenant custom hostnames).
//
// Routing:
//   - `/api/*`      -> `env.API.fetch(request)`  (server worker via service binding)
//   - everything else -> `env.ASSETS.fetch(request)` (static SPA)
//
// `apps/server` and `apps/auth` are NOT directly addressable from the public
// internet. Auth traffic also goes through `apps/server` so tenancy middleware
// can call the private auth worker via typed RPC.

export default {
  fetch: (req: Request, env: CloudflareBindings) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      return env.API.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<CloudflareBindings>;
