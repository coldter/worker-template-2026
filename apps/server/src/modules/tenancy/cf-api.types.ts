import { z } from "zod";

/**
 * Cloudflare-for-SaaS Custom Hostname response shape (subset we consume).
 * Fully Zod-validated at the boundary; no `any` or unchecked casts in
 * downstream consumers.
 */
export const cfValidationRecordSchema = z
  .object({
    status: z.string().optional(),
    txt_name: z.string().optional(),
    txt_value: z.string().optional(),
    http_url: z.string().optional(),
    http_body: z.string().optional(),
  })
  .passthrough();

export const cfValidationErrorSchema = z
  .object({
    message: z.string(),
  })
  .passthrough();

export const cfSslSchema = z
  .object({
    status: z.string().nullable().optional(),
    method: z.string().optional(),
    type: z.string().optional(),
    validation_records: z.array(cfValidationRecordSchema).optional(),
    validation_errors: z.array(cfValidationErrorSchema).optional(),
  })
  .passthrough();

export const cfCustomHostnameSchema = z
  .object({
    id: z.string(),
    hostname: z.string(),
    status: z.string(),
    ssl: cfSslSchema,
    verification_errors: z.array(z.string()).optional(),
    ownership_verification: z
      .object({
        type: z.string().optional(),
        name: z.string().optional(),
        value: z.string().optional(),
      })
      .passthrough()
      .optional(),
    created_at: z.string().optional(),
  })
  .passthrough();

export type CfCustomHostname = z.infer<typeof cfCustomHostnameSchema>;
export type CfValidationRecord = z.infer<typeof cfValidationRecordSchema>;
export type CfValidationError = z.infer<typeof cfValidationErrorSchema>;

export const cfApiEnvelopeSchema = z.object({
  success: z.boolean(),
  errors: z
    .array(
      z
        .object({ code: z.number().optional(), message: z.string() })
        .passthrough()
    )
    .optional()
    .default([]),
  messages: z.array(z.unknown()).optional().default([]),
  result: z.unknown().optional(),
});

export type CfApiEnvelope = z.infer<typeof cfApiEnvelopeSchema>;

/**
 * Thrown when the CF response cannot be parsed against `cfApiEnvelopeSchema`
 * or when the envelope reports `success: false`.
 */
export class CfApiContractError extends Error {
  readonly cause?: unknown;
  readonly cfErrorCode?: number;
  constructor(message: string, cause?: unknown, cfErrorCode?: number) {
    super(message);
    this.name = "CfApiContractError";
    this.cause = cause;
    this.cfErrorCode = cfErrorCode;
  }
}
