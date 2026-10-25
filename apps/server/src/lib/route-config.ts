import { createRoute } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { NonEmptyTuple } from "type-fest";

export type RouteOptions = Parameters<typeof createRoute>[0] & {
  guard: MiddlewareHandler | NonEmptyTuple<MiddlewareHandler>;
};

export type Route<
  P extends string,
  R extends Omit<RouteOptions, "path"> & {
    path: P;
  },
> = ReturnType<typeof createRoute<P, Omit<R, "guard">>>;

const toMiddlewareList = (
  middleware: MiddlewareHandler | MiddlewareHandler[] | undefined
): MiddlewareHandler[] => {
  if (!middleware) {
    return [];
  }

  return Array.isArray(middleware) ? middleware : [middleware];
};

export const createRouteConfig = <
  P extends string,
  R extends Omit<RouteOptions, "path"> & {
    path: P;
  },
>({
  guard,
  ...routeConfig
}: R): Route<P, R> => {
  const initGuard = Array.isArray(guard) ? guard : [guard];

  const middleware = [
    ...initGuard,
    ...toMiddlewareList(routeConfig.middleware),
  ];

  return createRoute({
    ...routeConfig,
    middleware,
  });
};
