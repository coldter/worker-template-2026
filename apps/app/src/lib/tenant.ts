// Tenant bootstrap. Called BEFORE the router mounts so the SPA can apply
// per-tenant branding (B6) and resolve which auth providers are available.
//
// In development a wildcard cookie domain isn't always feasible, so the SPA
// can opt-in to a `x-dev-tenant-slug` header that the server's tenancy
// middleware accepts when `ALLOW_DEV_TENANT_HEADER=true` (D44).

export type TenantInfo = {
  organizationId: string;
  slug: string;
  enforceSSO: boolean;
  providers: Array<{ providerId: string; label: string }>;
  branding: { logoUrl?: string; primaryColor?: string; appName: string };
};

export async function resolveTenant(): Promise<TenantInfo | null> {
  const headers: Record<string, string> = {};
  if (import.meta.env.DEV && import.meta.env.VITE_DEV_TENANT_SLUG) {
    headers["x-dev-tenant-slug"] = import.meta.env.VITE_DEV_TENANT_SLUG;
  }
  const r = await fetch(`${window.location.origin}/api/tenancy/current`, {
    credentials: "include",
    headers,
  });
  if (!r.ok) {
    return null;
  }
  // boundary: server response shape narrowed at this trust boundary —
  // /api/tenancy/current is owned by apps/server and returns TenantInfo.
  return (await r.json()) as TenantInfo;
}
