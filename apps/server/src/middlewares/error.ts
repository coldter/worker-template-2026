import { logger } from "@repo/shared/logger";
import { DrizzleQueryError } from "drizzle-orm";
import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { PostgresError } from "pg-error-enum";
import { z } from "zod";
import type { AppEnv } from "@/lib/context";

const causeWithCodeSchema = z.object({ code: z.string() });

const postgresErrorSchema = z.object({
  code: z.string(),
  detail: z.string().optional().catch(undefined),
});

interface ErrorBody {
  error: { code: string; message: string; details?: string };
}

function correlationContext(c: Context<AppEnv>) {
  return {
    requestId: c.get("requestId"),
    version: c.env.CF_VERSION_METADATA?.id,
  };
}

function extractCauseCode(cause: unknown): string | null {
  const parsed = causeWithCodeSchema.safeParse(cause);
  return parsed.success ? parsed.data.code : null;
}

function errorResponse(
  code: string,
  message: string,
  details?: string
): ErrorBody {
  const error: ErrorBody["error"] = { code, message };
  if (details) {
    error.details = details;
  }
  return { error };
}

function defaultErrorCode(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    case 500:
      return "INTERNAL_SERVER_ERROR";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED";
  }
}

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const isProduction = String(c.env.NODE_ENV) === "production";

  if (err instanceof HTTPException) {
    if (err.status >= 500) {
      logger.error("HTTPException 500", {
        message: err.message,
        method: c.req.method,
        path: c.req.path,
        status: err.status,
        ...correlationContext(c),
      });
    }

    const errorCode =
      extractCauseCode(err.cause) ?? defaultErrorCode(err.status);

    return c.json(
      errorResponse(
        errorCode,
        isProduction && err.status === 500
          ? "internal server error"
          : err.message
      ),
      {
        status: err.status,
      }
    );
  }

  if (err instanceof DrizzleQueryError) {
    logger.error("DatabaseError", {
      error: err.message,
      ...correlationContext(c),
    });
    const { cause } = err;
    const parsed = postgresErrorSchema.safeParse(cause);
    if (
      cause instanceof Error &&
      parsed.success &&
      parsed.data.code === PostgresError.UNIQUE_VIOLATION
    ) {
      const message = isProduction
        ? "Duplicate value exists"
        : parsed.data.detail || "Duplicate value exists";
      return c.json(errorResponse("UNIQUE_VIOLATION", message), {
        status: 409,
      });
    }
    return c.json(errorResponse("DATABASE_ERROR", "database error occurred"), {
      status: 500,
    });
  }

  if (err?.name === "UserNotFoundError") {
    return c.json(errorResponse("NOT_FOUND", "User not found"), {
      status: 404,
    });
  }

  logger.error("unhandled exception", {
    message: err?.message,
    name: err?.name,
    stack: err?.stack,
    ...correlationContext(c),
  });

  return c.json(
    errorResponse(
      "INTERNAL_SERVER_ERROR",
      isProduction
        ? "internal server error"
        : (err.message ?? "something unexpected happened")
    ),
    { status: 500 }
  );
};
