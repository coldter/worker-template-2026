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
      // No signup UI exists in the web app, so registration stays closed unless
      // explicitly enabled. Dev defaults ENABLE_SIGNUP to "true" in wrangler.jsonc;
      // production deploys override it via --var (Wrangler vars are strings).
      disableSignUp: env.ENABLE_SIGNUP !== "true",
      enabled: true,
      requireEmailVerification: true,
    },

    plugins: [
      enhancedUserPlugin(),
      loginSecurityPlugin(db),
      adminPlugin(env.API),
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
        // Email OTP only; no TOTP enrollment flow to verify against.
        skipVerificationOnEnable: true,
        // usePlural: true on the Drizzle adapter requires the singular model name to resolve to "twoFactors".
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
            // boundary: better-auth additionalFields generic variance -- user-status plugin fields not visible to this callback's generic.
            const typedUser = user as typeof user & UserWithStatusFields;
            return {
              email: user.email,
              platform: session.platform,
              roleSlugs: typedUser.roleSlugs,
              sub: user.id,
            };
          },
          expirationTime: "15m",
          issuer: env.APP_URL,
        },
      }),
      {
        $Infer: {} as {
          Session: {
            user: User & UserWithStatusFields;
            session: Session & SessionWithAdditionalFields;
          };
        },
        id: "override-type",
      },
    ],

    // Global limit set above lockout threshold so custom lockout triggers first.
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
    secondaryStorage: {
      delete: async (key) => {
        await kvDelete(env.CACHE, key);
      },
      get: async (key) => kvGetJson(env.CACHE, key),
      // KV has no atomic get-and-delete; the previous adapter's get+delete
      // pair had the same single-use window, so behavior is unchanged.
      getAndDelete: async (key) => {
        const value = await kvGetJson(env.CACHE, key);
        if (value !== null) {
          await kvDelete(env.CACHE, key);
        }
        return value;
      },
      // KV has no counter primitive; read-modify-write matches the pre-1.7
      // adapter behavior (read-your-writes within a colo). TTL is applied
      // only on creation so the window never extends, per the 1.7 contract.
      increment: async (key, ttl) => {
        const current = await kvGetJson<number>(env.CACHE, key);
        const next = (typeof current === "number" ? current : 0) + 1;
        if (typeof current === "number") {
          await env.CACHE.put(key, JSON.stringify(next));
        } else {
          await kvSetJson(env.CACHE, key, next, ttl);
        }
        return next;
      },
      set: async (key, value, ttl) => {
        await kvSetJson(env.CACHE, key, value, ttl);
      },
    },
    secret: env.BETTER_AUTH_SECRET,

    session: {
      additionalFields: {
        activeOrgRole: {
          required: false,
          type: "string",
        },
        platform: {
          defaultValue: "web",
          required: false,
          type: [...platformSchema.options],
        },
      },
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
      // Mobile defaults so cookie Max-Age matches 7-day mobile sessions; web is shortened in hooks.
      expiresIn: 604_800,
      updateAge: 86_400,
    },
    trustedOrigins: corsOrigins,
  } satisfies BetterAuthOptions;

  return betterAuth(authConfig);
}
