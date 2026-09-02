import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { isValidRole } from "@/auth/principal";
import { auth } from "@/auth/schema";
import type { AppEnv } from "@/lib/context";
import { dispatchEvent } from "@/lib/events";
import { recordBufferableAuditEvent } from "@/modules/audit-logs/buffer";
import { AUDIT_EVENTS, TARGET_TYPES } from "@/modules/audit-logs/constants";
import { notificationService } from "@/modules/notifications";
import { defaultHook } from "@/utils/default-hook";
import { requireAuthorizedUserId } from "./auth-loader";
import {
  toMyAccountResponse,
  toUserDetailResponse,
  toUserSummaryResponse,
} from "./presenter";
import usersRoutes from "./routes";
import { userService } from "./service";

const app = new OpenAPIHono<AppEnv>({ defaultHook });
function requireCurrentUser(
  c: Context<AppEnv>
): NonNullable<AppEnv["Variables"]["user"]> {
  const currentUser = c.get("user");
  if (!currentUser) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return currentUser;
}

const usersHandler = app
  .openapi(usersRoutes.listUsers, async (c) => {
    const query = c.req.valid("query");
    const result = await userService.find(c.var.db, query);

    recordBufferableAuditEvent(c, {
      actorId: c.get("user")?.id,
      event: AUDIT_EVENTS.USER.LISTED.event,
      metadata: { count: result.data.length },
    });

    return c.json(
      {
        data: result.data.map(toUserSummaryResponse),
        meta: result.meta,
      },
      200
    );
  })

  .openapi(usersRoutes.getMyAccount, async (c) => {
    const currentUser = requireCurrentUser(c);

    const [account, unreadCount] = await Promise.all([
      userService.findAccountSummaryById(c.var.db, currentUser.id),
      notificationService.getUnreadCount(c.var.db, currentUser.id),
    ]);

    if (!account) {
      throw new HTTPException(404, { message: "User not found" });
    }

    return c.json(
      {
        notifications: {
          unreadCount,
        },
        profile: toMyAccountResponse(account),
      },
      200
    );
  })

  .openapi(usersRoutes.getUser, async (c) => {
    const userId = requireAuthorizedUserId(c);
    const user = await userService.findDetailById(c.var.db, userId);

    if (!user) {
      throw new HTTPException(404, { message: "User not found" });
    }

    recordBufferableAuditEvent(c, {
      actorId: c.get("user")?.id,
      event: AUDIT_EVENTS.USER.VIEWED.event,
      targetId: userId,
      targetType: TARGET_TYPES.USER,
    });

    return c.json({ user: toUserDetailResponse(user) }, 200);
  })

  .openapi(usersRoutes.createUser, async (c) => {
    const body = c.req.valid("json");
    const currentUser = requireCurrentUser(c);

    const invalidRoles = body.roleSlugs.filter((r) => !isValidRole(r));
    if (invalidRoles.length > 0) {
      throw new HTTPException(400, {
        message: `Invalid roles: ${invalidRoles.join(", ")}. Valid: ${auth.roleValues.join(", ")}`,
      });
    }

    const user = await userService.create(
      c.var.db,
      body,
      currentUser.id,
      c.var.auditContext
    );

    dispatchEvent(
      {
        payload: { email: user.email, name: user.name, userId: user.id },
        type: "user.created",
      },
      c.executionCtx
    );

    return c.json({ user: toUserSummaryResponse(user) }, 201);
  })

  .openapi(usersRoutes.updateUser, async (c) => {
    const { userId } = c.req.valid("param");
    const body = c.req.valid("json");
    const currentUser = requireCurrentUser(c);

    const user = await userService.update(
      c.var.db,
      userId,
      body,
      currentUser.id,
      c.var.auditContext
    );
    return c.json({ user: toUserSummaryResponse(user) }, 200);
  })

  .openapi(usersRoutes.updateUserRoles, async (c) => {
    const { userId } = c.req.valid("param");
    const body = c.req.valid("json");
    const currentUser = requireCurrentUser(c);

    const invalidRoles = body.roleSlugs.filter((r) => !isValidRole(r));
    if (invalidRoles.length > 0) {
      throw new HTTPException(400, {
        message: `Invalid roles: ${invalidRoles.join(", ")}. Valid: ${auth.roleValues.join(", ")}`,
      });
    }

    const user = await userService.updateRoles(
      c.var.db,
      userId,
      body,
      currentUser.id,
      c.var.auditContext
    );
    return c.json({ user: toUserSummaryResponse(user) }, 200);
  })

  .openapi(usersRoutes.deactivateUser, async (c) => {
    const { userId } = c.req.valid("param");
    const body = c.req.valid("json");
    const currentUser = requireCurrentUser(c);

    await userService.deactivate(
      c.var.db,
      userId,
      body.reason ?? null,
      currentUser.id,
      c.var.auditContext
    );

    return c.json({ success: true }, 200);
  })

  .openapi(usersRoutes.activateUser, async (c) => {
    const { userId } = c.req.valid("param");
    const currentUser = requireCurrentUser(c);
    await userService.activate(
      c.var.db,
      userId,
      currentUser.id,
      c.var.auditContext
    );

    return c.json({ success: true }, 200);
  })

  .openapi(usersRoutes.unlockUser, async (c) => {
    const { userId } = c.req.valid("param");
    const currentUser = requireCurrentUser(c);
    await userService.unlock(
      c.var.db,
      userId,
      currentUser.id,
      c.var.auditContext
    );

    return c.json({ success: true }, 200);
  });

export default usersHandler;
