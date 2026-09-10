export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug: <T extends object>(message: string, context?: T) => void;
  error: <T extends object>(message: string, context?: T) => void;
  info: <T extends object>(message: string, context?: T) => void;
  warn: <T extends object>(message: string, context?: T) => void;
}

interface SerializedError {
  cause?: unknown;
  message: string;
  name: string;
  stack: string | undefined;
}

function replaceErrors<T>(_key: string, value: T): T | SerializedError {
  if (value instanceof Error) {
    const serialized: SerializedError = {
      message: value.message,
      name: value.name,
      stack: value.stack,
    };
    if (value.cause !== undefined) {
      serialized.cause = value.cause;
    }
    return serialized;
  }
  return value;
}

function log<T extends object>(
  level: LogLevel,
  message: string,
  context?: T
): void {
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
