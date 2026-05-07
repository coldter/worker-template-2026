import { createFileRoute } from "@tanstack/react-router";
import { TenantDetailPage } from "@/modules/tenants/tenant-detail-page";

export const Route = createFileRoute("/_app/tenants/$slug")({
  component: TenantDetailRouteComponent,
});

function TenantDetailRouteComponent() {
  const { slug } = Route.useParams();
  return <TenantDetailPage slug={slug} />;
}
