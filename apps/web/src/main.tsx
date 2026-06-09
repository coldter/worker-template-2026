import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";
import AppError from "@/modules/common/app-error";
import { FullPageLoadingState } from "@/modules/common/full-page-loading-state";
import { queryClient } from "@/query/query-client";
import { routeTree } from "./routeTree.gen";

const router = createRouter({
  scrollRestoration: true,
  scrollRestorationBehavior: "smooth",
  defaultHashScrollIntoView: { behavior: "smooth" },
  routeTree,
  defaultPendingComponent: () => <FullPageLoadingState />,
  defaultErrorComponent: AppError,
  context: {
    queryClient,
    session: null,
  },
  defaultPendingMinMs: 0,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element not found");
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);

  // Render immediately so the app shell paints while the protected route's
  // beforeLoad resolves the session via ensureQueryData. The session is no
  // longer awaited up front: the protected beforeLoad is the source of truth
  // for the authenticated-redirect, and the router shows defaultPendingComponent
  // while it is in flight.
  root.render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider
        context={{ queryClient, session: null }}
        router={router}
      />
    </QueryClientProvider>
  );
}
