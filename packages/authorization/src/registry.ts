import { AuthorizationError } from "./errors";
import { evaluate, evaluateOptimistic } from "./evaluator";
import type { ActionsOf, ResourceTypeFor } from "./resource";
import type { AnyResourceDef } from "./schema";
import type { PolicyDecision, PolicyRule, Principal } from "./types";
import { validateRegistry } from "./validation";

export interface RegistryOptions {
  globalPolicies: PolicyRule[];
  orgRoleValues: readonly string[];
  schemaRoles: readonly string[];
  systemAdminRoles: readonly string[];
}

export type CapabilityKey<TResources extends Record<string, AnyResourceDef>> = {
  [K in keyof TResources & string]: `${K}:${ActionsOf<TResources[K]> & string}`;
}[keyof TResources & string];

export type CapabilityMap<TResources extends Record<string, AnyResourceDef>> = {
  [K in CapabilityKey<TResources>]: boolean;
};

export interface RegistryInstance<
  TResources extends Record<string, AnyResourceDef>,
> {
  assertCan: <K extends keyof TResources & string>(
    principal: Principal | null | undefined,
    resource: K,
    action: ActionsOf<TResources[K]>,
    opts?: { resource?: ResourceTypeFor<TResources[K]> }
  ) => Promise<void>;

  can: <K extends keyof TResources & string>(
    principal: Principal | null | undefined,
    resource: K,
    action: ActionsOf<TResources[K]>,
    opts?: { resource?: ResourceTypeFor<TResources[K]> }
  ) => Promise<PolicyDecision>;

  evaluateCapabilities: (
    principal: Principal
  ) => Promise<CapabilityMap<TResources>>;

  readonly resources: TResources;
}

export const buildRegistryInstance = <
  TResources extends Record<string, AnyResourceDef>,
>(
  resources: TResources,
  options: RegistryOptions
): RegistryInstance<TResources> => {
  validateRegistry(resources, options);

  const can = <K extends keyof TResources & string>(
    principal: Principal | null | undefined,
    resourceName: K,
    action: ActionsOf<TResources[K]>,
    opts?: { resource?: ResourceTypeFor<TResources[K]> }
  ): Promise<PolicyDecision> => {
    const resourceDef = Object.hasOwn(resources, resourceName)
      ? resources[resourceName]
      : undefined;

    if (!resourceDef?.actions.includes(action)) {
      return Promise.resolve({
        allowed: false,
        reason: "NO_MATCHING_POLICY",
      });
    }

    // SAFETY: AnyResourceDef erases the resource type of resolveOrganization, so it reads as `(resource: never) => …`; a registry only holds definitions built for the resource type it is queried with.
    const resolveOrganization = resourceDef.resolveOrganization as
      | ((
          resource: ResourceTypeFor<TResources[K]>
        ) => string | null | undefined)
      | undefined;

    return evaluate<ResourceTypeFor<TResources[K]>>({
      action,
      globalPolicies: options.globalPolicies,
      principal,
      resolveOrganization,
      resource: opts?.resource,
      resourcePolicies: resourceDef.policies,
      systemAdminRoles: options.systemAdminRoles,
    });
  };

  const assertCan = async <K extends keyof TResources & string>(
    principal: Principal | null | undefined,
    resource: K,
    action: ActionsOf<TResources[K]>,
    opts?: { resource?: ResourceTypeFor<TResources[K]> }
  ): Promise<void> => {
    const decision = await can(principal, resource, action, opts);

    if (!decision.allowed) {
      throw new AuthorizationError(decision.reason, decision.matchedPolicy);
    }
  };

  const evaluateCapabilities = async (
    principal: Principal
  ): Promise<CapabilityMap<TResources>> => {
    const tasks: Promise<readonly [string, boolean]>[] = [];

    for (const [name, resourceDef] of Object.entries(resources)) {
      for (const action of resourceDef.actions) {
        tasks.push(
          evaluateOptimistic({
            action,
            globalPolicies: options.globalPolicies,
            principal,
            resourcePolicies: resourceDef.policies,
            systemAdminRoles: options.systemAdminRoles,
          }).then(
            (decision) => [`${name}:${action}`, decision.allowed] as const
          )
        );
      }
    }

    const settled = await Promise.all(tasks);

    // SAFETY: every task key is built as `${resourceName}:${action}` for a resource/action pair, which is exactly the CapabilityKey<TResources> shape.
    return Object.fromEntries(settled) as CapabilityMap<TResources>;
  };

  return {
    assertCan,
    can,
    evaluateCapabilities,
    resources,
  };
};
