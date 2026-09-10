import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: vi.fn() } }));

import { createClientConfig } from "@/api-config";
import { ApiError } from "@/lib/api";
import { handleGlobalError, handleGlobalSuccess } from "@/query/on-error";
import { useAlertStore } from "@/store/alert";

beforeEach(() => {
  toastError.mockClear();
  useAlertStore.getState().clearDownAlert();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("api client error normalization", () => {
  it("wraps non-JSON error responses in an ApiError with status and path", async () => {
    const response = new Response("<html>bad gateway</html>", { status: 502 });
    Object.defineProperty(response, "url", {
      value: "http://localhost:8787/api/users",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const config = createClientConfig({});

    await expect(
      config.fetch?.("http://localhost:8787/api/users", {})
    ).rejects.toMatchObject({
      name: "ApiError",
      path: "/api/users",
      status: 502,
    });
  });
});

describe("handleGlobalError", () => {
  it("notifies on network errors without a status code", async () => {
    await handleGlobalError(new Error("Failed to fetch"));

    expect(toastError).toHaveBeenCalledWith(
      "Network error",
      expect.any(Object)
    );
  });

  it("maps 502 responses to a maintenance alert", async () => {
    await handleGlobalError(
      new ApiError({ error: { message: "bad gateway" } }, 502)
    );

    expect(useAlertStore.getState().downAlert).toBe("maintenance");
  });
});

describe("handleGlobalSuccess", () => {
  it("clears a forbidden banner after a subsequent success", () => {
    useAlertStore.getState().setDownAlert("forbidden");

    handleGlobalSuccess();

    expect(useAlertStore.getState().downAlert).toBeNull();
  });
});
