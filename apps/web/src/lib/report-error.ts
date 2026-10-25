import * as z from "zod/mini";

const catchSchema = z.catch;

interface ErrorContext {
  source: "router-error-boundary" | "unhandledrejection" | "window.error";
}

export const reportableErrorSchema = catchSchema(
  z.union([z.instanceof(Error), z.string()]),
  (ctx) => {
    try {
      return String(ctx.value);
    } catch {
      return "Unknown error";
    }
  }
);

export type ReportableError = z.infer<typeof reportableErrorSchema>;

export const reportError = (
  error: ReportableError,
  context?: ErrorContext
): void => {
  console.error("[report-error]", error, context ?? {});
};

let initialized = false;

export const initErrorReporting = (): void => {
  if (initialized) {
    return;
  }

  initialized = true;

  window.addEventListener("error", (event) => {
    reportError(event.error ?? event.message, { source: "window.error" });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason, { source: "unhandledrejection" });
  });
};
