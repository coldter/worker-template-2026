import { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected error occurred";
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60,
      staleTime: 1000 * 30,
      refetchOnWindowFocus: false,
      retry: false,
    },
    mutations: {
      retry: false,
      onError: (error) => {
        toast.error("Action failed", { description: describeError(error) });
      },
    },
  },
});
