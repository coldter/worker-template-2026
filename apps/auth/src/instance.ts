import { sso } from "@better-auth/sso";
import type { DrizzleClient } from "@repo/db";
import { generateIdForModel } from "@repo/db/ids";
import * as schema from "@repo/db/schema";
import {
  sendEmail,
  TenantInviteEmail,
  TwoFactorOtpEmail,
  VerificationOtpEmail,
} from "@repo/email";
import type { ApiBindingRpc } from "@repo/shared/api-binding";
import { getBrandConfig } from "@repo/shared/brand";
import { kvDelete, kvGetJson, kvSetJson } from "@repo/shared/kv-cache";
import { logger } from "@repo/shared/logger";
import { SYSTEM_ROLES } from "@repo/shared/roles";
import type { HostConfig, Tenant } from "@repo/tenancy";
import { parseHostname } from "@repo/tenancy";
import {
  type BetterAuthOptions,
  betterAuth,
  type Session,
  type User,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  admin,
  bearer,
  emailOTP,
  jwt,
  openAPI,
  twoFactor,
} from "better-auth/plugins";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { RATE_LIMIT_CONFIG, TWO_FACTOR_CONFIG } from "./constants";
import { disableOrgCreate } from "./disable-org-create";
import { disableSignUpHook } from "./disable-sign-up";
import type { AllowedHostsSnapshot } from "./host-config";
import { deriveAllowedHosts } from "./host-config";
import {
  buildJwtPayload,
  deriveJwtAudience,
  deriveJwtIssuer,
} from "./jwt-config";
import { adminPlugin } from "./plugins/admin";
import { loginSecurityPlugin } from "./plugins/login-security";
import { createOrganizationPlugin } from "./plugins/organization-setup";
import { provisionUserCallback } from "./plugins/provision-user";
import { ssoCallbackGuardPlugin } from "./plugins/sso-callback-guard";
import {
  enhancedUserPlugin,
  type UserWithStatusFields,
} from "./plugins/user-status";
import { enforceTenantMembership } from "./session-create-before";
import { assertSameTenantOnUpdate } from "./session-update-before";
import { getTrustedOriginsForTenant } from "./trusted-origin-store";

export type CreateAuthOptions = {
  tenant: Tenant | null;
  allowedHostsSnapshot: AllowedHostsSnapshot;
  extraTrustedOrigins?: readonly string[];
};

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

// Strips a trailing "/" so URL joins in the invitation-email helper produce
// stable absolute URLs.
const TRAILING_SLASH_RE = /\/$/;

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

/**
 * Minimum entropy for `BETTER_AUTH_SECRET`. BA derives HMAC keys directly
 * from this value; anything shorter is functionally a low-entropy password.
 * Enforced at construction time so a misconfigured deploy fails fast on the
 * first request rather than silently shipping weak signatures.
 */
const BETTER_AUTH_SECRET_MIN_LENGTH = 32;

