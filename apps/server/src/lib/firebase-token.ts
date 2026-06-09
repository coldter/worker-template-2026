import { env } from "cloudflare:workers";
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

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

// Module-scope caches (persist across requests in the same isolate)
let cachedToken: CachedToken | null = null;
let cachedCryptoKey: CryptoKey | null = null;
let cachedServiceAccount: ServiceAccount | null = null;

const RE_PLUS = /\+/g;
const RE_SLASH = /\//g;
const RE_TRAILING_EQUALS = /=+$/;

function base64UrlEncode(data: Uint8Array): string {
  const binary = Array.from(data, (b) => String.fromCharCode(b)).join("");
  return btoa(binary)
    .replace(RE_PLUS, "-")
    .replace(RE_SLASH, "_")
    .replace(RE_TRAILING_EQUALS, "");
}

function textToBase64Url(text: string): string {
  return base64UrlEncode(new TextEncoder().encode(text));
}

export function parseServiceAccount(): ServiceAccount {
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
  // boundary: service-account JSON external input validated by serviceAccountSchema below
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
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  if (cachedCryptoKey) {
    return cachedCryptoKey;
  }

  const pemBody = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binaryString = atob(pemBody);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  cachedCryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return cachedCryptoKey;
}

async function createSignedJwt(
  serviceAccount: ServiceAccount
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = textToBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = textToBase64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: FCM_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
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
}

async function fetchAccessToken(
  serviceAccount: ServiceAccount
): Promise<CachedToken> {
  const jwt = await createSignedJwt(serviceAccount);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `OAuth2 token exchange failed (${response.status}): ${text}`
    );
  }

  // boundary: external OAuth2 token response validated by oauthTokenResponseSchema
  const rawData: unknown = await response.json();
  const parsedData = oauthTokenResponseSchema.safeParse(rawData);
  if (!parsedData.success) {
    throw new Error("OAuth2 token response did not match expected shape");
  }

  return {
    accessToken: parsedData.data.access_token,
    expiresAt: Date.now() + parsedData.data.expires_in * 1000,
  };
}

export async function getAccessToken(
  serviceAccount: ServiceAccount
): Promise<string> {
  // Tier 1: module-scope in-memory cache
  if (
    cachedToken &&
    Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS
  ) {
    return cachedToken.accessToken;
  }

  // Tier 2: KV cache
  try {
    const stored = (await env.CACHE.get(
      "fcm:access_token",
      "json"
    )) as CachedToken | null;
    if (stored && Date.now() < stored.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      cachedToken = stored;
      return stored.accessToken;
    }
  } catch {
    // KV unavailable - proceed to generate
  }

  // Tier 3: generate new token
  const token = await fetchAccessToken(serviceAccount);
  cachedToken = token;

  // Persist to KV (best-effort)
  try {
    await env.CACHE.put("fcm:access_token", JSON.stringify(token), {
      expirationTtl: 3300,
    });
  } catch {
    // KV write failure is non-critical
  }

  return token.accessToken;
}

export type { ServiceAccount };
