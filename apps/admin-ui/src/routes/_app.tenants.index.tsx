import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { TenantsListPage } from "@/modules/tenants/tenants-list-page";

const search = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

export const Route = createFileRoute("/_app/tenants/")({
  component: TenantsListRouteComponent,
  validateSearch: search,
});

function TenantsListRouteComponent() {
  const navigate = useNavigate();
  const { page } = Route.useSearch();
  const setPage = (next: number) => {
    navigate({ to: "/tenants", search: { page: next } });
  };
  return <TenantsListPage page={page} setPage={setPage} />;
}
