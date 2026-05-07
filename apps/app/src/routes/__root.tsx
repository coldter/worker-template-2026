import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { TenantInfo } from "@/lib/tenant";

export type RouterContext = {
  queryClient: QueryClient;
  tenant: TenantInfo | null;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootRoute,
});

function RootRoute() {
  return <Outlet />;
}
