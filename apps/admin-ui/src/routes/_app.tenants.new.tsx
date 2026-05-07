import { createFileRoute } from "@tanstack/react-router";
import { NewTenantPage } from "@/modules/tenants/new-tenant-page";

export const Route = createFileRoute("/_app/tenants/new")({
  component: NewTenantPage,
});
