/* oxlint-disable no-await-in-loop -- policy evaluation is ordered for deny precedence and short-circuits on the first match, so parallelising would change outcomes */
import type {
  ConditionContext,
  DenyReason,
  PolicyDecision,
  PolicyRule,
  Principal,
} from "./types";

export interface EvaluateInput<TResource = unknown> {
  action: string;
  globalPolicies: PolicyRule<never>[];
  principal: Principal | null | undefined;
  resolveOrganization?: (resource: TResource) => string | null | undefined;
  resource?: TResource;
  resourcePolicies: PolicyRule<never>[];
  systemAdminRoles: readonly string[];
}

const roleMatches = (
  policy: PolicyRule<never>,
  principal: Principal
): boolean => {
  if (policy.roles === "*") {
    return true;
  }

  return policy.roles.some((role) => principal.roles.includes(role));
};

const actionMatches = (policy: PolicyRule<never>, action: string): boolean => {
  if (policy.actions === "*") {
    return true;
  }

  return policy.actions.includes(action);
};

const hasResourceConditions = (policy: PolicyRule<never>): boolean =>
  policy.conditions.some(
    (condition) => condition.effect === "requires_resource"
  );

interface MatchResult {
  matched: boolean;
  conditionError?: true;
}

const matchPolicy = async <TResource>(
  policy: PolicyRule<TResource>,
  principal: Principal,
  action: string,
  resource: TResource | undefined,
  optimistic: boolean
): Promise<MatchResult> => {
  if (!roleMatches(policy, principal)) {
    return { matched: false };
  }

  if (!actionMatches(policy, action)) {
    return { matched: false };
  }

  for (const condition of policy.conditions) {
    if (condition.effect === "requires_resource" && optimistic) {
      continue;
    }

    if (condition.effect === "requires_resource" && resource === undefined) {
      return { matched: false };
    }

    const ctx: ConditionContext<TResource> = {
      principal,
      resource,
    };

    try {
      const result = await condition.evaluate(ctx);

      if (!result) {
        return { matched: false };
      }
    } catch (error) {
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
};

type OrgSkipReason =
  | "ORG_CONTEXT_MISSING"
  | "ORG_RESOLUTION_FAILED"
  | "TENANT_MISMATCH";

type OrgCheckResult = "pass" | { skip: OrgSkipReason };

const checkOrgScoping = <TResource>(
  principal: Principal,
  resource: TResource,
  resolveOrganization: (resource: TResource) => string | null | undefined,
  policy: PolicyRule<never>,
  systemAdminRoles: readonly string[]
): OrgCheckResult => {
  if (
    (policy.roles === "*" ||
      policy.roles.some((role) => principal.roles.includes(role))) &&
    principal.roles.some((role) => systemAdminRoles.includes(role))
  ) {
    return "pass";
  }

  const org = principal.organization;

  if (!org) {
    return { skip: "ORG_CONTEXT_MISSING" };
  }

  const resourceOrgId = resolveOrganization(resource);

  if (resourceOrgId === null || resourceOrgId === undefined) {
    return { skip: "ORG_RESOLUTION_FAILED" };
  }

  if (org.id !== resourceOrgId) {
    return { skip: "TENANT_MISMATCH" };
  }

  return "pass";
};

type PolicyVerdict =
  | { kind: "match" }
  | { kind: "no-match" }
  | { kind: "skip"; reason: OrgSkipReason }
  | { kind: "condition-error" };

const assessResourcePolicy = async <TResource>(
  input: EvaluateInput<TResource>,
  principal: Principal,
  policy: PolicyRule<TResource>,
  optimistic: boolean
): Promise<PolicyVerdict> => {
  const { action, resolveOrganization, resource, systemAdminRoles } = input;

  if (resolveOrganization && resource !== undefined) {
    const orgResult = checkOrgScoping(
      principal,
      resource,
      resolveOrganization,
      policy,
      systemAdminRoles
    );

    if (orgResult !== "pass") {
      return { kind: "skip", reason: orgResult.skip };
    }
  }

  const { matched, conditionError } = await matchPolicy(
    policy,
    principal,
    action,
    resource,
    optimistic
  );

  if (conditionError) {
    return { kind: "condition-error" };
  }

  return matched ? { kind: "match" } : { kind: "no-match" };
};

const evaluateGlobalDenyPolicies = async <TResource>(
  input: EvaluateInput<TResource>,
  principal: Principal
): Promise<PolicyDecision | undefined> => {
  for (const policy of input.globalPolicies) {
    if (policy.effect !== "deny") {
      continue;
    }

    const { matched, conditionError } = await matchPolicy(
      policy,
      principal,
      input.action,
      undefined,
      false
    );

    if (conditionError) {
      return { allowed: false, reason: "EVALUATION_ERROR" };
    }

    if (matched) {
      return {
        allowed: false,
        matchedPolicy: policy.label,
        reason: "GLOBAL_DENY",
      };
    }
  }

  return undefined;
};

interface ResourcePhaseResult {
  decision?: PolicyDecision;
  orgDenyReason?: DenyReason;
}

const evaluateResourcePolicies = async <TResource>(
  input: EvaluateInput<TResource>,
  principal: Principal,
  effect: "allow" | "deny",
  optimistic: boolean,
  orgDenyReason: DenyReason | undefined
): Promise<ResourcePhaseResult> => {
  let pendingOrgReason = orgDenyReason;

  for (const erasedPolicy of input.resourcePolicies) {
    if (erasedPolicy.effect !== effect) {
      continue;
    }

    if (
      hasResourceConditions(erasedPolicy) &&
      input.resource === undefined &&
      !optimistic
    ) {
      continue;
    }

    // SAFETY: resource policies are stored erased (PolicyRule<never>) so a heterogeneous registry stays assignable; each rule was authored for the resource definition that owns it, which is the resource passed in here.
    const policy = erasedPolicy as PolicyRule<TResource>;

    const verdict = await assessResourcePolicy(
      input,
      principal,
      policy,
      optimistic
    );

    if (verdict.kind === "condition-error") {
      return { decision: { allowed: false, reason: "EVALUATION_ERROR" } };
    }

    if (verdict.kind === "skip") {
      pendingOrgReason ??= verdict.reason;
      continue;
    }

    if (verdict.kind === "match") {
      return {
        decision:
          effect === "deny"
            ? {
                allowed: false,
                matchedPolicy: policy.label,
                reason: "EXPLICIT_DENY",
              }
            : { allowed: true, matchedPolicy: policy.label },
        orgDenyReason: pendingOrgReason,
      };
    }
  }

  return { orgDenyReason: pendingOrgReason };
};

const runEvaluation = async <TResource>(
  input: EvaluateInput<TResource>,
  optimistic: boolean
): Promise<PolicyDecision> => {
  const { principal } = input;

  if (!principal) {
    return { allowed: false, reason: "UNAUTHENTICATED" };
  }

  const globalDecision = await evaluateGlobalDenyPolicies(input, principal);

  if (globalDecision) {
    return globalDecision;
  }

  const denied = await evaluateResourcePolicies(
    input,
    principal,
    "deny",
    false,
    undefined
  );

  if (denied.decision) {
    return denied.decision;
  }

  const allowed = await evaluateResourcePolicies(
    input,
    principal,
    "allow",
    optimistic,
    denied.orgDenyReason
  );

  if (allowed.decision) {
    return allowed.decision;
  }

  if (allowed.orgDenyReason) {
    return { allowed: false, reason: allowed.orgDenyReason };
  }

  return { allowed: false, reason: "NO_MATCHING_POLICY" };
};

export const evaluate = <TResource = unknown>(
  input: EvaluateInput<TResource>
): Promise<PolicyDecision> => runEvaluation(input, false);

export const evaluateOptimistic = <TResource = unknown>(
  input: EvaluateInput<TResource>
): Promise<PolicyDecision> => runEvaluation(input, true);
