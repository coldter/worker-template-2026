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
  tenantHostname: "tnh",
  ssoProvider: "sso",
  reservedSlug: "rsv",
  verificationToken: "vtok",
  globalAdmin: "gad",
  organization: "org",
  invitation: "inv",
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
  const timestampSeconds = Math.floor(Date.now() / 1000);
  const timestampHex = timestampSeconds.toString(16).toLowerCase();

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

// CLOSED switch: do NOT add new cases here. New schema tables must call
// generatePrefixedCuid(ID_PREFIXES.X) directly from their $defaultFn.
//
// The default branch THROWS rather than falling through to an "ent" prefix.
// A silent fallback would let a new model accidentally violate the prefix
// invariant -- IDs shaped `ent_*` would collide across tables and obscure
// the table-of-origin during incident triage. New models must wire their
// own `$defaultFn(() => generatePrefixedCuid(ID_PREFIXES.X))` and add a
// matching entry to `ID_PREFIXES` instead of touching this switch.
export const generateIdForModel = (model: string): string => {
  switch (model) {
    case "user":
      return createUserId();
    case "session":
      return createSessionId();
    case "account":
      return createAccountId();
    case "verification":
      return createVerificationId();
    default:
      throw new Error(
        `generateIdForModel: unsupported model "${model}". ` +
          "Add a $defaultFn(() => generatePrefixedCuid(ID_PREFIXES.X)) on the table " +
          "and a matching ID_PREFIXES entry instead of extending this switch."
      );
  }
};
