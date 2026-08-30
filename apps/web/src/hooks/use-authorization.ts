import type { authorization } from "@repo/shared/authorization";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { getAuthorizationCapabilities } from "@/api.gen/sdk.gen";

export type Capability = keyof Awaited<
  ReturnType<typeof authorization.evaluateCapabilities>
> &
  string;

export const authorizationKeys = {
  all: ["authorization"] as const,
  capabilities: () => [...authorizationKeys.all, "capabilities"] as const,
};

export const authorizationCapabilitiesQueryOptions = () =>
  queryOptions({
    queryFn: async ({ signal }) => {
      const response = await getAuthorizationCapabilities({ signal });
      return response.capabilities;
    },
    queryKey: authorizationKeys.capabilities(),
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

export function useAuthorization() {
  const query = useQuery(authorizationCapabilitiesQueryOptions());

  return {
    capabilities: query.data ?? {},
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

// fail-closed during loading
export function useCan(capability: Capability): {
  allowed: boolean;
  isLoading: boolean;
} {
  const { capabilities, isLoading } = useAuthorization();
  if (isLoading) {
    return { allowed: false, isLoading: true };
  }
  return { allowed: capabilities[capability] === true, isLoading: false };
}

// null/undefined capability treated as public; fail-closed during loading
export function useCapabilityChecker(): {
  check: (capability: Capability | null | undefined) => boolean;
  isLoading: boolean;
} {
  const { capabilities, isLoading } = useAuthorization();
  const check = (capability: Capability | null | undefined): boolean => {
    if (capability === null || capability === undefined) {
      return true;
    }
    if (isLoading) {
      return false;
    }
    return capabilities[capability] === true;
  };
  return { check, isLoading };
}
