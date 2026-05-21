import type { GlobalAdminRole } from "@repo/authorization";

// TODO(api-gen): swap for the generated type once the admin worker ships an
// OpenAPI-described `/api/admin/me` endpoint.
export interface Operator {
  email: string;
  id: string;
  role: GlobalAdminRole;
  status: "active" | "deactivated";
}

export type OperatorRole = GlobalAdminRole;
