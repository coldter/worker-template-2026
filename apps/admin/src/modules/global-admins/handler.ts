import { OpenAPIHono } from "@hono/zod-openapi";
import { requireOperator } from "@repo/authorization";
import type { AdminEnv } from "@/env";
import { adminOperatorAuditLogger } from "@/lib/operator-audit";

const app = new OpenAPIHono<AdminEnv>();

const audit = { audit: adminOperatorAuditLogger };

// B2 fleshes out create / deactivate / reissue-enrollment handlers.
app.get("/", requireOperator("platform.manage_global_admins", audit), (c) =>
  c.json({ data: [], meta: { total: 0 } }, 200)
);

export default app;
