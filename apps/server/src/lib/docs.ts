import { env } from "cloudflare:workers";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { AppEnv } from "@/lib/context";

export function setupDocs(app: OpenAPIHono<AppEnv>): void {
  const registry = app.openAPIRegistry;

  registry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "session_token_v1",
    description:
      "Authentication cookie. Copy the cookie from your network tab and paste it here.",
  });

  app.doc31("/openapi.json", {
    servers: [{ url: env.APP_URL }],
    info: {
      title: "Api Reference",
      version: "v1",
      description: "API documentation",
    },
    openapi: "3.1.0",
  });

  app.get("/docs", (c) =>
    Scalar<AppEnv>({
      url: "openapi.json",
      theme: "deepSpace",
      servers: [
        {
          url: new URL(c.req.url).origin,
          description: "Current",
        },
      ],
    })(c, async () => {})
  );
}
