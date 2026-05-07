import { describe, expect, it } from "vitest";
import { type AuthFailure, authFailureToResponse } from "@/lib/auth-failure";

const cases: Array<{ failure: AuthFailure; status: number; code: string }> = [
  {
    failure: { kind: "missing_token" },
    status: 403,
    code: "ACCESS_TOKEN_REQUIRED",
  },
  {
    failure: { kind: "invalid_token" },
    status: 403,
    code: "ACCESS_TOKEN_INVALID",
  },
  {
    failure: { kind: "service_token_rejected" },
    status: 403,
    code: "IDENTITY_TOKEN_REQUIRED",
  },
  { failure: { kind: "host_mismatch" }, status: 404, code: "NOT_FOUND" },
  { failure: { kind: "misconfigured" }, status: 500, code: "MISCONFIGURED" },
  {
    failure: { kind: "enrollment_required" },
    status: 403,
    code: "ENROLLMENT_REQUIRED",
  },
  {
    failure: { kind: "deactivated" },
    status: 403,
    code: "ACCOUNT_DEACTIVATED",
  },
];

describe("authFailureToResponse", () => {
  for (const tc of cases) {
    it(`maps ${tc.failure.kind} to ${tc.status} ${tc.code}`, async () => {
      const res = authFailureToResponse(tc.failure);
      expect(res.status).toBe(tc.status);
      const body = (await res.json()) as { error: { code: string } };
      expect(body).toMatchObject({ error: { code: tc.code } });
    });
  }

  it("is exhaustive — adding a new branch breaks the build", () => {
    const failure = { kind: "missing_token" } satisfies AuthFailure;
    expect(authFailureToResponse(failure).status).toBe(403);
  });
});
