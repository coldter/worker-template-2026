import { queryOptions, useQuery } from "@tanstack/react-query";

import { listAuditLogs } from "@/api.gen/sdk.gen";
import type { ListAuditLogsData } from "@/api.gen/types.gen";

import { decodeAuditLogMetadata } from "./event-utils";

export type AuditLogsQueryParams = NonNullable<ListAuditLogsData["query"]>;

export const auditLogsKeys = {
  all: ["audit-logs"] as const,
  list: (params: AuditLogsQueryParams) =>
    [...auditLogsKeys.lists(), params] as const,
  lists: () => [...auditLogsKeys.all, "list"] as const,
};

export const auditLogsListQueryOptions = (params: AuditLogsQueryParams) =>
  queryOptions({
    queryFn: async ({ signal }) => {
      const response = await listAuditLogs({ query: params, signal });

      return {
        ...response,
        data: response.data.map((log) => ({
          ...log,
          metadata: decodeAuditLogMetadata(log.metadata),
        })),
      };
    },
    queryKey: auditLogsKeys.list(params),
  });

export const useAuditLogsQuery = (params: AuditLogsQueryParams) =>
  useQuery({
    ...auditLogsListQueryOptions(params),
    placeholderData: (prev) => prev,
  });
