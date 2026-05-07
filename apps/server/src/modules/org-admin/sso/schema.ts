import { z } from "@hono/zod-openapi";

export const oidcConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  discoveryEndpoint: z.string().url().optional(),
  authorizationEndpoint: z.string().url().optional(),
  tokenEndpoint: z.string().url().optional(),
  jwksEndpoint: z.string().url().optional(),
  userInfoEndpoint: z.string().url().optional(),
  scopes: z.array(z.string()).optional(),
});

export const createSsoProviderBodySchema = z.object({
  issuer: z.string().url(),
  domain: z.string().min(1),
  providerId: z.string().min(1),
  oidcConfig: oidcConfigSchema,
});

export const updateSsoProviderBodySchema = z.object({
  issuer: z.string().url().optional(),
  domain: z.string().min(1).optional(),
});

export const rotateSecretBodySchema = z.object({
  clientSecret: z.string().min(1),
});

export const ssoProviderParamsSchema = z.object({
  providerId: z.string().min(1),
});

export const ssoProviderResponseSchema = z.object({
  id: z.string(),
  issuer: z.string(),
  domain: z.string(),
  providerId: z.string(),
  organizationId: z.string(),
  domainVerified: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const listSsoProvidersResponseSchema = z.object({
  providers: z.array(ssoProviderResponseSchema),
});

export const createSsoProviderResponseSchema = z.object({
  provider: ssoProviderResponseSchema,
});

export const successResponseSchema = z.object({ success: z.boolean() });

export type CreateSsoProviderBody = z.infer<typeof createSsoProviderBodySchema>;
export type UpdateSsoProviderBody = z.infer<typeof updateSsoProviderBodySchema>;
export type RotateSecretBody = z.infer<typeof rotateSecretBodySchema>;
