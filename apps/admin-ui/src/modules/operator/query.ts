import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Operator } from "./types";

/**
 * Operator identity probe. Behind Cloudflare Access the SPA has no sign-in
 * flow: the edge attaches `cf-access-jwt-assertion` before the SPA loads, and
 * this call exchanges that cookie for the operator row.
 */
export const operatorQueryOptions = queryOptions({
  queryKey: ["operator", "me"] as const,
  queryFn: async ({ signal }): Promise<Operator> =>
    apiFetch<Operator>("/api/admin/me", { signal }),
  staleTime: 60_000,
  gcTime: 5 * 60_000,
  retry: false,
});
