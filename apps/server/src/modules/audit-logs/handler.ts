import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnv } from "@/lib/context";
import { defaultHook } from "@/utils/default-hook";

import auditLogsRoutes from "./routes";
import { auditLogService } from "./service";

const app = new OpenAPIHono<AppEnv>({ defaultHook });

const auditLogsHandler = app.openapi(
  auditLogsRoutes.listAuditLogs,
  async (c) => {
    const query = c.req.valid("query");
    const tenant = c.get("tenant");
    if (!tenant) {
      return c.json({ error: { code: "TENANT_REQUIRED" } }, 403);
    }
    const result = await auditLogService.find(c.var.db, query, {
      organizationId: tenant.organizationId,
    });

    return c.json(
      {
        data: result.data.map((log) => ({
          ...log,
          createdAt: log.createdAt.toISOString(),
        })),
        meta: result.meta,
      },
      200
    );
  }
);

export default auditLogsHandler;
