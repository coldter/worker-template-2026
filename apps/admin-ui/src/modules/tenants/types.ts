// TODO(api-gen): replace with the @hey-api type once
// `apps/admin/openapi.cache.json` is generated.
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
