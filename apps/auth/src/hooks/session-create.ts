import type { DrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import { getClientIpFromHeaders } from "@repo/shared/client-ip";
import type { Session } from "better-auth";
import { desc, eq } from "drizzle-orm";

import type { AuthBindings } from "../instance";
import type { MinimalExecutionContext } from "../lib/execution-context";
import { tolerateMissingOrgTables } from "../lib/org-tables";
import { detectPlatform, SESSION_CONFIG } from "../lib/platform";

export const createSessionCreateBeforeHook =
  (db: DrizzleClient, env: AuthBindings, ctx: MinimalExecutionContext) =>
  async (
    session: Session,
    context: { headers?: Headers } | null | undefined
  ) => {
    const userAgent = context?.headers?.get("user-agent") ?? null;

    const ipAddress = context?.headers
      ? (getClientIpFromHeaders(context.headers) ?? null)
      : null;

    const platform = detectPlatform(userAgent);
    const config = SESSION_CONFIG[platform];

    const membershipPromise = tolerateMissingOrgTables(
      async () => {
        const [row] = await db
          .select({
            organizationId: schema.members.organizationId,
            role: schema.members.role,
          })
          .from(schema.members)
          .where(eq(schema.members.userId, session.userId))
          .orderBy(desc(schema.members.createdAt))
          .limit(1);

        return row;
      },
      {
        meta: { userId: session.userId },
        reason: "Skipping org context on session create: org tables missing",
      }
    );

    const revokedSessions = await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, session.userId))
      .returning({
        createdAt: schema.sessions.createdAt,
        ipAddress: schema.sessions.ipAddress,
        userAgent: schema.sessions.userAgent,
      });

    let previousSession: (typeof revokedSessions)[number] | undefined;

    for (const candidate of revokedSessions) {
      if (
        previousSession === undefined ||
        candidate.createdAt > previousSession.createdAt
      ) {
        previousSession = candidate;
      }
    }

    if (previousSession) {
      const isNewDevice =
        previousSession.userAgent !== userAgent ||
        previousSession.ipAddress !== ipAddress;

      if (isNewDevice) {
        ctx.waitUntil(
          (async () => {
            try {
              await env.API.onNewDeviceLogin({
                ipAddress: ipAddress ?? "",
                platform,
                userAgent: userAgent ?? "",
                userId: session.userId,
              });
            } catch (error) {
              console.error(
                "Failed to trigger new device notification:",
                error
              );
            }
          })()
        );
      }
    }

    const expiresAt = new Date(Date.now() + config.expiresIn * 1000);

    const firstMembership = await membershipPromise;

    const orgContext = firstMembership
      ? {
          activeOrganizationId: firstMembership.organizationId,
          activeOrgRole: firstMembership.role,
        }
      : null;

    return {
      data: {
        ...session,
        expiresAt,
        platform,
        ...orgContext,
      },
    };
  };
