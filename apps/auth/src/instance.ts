import type { DrizzleClient } from "@repo/db";
import { generateIdForModel } from "@repo/db/ids";
import * as schema from "@repo/db/schema";
import type { ApiBindingRpc } from "@repo/shared/api-binding";
import { getBrandConfig } from "@repo/shared/brand";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";
import { emailOTP } from "better-auth/plugins/email-otp";
import { jwt } from "better-auth/plugins/jwt";
import { openAPI } from "better-auth/plugins/open-api";
import { twoFactor } from "better-auth/plugins/two-factor";
import { z } from "zod";

import { RATE_LIMIT_CONFIG, TWO_FACTOR_CONFIG } from "./constants";
import { createSendTwoFactorOTP } from "./email/send-two-factor-otp";
import { createSendVerificationOTP } from "./email/send-verification-otp";
import { createSessionCreateBeforeHook } from "./hooks/session-create";
import { createSessionUpdateBeforeHook } from "./hooks/session-update";
import {
  createUserCreateAfterHook,
  createUserCreateBeforeHook,
} from "./hooks/user-create";
import type { MinimalExecutionContext } from "./lib/execution-context";
import { platformSchema, SESSION_CONFIG } from "./lib/platform";
import { createSecondaryStorage } from "./lib/secondary-storage";
import { loginSecurityPlugin } from "./plugins/login-security";
import { createOrganizationPlugin } from "./plugins/organization-setup";
import { enhancedUserPlugin } from "./plugins/user-status";

export type AuthBindings = Omit<
  CloudflareBindings,
  "API" | "NODE_ENV" | "ENABLE_SIGNUP"
> & {
  API: CloudflareBindings["API"] & ApiBindingRpc;
  NODE_ENV: string;
  ENABLE_SIGNUP: string;
};

const jwtUserFieldsSchema = z.object({
  roleSlugs: z.array(z.string()),
});

let memoizedCorsOrigins: string[] | undefined;
let memoizedBrand: ReturnType<typeof getBrandConfig> | undefined;

const getCorsOrigins = (env: AuthBindings): string[] => {
  if (!memoizedCorsOrigins) {
    memoizedCorsOrigins = env.CORS_ORIGINS.split(",").map((s: string) =>
      s.trim()
    );
  }

  return memoizedCorsOrigins;
};

const getMemoizedBrandConfig = (
  env: AuthBindings
): ReturnType<typeof getBrandConfig> => {
  if (!memoizedBrand) {
    memoizedBrand = getBrandConfig({
      APP_NAME: env.APP_NAME,
      APP_URL: env.APP_URL,
      BRAND_PRIMARY_COLOR: env.BRAND_PRIMARY_COLOR,
      COMPANY_NAME: env.COMPANY_NAME,
      LOGO_TEXT: env.LOGO_TEXT,
      SUPPORT_EMAIL: env.SUPPORT_EMAIL,
    });
  }

  return memoizedBrand;
};

export const createAuth = (
  db: DrizzleClient,
  env: AuthBindings,
  ctx: MinimalExecutionContext
) => {
  const corsOrigins = getCorsOrigins(env);
  const brand = getMemoizedBrandConfig(env);

  const authConfig = {
    advanced: {
      cookies: {
        session_token: {
          attributes: {
            httpOnly: true,
          },
          name: "session_token_v1",
        },
      },
      database: {
        generateId: (options) => generateIdForModel(options.model),
      },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
      },
      disableOriginCheck: false,
    },
    appName: brand.appName,
    baseURL: env.APP_URL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
      usePlural: true,
    }),
    databaseHooks: {
      session: {
        create: {
          before: createSessionCreateBeforeHook(db, env, ctx),
        },
        update: {
          before: createSessionUpdateBeforeHook(db),
        },
      },
      user: {
        create: {
          after: createUserCreateAfterHook(env, ctx),
          before: createUserCreateBeforeHook(),
        },
      },
    },

    emailAndPassword: {
      disableSignUp: env.ENABLE_SIGNUP !== "true",
      enabled: true,
      requireEmailVerification: true,
    },

    plugins: [
      enhancedUserPlugin(db),
      loginSecurityPlugin(db),
      emailOTP({
        expiresIn: TWO_FACTOR_CONFIG.emailOtpExpiresIn,
        otpLength: TWO_FACTOR_CONFIG.otpLength,
        sendVerificationOnSignUp: true,
        sendVerificationOTP: createSendVerificationOTP(db, env, ctx, brand),
      }),
      twoFactor({
        otpOptions: {
          period: TWO_FACTOR_CONFIG.twoFactorOtpPeriodMinutes,
          sendOTP: createSendTwoFactorOTP(env, ctx, brand),
        },

        twoFactorTable: "twoFactor",
      }),
      openAPI({
        disableDefaultReference: true,
      }),
      createOrganizationPlugin(db),
      bearer({ requireSignature: true }),
      jwt({
        jwks: {
          rotationInterval: 30 * 24 * 60 * 60,
        },
        jwt: {
          audience: env.APP_URL,
          definePayload: ({ user, session }) => {
            const parsed = jwtUserFieldsSchema.safeParse(user);

            return {
              email: user.email,
              platform: session.platform,
              roleSlugs: parsed.success ? parsed.data.roleSlugs : undefined,
              sub: user.id,
            };
          },
          expirationTime: "15m",
          issuer: env.APP_URL,
        },
      }),
    ],

    rateLimit: {
      customRules: {
        "/sign-in/email": {
          max: RATE_LIMIT_CONFIG.signIn.max,
          window: RATE_LIMIT_CONFIG.signIn.window,
        },
      },
      enabled: true,
      max: RATE_LIMIT_CONFIG.global.max,
      storage: "secondary-storage" as const,
      window: RATE_LIMIT_CONFIG.global.window,
    },
    secondaryStorage: createSecondaryStorage(env.CACHE),
    secret: env.BETTER_AUTH_SECRET,

    session: {
      additionalFields: {
        activeOrgRole: {
          input: false,
          required: false,
          type: "string",
        },
        platform: {
          defaultValue: "web",
          input: false,
          required: false,
          type: [...platformSchema.options],
        },
      },

      cookieCache: {
        enabled: false,
        maxAge: 60,
      },

      expiresIn: SESSION_CONFIG.mobile.expiresIn,
      updateAge:
        SESSION_CONFIG.mobile.expiresIn -
        (SESSION_CONFIG.web.expiresIn - SESSION_CONFIG.web.updateAge),
    },
    trustedOrigins: corsOrigins,
  } satisfies BetterAuthOptions;

  return betterAuth(authConfig);
};
