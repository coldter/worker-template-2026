import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

import { clearSession } from "@/modules/auth/helpers";
import { useAlertStore } from "@/store/alert";
import { useUserStore } from "@/store/user";

const FALLBACK_MESSAGES: Record<number, string> = {
  400: "Bad request. Please check your input.",
  401: "Your session has expired. Please sign in again.",
  403: "You do not have permission to perform this action.",
  404: "The requested resource was not found.",
  429: "Too many requests. Please slow down.",
  500: "An internal server error occurred.",
  502: "Server is temporarily unavailable.",
  503: "Service is under maintenance.",
  504: "Request timed out. Please try again.",
};

const readStringProp = (error: unknown, key: string): string | undefined => {
  if (typeof error !== "object" || error === null) {
    return;
  }
  if (!(key in error)) {
    return;
  }
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
};

const readNumberProp = (error: unknown, key: string): number | undefined => {
  if (typeof error !== "object" || error === null) {
    return;
  }
  if (!(key in error)) {
    return;
  }
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
};

const getStatusCode = (error: unknown): number => {
  if (ApiError.is(error)) {
    return error.status;
  }
  return readNumberProp(error, "status") ?? 0;
};

const getErrorPath = (error: unknown): string | undefined => {
  if (ApiError.is(error)) {
    return error.path;
  }
  return readStringProp(error, "path");
};

const getErrorMessage = (error: unknown): string => {
  const status = getStatusCode(error);

  if (ApiError.is(error)) {
    if (error.error.message) {
      return error.error.message;
    }
    if (error.message && error.message !== "Error") {
      return error.message;
    }
    return FALLBACK_MESSAGES[status] || "An unexpected error occurred";
  }

  const message = readStringProp(error, "message");
  if (message && message !== "Error") {
    return message;
  }

  return FALLBACK_MESSAGES[status] || "An unexpected error occurred";
};

const isSessionCheckPath = (path?: string): boolean => {
  if (!path) {
    return false;
  }
  const sessionPaths = ["/api/auth/get-session"];
  return sessionPaths.some((p) => path.includes(p));
};

const handleAuthError = async (): Promise<void> => {
  if (!useUserStore.getState().user) {
    return;
  }
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

export const handleGlobalError = async (error: unknown): Promise<void> => {
  console.error("Global query/mutation error:", error);

  const statusCode = getStatusCode(error);
  const errorPath = getErrorPath(error);
  const isCasualSessionCheck = isSessionCheckPath(errorPath);

  switch (statusCode) {
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
        description: getErrorMessage(error),
      });
      return;

    case 401:
      await handleAuthError();
      return;

    case 403:
      useAlertStore.getState().setDownAlert("forbidden");
      toast.error("Access Denied", {
        description: getErrorMessage(error),
      });
      return;

    default:
      if (statusCode >= 400) {
        toast.error("Error", {
          description: getErrorMessage(error),
        });
      }
  }
};

export const handleGlobalSuccess = (): void => {
  const { downAlert, clearDownAlert } = useAlertStore.getState();

  if (
    downAlert &&
    ["maintenance", "offline", "auth_unavailable"].includes(downAlert)
  ) {
    clearDownAlert();
  }
};
