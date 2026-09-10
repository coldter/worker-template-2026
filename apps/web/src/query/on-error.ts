import { toast } from "sonner";
import * as z from "zod/mini";
import { ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

import { clearSession } from "@/modules/auth/helpers";
import { useAlertStore } from "@/store/alert";
import { useUserStore } from "@/store/user";

const FALLBACK_MESSAGES = new Map<number, string>([
  [400, "Bad request. Please check your input."],
  [401, "Your session has expired. Please sign in again."],
  [403, "You do not have permission to perform this action."],
  [404, "The requested resource was not found."],
  [429, "Too many requests. Please slow down."],
  [500, "An internal server error occurred."],
  [502, "Server is temporarily unavailable."],
  [503, "Service is under maintenance."],
  [504, "Request timed out. Please try again."],
]);

const thrownErrorSchema = z.catch(
  z.object({
    message: z.catch(z.optional(z.string()), undefined),
    path: z.catch(z.optional(z.string()), undefined),
    status: z.catch(z.optional(z.number()), undefined),
  }),
  {}
);

type ErrorDetails = z.infer<typeof thrownErrorSchema>;

const parseErrorDetails = (error: Error): ErrorDetails =>
  thrownErrorSchema.parse(error);

const fallbackMessage = (status: number): string =>
  FALLBACK_MESSAGES.get(status) ?? "An unexpected error occurred";

const getStatusCode = (error: Error, details: ErrorDetails): number =>
  ApiError.is(error) ? error.status : (details.status ?? 0);

const getErrorPath = (
  error: Error,
  details: ErrorDetails
): string | undefined => (ApiError.is(error) ? error.path : details.path);

const getErrorMessage = (error: Error, details: ErrorDetails): string => {
  if (ApiError.is(error)) {
    if (error.error.message) {
      return error.error.message;
    }
    if (error.message && error.message !== "Error") {
      return error.message;
    }
    return fallbackMessage(error.status);
  }

  if (details.message && details.message !== "Error") {
    return details.message;
  }

  return fallbackMessage(details.status ?? 0);
};

const isSessionCheckPath = (path?: string): boolean => {
  if (!path) {
    return false;
  }
  const sessionPaths = ["/api/auth/get-session"];
  return sessionPaths.some((p) => path.includes(p));
};

const performAuthError = async (): Promise<void> => {
  useAlertStore.getState().setDownAlert("auth_expired");

  try {
    await authClient.signOut();
  } catch {}

  clearSession();

  toast.error("Session expired", {
    description: "Please sign in again to continue.",
  });

  if (!window.location.pathname.startsWith("/login")) {
    const currentPath = window.location.pathname + window.location.search;
    const redirectUrl =
      currentPath && currentPath !== "/"
        ? `/login?redirect=${encodeURIComponent(currentPath)}`
        : "/login";

    window.location.href = redirectUrl;
  }
};

let authErrorInFlight: Promise<void> | null = null;

const handleAuthError = (): Promise<void> => {
  if (!useUserStore.getState().user) {
    return Promise.resolve();
  }
  authErrorInFlight ??= performAuthError();
  return authErrorInFlight;
};

export const handleGlobalError = async (error: Error): Promise<void> => {
  console.error("Global query/mutation error:", error);

  const details = parseErrorDetails(error);
  const statusCode = getStatusCode(error, details);
  const errorPath = getErrorPath(error, details);
  const isCasualSessionCheck = isSessionCheckPath(errorPath);

  switch (statusCode) {
    case 0:
      toast.error("Network error", {
        description:
          "Unable to reach the server. Check your connection and try again.",
      });
      return;

    case 502:
    case 503:
      useAlertStore.getState().setDownAlert("maintenance");
      toast.error("Maintenance", {
        description: "The service is temporarily unavailable.",
      });
      return;

    case 504:
      useAlertStore.getState().setDownAlert("offline");
      return;

    case 500:
      if (isCasualSessionCheck) {
        useAlertStore.getState().setDownAlert("auth_unavailable");
        return;
      }
      toast.error("Server Error", {
        description: getErrorMessage(error, details),
      });
      return;

    case 401:
      await handleAuthError();
      return;

    case 403:
      useAlertStore.getState().setDownAlert("forbidden");
      toast.error("Access Denied", {
        description: getErrorMessage(error, details),
      });
      return;

    default:
      if (statusCode >= 400) {
        toast.error("Error", {
          description: getErrorMessage(error, details),
        });
      }
  }
};

export const handleGlobalSuccess = (): void => {
  const { downAlert, clearDownAlert } = useAlertStore.getState();

  if (
    downAlert &&
    ["maintenance", "offline", "auth_unavailable", "forbidden"].includes(
      downAlert
    )
  ) {
    clearDownAlert();
  }
};
