import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AdminAuditLogListResponse } from "./types";

const PAGE_SIZE = 25;

export interface AuditLogListParams {
  event?: string;
  organizationId?: string;
  page: number;
}

export const auditLogListQueryOptions = (params: AuditLogListParams) =>
  queryOptions({
    queryKey: ["audit-logs", "list", params] as const,
    queryFn: async ({ signal }) =>
      apiFetch<AdminAuditLogListResponse>("/api/admin/audit-logs", {
        signal,
        search: {
          page: params.page,
          pageSize: PAGE_SIZE,
          event: params.event,
          organizationId: params.organizationId,
        },
      }),
  });

export const auditLogPageSize = PAGE_SIZE;
