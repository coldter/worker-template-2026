// SPA bootstrap (D44, D47). The order matters:
//   1. Resolve the tenant (per-host) so we know which BA providers/SSO are
//      available and what to brand the page as.
//   2. Apply branding (CSP-safe `setProperty`) BEFORE the first paint so the
//      shell doesn't flash unbranded.
//   3. Mount the router with `tenant` in context so route loaders can use it
//      without re-fetching.
//
// If the host doesn't map to a tenant we render the dedicated TenantNotFound
// component instead (the apex of `APP_WILDCARD_HOST` is served by a
// different static page — `public/apex/index.html`, D76).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { renderTenantNotFound } from "@/components/tenant-not-found";
import { applyBranding } from "@/lib/branding";
import { resolveTenant } from "@/lib/tenant";
import { routeTree } from "@/routeTree.gen";

const queryClient = new QueryClient();
const router = createRouter({
  routeTree,
  context: { queryClient, tenant: null },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

async function bootstrap() {
  const tenant = await resolveTenant();
  if (!tenant) {
    renderTenantNotFound();
    return;
  }
  applyBranding(tenant.branding);
  const rootEl = document.getElementById("root");
  if (!rootEl) {
    throw new Error("Missing #root");
  }
  createRoot(rootEl).render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider context={{ queryClient, tenant }} router={router} />
    </QueryClientProvider>
  );
}

bootstrap().catch((err) => {
  // Bootstrap failures are unrecoverable — log so the failure shows up in
  // browser devtools / server-side error reporting (B6 wires error
  // boundaries proper). console.error is permitted by biome config.
  console.error("Bootstrap failed:", err);
});
