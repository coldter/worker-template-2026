import { isValidSlug } from "@repo/tenancy";
import { z } from "zod";

/**
 * B2 — request body for `POST /api/admin/tenants`. Slug is shape-checked
 * AND filtered against the built-in reserved list (e.g. "admin", "api")
 * before the entrypoint runs, so the server-side insert never has to roll
 * back over a reserved name. The DB-backed `reserved_slugs` table is still
 * consulted server-side as the authoritative gate (D32 / A1c).
 */
export const createTenantBody = z.object({
  slug: z.string().min(1).max(63).refine(isValidSlug, {
    message: "Invalid or reserved slug",
  }),
  name: z.string().min(1).max(120),
  primaryAdminEmail: z
    .string()
    .email()
    .transform((s) => s.toLowerCase().trim()),
});

export type CreateTenantBody = z.infer<typeof createTenantBody>;
