import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { invalidateForTenantAction } from "./invalidations";
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
      // TODO(api-gen): admin worker has no GET /tenants/:slug route yet.
      apiFetch<AdminTenant>(`/api/admin/tenants/${slug}`, { signal }),
    enabled: slug.length > 0,
  });

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTenantInput) =>
      apiFetch<AdminTenant>("/api/admin/tenants", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      invalidateForTenantAction(qc, "create", {});
    },
  });
}

export function useSuspendTenant() {
  const qc = useQueryClient();
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
      invalidateForTenantAction(qc, "suspend", {
        organizationId: variables.organizationId,
      });
    },
  });
}

export function useRestoreTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ organizationId }: { organizationId: string }) =>
      apiFetch<void>(`/api/admin/tenants/${organizationId}/restore`, {
        method: "POST",
      }),
    onSuccess: (_data, variables) => {
      invalidateForTenantAction(qc, "restore", {
        organizationId: variables.organizationId,
      });
    },
  });
}

export function useDeleteTenant() {
  const qc = useQueryClient();
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
      invalidateForTenantAction(qc, "delete", {});
    },
  });
}

export const tenantListPageSize = PAGE_SIZE;
