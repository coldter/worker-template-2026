// biome-ignore-all lint/performance/noAwaitInLoops: policy evaluation is ordered (deny precedence) and short-circuits on first match, so parallelising would change outcomes.
import type {
  ConditionContext,
  DenyReason,
  PolicyDecision,
  PolicyRule,
  Principal,
} from "./types";

export interface EvaluateInput {
  action: string;
  globalPolicies: PolicyRule[];
  /**
   * When true, resource conditions (requires_resource) are treated as
   * automatically passing instead of being skipped. Used by
   * evaluateCapabilities to report conditionally-allowed actions as true.
   */
  ignoreResourceConditions?: boolean;
  principal: Principal | null | undefined;
  // Resource parameter is typed `never` (covariant-safe trick used by
  // AnyResourceDef) so concrete (resource: TResource) => ... signatures
  // assign without a cast at the registry call site.
  resolveOrganization?: (resource: never) => string | null | undefined;
  resolveRelation?: (
    subjectType: string,
    subjectId: string,
    relation: string,
    objectType: string,
    objectId: string
  ) => Promise<boolean>;
  resource?: unknown;
  resourceName: string;
  resourcePolicies: PolicyRule[];
  systemAdminRoles: readonly string[];
}

export async function evaluate(input: EvaluateInput): Promise<PolicyDecision> {
  const {
    principal,
    action,
    globalPolicies,
    resourcePolicies,
    systemAdminRoles,
    resolveOrganization,
    resource,
    resolveRelation,
    ignoreResourceConditions = false,
  } = input;

  if (!principal) {
    return { allowed: false, reason: "UNAUTHENTICATED" };
  }

  let sawEvaluationError = false;

  for (const policy of globalPolicies) {
    if (policy.effect !== "deny") {
      continue;
    }
    const { matched, conditionError } = await matchPolicy(
      policy,
      principal,
      action,
      undefined,
      resolveRelation
    );
    if (conditionError) {
      sawEvaluationError = true;
      continue;
    }
    if (matched) {
      return {
        allowed: false,
        matchedPolicy: policy.label,
        reason: "GLOBAL_DENY",
      };
    }
  }

  let orgDenyReason: DenyReason | undefined;

  for (const policy of resourcePolicies) {
    if (policy.effect !== "deny") {
      continue;
    }

    if (hasResourceConditions(policy) && resource === undefined) {
      continue;
    }

    if (resolveOrganization && resource !== undefined) {
      const orgResult = checkOrgScoping(
        principal,
        resource,
        resolveOrganization,
        policy,
        systemAdminRoles
      );
      if (orgResult !== "pass") {
        orgDenyReason ??= orgResult.skip;
        continue;
      }
    }

    const { matched, conditionError } = await matchPolicy(
      policy,
      principal,
      action,
      resource,
      resolveRelation
    );
    if (conditionError) {
      sawEvaluationError = true;
      continue;
    }
    if (matched) {
      return {
        allowed: false,
        matchedPolicy: policy.label,
        reason: "EXPLICIT_DENY",
      };
    }
  }

  for (const policy of resourcePolicies) {
    if (policy.effect !== "allow") {
      continue;
    }

    if (
      hasResourceConditions(policy) &&
      resource === undefined &&
      !ignoreResourceConditions
    ) {
      continue;
    }

    if (resolveOrganization && resource !== undefined) {
      const orgResult = checkOrgScoping(
        principal,
        resource,
        resolveOrganization,
        policy,
        systemAdminRoles
      );
      if (orgResult !== "pass") {
        orgDenyReason ??= orgResult.skip;
        continue;
      }
    }

    const { matched, conditionError } = await matchPolicy(
      policy,
      principal,
      action,
      resource,
      resolveRelation,
      ignoreResourceConditions
    );
    if (conditionError) {
      sawEvaluationError = true;
      continue;
    }
    if (matched) {
      return { allowed: true, matchedPolicy: policy.label };
    }
  }

  if (sawEvaluationError) {
    return { allowed: false, reason: "EVALUATION_ERROR" };
  }
  if (orgDenyReason) {
    return { allowed: false, reason: orgDenyReason };
  }
  return { allowed: false, reason: "NO_MATCHING_POLICY" };
}

