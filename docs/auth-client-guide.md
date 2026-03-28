# Auth Client Integration Guide

This guide covers everything a client developer needs to integrate with the authentication service. The auth service is built on [Better Auth](https://www.better-auth.com) and exposed as a Cloudflare Worker.

---

## Table of Contents

1. [Base URL and Endpoint Reference](#base-url-and-endpoint-reference)
2. [Email/Password Sign-Up Flow](#emailpassword-sign-up-flow)
3. [Email/Password Sign-In Flow](#emailpassword-sign-in-flow)
4. [Email Verification (OTP)](#email-verification-otp)
5. [Password Reset (OTP)](#password-reset-otp)
6. [Two-Factor Authentication](#two-factor-authentication)
7. [Session Lifecycle and Expiry](#session-lifecycle-and-expiry)
8. [Bearer Token Usage](#bearer-token-usage)
9. [JWT Token Usage](#jwt-token-usage)
10. [Platform-Specific Guides](#platform-specific-guides)
    - [Web Browser](#web-browser-better-auth-react-client)
    - [Native iOS (Swift)](#native-ios-swift)
    - [Native Android (Kotlin)](#native-android-kotlin)
    - [React Native / Expo](#react-native--expo)
    - [Flutter](#flutter)
11. [Error Response Format and Codes](#error-response-format-and-codes)
12. [Future: Device Authorization Flow](#future-device-authorization-flow)

---

## Base URL and Endpoint Reference

All auth endpoints are served under the auth service base URL. In production this is configured via `APP_URL`.

```
BASE_URL = https://auth.example.com
```

All endpoints below are prefixed with `/api/auth` by default (Better Auth convention).

| Endpoint | Method | Description |
|---|---|---|
| `/api/auth/sign-up/email` | POST | Create a new account |
| `/api/auth/sign-in/email` | POST | Sign in with email and password |
| `/api/auth/sign-out` | POST | Invalidate the current session |
| `/api/auth/get-session` | GET | Fetch the current session and user |
| `/api/auth/email-otp/send-verification-otp` | POST | Request an email verification OTP |
| `/api/auth/email-otp/verify-email` | POST | Submit the email verification OTP |
| `/api/auth/email-otp/send-otp` | POST | Request a forget-password OTP |
| `/api/auth/email-otp/verify-otp` | POST | Verify a forget-password OTP and reset password |
| `/api/auth/two-factor/enable` | POST | Enable 2FA for the signed-in user |
| `/api/auth/two-factor/disable` | POST | Disable 2FA for the signed-in user |
| `/api/auth/two-factor/send-otp` | POST | Request a 2FA OTP during sign-in |
| `/api/auth/two-factor/verify-otp` | POST | Submit a 2FA OTP to complete sign-in |
| `/api/auth/token` | GET | Exchange session for a short-lived JWT |
| `/api/auth/jwks` | GET | JWKS endpoint for JWT verification |
| `/api/auth/openapi` | GET | OpenAPI spec for the auth service |

---

## Email/Password Sign-Up Flow

Sign-up requires an email that has not been used before. After a successful sign-up, a 6-digit verification OTP is automatically sent to the provided email. The account cannot be used to sign in until email verification is complete.

### Step 1 — Create account

```bash
curl -X POST https://auth.example.com/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "name": "Alice Smith"
  }'
```

**Success response (200):**

```json
{
  "user": {
    "id": "usr_01abc",
    "email": "user@example.com",
    "name": "Alice Smith",
    "emailVerified": false,
    "createdAt": "2026-03-28T10:00:00.000Z"
  },
  "session": null
}
```

`session` is `null` because `requireEmailVerification` is enabled. The user must verify their email before a session is established.

### Step 2 — Verify email (see [Email Verification](#email-verification-otp))

The verification OTP is sent automatically on sign-up. Proceed directly to the verification step.

---

## Email/Password Sign-In Flow

### Basic sign-in (no 2FA)

```bash
curl -X POST https://auth.example.com/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!"
  }'
```

**Success response (200):**

```json
{
  "user": {
    "id": "usr_01abc",
    "email": "user@example.com",
    "name": "Alice Smith",
    "emailVerified": true,
    "twoFactorEnabled": false
  },
  "session": {
    "id": "ses_01xyz",
    "token": "...",
    "expiresAt": "2026-03-28T11:00:00.000Z",
    "platform": "web"
  }
}
```

For web clients the session cookie (`session_token_v1`) is set automatically. Mobile clients must read the `set-auth-token` response header (see [Bearer Token Usage](#bearer-token-usage)).

### Sign-in with 2FA enabled

When 2FA is enabled, `sign-in/email` returns a `twoFactorRedirect` indicator instead of a full session. The client must complete the 2FA challenge.

```json
{
  "twoFactorRedirect": true
}
```

Proceed to [Two-Factor Authentication](#two-factor-authentication).

---

## Email Verification (OTP)

OTP length: **6 digits**. Expiry: **5 minutes**.

An OTP is sent automatically when a new account is created. You can also trigger a resend.

### Resend verification OTP

```bash
curl -X POST https://auth.example.com/api/auth/email-otp/send-verification-otp \
  -H "Content-Type: application/json" \
  -d '{ "email": "user@example.com" }'
```

**Response (200):** `{ "success": true }`

### Submit OTP

```bash
curl -X POST https://auth.example.com/api/auth/email-otp/verify-email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "otp": "847291"
  }'
```

**Success response (200):**

```json
{
  "user": {
    "id": "usr_01abc",
    "email": "user@example.com",
    "emailVerified": true
  },
  "session": {
    "id": "ses_01xyz",
    "token": "...",
    "expiresAt": "2026-03-28T11:00:00.000Z"
  }
}
```

After successful verification, a full session is created and the user is signed in.

---

## Password Reset (OTP)

Password reset uses the same email OTP mechanism. OTP length: **6 digits**. Expiry: **5 minutes**.

### Step 1 — Request a password reset OTP

```bash
curl -X POST https://auth.example.com/api/auth/email-otp/send-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "type": "forget-password"
  }'
```

**Response (200):** `{ "success": true }`

The OTP is sent to the email address. For non-existent accounts, the response is the same (no enumeration).

### Step 2 — Verify OTP and set new password

```bash
curl -X POST https://auth.example.com/api/auth/email-otp/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "otp": "382910",
    "type": "forget-password",
    "newPassword": "NewSecurePassword456!"
  }'
```

**Success response (200):** `{ "success": true }`

After a successful reset the user must sign in again with the new password.

---

## Two-Factor Authentication

2FA uses email OTP only. TOTP authenticator apps are not supported. OTP length: **6 digits**. Expiry: **3 minutes**.

### Enabling 2FA

The user must be signed in with a valid session.

```bash
curl -X POST https://auth.example.com/api/auth/two-factor/enable \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "password": "SecurePassword123!" }'
```

**Response (200):** `{ "status": true }`

### Disabling 2FA

```bash
curl -X POST https://auth.example.com/api/auth/two-factor/disable \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "password": "SecurePassword123!" }'
```

**Response (200):** `{ "status": true }`

### Completing sign-in with 2FA

After `sign-in/email` returns `{ "twoFactorRedirect": true }`:

**Step 1 — Request OTP**

```bash
curl -X POST https://auth.example.com/api/auth/two-factor/send-otp \
  -H "Content-Type: application/json"
```

An OTP is sent to the user's registered email.

**Step 2 — Submit OTP**

```bash
curl -X POST https://auth.example.com/api/auth/two-factor/verify-otp \
  -H "Content-Type: application/json" \
  -d '{ "code": "612045" }'
```

**Success response (200):**

```json
{
  "user": { ... },
  "session": {
    "id": "ses_01xyz",
    "token": "...",
    "expiresAt": "2026-03-29T10:00:00.000Z"
  }
}
```

---

## Session Lifecycle and Expiry

Session duration is determined by the client's platform, detected automatically from the `User-Agent` header.

| Platform | Session duration | Slide window |
|---|---|---|
| Web (`web`) | 1 hour | 30 minutes |
| Mobile (`mobile`) | 7 days | 1 day |

**Platform detection** — the following User-Agent substrings are treated as mobile:

`android`, `iphone`, `ipad`, `mobile`, `okhttp`, `dart`, `flutter`, `react-native`, `expo`

Any other User-Agent defaults to `web`.

**Single session per user** — only one session is active at a time. Signing in from a new device/client terminates the previous session. A new-device login notification email is sent when device fingerprint changes.

**Session refresh** — Better Auth slides the expiry automatically when the session is within the `updateAge` window. Mobile clients should send their bearer token on every request so the session stays alive.

### Checking the current session

```bash
curl https://auth.example.com/api/auth/get-session \
  -H "Authorization: Bearer <token>"
```

**Response (200):**

```json
{
  "user": {
    "id": "usr_01abc",
    "email": "user@example.com",
    "name": "Alice Smith",
    "emailVerified": true,
    "twoFactorEnabled": true,
    "roleSlugs": ["user"],
    "permissions": ["read:profile", "write:profile"],
    "status": "active"
  },
  "session": {
    "id": "ses_01xyz",
    "expiresAt": "2026-03-29T10:00:00.000Z",
    "platform": "mobile"
  }
}
```

### Sign out

```bash
curl -X POST https://auth.example.com/api/auth/sign-out \
  -H "Authorization: Bearer <token>"
```

**Response (200):** `{ "success": true }`

---

## Bearer Token Usage

Mobile and non-browser clients use bearer tokens. The bearer plugin is configured with `requireSignature: true`, so tokens are signed and must not be modified.

### Obtaining the token

The bearer token is returned in the `set-auth-token` response header on any endpoint that creates or refreshes a session:

- `POST /sign-up/email` (after email verification)
- `POST /sign-in/email` (successful sign-in)
- `POST /email-otp/verify-email`
- `POST /two-factor/verify-otp`

```
HTTP/1.1 200 OK
set-auth-token: <signed-bearer-token>
Content-Type: application/json
```

Store this value securely (see platform-specific guides below).

### Using the token

Include the token in the `Authorization` header on every subsequent request:

```
Authorization: Bearer <signed-bearer-token>
```

### Token renewal

The bearer token is tied to the underlying session. When Better Auth slides the session expiry (within the `updateAge` window), a new `set-auth-token` header may be issued. Clients should update their stored token whenever this header appears in any response.

---

## JWT Token Usage

Short-lived JWTs are available for downstream services that need to verify the caller's identity without contacting the auth service on every request.

- **Issuer / Audience:** `APP_URL`
- **Expiry:** 15 minutes
- **Algorithm:** RS256 (keys rotated every 30 days)

### Obtain a JWT

```bash
curl https://auth.example.com/api/auth/token \
  -H "Authorization: Bearer <token>"
```

**Response (200):**

```json
{
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### JWT payload fields

```json
{
  "sub": "usr_01abc",
  "email": "user@example.com",
  "roleSlugs": ["user"],
  "permissions": ["read:profile"],
  "platform": "mobile",
  "iss": "https://auth.example.com",
  "aud": "https://auth.example.com",
  "exp": 1743161700,
  "iat": 1743160800
}
```

### Verifying a JWT in a downstream service

Fetch the JWKS and verify the token signature:

```bash
# Fetch JWKS
curl https://auth.example.com/api/auth/jwks
```

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "kid": "...",
      "n": "...",
      "e": "AQAB"
    }
  ]
}
```

Use a standard JWT library with the JWKS to verify the signature, issuer, audience, and expiry. Because JWTs expire in 15 minutes, clients should obtain a fresh JWT per request (or cache with a short TTL).

---

## Platform-Specific Guides

### Web Browser (Better Auth React Client)

The official Better Auth React client handles cookies automatically. The browser stores the `session_token_v1` HttpOnly cookie; no manual token management is needed.

**Installation:**

```bash
npm install better-auth
```

**Client setup (`lib/auth-client.ts`):**

```typescript
import { createAuthClient } from "better-auth/react";
import { twoFactorClient, emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: "https://auth.example.com",
  plugins: [
    twoFactorClient(),
    emailOTPClient(),
  ],
});
```

**Sign-up:**

```typescript
const { data, error } = await authClient.signUp.email({
  email: "user@example.com",
  password: "SecurePassword123!",
  name: "Alice Smith",
});
```

**Sign-in:**

```typescript
const { data, error } = await authClient.signIn.email({
  email: "user@example.com",
  password: "SecurePassword123!",
});

if (data?.twoFactorRedirect) {
  // Prompt user to enter 2FA code
  await authClient.twoFactor.sendOtp();
  const { data: twoFaData } = await authClient.twoFactor.verifyOtp({
    code: userEnteredCode,
  });
}
```

**Email verification:**

```typescript
// Resend OTP
await authClient.emailOtp.sendVerificationOtp({ email: "user@example.com" });

// Verify OTP
await authClient.emailOtp.verifyEmail({ email: "user@example.com", otp: "847291" });
```

**Password reset:**

```typescript
// Request OTP
await authClient.emailOtp.sendOtp({ email: "user@example.com", type: "forget-password" });

// Verify and reset
await authClient.emailOtp.verifyOtp({
  email: "user@example.com",
  otp: "382910",
  type: "forget-password",
  newPassword: "NewPassword456!",
});
```

**Session access in React:**

```typescript
const { data: session } = authClient.useSession();
```

---

### Native iOS (Swift)

iOS clients must include a mobile User-Agent so the server grants a 7-day session. Store the bearer token in the system Keychain.

**Sign-in:**

```swift
import Foundation
import Security

struct AuthClient {
    static let baseURL = URL(string: "https://auth.example.com/api/auth")!

    static func signIn(email: String, password: String) async throws -> String {
        var request = URLRequest(url: baseURL.appendingPathComponent("sign-in/email"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Mobile User-Agent ensures a 7-day session
        request.setValue("MyApp/1.0 (iPhone; iOS 17)", forHTTPHeaderField: "User-Agent")

        let body = ["email": email, "password": password]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.invalidResponse
        }

        // Extract bearer token from response header
        guard let token = httpResponse.value(forHTTPHeaderField: "set-auth-token") else {
            throw AuthError.missingToken
        }
        return token
    }
}
```

**Keychain storage:**

```swift
import Security

func saveTokenToKeychain(_ token: String, for account: String = "auth_token") {
    let data = Data(token.utf8)
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrAccount: account,
        kSecValueData: data,
        kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
    SecItemDelete(query as CFDictionary)
    SecItemAdd(query as CFDictionary, nil)
}

func loadTokenFromKeychain(for account: String = "auth_token") -> String? {
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrAccount: account,
        kSecReturnData: true,
        kSecMatchLimit: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
}
```

**Authenticated request:**

```swift
func makeAuthenticatedRequest(path: String) async throws -> Data {
    guard let token = loadTokenFromKeychain() else { throw AuthError.notSignedIn }
    var request = URLRequest(url: baseURL.appendingPathComponent(path))
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("MyApp/1.0 (iPhone; iOS 17)", forHTTPHeaderField: "User-Agent")
    let (data, _) = try await URLSession.shared.data(for: request)
    return data
}
```

**Token renewal** — inspect every response for the `set-auth-token` header and update Keychain when present:

```swift
let (data, response) = try await URLSession.shared.data(for: request)
if let httpResponse = response as? HTTPURLResponse,
   let newToken = httpResponse.value(forHTTPHeaderField: "set-auth-token") {
    saveTokenToKeychain(newToken)
}
```

---

### Native Android (Kotlin)

Android clients must include a mobile User-Agent. Store the bearer token in the Android Keystore via `EncryptedSharedPreferences`.

**Dependencies (`build.gradle.kts`):**

```kotlin
implementation("com.squareup.okhttp3:okhttp:4.12.0")
implementation("androidx.security:security-crypto:1.1.0-alpha06")
```

**Encrypted storage:**

```kotlin
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class TokenStore(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "auth_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun saveToken(token: String) = prefs.edit().putString("bearer_token", token).apply()
    fun loadToken(): String? = prefs.getString("bearer_token", null)
    fun clearToken() = prefs.edit().remove("bearer_token").apply()
}
```

**Sign-in with OkHttp:**

```kotlin
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

val client = OkHttpClient()
val BASE_URL = "https://auth.example.com/api/auth"
// Mobile User-Agent ensures a 7-day session
val MOBILE_USER_AGENT = "MyApp/1.0 (Android 14; Pixel 8)"

fun signIn(email: String, password: String): String {
    val json = JSONObject().apply {
        put("email", email)
        put("password", password)
    }
    val body = json.toString().toRequestBody("application/json".toMediaType())
    val request = Request.Builder()
        .url("$BASE_URL/sign-in/email")
        .post(body)
        .header("User-Agent", MOBILE_USER_AGENT)
        .build()

    client.newCall(request).execute().use { response ->
        val token = response.header("set-auth-token")
            ?: throw IllegalStateException("Missing auth token")
        return token
    }
}
```

**Authenticated request:**

```kotlin
fun getSession(tokenStore: TokenStore): String {
    val token = tokenStore.loadToken() ?: throw IllegalStateException("Not signed in")
    val request = Request.Builder()
        .url("$BASE_URL/get-session")
        .header("Authorization", "Bearer $token")
        .header("User-Agent", MOBILE_USER_AGENT)
        .build()

    client.newCall(request).execute().use { response ->
        // Renew token if the server sends a fresh one
        response.header("set-auth-token")?.let { tokenStore.saveToken(it) }
        return response.body?.string() ?: ""
    }
}
```

---

### React Native / Expo

Use the official Better Auth Expo plugin. It handles bearer token storage in `SecureStore` automatically.

**Installation:**

```bash
npx expo install better-auth-expo expo-secure-store
```

**Client setup:**

```typescript
import { createAuthClient } from "better-auth/react";
import { expoClient } from "better-auth-expo";
import { twoFactorClient, emailOTPClient } from "better-auth/client/plugins";
import * as SecureStore from "expo-secure-store";

export const authClient = createAuthClient({
  baseURL: "https://auth.example.com",
  plugins: [
    expoClient({
      scheme: "myapp",
      storagePrefix: "myapp",
      storage: SecureStore,
    }),
    twoFactorClient(),
    emailOTPClient(),
  ],
});
```

The `expoClient` plugin automatically:
- Sends a mobile-identified User-Agent (triggering 7-day session)
- Reads `set-auth-token` from responses and stores it in `SecureStore`
- Attaches `Authorization: Bearer <token>` on every request

Sign-in, sign-up, and 2FA flows are identical to the web React client.

---

### Flutter

Flutter uses the `http` package with manual token management. The `dart`/`flutter` substrings in the default Dart User-Agent are detected as mobile, so no override is needed.

**Dependencies (`pubspec.yaml`):**

```yaml
dependencies:
  http: ^1.2.0
  flutter_secure_storage: ^9.0.0
```

**Auth client:**

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthClient {
  static const baseUrl = 'https://auth.example.com/api/auth';
  final _storage = const FlutterSecureStorage();

  Future<void> signIn(String email, String password) async {
    final response = await http.post(
      Uri.parse('$baseUrl/sign-in/email'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );

    if (response.statusCode != 200) {
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      throw AuthException(body['code'] as String? ?? 'UNKNOWN');
    }

    final token = response.headers['set-auth-token'];
    if (token != null) {
      await _storage.write(key: 'bearer_token', value: token);
    }
  }

  Future<http.Response> authenticatedGet(String path) async {
    final token = await _storage.read(key: 'bearer_token');
    final response = await http.get(
      Uri.parse('$baseUrl/$path'),
      headers: {
        if (token != null) 'Authorization': 'Bearer $token',
      },
    );

    // Renew token if server sends a fresh one
    final newToken = response.headers['set-auth-token'];
    if (newToken != null) {
      await _storage.write(key: 'bearer_token', value: newToken);
    }
    return response;
  }

  Future<void> signOut() async {
    await authenticatedGet('sign-out');
    await _storage.delete(key: 'bearer_token');
  }
}

class AuthException implements Exception {
  final String code;
  AuthException(this.code);
}
```

---

## Error Response Format and Codes

The auth service returns errors in the following format:

```json
{
  "message": "Human-readable description",
  "code": "ERROR_CODE",
  "status": 403
}
```

### Error codes

| Code | HTTP Status | Description |
|---|---|---|
| `ACCOUNT_DELETED` | 403 | The account has been permanently deleted |
| `ACCOUNT_INACTIVE` | 403 | The account has been deactivated by an administrator |
| `ACCOUNT_LOCKED` | 429 | Too many failed login attempts; locked for 15 minutes |
| `INVALID_CREDENTIALS` | 401 | Email or password is incorrect |

### Account lockout details

After **3 consecutive failed sign-in attempts**, the account is locked for **15 minutes**. The error message includes the remaining time:

```json
{
  "message": "Account is locked. Please try again in 14 minute(s) or reset your password.",
  "code": "ACCOUNT_LOCKED",
  "status": 429
}
```

To unlock immediately, the user can reset their password using the [forget-password OTP flow](#password-reset-otp). Lockouts also expire automatically after 15 minutes.

### Handling errors (TypeScript example)

```typescript
async function handleSignIn(email: string, password: string) {
  const response = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json() as { code?: string; message: string };
    switch (error.code) {
      case "ACCOUNT_DELETED":
        // Show permanent deletion message
        break;
      case "ACCOUNT_INACTIVE":
        // Prompt user to contact support
        break;
      case "ACCOUNT_LOCKED":
        // Show lockout timer; offer password reset
        break;
      case "INVALID_CREDENTIALS":
        // Show generic invalid credentials message
        break;
      default:
        // Handle unexpected errors
    }
    return;
  }

  // Handle success
}
```

---

## Future: Device Authorization Flow

The Device Authorization Grant (RFC 8628) is planned for TV, smart display, CLI, and IoT clients that cannot open a browser directly.

The flow works as follows:

1. The device requests a device code and user code from the auth service.
2. The device displays the user code and instructs the user to visit a verification URL on another device (phone, computer).
3. The user signs in on the secondary device and enters the user code to approve the request.
4. Meanwhile, the device polls the auth service for an access token.
5. Once approved, the device receives a bearer token.

This capability is not yet implemented. When available, it will be documented here with the relevant endpoints and polling intervals.
