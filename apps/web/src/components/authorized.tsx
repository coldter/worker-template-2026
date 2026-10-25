import type { ReactNode } from "react";

import { useCan } from "@/hooks/use-authorization";
import type { Capability } from "@/hooks/use-authorization";
import { Skeleton } from "@/modules/ui/skeleton";

interface AuthorizedProps {
  capability: Capability;
  children: ReactNode;
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
}

export const Authorized = ({
  capability,
  children,
  fallback = null,
  loadingFallback,
}: AuthorizedProps) => {
  const { allowed, isLoading } = useCan(capability);

  if (isLoading) {
    if (loadingFallback !== undefined) {
      return loadingFallback;
    }

    return (
      <Skeleton
        aria-hidden="true"
        className="inline-block h-4 w-16 align-middle"
      />
    );
  }

  if (!allowed) {
    return fallback;
  }

  return children;
};
