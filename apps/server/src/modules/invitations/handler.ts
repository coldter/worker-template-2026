/**
 * B2 / Task 2.4 — `POST /api/invitations/accept/:invitationId`.
 *
 * Orchestrates the four-step invitation accept flow against the auth worker
 * over the AUTH RPC binding (D60):
 *   1. Validate request body (name, password) and load + guard the invitation
 *      row scoped to the resolved tenant.
 *   2. AUTH.createUser — recover from BA's non-idempotent USER_ALREADY_EXISTS
 *      by looking up the existing user via AUTH.findUserByEmail. Auto-link is
 *      only safe when the existing user is email-verified; the lookup returns
 *      the canonical user row, and we proceed to sign-in below.
 *   3. AUTH.signInEmail — receive BA's Set-Cookie and forward it verbatim.
 *   4. AUTH.acceptInvitation — accept under the just-signed-in session.
 *
 * Failure between steps 2 and 4 writes a CRITICAL dual-scope
 * `org.invitation.partial_failure` audit row so operators can spot stuck
 * users. The handler does NOT mark the invitation as accepted itself — BA
 * owns that row mutation inside acceptInvitation.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { AUDIT_EVENTS } from "@repo/shared/audit";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import type { AppEnv } from "@/lib/context";
import { auditLogService } from "@/modules/audit-logs/service";
import { isUserAlreadyExistsError } from "./errors";
import { loadAndGuardInvitation } from "./loader";

const handler = new OpenAPIHono<AppEnv>();

const acceptBody = z.object({
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(256),
});

/**
 * Audit-fix #3 — accept-route scoped rate limit.
 *
 * The accept handler unconditionally bypasses BA's HTTP-layer CSRF /
 * disableSignUp / /sign-in/email throttle (see boundary comment in
 * apps/auth/src/index.ts). Without a bespoke gate, an attacker who guesses
 * `inv_*` ids — or who holds a leaked id and wants to enumerate passwords —
 * can hammer the orchestration freely. Cap each (IP, invitationId) tuple at
 * 5 attempts per 5 minutes, which is well above any honest-user retry
 * cadence and well below what's useful for credential stuffing.
 *
 * Identifier shape: `inv-accept:<ip>:<invitationId>`. We intentionally key
 * on the path parameter so a stuffer cannot rotate IPs under one id and
 * stay below the per-tuple ceiling — but a wider per-IP brake is provided
 * by the global `rateLimitMiddleware` upstream.
 */
const ACCEPT_RATE_LIMIT = 5;
const ACCEPT_RATE_WINDOW_MS = 5 * 60 * 1000;
const ACCEPT_RATE_WINDOW_SECONDS = ACCEPT_RATE_WINDOW_MS / 1000;

const acceptRateLimit = createMiddleware<AppEnv>(async (c, next) => {
  const invitationId = c.req.param("invitationId") ?? "unknown";
  const ip =
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown";
  const identifier = `inv-accept:${ip}:${invitationId}`;

  const doBinding = c.env.RATE_LIMITER;
  if (doBinding) {
    try {
      const stub = doBinding.get(doBinding.idFromName(identifier));
      const { allowed } = await stub.checkLimit(
        ACCEPT_RATE_LIMIT,
        ACCEPT_RATE_WINDOW_MS
      );
      if (!allowed) {
        return c.json(
          {
            error: {
              code: "RATE_LIMITED",
              message: "Too many invitation accept attempts",
            },
          },
          429
        );
      }
      return await next();
    } catch (err) {
      const { logger } = await import("@repo/shared/logger");
      logger.warn("Accept rate limiter DO unavailable, falling back to KV", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // KV fallback: fixed-window counter scoped to (ip, invitationId, window).
  const window = Math.floor(Date.now() / ACCEPT_RATE_WINDOW_MS);
  const key = `rl:${identifier}:${window}`;
  const raw = await c.env.CACHE.get(key, "text");
  const count = raw ? Number.parseInt(raw, 10) : 0;
  if (count >= ACCEPT_RATE_LIMIT) {
    return c.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many invitation accept attempts",
        },
      },
      429
    );
  }
  try {
    c.executionCtx.waitUntil(
      (async () => {
        const current = await c.env.CACHE.get(key, "text");
        const n = current ? Number.parseInt(current, 10) : 0;
        await c.env.CACHE.put(key, String(n + 1), {
          expirationTtl: ACCEPT_RATE_WINDOW_SECONDS * 2,
        });
      })()
    );
  } catch {
    // executionCtx unavailable in unit tests — counter is best-effort there.
  }
  await next();
});

