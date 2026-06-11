import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { StrictMode } from "react";
import { ThemeProvider } from "@/context/theme-provider";
import { brand } from "@/lib/brand";
import { initErrorReporting } from "@/lib/report-error";
import type { Session } from "@/modules/auth";
import AppError from "@/modules/common/app-error";
import { DownAlert } from "@/modules/common/down-alert";
import { NavigationProgress } from "@/modules/common/navigation-progress";
import { NotFoundError } from "@/modules/errors/not-found-error";
import { Toaster } from "@/modules/ui/sonner";
import "../index.css";

export type RouterAppContext = {
  queryClient: QueryClient;
  session: Session | null;
};

initErrorReporting();

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  notFoundComponent: NotFoundError,
  errorComponent: AppError,
  head: () => ({
    meta: [
      {
        title: brand.appName,
      },
      {
        name: "description",
        content: "Web application",
      },
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
    ],
    links: [
      {
        rel: "icon",
        href: "/favicon.ico",
      },
    ],
  }),
});

function RootComponent() {
  return (
    <StrictMode>
      <HeadContent />
      <ThemeProvider defaultTheme="light">
        <NavigationProgress />
        <div className="flex min-h-svh flex-col">
          <main className="flex-1">
            <Outlet />
          </main>
        </div>
        <Toaster richColors />
        <DownAlert />
      </ThemeProvider>
      {/* Dev-only at build time: import.meta.env.DEV is statically tree-shaken in prod. */}
      {import.meta.env.DEV && (
        <>
          <ReactQueryDevtools initialIsOpen={false} />
          <TanStackRouterDevtools position="bottom-left" />
        </>
      )}
    </StrictMode>
  );
}
