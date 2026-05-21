import { OpenAPIHono } from "@hono/zod-openapi";
import { requireOperator } from "@repo/authorization";
import type { AdminEnv } from "@/env";
import { adminOperatorAuditLogger } from "@/lib/operator-audit";

const app = new OpenAPIHono<AdminEnv>();

const audit = { audit: adminOperatorAuditLogger };

app.get("/", requireOperator("platform.view_audit_logs_global", audit), (c) =>
  c.json({ data: [], meta: { total: 0 } }, 200)
);

export default app;
