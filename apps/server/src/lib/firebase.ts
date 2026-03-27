import { env } from "cloudflare:workers";
import { logger } from "@/lib/logger";

// ============================================================
// TYPES
// ============================================================

interface PushMessage {
  data: Record<string, string>;
  token: string;
}

interface PushSendResult {
  error?: string;
  /** True if the token is invalid and should be removed */
  invalidToken?: boolean;
  messageId?: string;
  success: boolean;
}

interface PushProvider {
  send(message: PushMessage): Promise<PushSendResult>;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// ============================================================
// CONSOLE PROVIDER (development)
// ============================================================

class ConsolePushProvider implements PushProvider {
  async send(message: PushMessage): Promise<PushSendResult> {
    logger.info("Console push provider: would send push notification", {
      token: `${message.token.slice(0, 12)}...`,
      type: message.data.type,
      title: message.data.title,
      body: message.data.body,
    });
    return { success: true, messageId: `console_${Date.now()}` };
  }
}

// ============================================================
// FCM HTTP v1 PROVIDER
// ============================================================

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

function parseServiceAccount(): ServiceAccount {
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
  const parsed = JSON.parse(json) as Record<string, string>;

  if (!(parsed.client_email && parsed.private_key && parsed.project_id)) {
    throw new Error(
      "Service account JSON must contain client_email, private_key, and project_id"
    );
  }

  cachedServiceAccount = {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    project_id: parsed.project_id,
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

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function getAccessToken(serviceAccount: ServiceAccount): Promise<string> {
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

const INVALID_TOKEN_ERROR_CODES = new Set([
  "UNREGISTERED",
  "INVALID_ARGUMENT",
  "SENDER_ID_MISMATCH",
]);

class FcmHttpProvider implements PushProvider {
  private readonly serviceAccount: ServiceAccount;

  constructor(serviceAccount: ServiceAccount) {
    this.serviceAccount = serviceAccount;
  }

  async send(message: PushMessage): Promise<PushSendResult> {
    const accessToken = await getAccessToken(this.serviceAccount);
    const url = `https://fcm.googleapis.com/v1/projects/${this.serviceAccount.project_id}/messages:send`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: message.token,
          data: message.data,
        },
      }),
    });

    if (response.ok) {
      const result = (await response.json()) as { name: string };
      return { success: true, messageId: result.name };
    }

    const errorBody = (await response.json()) as {
      error?: {
        code?: number;
        message?: string;
        details?: Array<{ "@type"?: string; errorCode?: string }>;
      };
    };

    const fcmErrorCode = errorBody.error?.details?.find(
      (d) =>
        d["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError"
    )?.errorCode;

    const isInvalidToken = fcmErrorCode
      ? INVALID_TOKEN_ERROR_CODES.has(fcmErrorCode)
      : false;

    return {
      success: false,
      error:
        errorBody.error?.message ?? `FCM request failed (${response.status})`,
      invalidToken: isInvalidToken,
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let pushProvider: PushProvider | null = null;

export function getPushProvider(): PushProvider {
  if (pushProvider) {
    return pushProvider;
  }

  if (String(env.FCM_PROVIDER) === "fcm") {
    const serviceAccount = parseServiceAccount();
    pushProvider = new FcmHttpProvider(serviceAccount);
    logger.info("FCM HTTP v1 push provider initialized");
  } else {
    pushProvider = new ConsolePushProvider();
    logger.info("Console push provider initialized (FCM_PROVIDER!=fcm)");
  }

  return pushProvider;
}

export type { PushMessage, PushProvider, PushSendResult };
