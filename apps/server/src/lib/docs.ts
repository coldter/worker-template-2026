import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";

import type { AppEnv } from "@/lib/context";

export const setupDocs = (app: OpenAPIHono<AppEnv>): void => {
  const registry = app.openAPIRegistry;

  registry.registerComponent("securitySchemes", "cookieAuth", {
    description:
      "Authentication cookie. Copy the cookie from your network tab and paste it here.",
    in: "cookie",
    name: "session_token_v1",
    type: "apiKey",
  });

  app.get("/openapi.json", (c) =>
    c.json(
      app.getOpenAPI31Document({
        info: {
          description: "API documentation",
          title: "Server API",
          version: "v1",
        },
        openapi: "3.1.0",
        servers: [{ url: c.env.APP_URL }],
      })
    )
  );

  app.use("/docs", async (c, next) => {
    if (String(c.env.NODE_ENV) === "production") {
      return c.notFound();
    }

    return await next();
  });

  app.get(
    "/docs",
    Scalar<AppEnv>((c) => ({
      servers: [
        {
          description: "Current",
          url: new URL(c.req.url).origin,
        },
      ],
      theme: "deepSpace",
      url: "openapi.json",
    }))
  );
};
