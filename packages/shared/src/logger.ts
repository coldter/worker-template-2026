export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
}

function log(level: LogLevel, message: string, context?: LogContext): void {
  const entry = JSON.stringify({ level, message, ts: Date.now(), ...context });
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
  info: (message, context) => log("info", message, context),
  warn: (message, context) => log("warn", message, context),
  error: (message, context) => log("error", message, context),
};