function roleMatches(policy: PolicyRule, principal: Principal): boolean {
  if (policy.roles === "*") {
    return true;
  }
  return policy.roles.some((role) => principal.roles.includes(role));
}

function actionMatches(policy: PolicyRule, action: string): boolean {
  if (policy.actions === "*") {
    return true;
  }
  return policy.actions.includes(action);
}

function hasResourceConditions(policy: PolicyRule): boolean {
  return policy.conditions.some((c) => c.effect === "requires_resource");
}

// Catch is narrowed to condition.evaluate; operational errors from resolveRelation/resolveOrganization propagate.
type MatchResult = { matched: boolean; conditionError?: true };

async function matchPolicy(
  policy: PolicyRule,
  principal: Principal,
  action: string,
  resource: unknown | undefined,
  resolveRelation?: EvaluateInput["resolveRelation"],
  ignoreResourceConditions = false
): Promise<MatchResult> {
  if (!roleMatches(policy, principal)) {
    return { matched: false };
  }

  if (!actionMatches(policy, action)) {
    return { matched: false };
  }

  for (const condition of policy.conditions) {
    if (condition.effect === "requires_resource" && ignoreResourceConditions) {
      continue;
    }

    if (condition.effect === "requires_resource" && resource === undefined) {
      return { matched: false };
    }

    const ctx: ConditionContext = {
      principal,
      resolveRelation,
      resource,
    };
    try {
      const result = await condition.evaluate(ctx);
      if (!result) {
        return { matched: false };
      }
    } catch (error) {
      // console here avoids a @repo/shared <-> @repo/authorization circular dep.
      const errInfo =
        error instanceof Error
          ? { message: error.message, name: error.name, stack: error.stack }
          : { value: String(error) };
      console.error(
        JSON.stringify({
          action,
          error: errInfo,
          level: "error",
          message: "authorization.evaluator.condition_error",
          policyId: policy.label,
          principalId: principal.id,
          ts: Date.now(),
        })
      );
      return { conditionError: true, matched: false };
    }
  }

  return { matched: true };
}

type OrgCheckResult =
  | "pass"
  | {
      skip: "ORG_CONTEXT_MISSING" | "ORG_RESOLUTION_FAILED" | "TENANT_MISMATCH";
    };

function checkOrgScoping(
  principal: Principal,
  resource: unknown,
  resolveOrganization: (resource: never) => string | null | undefined,
  policy: PolicyRule,
  systemAdminRoles: readonly string[]
): OrgCheckResult {
  // Bypass org scoping for system admins. The policy's role list might be
  // ["member","admin"]; we must check if ANY of the principal's roles is a
  // system admin, not just the first one that matches the policy. Using
  // find() to pick a single matched role would let a genuine system admin
  // miss the bypass when a non-admin role happens to come first in the
  // policy's role list.
  if (
    (policy.roles === "*" ||
      policy.roles.some((r) => principal.roles.includes(r))) &&
    principal.roles.some((r) => systemAdminRoles.includes(r))
  ) {
    return "pass";
  }

  // Principal must have an active org
  const org = principal.organization;
  if (!org) {
    return { skip: "ORG_CONTEXT_MISSING" };
  }

  // Resource must resolve to an org. resolveOrganization is typed
  // (resource: never) => ... for covariant assignment from concrete
  // ResourceDef signatures; the actual runtime value is the resource
  // shape the caller defined.
  // boundary: covariant function-pointer variance
  const resourceOrgId = (
    resolveOrganization as (r: unknown) => string | null | undefined
  )(resource);
  if (resourceOrgId === null || resourceOrgId === undefined) {
    return { skip: "ORG_RESOLUTION_FAILED" };
  }

  // Org IDs must match
  if (org.id !== resourceOrgId) {
    return { skip: "TENANT_MISMATCH" };
  }

  return "pass";
}