export function createAuth(
  db: DrizzleClient,
  env: AuthBindings,
  ctx: MinimalExecutionContext,
  options: CreateAuthOptions
) {
  if (
    !env.BETTER_AUTH_SECRET ||
    env.BETTER_AUTH_SECRET.length < BETTER_AUTH_SECRET_MIN_LENGTH
  ) {
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${BETTER_AUTH_SECRET_MIN_LENGTH} characters`
    );
  }

  // boundary: workerd env bindings are typed via wrangler codegen; cast to a
  // plain record for the brand helper.
  const brand = getBrandConfig(
    env as unknown as Record<string, string | undefined>
  );

  const allowedHosts = Array.from(
    new Set([
      ...deriveAllowedHosts(options.allowedHostsSnapshot),
      ...(options.tenant ? [options.tenant.host] : []),
    ])
  );

  // hostConfig mirrors the snapshot fields that parseHostname needs.
  const hostConfig: HostConfig = {
    wildcardSuffix: options.allowedHostsSnapshot.wildcardSuffix,
    adminHost: options.allowedHostsSnapshot.adminHost,
    fallbackHost: options.allowedHostsSnapshot.wildcardSuffix.startsWith(".")
      ? options.allowedHostsSnapshot.wildcardSuffix.slice(1)
      : options.allowedHostsSnapshot.wildcardSuffix,
    localDevHosts: options.allowedHostsSnapshot.localDevHosts,
    allowDevTenantHeader: false,
    nodeEnv:
      env.NODE_ENV === "development" || env.NODE_ENV === "test"
        ? env.NODE_ENV
        : "production",
  };

  const localDevOrigins = options.allowedHostsSnapshot.localDevHosts.map(
    (h) => `http://${h}`
  );

  const authConfig = {
    appName: brand.appName,
    // Disable account-linking entry points so a user discovered via SSO can
    // never be auto-merged into a different identity. trustedProviders is the
    // bypass list for `allowDifferentEmails`; keeping it empty closes that
    // bypass too. (A4.2)
    account: {
      accountLinking: {
        allowDifferentEmails: false,
        trustedProviders: [],
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    // Absent `fallback` is intentional: unknown hosts must fail closed (D6).
    baseURL: {
      allowedHosts: allowedHosts as string[],
      protocol: "https" as const,
    },
    basePath: "/api/auth",
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
    // BA auto-merges allowedHosts into trustedOrigins. This callback adds the
    // per-tenant origin explicitly for the discovery-origin extension point
    // (A4) and to make audit reading obvious. Do NOT echo req.headers.get("Host")
    // — that re-opens the trustedOrigins echo abuse (spec 09-security).
    //
    // A4.4 — registered SSO issuer origins (per-isolate snapshot) are merged
    // here so subsequent /sso/sign-in redirects to a registered IdP issuer
    // pass BA's allowed-redirect check. The store is populated by
    // AuthEntrypoint.registerTrustedOrigin after createSsoProvider commits.
    trustedOrigins: async (req?: Request) => {
      const tenantId = options.tenant?.organizationId ?? null;
      const registeredIssuers = getTrustedOriginsForTenant(tenantId);
      if (!req) {
        return [
          ...localDevOrigins,
          ...(options.extraTrustedOrigins ?? []),
          ...registeredIssuers,
        ] as string[];
      }
      const host = new URL(req.url).host;
      const parsed = parseHostname(host, hostConfig);
      const tenantOrigin =
        parsed.kind === "subdomain" || parsed.kind === "custom"
          ? [`https://${host}`]
          : [];
      return [
        ...tenantOrigin,
        ...localDevOrigins,
        ...(options.extraTrustedOrigins ?? []),
        ...registeredIssuers,
      ] as string[];
    },

    // Rate limiting — set higher than lockout to ensure our custom lockout
    // kicks in first.
    //
    // Storage decision: BA's `secondary-storage` adapter pointed at
    // Cloudflare KV (eventually consistent, write-coalesced) caused
    // counters to lag across colos and let attackers bypass the window by
    // spreading requests. Until the auth worker grows a service binding to
    // the server worker's `RateLimiter` Durable Object (Wave 2A), we switch
    // to the BA-managed Postgres table (`storage: "database"`) so counter
    // writes are linearizable through Hyperdrive. The same Drizzle adapter
    // is already wired below, so no extra plumbing is needed.
    rateLimit: {
      enabled: true,
      window: RATE_LIMIT_CONFIG.global.window,
      max: RATE_LIMIT_CONFIG.global.max,
      storage: "database" as const,
      customRules: {
        "/sign-in/email": {
          window: RATE_LIMIT_CONFIG.signIn.window,
          max: RATE_LIMIT_CONFIG.signIn.max,
        },
      },
    },

    emailAndPassword: {
      enabled: true,
      // BA-level guard. Defense in depth: databaseHooks.user.create.before
      // also rejects unless the admin createUser path is active.
      disableSignUp: true,
      requireEmailVerification: true,
    },

    session: {
      // We revoke sessions by deleting rows from the BA session table during
      // tenant suspension, SSO rotation, and single-session enforcement. Keep
      // DB persistence enabled even though secondaryStorage backs other BA
      // transient state.
      storeSessionInDatabase: true,
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
      // Each request resolves to a single tenant host via `sanitizedAuthRequest`,
      // so host-only cookies are correct: never send a `Domain` attribute,
      // mark `Secure`, `HttpOnly`, and `SameSite=lax`. Cross-subdomain leakage
      // is the threat we explicitly close (D15/D65) — browsers default to
      // host-only when `Domain` is omitted.
      useSecureCookies: true,
      defaultCookieAttributes: {
        sameSite: "lax",
        httpOnly: true,
        secure: true,
      },
      cookies: {
        session_token: {
          name: "session_token_v1",
          attributes: {
            httpOnly: true,
            sameSite: "lax",
            secure: true,
          },
        },
      },
      database: {
        generateId: (o) => generateIdForModel(o.model),
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, hookCtx) => {
            // Reject public sign-up first; admin createUser path passes (D32).
            const { create } = disableSignUpHook();
            const signUpResult = await create.before(user, hookCtx);

            // Preserve existing role-assignment behavior after the bypass check.
            const base =
              signUpResult &&
              typeof signUpResult === "object" &&
              "data" in signUpResult
                ? signUpResult.data
                : user;
            return {
              data: {
                ...base,
                roleSlugs: [SYSTEM_ROLES.USER.slug],
                status: "active",
                failedLoginAttempts: 0,
                twoFactorEnabled: false,
              },
            };
          },
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
            // User status checks (deleted, inactive, locked) live in
            // loginSecurityPlugin; this hook only handles platform detection
            // and session configuration.
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

            // A6.4 — when a tenant is resolved, enforce membership and
            // pin the active org/role + copy the org claim fields so the
            // JWT mint can stamp them as `org` without a re-query (D34/D32).
            // For the apex / null-tenant case, fall back to the legacy
            // "most recent membership" lookup so admin host / apex sign-ins
            // still get a default activeOrganizationId.
            let orgContext: {
              activeOrganizationId: string;
              activeOrgRole: string;
              tenantOrgId?: string;
              tenantHost?: string;
              tenantSessionVersion?: number;
            } | null = null;

            if (options.tenant) {
              const fields = await enforceTenantMembership(db, options.tenant, {
                userId: session.userId,
              });
              if (fields) {
                orgContext = fields;
              }
            } else {
              // Wrapped in try-catch: the org tables may not exist if the
              // organization migration has not been applied yet.
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
            // boundary: BA Session generics — the update payload is typed as
            // a partial Session in BA but only carries the changed fields at
            // runtime; reach via Record<string, unknown> per the BA pattern.
            const updateData = session as Record<string, unknown>;

            // A6.5 — host-pinned tenants reject any setActive to a foreign
            // org. Defense in depth on top of the create-time pin.
            assertSameTenantOnUpdate(options.tenant, updateData);

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
      // Bearer + JWT must be registered before any plugin that consumes the
      // resolved session via `sessionMiddleware` (e.g. our admin plugin).
      // Otherwise BA's late-registration ordering means bearer-token requests
      // never get a session attached for downstream plugins. (BA convention.)
      bearer({ requireSignature: true }),
      jwt({
        jwt: {
          // Per-tenant URL-form aud/iss (D12). Spec deviation: the `org.id`
          // claim carries the URN-style stable identifier; iss/aud stay URL.
          issuer: deriveJwtIssuer(options.tenant, { APP_URL: env.APP_URL }),
          audience: deriveJwtAudience(options.tenant, { APP_URL: env.APP_URL }),
          expirationTime: "15m",
          definePayload: ({ user, session }) => {
            // boundary: BA Session generics — BA's `User`/`Session` types do
            // not surface our `UserWithStatusFields` extension or our session
            // platform field; these structural casts are documented in the
            // BA hooks doc as the supported pattern for additional fields.
            const typedUser = user as typeof user & UserWithStatusFields;
            const typedSession = session as typeof session & {
              platform?: string;
              tenantOrgId?: string;
              tenantHost?: string;
              tenantSessionVersion?: number;
            };
            return buildJwtPayload(
              {
                id: user.id,
                email: typedUser.email,
                roleSlugs: typedUser.roleSlugs,
              },
              {
                platform: typedSession.platform,
                tenantOrgId: typedSession.tenantOrgId,
                tenantHost: typedSession.tenantHost,
                tenantSessionVersion: typedSession.tenantSessionVersion,
              },
              options.tenant
            );
          },
        },
        jwks: {
          // Pin to BA's documented EdDSA/Ed25519 default explicitly — keeps
          // signing/verification algorithms in lock-step with the consumer
          // (`packages/auth-tokens`) and prevents accidental drift if BA
          // changes the implicit default in a future release.
          keyPairConfig: { alg: "EdDSA", crv: "Ed25519" },
          rotationInterval: 30 * 24 * 60 * 60,
        },
      }),
      loginSecurityPlugin(db),
      admin({
        defaultRole: SYSTEM_ROLES.USER.slug,
        adminRoles: [SYSTEM_ROLES.ADMIN.slug],
      }),
      adminPlugin(env.API),
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
        // With usePlural: true on the Drizzle adapter, provide the
        // singular model name so it resolves to our "twoFactors" table.
        twoFactorTable: "twoFactor",
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
      createOrganizationPlugin(db, async (data) => {
        // B2 / Audit-fix #2 — wire BA's `sendInvitationEmail` callback to the
        // shared `TenantInviteEmail` template via Resend. The callback fires
        // when BA's organization plugin creates an invitation row through its
        // public createInvitation endpoint. The operator-led path
        // (`AdminApiEntrypoint.createTenantOnBehalfOf`) inserts the
        // invitation row directly via Drizzle and does NOT invoke this
        // callback — that flow's email is sent from the server worker after
        // the transaction commits (separate plumbing tracked in B2.6
        // integration). Wiring this callback here keeps tenant-admin-led
        // invites (member invites within an existing tenant) on the same
        // template + transport.
        const acceptUrl = options.tenant?.host
          ? `https://${options.tenant.host}/accept-invite/${data.invitation.id}`
          : `${env.APP_URL.replace(TRAILING_SLASH_RE, "")}/accept-invite/${data.invitation.id}`;
        const expiresInHours = data.invitation.expiresAt
          ? Math.max(
              1,
              Math.round(
                (new Date(data.invitation.expiresAt).getTime() - Date.now()) /
                  (60 * 60 * 1000)
              )
            )
          : 48;
        ctx.waitUntil(
          sendEmail({
            apiKey: env.RESEND_API_KEY,
            from: `${brand.appName} <${env.EMAIL_FROM}>`,
            to: data.email,
            subject: `You're invited to ${data.organization.name}`,
            template: TenantInviteEmail,
            props: {
              acceptUrl,
              organizationName: data.organization.name,
              inviterName: data.inviter?.user?.name ?? null,
              expiresInHours,
            },
          }).catch((error) => {
            logger.error("Failed to send tenant invitation email", {
              email: data.email,
              invitationId: data.invitation.id,
              error: error instanceof Error ? error.message : String(error),
            });
          })
        );
      }),
      // Placed after createOrganizationPlugin so its before hook runs first
      // (BA's late-registration ordering). No bypass surface (D22).
      disableOrgCreate(),
      // SSO plugin — BEFORE bearer/jwt so its before-hooks fire on the right path.
      // organizationProvisioning disabled: org membership is managed by A4.4 CRUD.
      // domainVerified gate is enforced in provisionUserCallback (D8).
      // BA writes oidc_config text via its own /sso/register endpoint; org-admin
      // CRUD (A4.4) writes oidc_config_encrypted bytea. The decrypted view
      // reconciles both columns transparently for BA reads.
      sso({
        organizationProvisioning: { disabled: true },
        provisionUser: provisionUserCallback(db, options.tenant),
        provisionUserOnEveryLogin: false,
        domainVerification: { enabled: true },
      }),
      // Validates provider.organizationId === tenant.organizationId BEFORE the
      // IdP token exchange (A4.3). Must be after sso() so BA's own SSO routes
      // are registered, but the before-hook fires on every matching request.
      ssoCallbackGuardPlugin(db, options.tenant),
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
