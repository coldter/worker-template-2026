import { logger, redact } from "@repo/shared/logger";
import { DrizzleQueryError } from "drizzle-orm";
import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import pg from "pg";
import { PostgresError } from "pg-error-enum";
import type { AppEnv } from "@/lib/context";

function extractCauseCode(cause: unknown): string | null {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof (cause as Record<string, unknown>).code === "string"
  ) {
    return (cause as Record<string, unknown>).code as string;
  }
  return null;
}

function errorResponse(
  code: string,
  message: string,
  details?: string
): { error: { code: string; message: string; details?: string } } {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

/**
 * Build the per-request log envelope. Every error log entry carries the
 * same correlation fields so a single request_id can be grep'd across the
 * stack — request-id, tenant-id, HTTP method, path. User-supplied values
 * pass through `redact()` to keep secrets out of the log stream; stack
 * traces are left untouched (they are developer-facing and not sourced
 * from request input).
 */
function correlationFields(c: Context<AppEnv>): Record<string, unknown> {
  const tenant = c.var.tenant ?? null;
  // boundary: structured-log redaction — `redact` walks plain {k:v} shapes;
  // headers / paths are user-controllable so we sanitize them defensively.
  return {
    requestId: c.var.requestId,
    tenantId: tenant?.organizationId,
    path: redact(c.req.path),
    method: c.req.method,
  };
}

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const correlation = correlationFields(c);

  if (err instanceof HTTPException) {
    if (err.status >= 500) {
      logger.error("HTTPException 500", {
        ...correlation,
        message: err.message,
        status: err.status,
      });
    }

    const causeCode = extractCauseCode(err.cause);

    const defaultCodeByStatus: Record<number, string> = {
      400: "BAD_REQUEST",
      401: "UNAUTHORIZED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      409: "CONFLICT",
      429: "RATE_LIMITED",
      500: "INTERNAL_SERVER_ERROR",
      503: "SERVICE_UNAVAILABLE",
    };

    const errorCode =
      err.status >= 500
        ? "INTERNAL_SERVER_ERROR"
        : (causeCode ?? defaultCodeByStatus[err.status] ?? "REQUEST_FAILED");
    const message =
      err.status >= 500 ? "something unexpected happened" : err.message;

    return c.json(errorResponse(errorCode, message), {
      status: err.status,
    });
  }

  if (err instanceof DrizzleQueryError) {
    logger.error("DatabaseError", {
      ...correlation,
      error: err.message,
    });
    if (
      err.cause instanceof pg.DatabaseError &&
      err.cause?.code === PostgresError.UNIQUE_VIOLATION
    ) {
      const message = "A record with this value already exists";
      return c.json(errorResponse("UNIQUE_VIOLATION", message), {
        status: 409,
      });
    }
    return c.json(errorResponse("DATABASE_ERROR", "database error occurred"), {
      status: 500,
    });
  }

  logger.error("unhandled exception", {
    ...correlation,
    name: err?.name,
    message: err?.message,
    // stack traces are developer-facing context — do not redact.
    stack: err?.stack,
  });

  return c.json(
    errorResponse("INTERNAL_SERVER_ERROR", "something unexpected happened"),
    { status: 500 }
  );
};
