// Tenant-facing SPA worker. Public ingress for tenant traffic via Cloudflare
// routes on `*.${APP_WILDCARD_HOST}`, the apex of `${APP_WILDCARD_HOST}`, and
// `${FALLBACK_HOST}` (CF for SaaS fallback origin for tenant custom hostnames).
//
// `apps/server` and `apps/auth` are NOT directly addressable from the public
// internet. Auth traffic also goes through `apps/server` so tenancy middleware
// can call the private auth worker via typed RPC.

// Defense-in-depth CSP at the edge: branches on HTML vs non-HTML, so this
// worker uses raw Response cloning rather than Hono's secureHeaders.
import { cspToHeader, HSTS_VALUE, OTHER_HEADERS, SPA_CSP } from "@repo/shared";

const HTML_CSP = cspToHeader(SPA_CSP);
const HSTS = HSTS_VALUE;

function isHtmlResponse(res: Response): boolean {
  const contentType = res.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("text/html");
}

function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Strict-Transport-Security", HSTS);
  headers.set("X-Content-Type-Options", OTHER_HEADERS.xContentTypeOptions);
  if (isHtmlResponse(res)) {
    headers.set("Content-Security-Policy", HTML_CSP);
    headers.set("Referrer-Policy", OTHER_HEADERS.referrerPolicy);
    headers.set("X-Frame-Options", OTHER_HEADERS.xFrameOptions);
    headers.set(
      "Cross-Origin-Opener-Policy",
      OTHER_HEADERS.crossOriginOpenerPolicy
    );
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

// Defense-in-depth: strip `x-dev-tenant-slug` at the public edge in prod so
// a misconfigured downstream env can never accept tenant-spoofing input.
function stripDevHeadersIfProd(req: Request, env: CloudflareBindings): Request {
  if (env.NODE_ENV !== "production") {
    return req;
  }
  if (!req.headers.has("x-dev-tenant-slug")) {
    return req;
  }
  const headers = new Headers(req.headers);
  headers.delete("x-dev-tenant-slug");
  return new Request(req, { headers });
}

function badGatewayResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "BAD_GATEWAY",
        message: "Upstream service unavailable",
      },
    }),
    {
      status: 502,
      headers: {
        "Content-Type": "application/json",
        "Strict-Transport-Security": HSTS,
        "X-Content-Type-Options": OTHER_HEADERS.xContentTypeOptions,
      },
    }
  );
}

export default {
  fetch: async (req: Request, env: CloudflareBindings) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      const outbound = stripDevHeadersIfProd(req, env);
      try {
        const upstream = await env.API.fetch(outbound);
        return withSecurityHeaders(upstream);
      } catch (err) {
        console.error("apps/app API service binding failed", err);
        return badGatewayResponse();
      }
    }
    const upstream = await env.ASSETS.fetch(req);
    return withSecurityHeaders(upstream);
  },
} satisfies ExportedHandler<CloudflareBindings>;
