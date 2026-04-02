import { useQuery } from "@tanstack/react-query";
import { getAuthorizationCapabilities } from "@/api.gen/sdk.gen";

export function useAuthorization() {
  const query = useQuery({
    queryKey: ["authorization", "capabilities"],
    queryFn: async () => {
      const response = await getAuthorizationCapabilities();
      return response.capabilities;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });

  return {
    capabilities: query.data ?? {},
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
