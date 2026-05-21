import { isValidSlug } from "@repo/tenancy";
import { z } from "zod";

// Pre-filters slugs against the built-in reserved list so the server-side
// insert avoids rolling back on a reserved name; the DB `reserved_slugs`
// table is still the authoritative gate server-side.
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
