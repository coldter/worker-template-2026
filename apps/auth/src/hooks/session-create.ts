import type { DrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import { getClientIpFromHeaders } from "@repo/shared/client-ip";
import type { Session } from "better-auth";
import { desc, eq } from "drizzle-orm";
import type { AuthBindings } from "../instance";
import type { MinimalExecutionContext } from "../lib/execution-context";
import { tolerateMissingOrgTables } from "../lib/org-tables";
import { detectPlatform, SESSION_CONFIG } from "../lib/platform";

export function createSessionCreateBeforeHook(
  db: DrizzleClient,
  env: AuthBindings,
  ctx: MinimalExecutionContext
) {
  return async (
    session: Session & Record<string, unknown>,
    context: { headers?: Headers } | null | undefined
  ) => {
    const userAgent = context?.headers?.get("user-agent") ?? null;
    const ipAddress = context?.headers
      ? (getClientIpFromHeaders(context.headers) ?? null)
      : null;
    const platform = detectPlatform(userAgent);
    const config = SESSION_CONFIG[platform];

    // The org membership lookup is independent of the session read/delete chain
    // below, so start it now and let it run concurrently. It is awaited later
    // where its result is needed.
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
        reason: "Skipping org context on session create: org tables missing",
        meta: { userId: session.userId },
      }
    );

    // Single session per user: revoke existing rows before inserting. RETURNING
    // feeds new-device detection, saving a separate SELECT round trip on the
    // per-request client; sorting by createdAt desc makes the comparison use the
    // latest session instead of whichever row an unordered LIMIT 1 happened to pick.
    const revokedSessions = await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, session.userId))
      .returning({
        userAgent: schema.sessions.userAgent,
        ipAddress: schema.sessions.ipAddress,
        createdAt: schema.sessions.createdAt,
      });

    const [previousSession] = revokedSessions.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    if (previousSession) {
      const isNewDevice =
        previousSession.userAgent !== userAgent ||
        previousSession.ipAddress !== ipAddress;

      if (isNewDevice) {
        ctx.waitUntil(
          env.API.onNewDeviceLogin({
            userId: session.userId,
            ipAddress: ipAddress ?? "",
            userAgent: userAgent ?? "",
            platform,
          }).catch((err: unknown) => {
            console.error("Failed to trigger new device notification:", err);
          })
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
        platform,
        expiresAt,
        ...(orgContext ?? {}),
      },
    };
  };
}
