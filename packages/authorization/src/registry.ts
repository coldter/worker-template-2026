import { AuthorizationError } from "./errors";
import { evaluate } from "./evaluator";
import type { ActionsOf } from "./resource";
import type { AnyResourceDef } from "./schema";
import type { PolicyDecision, PolicyRule, Principal } from "./types";
import { validateRegistry } from "./validation";

export interface RegistryOptions {
  globalPolicies: PolicyRule[];
  orgRoleValues: readonly string[];
  schemaRelations: readonly string[];
  schemaRoles: readonly string[];
  systemAdminRoles: readonly string[];
}

/**
 * Shared by `can` and `assertCan` so a new resolver cannot silently drop
 * on one path. Do not inline this shape on either signature.
 */
export interface RegistryEvaluateOpts {
  resolveRelation?: (
    subjectType: string,
    subjectId: string,
    relation: string,
    objectType: string,
    objectId: string
  ) => Promise<boolean>;
  resource?: unknown;
}

/**
 * Typed capability map keyed by `${ResourceName}:${ActionName}`. Powers
 * autocomplete on `caps["user:list"]` while still degrading to `boolean`
 * for keys outside the registry's vocabulary at the value-level shape.
 */
export type CapabilityKey<TResources extends Record<string, AnyResourceDef>> = {
  [K in keyof TResources & string]: `${K}:${ActionsOf<TResources[K]> & string}`;
}[keyof TResources & string];

export type CapabilityMap<TResources extends Record<string, AnyResourceDef>> = {
  [K in CapabilityKey<TResources>]: boolean;
};

export interface RegistryInstance<
  TResources extends Record<string, AnyResourceDef>,
> {
  assertCan<K extends keyof TResources & string>(
    principal: Principal | null | undefined,
    resource: K,
    action: ActionsOf<TResources[K]>,
    opts?: RegistryEvaluateOpts
  ): Promise<void>;
  can<K extends keyof TResources & string>(
    principal: Principal | null | undefined,
    resource: K,
    action: ActionsOf<TResources[K]>,
    opts?: RegistryEvaluateOpts
  ): Promise<PolicyDecision>;

  /**
   * Build an OPTIMISTIC capability map keyed by `${resource}:${action}` for
   * the given principal. Intended for UI gating only -- nav items, page
   * entry points, broad presentation. Conditional allows (e.g. `whereOwner`,
   * `withRelation`) resolve to `true` without evaluating against a concrete
   * resource, and conditional denies that depend on a resource are skipped;
   * both lean optimistic. NOT an authoritative permission check -- always
   * use server responses for record-level actions and destructive flows.
   */
  evaluateCapabilities(
    principal: Principal
  ): Promise<CapabilityMap<TResources>>;

  getResource<K extends keyof TResources & string>(name: K): TResources[K];

  readonly resources: TResources;
}

export function buildRegistryInstance<
  TResources extends Record<string, AnyResourceDef>,
>(
  resources: TResources,
  options: RegistryOptions
): RegistryInstance<TResources> {
  validateRegistry(
    resources,
    options.schemaRoles,
    options.schemaRelations,
    options.orgRoleValues
  );

  return {
    resources,

    getResource<K extends keyof TResources & string>(name: K): TResources[K] {
      return resources[name];
    },

    async can(principal, resourceName, action, opts) {
      const resourceDef = resources[resourceName];
      if (!resourceDef) {
        return { allowed: false, reason: "NO_MATCHING_POLICY" };
      }

      return evaluate({
        principal,
        action,
        resourceName,
        resource: opts?.resource,
        globalPolicies: options.globalPolicies,
        resourcePolicies: resourceDef.policies,
        systemAdminRoles: options.systemAdminRoles,
        resolveOrganization: resourceDef.resolveOrganization,
        resolveRelation: opts?.resolveRelation,
      });
    },

    async assertCan(principal, resource, action, opts) {
      // Inline the evaluation so resolveRelation and other side-effects
      // run exactly once (delegating to `can()` would double them).
      const resourceDef = resources[resource];
      const decision: PolicyDecision = resourceDef
        ? await evaluate({
            principal,
            action,
            resourceName: resource,
            resource: opts?.resource,
            globalPolicies: options.globalPolicies,
            resourcePolicies: resourceDef.policies,
            systemAdminRoles: options.systemAdminRoles,
            resolveOrganization: resourceDef.resolveOrganization,
            resolveRelation: opts?.resolveRelation,
          })
        : { allowed: false, reason: "NO_MATCHING_POLICY" };
      if (!decision.allowed) {
        throw new AuthorizationError(decision.reason, decision.matchedPolicy);
      }
    },

    async evaluateCapabilities(principal) {
      const capabilities: Record<string, boolean> = {};

      for (const [name, resourceDef] of Object.entries(resources)) {
        for (const action of resourceDef.actions) {
          // ignoreResourceConditions reports conditionally-allowed actions
          // (e.g. whereOwner) as true since there is no concrete resource.
          const decision = await evaluate({
            principal,
            action,
            resourceName: name,
            resource: undefined,
            globalPolicies: options.globalPolicies,
            resourcePolicies: resourceDef.policies,
            systemAdminRoles: options.systemAdminRoles,
            ignoreResourceConditions: true,
          });
          // Surface evaluation errors so the UI gating downgrade is loud in
          // logs/metrics. The capability check stays non-fatal -- the action
          // is reported as `false` (fail-closed) and the caller continues.
          // Authorization is a leaf package (no @repo/shared dep available
          // due to the shared->authorization edge); a minimal structured
          // console.warn keeps the package dependency-free.
          if (!decision.allowed && decision.reason === "EVALUATION_ERROR") {
            console.warn(
              JSON.stringify({
                level: "warn",
                event: "EVALUATION_ERROR",
                message:
                  "evaluateCapabilities: policy evaluation threw; reporting capability as false",
                resource: name,
                action,
                matchedPolicy: decision.matchedPolicy,
              })
            );
          }
          capabilities[`${name}:${action}`] = decision.allowed;
        }
      }

      // boundary: runtime keys are derived from the registry's own action
      // tuples, so the typed CapabilityMap shape is correct by construction.
      return capabilities as unknown as CapabilityMap<TResources>;
    },
  };
}
