import { queryOptions, useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { queryClient } from "@/query/query-client";
import type {
  AdminTenant,
  AdminTenantListResponse,
  CreateTenantInput,
} from "./types";

const PAGE_SIZE = 20;

export interface TenantListParams {
  page: number;
  search?: string;
}

export const tenantListQueryOptions = (params: TenantListParams) =>
  queryOptions({
    queryKey: ["tenants", "list", params] as const,
    queryFn: async ({ signal }) =>
      apiFetch<AdminTenantListResponse>("/api/admin/tenants", {
        signal,
        search: {
          page: params.page,
          pageSize: PAGE_SIZE,
          search: params.search,
        },
      }),
  });

export const tenantDetailQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["tenants", "detail", slug] as const,
    queryFn: async ({ signal }) =>
      // TODO(api-gen): the admin worker has no `GET /tenants/:slug` route in
      // B2's stub handler. Once it lands, the @hey-api SDK supersedes this.
      apiFetch<AdminTenant>(`/api/admin/tenants/${slug}`, { signal }),
    enabled: slug.length > 0,
  });

export function useCreateTenant() {
  return useMutation({
    mutationFn: (input: CreateTenantInput) =>
      apiFetch<AdminTenant>("/api/admin/tenants", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants", "list"] });
    },
  });
}

export function useSuspendTenant() {
  return useMutation({
    mutationFn: ({
      organizationId,
      reason,
    }: {
      organizationId: string;
      reason?: string;
    }) =>
      apiFetch<void>(`/api/admin/tenants/${organizationId}/suspend`, {
        method: "POST",
        body: reason ? { reason } : undefined,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tenants", "list"] });
      queryClient.invalidateQueries({
        queryKey: ["tenants", "detail", variables.organizationId],
      });
    },
  });
}

export function useRestoreTenant() {
  return useMutation({
    mutationFn: ({ organizationId }: { organizationId: string }) =>
      apiFetch<void>(`/api/admin/tenants/${organizationId}/restore`, {
        method: "POST",
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tenants", "list"] });
      queryClient.invalidateQueries({
        queryKey: ["tenants", "detail", variables.organizationId],
      });
    },
  });
}

export function useDeleteTenant() {
  return useMutation({
    mutationFn: ({
      organizationId,
      reason,
    }: {
      organizationId: string;
      reason?: string;
    }) =>
      apiFetch<void>(`/api/admin/tenants/${organizationId}`, {
        method: "DELETE",
        body: reason ? { reason } : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
  });
}

export const tenantListPageSize = PAGE_SIZE;
