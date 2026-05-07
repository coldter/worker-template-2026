import { z } from "@hono/zod-openapi";

export const customHostnameLifecycleEnum = z
  .enum([
    "pending_txt",
    "awaiting_cf",
    "pre_validation",
    "active",
    "failed",
    "removing",
    "removed",
  ])
  .openapi("CustomHostnameLifecycle");

/**
 * Strict per-label hostname regex (RFC 1035 letter-digit-hyphen, with the
 * additional restriction that a label cannot start or end with a hyphen).
 * Total length is bounded by Zod `.max(253)`. The lifecycle service
 * applies the same regex at `lifecycle.ts:isValidHostname` so the error
 * surfaces at both the route boundary and the service boundary.
 */
const HOSTNAME_LABEL_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/;

export const requestCustomHostnameBodySchema = z
  .object({
    hostname: z
      .string()
      .min(1)
      .max(253)
      .regex(HOSTNAME_LABEL_RE, { message: "invalid hostname format" }),
  })
  .openapi("RequestCustomHostnameBody");

export const requestCustomHostnameResponseSchema = z
  .object({
    id: z.string(),
    hostname: z.string(),
    verificationToken: z.string(),
    verificationLabel: z.string(),
    instructions: z.string(),
  })
  .openapi("RequestCustomHostnameResponse");

export const verifyTxtResponseSchema = z
  .object({
    id: z.string(),
    hostname: z.string(),
    cfHostnameId: z.string().nullable(),
    lifecycleStatus: customHostnameLifecycleEnum,
    cnameTarget: z.string(),
    preValidation: z
      .object({ url: z.string(), body: z.string() })
      .nullable()
      .optional(),
    /**
     * CF-issued DCV TXT records the tenant must add for `ssl.method=txt`.
     * Empty array on idempotency short-circuits before a CF call.
     */
    cfTxtRecords: z
      .array(z.object({ name: z.string(), value: z.string() }))
      .optional(),
  })
  .openapi("VerifyTxtResponse");

export const customHostnameItemSchema = z
  .object({
    id: z.string(),
    hostname: z.string(),
    lifecycleStatus: customHostnameLifecycleEnum,
    cfStatus: z.string().nullable(),
    cfSslStatus: z.string().nullable(),
    verificationVerifiedAt: z.string().nullable(),
    lastReconciledAt: z.string().nullable(),
    verificationErrors: z.array(z.string()),
    createdAt: z.string(),
  })
  .openapi("CustomHostnameItem");

export const listCustomHostnamesResponseSchema = z
  .object({
    hostnames: z.array(customHostnameItemSchema),
  })
  .openapi("ListCustomHostnamesResponse");

export const customHostnameParamsSchema = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" } }),
});

export const removeCustomHostnameResponseSchema = z
  .object({
    id: z.string(),
    lifecycleStatus: customHostnameLifecycleEnum,
  })
  .openapi("RemoveCustomHostnameResponse");
