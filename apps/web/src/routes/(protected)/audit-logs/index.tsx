import { createFileRoute } from "@tanstack/react-router";
// zod/mini: autoCodeSplitting cannot extract validateSearch, so classic zod
// here would ship in the eager entry chunk for every visitor.
import * as z from "zod/mini";

import { Authorized } from "@/components/authorized";
import { authorizationCapabilitiesQueryOptions } from "@/hooks/use-authorization";
import { AuditLogs } from "@/modules/audit-logs";
import { auditLogsListQueryOptions } from "@/modules/audit-logs/query";
import { PermissionDenied } from "@/modules/permissions";

export const auditLogsSearchSchema = z.object({
  actorId: z.optional(z.string()),
  event: z.optional(z.string()),
  order: z.optional(z.enum(["asc", "desc"])),
  page: z.catch(z.optional(z.number()), 1),
  perPage: z.catch(z.optional(z.number()), 20),
  sort: z.optional(z.string()),
  targetType: z.optional(z.enum(["user", "role", "session"])),
});

export type AuditLogsSearch = z.infer<typeof auditLogsSearchSchema>;

// Must mirror AuditLogsTable's useTableUrlState derivation exactly; a different
// params object changes the query key and the loader's fetch is wasted.
function auditLogsListParams(search: AuditLogsSearch) {
  return {
    actorId: search.actorId,
    event: search.event,
    order: search.order ?? ("desc" as const),
    page: Math.max(1, search.page ?? 1),
    // useTableUrlState reads the "pageSize" search key, which this schema does
    // not define, so the table always fetches the default page size.
    perPage: 20,
    sort: search.sort ?? "createdAt",
    targetType: search.targetType,
  };
}

export const Route = createFileRoute("/(protected)/audit-logs/")({
  component: () => (
    <Authorized
      capability="audit-log:list"
      fallback={<PermissionDenied requiredPermission="audit-log:list" />}
    >
      <AuditLogs />
    </Authorized>
  ),
  loader: async ({ context, deps }) => {
    const { queryClient } = context;
    // The protected layout's beforeLoad already resolved capabilities via
    // ensureQueryData, so a synchronous cache read is enough here.
    const capabilities = queryClient.getQueryData(
      authorizationCapabilitiesQueryOptions().queryKey
    );
    if (capabilities?.["audit-log:list"]) {
      // prefetchQuery (not ensureQueryData) so fetch failures keep rendering
      // the inline TableError instead of replacing the page with the
      // errorComponent.
      await queryClient.prefetchQuery(
        auditLogsListQueryOptions(auditLogsListParams(deps))
      );
    }
  },
  loaderDeps: ({ search }) => search,
  validateSearch: (search) => auditLogsSearchSchema.parse(search),
});
