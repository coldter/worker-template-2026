import { OpenAPIHono } from "@hono/zod-openapi";
import { requireOperator } from "@repo/authorization";
import {
  type AdminApiOperatorIdentity,
  tenantConflictCode,
} from "@repo/shared/api-binding";
import type { AdminEnv } from "@/env";
import { adminOperatorAuditLogger } from "@/lib/operator-audit";
import { createTenantBody } from "./schema";

const app = new OpenAPIHono<AdminEnv>();

// Audit-fix #7 — wire the deny-path audit hook on every operator gate so a
// missing or under-privileged operator surfaces an `operator.access.denied`
// row alongside the 401/403 response.
const audit = { audit: adminOperatorAuditLogger };

// B2 fleshes out create / suspend / delete handlers. B1 ships a list stub
// behind requireOperator(tenant.list) so the integration test can exercise
// the full middleware chain.
app.get("/", requireOperator("tenant.list", audit), (c) =>
  c.json({ data: [], meta: { total: 0 } }, 200)
);

/**
 * Build the operator wire-payload from `c.var.globalAdmin`. The server
 * worker's `AdminApiEntrypoint` only needs the durable subset (id/email/role)
 * for audit + actor fields — the rest of the row stays in the admin worker.
 */
function operatorPayload(admin: {
  id: string;
  email: string;
  role: string;
}): AdminApiOperatorIdentity {
  // The role is one of the four `globalAdmins.role` enum values; the type is
  // narrowed by the Drizzle schema, so a structural mirror suffices here.
  return {
    id: admin.id,
    email: admin.email,
    role: admin.role as AdminApiOperatorIdentity["role"],
  };
}

type OptionalReasonResult =
  | { ok: true; reason: string | undefined }
  | { ok: false; response: Response };

/**
 * Read an optional `{ reason: string }` from a possibly-empty JSON body.
 * Returns `{ ok: true, reason: undefined }` when the body is missing or has
 * no `reason` field, and `{ ok: false }` with a 400 response when the body
 * advertises `application/json` but cannot be parsed (Audit-fix #9). Used by
 * suspend + delete to forward an audit reason without making the body
 * required while still surfacing client-side malformations as a clear 400.
 */
async function readOptionalReason(req: Request): Promise<OptionalReasonResult> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return { ok: true, reason: undefined };
  }
  // Treat a fully empty body as no-reason. `req.text()` lets us peek before
  // parsing so we can distinguish "no body" from "malformed JSON".
  let body: string;
  try {
    body = await req.text();
  } catch {
    return {
      ok: false,
      response: Response.json(
        {
          error: {
            code: "INVALID_BODY",
            message: "Request body could not be read",
          },
        },
        { status: 400 }
      ),
    };
  }
  if (body.length === 0) {
    return { ok: true, reason: undefined };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return {
      ok: false,
      response: Response.json(
        {
          error: {
            code: "INVALID_BODY",
            message: "Request body must be valid JSON",
          },
        },
        { status: 400 }
      ),
    };
  }
  if (!raw || typeof raw !== "object") {
    return { ok: true, reason: undefined };
  }
  const reason = (raw as { reason?: unknown }).reason;
  return {
    ok: true,
    reason:
      typeof reason === "string" && reason.length > 0 ? reason : undefined,
  };
}

/**
 * B2 — operator-led tenant creation. The body is parsed with
 * `createTenantBody` (slug shape + reserved-list filter), then the validated
 * payload is forwarded to the server worker's `AdminApiEntrypoint` over the
 * `API` service binding. The server runs the org + invitation + dual-scope
 * audit inserts in a single Postgres transaction (D23 / D25 / D35).
 */
app.post(
  "/",
  requireOperator("tenant.create", audit),
  async (c, next) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { error: { code: "INVALID_BODY", message: "Body must be JSON" } },
        400
      );
    }
    const parsed = createTenantBody.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "INVALID_BODY",
            message: "Validation failed",
            issues: parsed.error.issues,
          },
        },
        400
      );
    }
    c.set("createTenantBody", parsed.data);
    return await next();
  },
  async (c) => {
    const operator = c.get("globalAdmin");
    const body = c.get("createTenantBody");
    if (!body) {
      // Guarded earlier by the parsing middleware; the absence of `body`
      // means the parse middleware didn't run, which would be a code defect.
      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Missing parsed body",
          },
        },
        500
      );
    }
    try {
      const result = await c.env.API.createTenantOnBehalfOf(
        operatorPayload(operator),
        body
      );
      return c.json(result, 201);
    } catch (err) {
      // The server worker's AdminApiEntrypoint throws typed slug-conflict
      // errors (SlugReservedError / SlugTakenError). Workers RPC preserves
      // their `name` + `code` fields but not class identity — narrow
      // structurally and map to 409.
      const conflict = tenantConflictCode(err);
      if (conflict) {
        return c.json({ error: { code: conflict } }, 409);
      }
      throw err;
    }
  }
);

/**
 * C6.2 — operator-led tenant suspend. Replaces the legacy
 * `POST /api/admin/tenants/:id/suspend` route on apps/server (A6 stop-gap).
 * Idempotent at the service layer; both first-suspend and re-suspend
 * resolve to 204. Optional `{ reason }` body is forwarded to the audit.
 */
app.post(
  "/:organizationId/suspend",
  requireOperator("tenant.suspend", audit),
  async (c) => {
    const operator = c.get("globalAdmin");
    const organizationId = c.req.param("organizationId");
    const parsed = await readOptionalReason(c.req.raw);
    if (!parsed.ok) {
      return parsed.response;
    }
    await c.env.API.suspendTenant(
      organizationId,
      operatorPayload(operator),
      parsed.reason
    );
    return new Response(null, { status: 204 });
  }
);

/**
 * C6.2 — operator-led tenant restore. Replaces the legacy
 * `POST /api/admin/tenants/:id/restore` route on apps/server (A6 stop-gap).
 * Clears `suspended_at` only — `session_version` is intentionally left
 * untouched so previously revoked JWTs stay revoked (D34).
 */
app.post(
  "/:organizationId/restore",
  requireOperator("tenant.restore", audit),
  async (c) => {
    const operator = c.get("globalAdmin");
    const organizationId = c.req.param("organizationId");
    await c.env.API.restoreTenant(organizationId, operatorPayload(operator));
    return new Response(null, { status: 204 });
  }
);

/**
 * C6.2 — operator-led tenant soft-delete (D54). super_admin only — the
 * `requireOperator("tenant.delete")` gate enforces the role split. The
 * server worker tombstones the slug into `reserved_slugs` so a future
 * tenant cannot reclaim it.
 */
app.delete(
  "/:organizationId",
  requireOperator("tenant.delete", audit),
  async (c) => {
    const operator = c.get("globalAdmin");
    const organizationId = c.req.param("organizationId");
    const parsed = await readOptionalReason(c.req.raw);
    if (!parsed.ok) {
      return parsed.response;
    }
    await c.env.API.deleteTenant(
      organizationId,
      operatorPayload(operator),
      parsed.reason
    );
    return new Response(null, { status: 204 });
  }
);

export default app;
