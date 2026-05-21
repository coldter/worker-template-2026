import type { QueryClient } from "@tanstack/react-query";

type TenantMutationAction = "create" | "suspend" | "restore" | "delete";

interface TenantInvalidationContext {
  // Known mismatch: `tenantDetailQueryOptions` is keyed by slug, but
  // suspend/restore hooks pass `organizationId`. Preserved from prior behaviour.
  organizationId?: string;
}

export function invalidateForTenantAction(
  qc: QueryClient,
  action: TenantMutationAction,
  context: TenantInvalidationContext = {}
) {
  switch (action) {
    case "create":
      qc.invalidateQueries({ queryKey: ["tenants", "list"] });
      return;
    case "suspend":
      qc.invalidateQueries({ queryKey: ["tenants", "list"] });
      if (context.organizationId) {
        qc.invalidateQueries({
          queryKey: ["tenants", "detail", context.organizationId],
        });
      }
      return;
    case "restore":
      qc.invalidateQueries({ queryKey: ["tenants", "list"] });
      if (context.organizationId) {
        qc.invalidateQueries({
          queryKey: ["tenants", "detail", context.organizationId],
        });
      }
      return;
    case "delete":
      qc.invalidateQueries({ queryKey: ["tenants"] });
      return;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
