import { z } from "@hono/zod-openapi";

export const tenancyCurrentBrandingSchema = z
  .object({
    primaryColor: z.string().nullable(),
    logoUrl: z.string().nullable(),
    appName: z.string().nullable(),
    logoVersion: z.number().int().nullable(),
  })
  .openapi("TenancyCurrentBranding");

export const tenancyCurrentResponseSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    host: z.string(),
    name: z.string(),
    enforceSso: z.boolean(),
    branding: tenancyCurrentBrandingSchema,
  })
  .openapi("TenancyCurrentResponse");

export type TenancyCurrentResponse = z.infer<
  typeof tenancyCurrentResponseSchema
>;
