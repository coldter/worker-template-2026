import { OPERATOR_PERMISSIONS, type OperatorAction } from "@repo/authorization";
import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { ApiError } from "@/lib/api";
import { FullPageLoadingState } from "@/modules/common/full-page-loading-state";
import { SessionExpired } from "@/modules/common/session-expired";
import { operatorQueryOptions } from "./query";
import type { Operator } from "./types";

interface OperatorContextValue {
  /**
   * Returns true if the operator's role permits the given action under the
   * matrix in `@repo/authorization`. Server-side `requireOperator(action)`
   * remains the source of truth — these checks are presentation hints only.
   */
  can: (action: OperatorAction) => boolean;
  operator: Operator;
}

const OperatorContext = createContext<OperatorContextValue | null>(null);

interface OperatorProviderProps {
  children: ReactNode;
}

export function OperatorProvider({ children }: OperatorProviderProps) {
  const query = useQuery(operatorQueryOptions);

  const value = useMemo<OperatorContextValue | null>(() => {
    if (!query.data) {
      return null;
    }
    const operator = query.data;
    return {
      operator,
      can: (action) => {
        if (operator.status !== "active") {
          return false;
        }
        const allowed: readonly string[] = OPERATOR_PERMISSIONS[action];
        return allowed.includes(operator.role);
      },
    };
  }, [query.data]);

  if (query.isLoading) {
    return <FullPageLoadingState title="Loading operator" />;
  }

  if (query.error || !value) {
    const status =
      query.error instanceof ApiError ? query.error.status : undefined;
    return <SessionExpired status={status} />;
  }

  return <OperatorContext value={value}>{children}</OperatorContext>;
}

export function useOperator(): OperatorContextValue {
  const ctx = useContext(OperatorContext);
  if (!ctx) {
    throw new Error("useOperator must be used inside <OperatorProvider>");
  }
  return ctx;
}
