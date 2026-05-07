import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Operator } from "./types";

/**
 * Operator identity probe.
 *
 * Behind Cloudflare Access, the SPA does not run a sign-in flow — when the
 * browser reaches the SPA shell, the edge already attached a verified
 * `cf-access-jwt-assertion` cookie. This call exchanges that cookie for the
 * admin worker's view of the operator row (id / email / role / status).
 *
 * TODO(api-gen): the admin worker has no `/api/admin/me` route yet. Until
 * it ships, this query will 404 and the OperatorProvider falls back to the
 * "Session expired" screen. Wire the route in `apps/admin/src/server.ts`
 * and regenerate the OpenAPI client.
 */
export const operatorQueryOptions = queryOptions({
  queryKey: ["operator", "me"] as const,
  queryFn: async ({ signal }): Promise<Operator> =>
    apiFetch<Operator>("/api/admin/me", { signal }),
  staleTime: 60_000,
  gcTime: 5 * 60_000,
  retry: false,
});
