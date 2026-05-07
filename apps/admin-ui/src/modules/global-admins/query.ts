import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AdminGlobalAdminListResponse } from "./types";

const PAGE_SIZE = 25;

export interface GlobalAdminListParams {
  page: number;
}

export const globalAdminListQueryOptions = (params: GlobalAdminListParams) =>
  queryOptions({
    queryKey: ["global-admins", "list", params] as const,
    queryFn: async ({ signal }) =>
      apiFetch<AdminGlobalAdminListResponse>("/api/admin/global-admins", {
        signal,
        search: {
          page: params.page,
          pageSize: PAGE_SIZE,
        },
      }),
  });

export const globalAdminPageSize = PAGE_SIZE;
