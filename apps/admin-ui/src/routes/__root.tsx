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
import AppError from "@/modules/common/app-error";
import { NavigationProgress } from "@/modules/common/navigation-progress";
import { OperatorProvider } from "@/modules/operator/provider";
import { Toaster } from "@/modules/ui/sonner";
import "../index.css";

export type RouterAppContext = {
  queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  errorComponent: AppError,
  head: () => ({
    meta: [
      { title: `${brand.appName} - Operator Console` },
      { name: "description", content: "Operator console" },
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "icon", href: "/favicon.ico" }],
  }),
});

function RootComponent() {
  return (
    <StrictMode>
      <HeadContent />
      <ThemeProvider defaultTheme="light">
        <NavigationProgress />
        <OperatorProvider>
          <Outlet />
        </OperatorProvider>
        <Toaster richColors />
      </ThemeProvider>
      <ReactQueryDevtools initialIsOpen={false} />
      <TanStackRouterDevtools position="bottom-left" />
    </StrictMode>
  );
}
