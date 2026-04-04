import { useQuery } from "@tanstack/react-query";
import { getAuthorizationCapabilities } from "@/api.gen/sdk.gen";

export const authorizationKeys = {
  all: ["authorization"] as const,
  capabilities: () => [...authorizationKeys.all, "capabilities"] as const,
};

export function useAuthorization() {
  const query = useQuery({
    queryKey: authorizationKeys.capabilities(),
    queryFn: async ({ signal }) => {
      const response = await getAuthorizationCapabilities({ signal });
      return response.capabilities;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    capabilities: query.data ?? {},
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
