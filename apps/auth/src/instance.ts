import type { DrizzleClient } from "@repo/db";
import { generateIdForModel } from "@repo/db/ids";
import * as schema from "@repo/db/schema";
import {
  sendEmail,
  TwoFactorOtpEmail,
  VerificationOtpEmail,
} from "@repo/email";
import { getBrandConfig } from "@repo/shared/brand";
import { kvDelete, kvGetJson, kvSetJson } from "@repo/shared/kv-cache";
import { logger } from "@repo/shared/logger";
import { SYSTEM_ROLES } from "@repo/shared/roles";
import {
  type BetterAuthOptions,
  betterAuth,
  type Session,
  type User,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, emailOTP, jwt, openAPI, twoFactor } from "better-auth/plugins";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { RATE_LIMIT_CONFIG, TWO_FACTOR_CONFIG } from "./constants";
import { adminPlugin } from "./plugins/admin";
import { loginSecurityPlugin } from "./plugins/login-security";
import { createOrganizationPlugin } from "./plugins/organization-setup";
import {
  enhancedUserPlugin,
  type UserWithStatusFields,
} from "./plugins/user-status";

/**
 * Minimal interface for the API service binding RPC methods.
 * Avoids circular dependency on the server package. Will be replaced
 * by a concrete Service<ApiEntrypoint> type once Task 5 is complete.
 */
interface ApiBindingRpc {
  onNewDeviceLogin(params: {
    userId: string;
    ipAddress: string;
    userAgent: string;
    platform: string;
  }): Promise<void>;
  onUserCreated(params: {
    id: string;
    email: string;
    name: string;
  }): Promise<void>;
  onUserStatusChange(params: {
    userId: string;
    newStatus: string;
    previousStatus: string;
    reason: string | null;
  }): Promise<void>;
}

/**
 * CloudflareBindings with the API binding typed for its RPC methods.
 * Uses intersection so the Service fetch/connect methods remain available
 * and the cast from CloudflareBindings is structurally compatible.
 */
export type AuthBindings = Omit<CloudflareBindings, "API" | "NODE_ENV"> & {
  API: CloudflareBindings["API"] & ApiBindingRpc;
  NODE_ENV: string;
};

const platformSchema = z.enum(["web", "mobile"]);

// Platform-specific session durations (in seconds)
const SESSION_CONFIG = {
  web: {
    expiresIn: 3600, // 1 hour
    updateAge: 1800, // 30 minutes
  },
  mobile: {
    expiresIn: 604_800, // 7 days
    updateAge: 86_400, // 1 day
  },
} as const;

type Platform = "web" | "mobile";

export type SessionWithAdditionalFields = {
  platform: Platform;
  expiresAt: Date;
  activeOrgRole: string | null;
};

// Regex patterns at top-level for performance
const MOBILE_PATTERNS = [
  /android/i,
  /iphone/i,
  /ipad/i,
  /mobile/i,
  /okhttp/i,
  /dart/i,
  /flutter/i,
  /react-native/i,
  /expo/i,
];

const detectPlatform = (userAgent: string | null): Platform => {
  if (!userAgent) {
    return "web";
  }
  return MOBILE_PATTERNS.some((pattern) => pattern.test(userAgent))
    ? "mobile"
    : "web";
};

/** Minimal execution context - compatible with both Workers and Hono ExecutionContext */
type MinimalExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

