import { env } from "cloudflare:workers";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { AppEnv } from "@/lib/context";

export function setupDocs(app: OpenAPIHono<AppEnv>): void {
  const registry = app.openAPIRegistry;

  registry.registerComponent("securitySchemes", "cookieAuth", {
    description:
      "Authentication cookie. Copy the cookie from your network tab and paste it here.",
    in: "cookie",
    name: "session_token_v1",
    type: "apiKey",
  });

  app.doc31("/openapi.json", {
    info: {
      description: "API documentation",
      title: "Server API",
      version: "v1",
    },
    openapi: "3.1.0",
    servers: [{ url: env.APP_URL }],
  });

  if (String(env.NODE_ENV) !== "production") {
    app.get("/docs", (c) =>
      Scalar<AppEnv>({
        servers: [
          {
            description: "Current",
            url: new URL(c.req.url).origin,
          },
        ],
        theme: "deepSpace",
        url: "openapi.json",
      })(c, async () => {})
    );
  }
}
