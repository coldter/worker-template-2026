export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
}

// JSON.stringify omits Error fields by default; serialize them explicitly.
// `cause` is included because wrapped errors (DrizzleQueryError around a pg
// DatabaseError) keep the actionable detail there; the replacer recurses into
// it, so a nested Error serializes the same way.
function replaceErrors(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack,
      ...(value.cause === undefined ? {} : { cause: value.cause }),
    };
  }
  return value;
}

function log(level: LogLevel, message: string, context?: LogContext): void {
  const payload = { level, message, ts: Date.now(), ...context };
  const entry =
    process.env.NODE_ENV === "production"
      ? JSON.stringify(payload, replaceErrors)
      : JSON.stringify(payload, replaceErrors, 2);
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

export const logger: Logger = {
  debug: (message, context) => log("debug", message, context),
  error: (message, context) => log("error", message, context),
  info: (message, context) => log("info", message, context),
  warn: (message, context) => log("warn", message, context),
};