export function createAuth(
  db: DrizzleClient,
  env: AuthBindings,
  ctx: MinimalExecutionContext
) {
  const corsOrigins = env.CORS_ORIGINS.split(",").map((s: string) => s.trim());
  // boundary: workerd env bindings are typed via wrangler codegen; cast to a
  // plain record for the brand helper.
  const brand = getBrandConfig(
    env as unknown as Record<string, string | undefined>
  );

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

    // Rate limiting - set higher than lockout to ensure our custom lockout kicks in first
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
      // Self-signup enabled for mobile onboarding flow
      disableSignUp: false,
      requireEmailVerification: true,
    },

    session: {
      // Use mobile defaults so cookie Max-Age matches 7-day mobile sessions.
      // Web sessions are shortened in database hooks.
      expiresIn: SESSION_CONFIG.mobile.expiresIn,
      updateAge: SESSION_CONFIG.mobile.updateAge,
      cookieCache: {
        enabled: false,
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
      // secure flag is auto-detected from baseURL (https = secure, http = not)
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
          // Assign default role, status, and force 2FA on user creation
          before: async (user) => ({
            data: {
              ...user,
              roleSlugs: [SYSTEM_ROLES.USER.slug],
              status: "active",
              failedLoginAttempts: 0,
              twoFactorEnabled: false,
            },
          }),
          after: async (user) => {
            ctx.waitUntil(
              env.API.onUserCreated({
                id: user.id,
                email: user.email,
                name: user.name,
              }).catch((err: unknown) => {
                console.error("Failed to trigger onboarding workflow:", err);
              })
            );
          },
        },
      },
      session: {
        create: {
          before: async (session, context) => {
            // Note: User status checks (deleted, inactive, locked) are handled by loginSecurityPlugin
            // This hook handles platform detection and session configuration

            // Platform detection and session configuration
            const userAgent = context?.headers?.get("user-agent") ?? null;
            const ipAddress =
              context?.headers?.get("CF-Connecting-IP") ??
              context?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
              null;
            const platform = detectPlatform(userAgent);
            const config = SESSION_CONFIG[platform];

            // Query existing session for new-device detection
            const [previousSession] = await db
              .select({
                userAgent: schema.sessions.userAgent,
                ipAddress: schema.sessions.ipAddress,
              })
              .from(schema.sessions)
              .where(eq(schema.sessions.userId, session.userId))
              .limit(1);

            // Revoke existing sessions for this user (single session per user)
            await db
              .delete(schema.sessions)
              .where(eq(schema.sessions.userId, session.userId));

            // Detect new device and send notification
            if (previousSession) {
              const isNewDevice =
                previousSession.userAgent !== userAgent ||
                previousSession.ipAddress !== ipAddress;

              if (isNewDevice) {
                ctx.waitUntil(
                  env.API.onNewDeviceLogin({
                    userId: session.userId,
                    ipAddress: ipAddress ?? "",
                    userAgent: userAgent ?? "",
                    platform,
                  }).catch((err: unknown) => {
                    console.error(
                      "Failed to trigger new device notification:",
                      err
                    );
                  })
                );
              }
            }

            // Calculate expiration based on platform
            const expiresAt = new Date(Date.now() + config.expiresIn * 1000);

            // Look up user's most recent org membership for initial org context.
            // The org plugin manages activeOrganizationId on the session; we
            // additionally persist activeOrgRole so downstream consumers can
            // read the role without a separate query.
            // Wrapped in try-catch: the org tables may not exist if the
            // organization migration has not been applied yet.
            let orgContext: {
              activeOrganizationId: string;
              activeOrgRole: string;
            } | null = null;
            try {
              const [firstMembership] = await db
                .select({
                  organizationId: schema.members.organizationId,
                  role: schema.members.role,
                })
                .from(schema.members)
                .where(eq(schema.members.userId, session.userId))
                .orderBy(desc(schema.members.createdAt))
                .limit(1);

              if (firstMembership) {
                orgContext = {
                  activeOrganizationId: firstMembership.organizationId,
                  activeOrgRole: firstMembership.role,
                };
              }
            } catch {
              // Organization tables not yet migrated -- skip org context
            }

            return {
              data: {
                ...session,
                platform,
                expiresAt,
                ...(orgContext ?? {}),
              },
            };
          },
        },
        update: {
          before: async (session, context) => {
            // Sync activeOrgRole when BA's org plugin updates activeOrganizationId.
            // The org plugin's setActive endpoint calls updateSession with
            // { activeOrganizationId } but doesn't know about our custom
            // activeOrgRole field, so we enrich the update payload here.
            const updateData = session as Record<string, unknown>;
            if (updateData.activeOrganizationId !== undefined) {
              const newOrgId = updateData.activeOrganizationId as string | null;

              if (!newOrgId) {
                // Clearing active org -- also clear the role
                return {
                  data: { ...session, activeOrgRole: null },
                };
              }

              // Resolve the userId from the endpoint context's session
              // (set by orgSessionMiddleware before the DB call).
              const endpointCtx = context as
                | {
                    context?: {
                      session?: { user?: { id?: string } };
                    };
                  }
                | undefined;
              const userId = endpointCtx?.context?.session?.user?.id;

              if (userId) {
                try {
                  const [membership] = await db
                    .select({ role: schema.members.role })
                    .from(schema.members)
                    .where(
                      and(
                        eq(schema.members.userId, userId),
                        eq(schema.members.organizationId, newOrgId)
                      )
                    )
                    .limit(1);

                  return {
                    data: {
                      ...session,
                      activeOrgRole: membership?.role ?? null,
                    },
                  };
                } catch {
                  // Org tables not yet migrated -- pass through
                }
              }

              return { data: session };
            }

            // Only intervene when Better Auth is refreshing the session expiry.
            // Other updates (e.g. updatedAt, ipAddress) should pass through.
            if (!session.expiresAt) {
              return { data: session };
            }

            // Detect platform from the request user-agent. The update hook only
            // receives the update payload (expiresAt, updatedAt) without the
            // session id or token, so we cannot look up the session row. Instead,
            // use the same user-agent detection as the create hook -- the request
            // that triggered the refresh carries the mobile client's user-agent.
            const userAgent = context?.headers?.get("user-agent") ?? null;
            const platform = detectPlatform(userAgent);

            // Web sessions get shorter expiry; mobile uses the global default (7 days)
            if (platform === "web") {
              return {
                data: {
                  ...session,
                  expiresAt: new Date(
                    Date.now() + SESSION_CONFIG.web.expiresIn * 1000
                  ),
                },
              };
            }

            return { data: session };
          },
        },
      },
    },

    plugins: [
      enhancedUserPlugin(),
      loginSecurityPlugin(db),
      adminPlugin(db, env.API),
      // Email OTP plugin for password reset via OTP (not magic links)
      emailOTP({
        otpLength: TWO_FACTOR_CONFIG.otpLength,
        expiresIn: TWO_FACTOR_CONFIG.emailOtpExpiresIn,
        sendVerificationOnSignUp: true,
        async sendVerificationOTP({ email, otp, type }) {
          const user = await db.query.users.findFirst({
            where: { email: { eq: email } },
            columns: { name: true },
          });

          const typeLabels: Record<typeof type, string> = {
            "sign-in": "sign-in",
            "email-verification": "email verification",
            "forget-password": "password reset",
            "change-email": "email change",
          };

          const subjectByType: Record<typeof type, string> = {
            "forget-password": "Reset Your Password",
            "email-verification": "Verify Your Email",
            "sign-in": "Sign In Verification",
            "change-email": "Confirm Email Change",
          };

          logger.info(`Sending ${typeLabels[type]} OTP to ${email}`);

          // Map change-email to email-verification for the template
          const templateType =
            type === "change-email" ? "email-verification" : type;

          // Send without awaiting to prevent timing attacks
          ctx.waitUntil(
            sendEmail({
              apiKey: env.RESEND_API_KEY,
              from: `${brand.appName} <${env.EMAIL_FROM}>`,
              to: email,
              subject: subjectByType[type],
              template: VerificationOtpEmail,
              props: {
                userName: user?.name ?? "User",
                otp,
                type: templateType,
                expiresIn: `${Math.floor(TWO_FACTOR_CONFIG.emailOtpExpiresIn / 60)} minutes`,
              },
            }).catch((error) => {
              logger.error("Failed to send verification OTP email", {
                email,
                type,
                error: error instanceof Error ? error.message : String(error),
              });
            })
          );
        },
      }),
      // Two-factor authentication plugin (email OTP only, no TOTP)
      twoFactor({
        // Use our custom twoFactor table
        twoFactorTable: "twoFactors",
        // Skip TOTP verification since we only use email OTP
        skipVerificationOnEnable: true,
        // OTP configuration for 2FA verification
        otpOptions: {
          // OTP expires in 3 minutes
          period: TWO_FACTOR_CONFIG.twoFactorOtpPeriodMinutes,
          async sendOTP({ user, otp }, reqCtx) {
            // debugging (remove in production)
            if (env.NODE_ENV === "development") {
              logger.info(`OPT: ${otp} for user ${user.id} (${user.email})`); // Log OTP for
            }
            logger.info(`Sending 2FA OTP to ${user.email}`);

            // Extract device info from context if available
            const ipAddress =
              reqCtx?.headers?.get("CF-Connecting-IP") ??
              reqCtx?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
              undefined;
            const userAgent = reqCtx?.headers?.get("user-agent") ?? undefined;

            // Send without awaiting to prevent timing attacks
            ctx.waitUntil(
              sendEmail({
                apiKey: env.RESEND_API_KEY,
                from: `${brand.appName} <${env.EMAIL_FROM}>`,
                to: user.email,
                subject: "Your Two-Factor Authentication Code",
                template: TwoFactorOtpEmail,
                props: {
                  userName: user.name,
                  otp,
                  expiresIn: `${TWO_FACTOR_CONFIG.twoFactorOtpPeriodMinutes} minutes`,
                  ipAddress,
                  userAgent,
                },
              }).catch((error) => {
                logger.error("Failed to send 2FA OTP email", {
                  userId: user.id,
                  email: user.email,
                  error: error instanceof Error ? error.message : String(error),
                });
              })
            );
          },
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
            const typedUser = user as typeof user & UserWithStatusFields;
            return {
              sub: user.id,
              email: (user as { email: string }).email,
              roleSlugs: typedUser.roleSlugs,
              platform: session.platform,
            };
          },
        },
        jwks: {
          rotationInterval: 30 * 24 * 60 * 60,
        },
      }),
      // override type
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
