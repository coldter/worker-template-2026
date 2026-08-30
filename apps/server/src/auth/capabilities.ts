import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { resolvePrincipalFromContext } from "@/auth/middleware";
import { authorization } from "@/auth/registry";
import type { AppEnv } from "@/lib/context";

const app = new OpenAPIHono<AppEnv>();

const capabilitiesRoute = createRoute({
  method: "get",
  operationId: "getAuthorizationCapabilities",
  path: "/",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            capabilities: z.record(z.string(), z.boolean()),
          }),
        },
      },
      description: "User capabilities",
    },
    401: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.object({
              code: z.string(),
              message: z.string(),
            }),
          }),
        },
      },
      description: "Unauthorized",
    },
  },
  summary: "Get current user authorization capabilities",
  tags: ["Authorization"],
});

app.openapi(capabilitiesRoute, async (c) => {
  const principal = resolvePrincipalFromContext(c);

  if (!principal) {
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
      401
    );
  }

  const capabilities = await authorization.evaluateCapabilities(principal);

  // Capabilities are derived purely from the principal's roles/status and
  // change rarely. A short private cache lets the browser skip re-requesting on
  // its own; route guards remain the authoritative server-side check. Kept
  // short so role/status changes propagate quickly.
  c.header("Cache-Control", "private, max-age=30");
  return c.json({ capabilities }, 200);
});

export default app;
