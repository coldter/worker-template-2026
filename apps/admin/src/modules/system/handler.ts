import { OpenAPIHono } from "@hono/zod-openapi";
import { requireOperator } from "@repo/authorization";
import type { AdminEnv } from "@/env";
import { adminOperatorAuditLogger } from "@/lib/operator-audit";

const app = new OpenAPIHono<AdminEnv>();

const audit = { audit: adminOperatorAuditLogger };

// B2 / C5 — queue + workflow metrics. Stub returns an empty payload so the
// OpenAPI spec includes the route from B1 onward.
app.get(
  "/metrics",
  requireOperator("platform.view_system_metrics", audit),
  (c) => c.json({ queues: [], workflows: [] }, 200)
);

export default app;
