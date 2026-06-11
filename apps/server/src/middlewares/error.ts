import { logger } from "@repo/shared/logger";
import { DrizzleQueryError } from "drizzle-orm";
import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import pg from "pg";
import { PostgresError } from "pg-error-enum";
import type { AppEnv } from "@/lib/context";

// Head sampling can drop the invocation log surrounding an error, so each
// error line carries its own correlation ids: the client-visible X-Request-Id
// and the deploy version the request ran on.
function correlationContext(c: Context<AppEnv>) {
  return {
    requestId: c.get("requestId"),
    version: c.env.CF_VERSION_METADATA?.id,
  };
}

// boundary: typeof-guarded reads of `code` on an unknown error cause.
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

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof HTTPException) {
    if (err.status >= 500) {
      logger.error("HTTPException 500", {
        message: err.message,
        status: err.status,
        path: c.req.path,
        method: c.req.method,
        ...correlationContext(c),
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
      causeCode ??
      defaultCodeByStatus[err.status] ??
      (err.status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED");

    return c.json(errorResponse(errorCode, err.message), {
      status: err.status,
    });
  }

  if (err instanceof DrizzleQueryError) {
    logger.error("DatabaseError", {
      error: err.message,
      ...correlationContext(c),
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
    name: err?.name,
    message: err?.message,
    stack: err?.stack,
    ...correlationContext(c),
  });

  return c.json(
    errorResponse("INTERNAL_SERVER_ERROR", "something unexpected happened"),
    { status: 500 }
  );
};
