import type { GlobalAdminRole } from "@repo/authorization";

/**
 * The minimal operator identity surface consumed by the SPA. This mirrors
 * the durable subset of `apps/admin/src/env.d.ts`'s `globalAdmin` row that
 * the admin worker is expected to expose at `GET /api/admin/me`.
 *
 * TODO(api-gen): once the admin worker ships an OpenAPI-described
 * `/api/admin/me` endpoint, swap this hand-typed shape for the generated
 * type. See `apps/admin/src/server.ts` — the route does not exist yet.
 */
export interface Operator {
  email: string;
  id: string;
  role: GlobalAdminRole;
  status: "active" | "deactivated";
}

export type OperatorRole = GlobalAdminRole;
