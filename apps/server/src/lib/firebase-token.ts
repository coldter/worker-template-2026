import { logger } from "@repo/shared/logger";
import { z } from "zod";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const serviceAccountSchema = z
  .object({
    client_email: z.string().min(1),
    private_key: z.string().min(1),
    project_id: z.string().min(1),
  })
  .passthrough();

const oauthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
});

const cachedTokenSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.number(),
});

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const TOKEN_CACHE_KEY = "fcm:access_token";

let cachedToken: CachedToken | null = null;
let cachedCryptoKey: CryptoKey | null = null;
let cachedServiceAccount: ServiceAccount | null = null;

const RE_PLUS = /\+/gu;
const RE_SLASH = /\//gu;
const RE_TRAILING_EQUALS = /[=]+$/u;

const base64UrlEncode = (data: Uint8Array): string => {
  const binary = Array.from(data, (b) => String.fromCodePoint(b)).join("");

  return btoa(binary)
    .replaceAll(RE_PLUS, "-")
    .replaceAll(RE_SLASH, "_")
    .replace(RE_TRAILING_EQUALS, "");
};

const textToBase64Url = (text: string): string =>
  base64UrlEncode(new TextEncoder().encode(text));

export const parseServiceAccount = (
  env: CloudflareBindings
): ServiceAccount => {
  if (cachedServiceAccount) {
    return cachedServiceAccount;
  }

  const keyBase64 = env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64;

  if (!keyBase64) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 is required for FCM provider"
    );
  }

  const json = atob(keyBase64);

  const raw: unknown = JSON.parse(json);
  const result = serviceAccountSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(
      "Service account JSON must contain client_email, private_key, and project_id"
    );
  }

  cachedServiceAccount = {
    client_email: result.data.client_email,
    private_key: result.data.private_key,
    project_id: result.data.project_id,
  };

  return cachedServiceAccount;
};

const importPrivateKey = async (pem: string): Promise<CryptoKey> => {
  if (cachedCryptoKey) {
    return cachedCryptoKey;
  }

  const pemBody = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replaceAll(/\s/gu, "");

  const binaryString = atob(pemBody);

  const bytes = Uint8Array.from(
    binaryString,
    (char) => char.codePointAt(0) ?? 0
  );

  cachedCryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
    false,
    ["sign"]
  );

  return cachedCryptoKey;
};

const createSignedJwt = async (
  serviceAccount: ServiceAccount
): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);

  const header = textToBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));

  const payload = textToBase64Url(
    JSON.stringify({
      aud: TOKEN_URL,
      exp: now + 3600,
      iat: now,
      iss: serviceAccount.client_email,
      scope: FCM_SCOPE,
    })
  );

  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(serviceAccount.private_key);

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
};

const fetchAccessToken = async (
  serviceAccount: ServiceAccount
): Promise<CachedToken> => {
  const jwt = await createSignedJwt(serviceAccount);

  const response = await fetch(TOKEN_URL, {
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `OAuth2 token exchange failed (${response.status}): ${text}`
    );
  }

  const rawData: unknown = await response.json();
  const parsedData = oauthTokenResponseSchema.safeParse(rawData);

  if (!parsedData.success) {
    throw new Error("OAuth2 token response did not match expected shape");
  }

  return {
    accessToken: parsedData.data.access_token,
    expiresAt: Date.now() + parsedData.data.expires_in * 1000,
  };
};

const readCachedToken = async (
  env: CloudflareBindings
): Promise<CachedToken | null> => {
  try {
    const parsed = cachedTokenSchema.safeParse(
      await env.CACHE.get(TOKEN_CACHE_KEY, "json")
    );

    return parsed.success ? parsed.data : null;
  } catch (error) {
    logger.debug("FCM token cache read failed", { error });

    return null;
  }
};

const persistCachedToken = async (
  token: CachedToken,
  env: CloudflareBindings
): Promise<void> => {
  try {
    await env.CACHE.put(TOKEN_CACHE_KEY, JSON.stringify(token), {
      expirationTtl: 3300,
    });
  } catch (error) {
    logger.debug("FCM token cache write failed", { error });
  }
};

export const getAccessToken = async (
  serviceAccount: ServiceAccount,
  env: CloudflareBindings
): Promise<string> => {
  if (
    cachedToken &&
    Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS
  ) {
    return cachedToken.accessToken;
  }

  const storedToken = await readCachedToken(env);

  if (
    storedToken &&
    Date.now() < storedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS
  ) {
    cachedToken = storedToken;

    return storedToken.accessToken;
  }

  const token = await fetchAccessToken(serviceAccount);
  cachedToken = token;
  await persistCachedToken(token, env);

  return token.accessToken;
};

export type { ServiceAccount };
