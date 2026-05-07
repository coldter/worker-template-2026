import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { GlobalAdminsPage } from "@/modules/global-admins/global-admins-page";

const search = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

export const Route = createFileRoute("/_app/global-admins")({
  component: GlobalAdminsRouteComponent,
  validateSearch: search,
});

function GlobalAdminsRouteComponent() {
  const navigate = useNavigate();
  const { page } = Route.useSearch();
  const setPage = (next: number) => {
    navigate({ to: "/global-admins", search: { page: next } });
  };
  return <GlobalAdminsPage page={page} setPage={setPage} />;
}
