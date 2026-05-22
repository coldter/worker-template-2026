import type { DrizzleClient } from "@repo/db";
import * as schema from "@repo/db/schema";
import type { Session } from "better-auth";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { tolerateMissingOrgTables } from "../lib/org-tables";
import { detectPlatform, SESSION_CONFIG } from "../lib/platform";

const sessionUpdatePayloadSchema = z
  .object({
    activeOrganizationId: z.string().nullable().optional(),
  })
  .passthrough();

const endpointContextWithSessionSchema = z
  .object({
    context: z
      .object({
        session: z
          .object({
            user: z
              .object({ id: z.string().optional() })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export function createSessionUpdateBeforeHook(db: DrizzleClient) {
  return async (
    session: Partial<Session> & Record<string, unknown>,
    context: { headers?: Headers } | null | undefined
  ) => {
    const updateParse = sessionUpdatePayloadSchema.safeParse(session);
    const activeOrganizationIdUpdate =
      updateParse.success && updateParse.data.activeOrganizationId !== undefined
        ? updateParse.data.activeOrganizationId
        : undefined;

    if (activeOrganizationIdUpdate !== undefined) {
      const newOrgId = activeOrganizationIdUpdate;

      if (!newOrgId) {
        return {
          data: { ...session, activeOrgRole: null },
        };
      }

      const endpointParse = endpointContextWithSessionSchema.safeParse(context);
      const userId = endpointParse.success
        ? endpointParse.data.context?.session?.user?.id
        : undefined;

      if (userId) {
        const lookup = await tolerateMissingOrgTables(
          async () => {
            const [row] = await db
              .select({ role: schema.members.role })
              .from(schema.members)
              .where(
                and(
                  eq(schema.members.userId, userId),
                  eq(schema.members.organizationId, newOrgId)
                )
              )
              .limit(1);
            // Wrap row so caller can distinguish "tables missing" (undefined) from "no row" ({ row: undefined }).
            return { row };
          },
          {
            reason: "Skipping activeOrgRole sync: org tables missing",
            meta: { userId },
          }
        );

        if (lookup !== undefined) {
          return {
            data: {
              ...session,
              activeOrgRole: lookup.row?.role ?? null,
            },
          };
        }
      }

      return { data: session };
    }

    if (!session.expiresAt) {
      return { data: session };
    }

    // Update payload omits session id/token, so detect platform from request UA (same as create hook).
    const userAgent = context?.headers?.get("user-agent") ?? null;
    const platform = detectPlatform(userAgent);

    if (platform === "web") {
      return {
        data: {
          ...session,
          expiresAt: new Date(Date.now() + SESSION_CONFIG.web.expiresIn * 1000),
        },
      };
    }

    return { data: session };
  };
}
