import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AuditLogsPage } from "@/modules/audit-logs/audit-logs-page";

const search = z.object({
  page: z.coerce.number().int().min(1).default(1),
  event: z.string().optional(),
  organizationId: z.string().optional(),
});

export const Route = createFileRoute("/_app/audit-logs")({
  component: AuditLogsRouteComponent,
  validateSearch: search,
});

function AuditLogsRouteComponent() {
  const navigate = useNavigate();
  const { page, event, organizationId } = Route.useSearch();

  const onChange = (
    next: Partial<{ page: number; event: string; organizationId: string }>
  ) => {
    navigate({
      to: "/audit-logs",
      search: {
        page: next.page ?? page,
        event: next.event ?? event,
        organizationId: next.organizationId ?? organizationId,
      },
    });
  };

  return (
    <AuditLogsPage
      event={event}
      onChange={onChange}
      organizationId={organizationId}
      page={page}
    />
  );
}
