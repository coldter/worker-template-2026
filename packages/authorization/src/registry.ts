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
    opts?: { resource?: unknown }
  ): Promise<void>;
  can<K extends keyof TResources & string>(
    principal: Principal | null | undefined,
    resource: K,
    action: ActionsOf<TResources[K]>,
    opts?: {
      resolveRelation?: (
        subjectType: string,
        subjectId: string,
        relation: string,
        objectType: string,
        objectId: string
      ) => Promise<boolean>;
      resource?: unknown;
    }
  ): Promise<PolicyDecision>;

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
    async assertCan(principal, resource, action, opts) {
      const decision = await this.can(principal, resource, action, opts);
      if (!decision.allowed) {
        throw new AuthorizationError(decision.reason, decision.matchedPolicy);
      }
    },

    async can(principal, resourceName, action, opts) {
      const resourceDef = resources[resourceName];
      if (!resourceDef) {
        return { allowed: false, reason: "NO_MATCHING_POLICY" };
      }

      return evaluate({
        action,
        globalPolicies: options.globalPolicies,
        principal,
        resolveOrganization: resourceDef.resolveOrganization,
        resolveRelation: opts?.resolveRelation,
        resource: opts?.resource,
        resourceName,
        resourcePolicies: resourceDef.policies,
        systemAdminRoles: options.systemAdminRoles,
      });
    },

    async evaluateCapabilities(principal) {
      const tasks: Promise<readonly [string, boolean]>[] = [];
      for (const [name, resourceDef] of Object.entries(resources)) {
        for (const action of resourceDef.actions) {
          tasks.push(
            evaluate({
              action,
              globalPolicies: options.globalPolicies,
              ignoreResourceConditions: true,
              principal,
              resource: undefined,
              resourceName: name,
              resourcePolicies: resourceDef.policies,
              systemAdminRoles: options.systemAdminRoles,
            }).then(
              (decision) => [`${name}:${action}`, decision.allowed] as const
            )
          );
        }
      }

      const settled = await Promise.all(tasks);
      const capabilities: Record<string, boolean> = {};
      for (const [key, allowed] of settled) {
        capabilities[key] = allowed;
      }

      return capabilities as unknown as CapabilityMap<TResources>;
    },

    getResource<K extends keyof TResources & string>(name: K): TResources[K] {
      return resources[name];
    },
    resources,
  };
}
