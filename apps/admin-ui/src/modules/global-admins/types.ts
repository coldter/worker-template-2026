import type { GlobalAdminRole } from "@repo/authorization";

/**
 * Global admin row exposed by the admin worker. TODO(api-gen): swap for
 * the generated type when `apps/admin/openapi.cache.json` ships.
 */
export interface AdminGlobalAdmin {
  createdAt: string;
  email: string;
  id: string;
  lastActiveAt?: string | null;
  role: GlobalAdminRole;
  status: "active" | "deactivated";
}

export interface AdminGlobalAdminListResponse {
  data: AdminGlobalAdmin[];
  meta: { total: number };
}
