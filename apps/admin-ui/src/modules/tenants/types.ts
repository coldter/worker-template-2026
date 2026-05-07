/**
 * Tenant DTO emitted by the admin worker. Mirrors the durable subset of
 * the `organizations` row that the admin tenants list/detail handlers
 * project. Once `apps/admin/openapi.cache.json` is generated, swap this
 * for the @hey-api type. TODO(api-gen).
 */
export interface AdminTenant {
  createdAt: string;
  id: string;
  name: string;
  primaryAdminEmail?: string | null;
  slug: string;
  status: "active" | "suspended" | "deleted";
  suspendedAt?: string | null;
}

export interface AdminTenantListResponse {
  data: AdminTenant[];
  meta: {
    total: number;
    page?: number;
    pageSize?: number;
  };
}

export interface CreateTenantInput {
  name: string;
  primaryAdminEmail: string;
  slug: string;
}
