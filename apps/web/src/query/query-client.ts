import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { handleGlobalError, handleGlobalSuccess } from "./on-error";

export const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: false,
    },
    queries: {
      gcTime: 1000 * 60 * 60 * 24,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 1000 * 30,
    },
  },
  mutationCache: new MutationCache({
    onSuccess: handleGlobalSuccess,
  }),
  queryCache: new QueryCache({
    onError: handleGlobalError,
    onSuccess: handleGlobalSuccess,
  }),
});