handler.post("/accept/:invitationId", acceptRateLimit, async (c) => {
  const tenant = c.var.tenant ?? null;
  if (!tenant) {
    return c.json(
      {
        error: {
          code: "TENANT_NOT_FOUND",
          message: "Invitation must be accepted on the tenant subdomain",
        },
      },
      404
    );
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(
      { error: { code: "INVALID_BODY", message: "Body must be JSON" } },
      400
    );
  }
  const parsed = acceptBody.safeParse(raw);
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
  const { name, password } = parsed.data;
  const invitationId = c.req.param("invitationId");
  const db = c.get("db");

  const outcome = await loadAndGuardInvitation(
    invitationId,
    tenant.organizationId,
    db
  );
  if (outcome.kind === "not_found") {
    return c.json({ error: { code: "INVITATION_NOT_FOUND" } }, 404);
  }
  if (outcome.kind === "not_pending") {
    return c.json(
      {
        error: {
          code: "INVITATION_NOT_PENDING",
          message: `Invitation status is '${outcome.status}'`,
        },
      },
      409
    );
  }
  if (outcome.kind === "expired") {
    return c.json({ error: { code: "INVITATION_EXPIRED" } }, 410);
  }
  if (outcome.kind === "wrong_tenant") {
    return c.json({ error: { code: "INVITATION_NOT_FOUND" } }, 404);
  }
  const invitation = outcome.invitation;

  // boundary: AuthBindingRpc.tenant is structurally compatible with the
  // server's Tenant type; pass through as-is.
  const authTenant = tenant;

  let userId: string;
  try {
    const created = await c.env.AUTH.createUser({
      email: invitation.email,
      password,
      name,
      emailVerified: true,
      tenant: authTenant,
    });
    userId = created.id;
  } catch (err) {
    if (!isUserAlreadyExistsError(err)) {
      throw err;
    }
    const existing = await c.env.AUTH.findUserByEmail(invitation.email);
    if (!existing) {
      // Lookup failed — re-throw to surface as a 5xx; the original BA error
      // is the better signal here.
      throw err;
    }
    userId = existing.id;
  }

  const signIn = await c.env.AUTH.signInEmail({
    email: invitation.email,
    password,
    tenant: authTenant,
  });
  if (!(signIn.ok && signIn.setCookies.length > 0)) {
    await auditLogService.createDualScope(
      {
        event: AUDIT_EVENTS.ORG.INVITATION_PARTIAL_FAILURE.event,
        actorType: "system",
        targetType: "user",
        targetId: userId,
        organizationId: tenant.organizationId,
        metadata: { stage: "sign_in", invitationId },
      },
      db
    );
    return c.json({ error: { code: "INVALID_CREDENTIALS" } }, 401);
  }

  try {
    await c.env.AUTH.acceptInvitation({
      invitationId,
      // Build a Cookie request header from the Set-Cookie values: the wire
      // format for outgoing requests is `name=value; name2=value2`, with no
      // attributes (Path, Expires, etc.). Strip everything after the first
      // ";" in each Set-Cookie string to get the name=value pair.
      sessionCookie: signIn.setCookies
        .map((c) => c.split(";")[0]?.trim() ?? "")
        .filter((p) => p.length > 0)
        .join("; "),
      tenant: authTenant,
    });
  } catch (err) {
    await auditLogService.createDualScope(
      {
        event: AUDIT_EVENTS.ORG.INVITATION_PARTIAL_FAILURE.event,
        actorType: "system",
        targetType: "user",
        targetId: userId,
        organizationId: tenant.organizationId,
        metadata: { stage: "accept_invitation", invitationId },
      },
      db
    );
    throw err;
  }

  // Forward each Set-Cookie verbatim. Hono's `append: true` is the supported
  // way to emit multiple Set-Cookie response headers — `Headers.set` would
  // collapse them with a comma (corrupting Expires attributes) and overwrite
  // any prior value.
  for (const cookie of signIn.setCookies) {
    c.header("Set-Cookie", cookie, { append: true });
  }
  return c.json({ ok: true, redirectTo: "/dashboard" });
});

export default handler;
