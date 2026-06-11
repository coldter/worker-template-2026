import type { DrizzleClient } from "@repo/db";
import { generateIdForModel } from "@repo/db/ids";
import * as schema from "@repo/db/schema";
import type { ApiBindingRpc } from "@repo/shared/api-binding";
import { getBrandConfig } from "@repo/shared/brand";
import { kvDelete, kvGetJson, kvSetJson } from "@repo/shared/kv-cache";
import {
  type BetterAuthOptions,
  betterAuth,
  type Session,
  type User,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, emailOTP, jwt, openAPI, twoFactor } from "better-auth/plugins";
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
import {
  platformSchema,
  type SessionWithAdditionalFields,
} from "./lib/platform";
import { adminPlugin } from "./plugins/admin";
import { loginSecurityPlugin } from "./plugins/login-security";
import { createOrganizationPlugin } from "./plugins/organization-setup";
import {
  enhancedUserPlugin,
  type UserWithStatusFields,
} from "./plugins/user-status";

// NODE_ENV and ENABLE_SIGNUP widen to string: wrangler types emits the dev
// literals from wrangler.jsonc, but --var deploy overrides change them at runtime.
export type AuthBindings = Omit<
  CloudflareBindings,
  "API" | "NODE_ENV" | "ENABLE_SIGNUP"
> & {
  API: CloudflareBindings["API"] & ApiBindingRpc;
  NODE_ENV: string;
  ENABLE_SIGNUP: string;
};

export type { SessionWithAdditionalFields };

// env is immutable for an isolate's lifetime, so these pure env-derived values
// are computed once on first use and reused across every per-request createAuth.
let memoizedCorsOrigins: string[] | undefined;
let memoizedBrand: ReturnType<typeof getBrandConfig> | undefined;

function getCorsOrigins(env: AuthBindings): string[] {
  if (!memoizedCorsOrigins) {
    memoizedCorsOrigins = env.CORS_ORIGINS.split(",").map((s: string) =>
      s.trim()
    );
  }
  return memoizedCorsOrigins;
}

function getMemoizedBrandConfig(
  env: AuthBindings
): ReturnType<typeof getBrandConfig> {
  if (!memoizedBrand) {
    // boundary: getBrandConfig accepts Record<string, string | undefined>; narrow workerd CloudflareBindings to that shape.
    memoizedBrand = getBrandConfig(
      env as unknown as Record<string, string | undefined>
    );
  }
  return memoizedBrand;
}

export function createAuth(
  db: DrizzleClient,
  env: AuthBindings,
  ctx: MinimalExecutionContext
) {
  const corsOrigins = getCorsOrigins(env);
  const brand = getMemoizedBrandConfig(env);

  const authConfig = {
    appName: brand.appName,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    database: drizzleAdapter(db, {
      provider: "pg",
      usePlural: true,
      schema,
    }),
    secondaryStorage: {
      get: async (key) => kvGetJson(env.CACHE, key),
      set: async (key, value, ttl) => {
        await kvSetJson(env.CACHE, key, value, ttl);
      },
      delete: async (key) => {
        await kvDelete(env.CACHE, key);
      },
    },
    trustedOrigins: corsOrigins,

    // Global limit set above lockout threshold so custom lockout triggers first.
    rateLimit: {
      enabled: true,
      window: RATE_LIMIT_CONFIG.global.window,
      max: RATE_LIMIT_CONFIG.global.max,
      storage: "secondary-storage" as const,
      customRules: {
        "/sign-in/email": {
          window: RATE_LIMIT_CONFIG.signIn.window,
          max: RATE_LIMIT_CONFIG.signIn.max,
        },
      },
    },

    emailAndPassword: {
      enabled: true,
      // No signup UI exists in the web app, so registration stays closed unless
      // explicitly enabled. Dev defaults ENABLE_SIGNUP to "true" in wrangler.jsonc;
      // production deploys override it via --var (Wrangler vars are strings).
      disableSignUp: env.ENABLE_SIGNUP !== "true",
      requireEmailVerification: true,
    },

    session: {
      // Mobile defaults so cookie Max-Age matches 7-day mobile sessions; web is shortened in hooks.
      expiresIn: 604_800,
      updateAge: 86_400,
      // Cache a signed session snapshot in the cookie for up to 60s to avoid a
      // secondary-storage / DB hit on every getSession. Deliberate trade-off:
      // while the cached snapshot is valid, session/role/status/lockout
      // revocation lags by up to 60s. In Better Auth 1.6.x the cookie cache
      // stores the full parsed user and session output, so the custom fields
      // the API principal relies on (platform, activeOrgRole, roleSlugs, status)
      // are served from the cookie and are subject to the same 60s staleness
      // window -- they are not re-fetched while the cache is fresh. The short
      // 60s maxAge bounds that lag; secondary storage, storeSessionInDatabase,
      // and session expiry are unchanged, so a deleted session still fails once
      // the snapshot expires.
      cookieCache: {
        enabled: true,
        maxAge: 60,
      },
      additionalFields: {
        platform: {
          type: [...platformSchema.options],
          required: false,
          defaultValue: "web",
        },
        activeOrgRole: {
          type: "string",
          required: false,
        },
      },
    },

    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        httpOnly: true,
      },
      cookies: {
        session_token: {
          name: "session_token_v1",
          attributes: {
            httpOnly: true,
          },
        },
      },
      database: {
        generateId: (options) => generateIdForModel(options.model),
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: createUserCreateBeforeHook(),
          after: createUserCreateAfterHook(env, ctx),
        },
      },
      session: {
        create: {
          before: createSessionCreateBeforeHook(db, env, ctx),
        },
        update: {
          before: createSessionUpdateBeforeHook(db),
        },
      },
    },

    plugins: [
      enhancedUserPlugin(),
      loginSecurityPlugin(db),
      adminPlugin(env.API),
      emailOTP({
        otpLength: TWO_FACTOR_CONFIG.otpLength,
        expiresIn: TWO_FACTOR_CONFIG.emailOtpExpiresIn,
        sendVerificationOnSignUp: true,
        sendVerificationOTP: createSendVerificationOTP(db, env, ctx, brand),
      }),
      twoFactor({
        // usePlural: true on the Drizzle adapter requires the singular model name to resolve to "twoFactors".
        twoFactorTable: "twoFactor",
        // Email OTP only; no TOTP enrollment flow to verify against.
        skipVerificationOnEnable: true,
        otpOptions: {
          period: TWO_FACTOR_CONFIG.twoFactorOtpPeriodMinutes,
          sendOTP: createSendTwoFactorOTP(env, ctx, brand),
        },
      }),
      openAPI({
        disableDefaultReference: true,
      }),
      createOrganizationPlugin(db),
      bearer({ requireSignature: true }),
      jwt({
        jwt: {
          issuer: env.APP_URL,
          audience: env.APP_URL,
          expirationTime: "15m",
          definePayload: ({ user, session }) => {
            // boundary: better-auth additionalFields generic variance -- user-status plugin fields not visible to this callback's generic.
            const typedUser = user as typeof user & UserWithStatusFields;
            return {
              sub: user.id,
              email: user.email,
              roleSlugs: typedUser.roleSlugs,
              platform: session.platform,
            };
          },
        },
        jwks: {
          rotationInterval: 30 * 24 * 60 * 60,
        },
      }),
      {
        id: "override-type",
        $Infer: {} as {
          Session: {
            user: User & UserWithStatusFields;
            session: Session & SessionWithAdditionalFields;
          };
        },
      },
    ],
  } satisfies BetterAuthOptions;

  return betterAuth(authConfig);
}
