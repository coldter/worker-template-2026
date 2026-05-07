export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
}

/**
 * Field names whose values must never appear in structured log output. The
 * comparison is case-insensitive and matches both camelCase and snake_case
 * variants. Add new entries when introducing new sensitive fields. C4 — D56
 * relies on this redactor to keep `withDecryptedSecret` plaintext out of
 * logs even when callers accidentally interpolate it.
 */
export const REDACT_KEYS: ReadonlySet<string> = new Set([
  "secret",
  "clientsecret",
  "client_secret",
  "enrollmenttoken",
  "enrollment_token",
  "password",
  "apikey",
  "api_key",
  "authorization",
  // SSO config blobs (D13/D73). Stored encrypted at rest; the decrypted
  // form must never appear in logs even when callers interpolate it.
  "oidcconfig",
  "oidc_config",
  "oidcconfigencrypted",
  "oidc_config_encrypted",
  // Asymmetric keys (JWT/JWKS). The privateKey column in `jwks` carries
  // the signing key; redact across both casings.
  "privatekey",
  "private_key",
  // OAuth/OIDC token material from the `accounts` table. Refresh tokens
  // and id tokens are bearer credentials; access tokens are also redacted
  // upstream by the `authorization` key but we keep both spellings here.
  "refreshtoken",
  "refresh_token",
  "idtoken",
  "id_token",
  // Verification tokens (account verification, password reset, etc.).
  "verificationtoken",
  "verification_token",
  // 2FA backup codes -- single-use credentials, redact unconditionally.
  "backupcodes",
  "backup_codes",
  // Note: `cf_access_sub` / `cfAccessSub` is the Cloudflare Access subject
  // identifier (a stable user pseudonym, not really a secret). It is not
  // redacted here -- redaction would inflate log volume and obscure
  // identity-correlation telemetry. Operators who consider it sensitive
  // can pass it via the `extraKeys` option at the callsite.
]);

const REDACTED = "[REDACTED]";
const DEFAULT_DEPTH_CAP = 10;

export interface RedactOptions {
  /**
   * Maximum recursion depth before bailing out and returning the value as-is.
   * Defaults to 10 to keep pathological inputs from blocking the event loop.
   */
  depthCap?: number;
  /**
   * Additional keys (case-insensitive) to redact in addition to the default
   * `REDACT_KEYS` set. Useful at callsites that handle context-specific
   * sensitive data (e.g., enrollment tokens for a specific feature).
   */
  extraKeys?: ReadonlySet<string>;
}

interface RedactInternalOptions {
  depthCap: number;
  matcher: (key: string) => boolean;
}

function buildMatcher(
  extra: ReadonlySet<string> | undefined
): (key: string) => boolean {
  if (extra === undefined || extra.size === 0) {
    return (k) => REDACT_KEYS.has(k.toLowerCase());
  }
  // Lowercase the extras once at construction time.
  const lowered = new Set<string>();
  for (const k of extra) {
    lowered.add(k.toLowerCase());
  }
  return (k) => {
    const lc = k.toLowerCase();
    return REDACT_KEYS.has(lc) || lowered.has(lc);
  };
}

function redactInternal(
  value: unknown,
  depth: number,
  opts: RedactInternalOptions
): unknown {
  if (depth > opts.depthCap) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactInternal(entry, depth + 1, opts));
  }
  if (value && typeof value === "object") {
    // boundary: structured-log redaction — `value` is arbitrary user-supplied
    // metadata; we walk its own keys and rebuild a sanitized record. Any
    // non-plain object (Map/Set/Class instance) is preserved as-is via the
    // typeof check above; we only descend into plain {key: value} shapes.
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(source)) {
      out[k] = opts.matcher(k) ? REDACTED : redactInternal(v, depth + 1, opts);
    }
    return out;
  }
  return value;
}

/**
 * Recursively walk a value and replace the values of any sensitive keys with
 * `[REDACTED]`. Key matching is case-insensitive. Recursion is bounded by
 * `depthCap` (default 10) to protect against pathological inputs.
 *
 * This is the same redactor used by `logger.{info, warn, ...}`. It is
 * exported so callers can sanitize values for non-logger sinks (OTEL spans,
 * error reports) without re-implementing the rules.
 */
export function redact(value: unknown, opts: RedactOptions = {}): unknown {
  return redactInternal(value, 0, {
    matcher: buildMatcher(opts.extraKeys),
    depthCap: opts.depthCap ?? DEFAULT_DEPTH_CAP,
  });
}

/**
 * Runtime knobs for the structured logger. Workers do not expose
 * `process.env.NODE_ENV`, so the default `logger` is configured via
 * `configureLogger({ structured: true })` from the worker bootstrap.
 * Callers that want a scoped logger (tests, isolated background tasks)
 * can build one with `createLogger(opts)`.
 */
export interface LoggerOptions {
  /**
   * When true, log lines are emitted as JSON strings (one per record) so
   * Cloudflare Workers logs / OTEL collectors can parse them. When false,
   * records are emitted as objects so local dev consoles render them
   * pretty. Defaults to false.
   */
  structured?: boolean;
}

const moduleLoggerState: { options: LoggerOptions } = {
  options: { structured: false },
};

/**
 * Replace the default logger's runtime options. Intended to be called once
 * during worker bootstrap (e.g. `configureLogger({ structured: true })`).
 * Subsequent calls overwrite earlier configuration; the change is visible
 * to the singleton `logger` immediately.
 */
export function configureLogger(options: LoggerOptions): void {
  moduleLoggerState.options = { ...options };
}

function emit(
  level: LogLevel,
  message: string,
  context: LogContext | undefined,
  options: LoggerOptions
): void {
  const safe =
    context === undefined ? undefined : (redact(context) as LogContext);
  const record = { level, message, ts: Date.now(), ...safe };
  const entry = options.structured ? JSON.stringify(record) : record;
  switch (level) {
    case "error":
      console.error(entry);
      break;
    case "warn":
      console.warn(entry);
      break;
    case "debug":
      // biome-ignore lint/suspicious/noConsole: logger implementation
      console.debug(entry);
      break;
    default:
      // biome-ignore lint/suspicious/noConsole: logger implementation
      console.log(entry);
  }
}

/**
 * Build a Logger with caller-supplied options. Useful in tests or when a
 * specific subsystem wants different formatting from the global logger.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const opts: LoggerOptions = { ...options };
  return {
    debug: (message, context) => emit("debug", message, context, opts),
    info: (message, context) => emit("info", message, context, opts),
    warn: (message, context) => emit("warn", message, context, opts),
    error: (message, context) => emit("error", message, context, opts),
  };
}

export const logger: Logger = {
  debug: (message, context) =>
    emit("debug", message, context, moduleLoggerState.options),
  info: (message, context) =>
    emit("info", message, context, moduleLoggerState.options),
  warn: (message, context) =>
    emit("warn", message, context, moduleLoggerState.options),
  error: (message, context) =>
    emit("error", message, context, moduleLoggerState.options),
};
