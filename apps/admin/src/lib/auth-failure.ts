export type AuthFailure =
  | { kind: "missing_token" }
  | { kind: "invalid_token" }
  | { kind: "service_token_rejected" }
  | { kind: "host_mismatch" }
  | { kind: "misconfigured" }
  | { kind: "enrollment_required" }
  | { kind: "deactivated" };

export function authFailureToResponse(failure: AuthFailure): Response {
  switch (failure.kind) {
    case "missing_token":
      return Response.json(
        {
          error: {
            code: "ACCESS_TOKEN_REQUIRED",
            message: "Access token required",
          },
        },
        { status: 403 }
      );
    case "invalid_token":
      return Response.json(
        {
          error: {
            code: "ACCESS_TOKEN_INVALID",
            message: "Invalid Access token",
          },
        },
        { status: 403 }
      );
    case "service_token_rejected":
      return Response.json(
        {
          error: {
            code: "IDENTITY_TOKEN_REQUIRED",
            message: "Identity token required",
          },
        },
        { status: 403 }
      );
    case "host_mismatch":
      return Response.json(
        { error: { code: "NOT_FOUND", message: "Route not found" } },
        { status: 404 }
      );
    case "misconfigured":
      return Response.json(
        { error: { code: "MISCONFIGURED", message: "Misconfigured" } },
        { status: 500 }
      );
    case "enrollment_required":
      return Response.json(
        {
          error: {
            code: "ENROLLMENT_REQUIRED",
            message: "Operator enrollment required",
          },
        },
        { status: 403 }
      );
    case "deactivated":
      return Response.json(
        {
          error: {
            code: "ACCOUNT_DEACTIVATED",
            message: "Account deactivated",
          },
        },
        { status: 403 }
      );
    default: {
      const _exhaustive: never = failure;
      throw new Error(`Unhandled AuthFailure: ${String(_exhaustive)}`);
    }
  }
}
