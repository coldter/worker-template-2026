import { logger } from "@repo/shared/logger";

export const ID_PREFIXES = {
  account: "acc",
  auditLog: "aud",
  invitation: "inv",
  jwks: "jwks",
  member: "mem",
  notification: "ntf",
  organization: "org",
  pushToken: "ptk",
  role: "rol",
  session: "ses",
  team: "tm",
  teamMember: "tmm",
  twoFactor: "2fa",
  user: "usr",
  verification: "ver",
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

// SAFETY: generatePrefixedCuid namespaces the value with ID_PREFIXES.user, which is the invariant the UserId brand encodes.
export const createUserId = (): UserId =>
  generatePrefixedCuid(ID_PREFIXES.user) as UserId;

// SAFETY: generatePrefixedCuid namespaces the value with ID_PREFIXES.session, which is the invariant the SessionId brand encodes.
export const createSessionId = (): SessionId =>
  generatePrefixedCuid(ID_PREFIXES.session) as SessionId;

// SAFETY: generatePrefixedCuid namespaces the value with ID_PREFIXES.account, which is the invariant the AccountId brand encodes.
export const createAccountId = (): AccountId =>
  generatePrefixedCuid(ID_PREFIXES.account) as AccountId;

// SAFETY: generatePrefixedCuid namespaces the value with ID_PREFIXES.verification, which is the invariant the VerificationId brand encodes.
export const createVerificationId = (): VerificationId =>
  generatePrefixedCuid(ID_PREFIXES.verification) as VerificationId;

function isIdModel(model: string): model is keyof typeof ID_PREFIXES {
  return Object.hasOwn(ID_PREFIXES, model);
}

export const generateIdForModel = (model: string): string => {
  if (isIdModel(model)) {
    const prefix = ID_PREFIXES[model];
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
