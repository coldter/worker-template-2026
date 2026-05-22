import { logger } from "@repo/shared/logger";

export const ID_PREFIXES = {
  user: "usr",
  session: "ses",
  account: "acc",
  verification: "ver",
  role: "rol",
  auditLog: "aud",
  notification: "ntf",
  pushToken: "ptk",
  relation: "rel",
  jwks: "jwks",
  twoFactor: "2fa",
  organization: "org",
  member: "mem",
  invitation: "inv",
  team: "tm",
  teamMember: "tmm",
} as const;

declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type UserId = Brand<string, "UserId">;
export type SessionId = Brand<string, "SessionId">;
export type AccountId = Brand<string, "AccountId">;
export type VerificationId = Brand<string, "VerificationId">;

export function generatePrefixedCuid<P extends string>(
  prefix: P
): `${P}_${string}` {
  const timestampMs = Date.now();
  const timestampHex = timestampMs.toString(16).toLowerCase();

  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);

  const randomHex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `${prefix}_${timestampHex}${randomHex}`;
}

export const createUserId = (): UserId =>
  generatePrefixedCuid(ID_PREFIXES.user) as UserId;

export const createSessionId = (): SessionId =>
  generatePrefixedCuid(ID_PREFIXES.session) as SessionId;

export const createAccountId = (): AccountId =>
  generatePrefixedCuid(ID_PREFIXES.account) as AccountId;

export const createVerificationId = (): VerificationId =>
  generatePrefixedCuid(ID_PREFIXES.verification) as VerificationId;

// Called by Better Auth's advanced.database.generateId for every model; unknown models fall back to "ent" so plugin inserts keep working.
export const generateIdForModel = (model: string): string => {
  if (model in ID_PREFIXES) {
    const prefix = ID_PREFIXES[model as keyof typeof ID_PREFIXES];
    return generatePrefixedCuid(prefix);
  }
  logger.warn(
    "generateIdForModel: unknown model, falling back to 'ent' prefix",
    {
      model,
    }
  );
  return generatePrefixedCuid("ent");
};
