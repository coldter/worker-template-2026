import { PolicyRuleBuilder } from "./policy-rule-builder";
import type { PolicyActionStage } from "./policy-rule-builder";
import type { PolicyRule } from "./types";

export { PolicyRuleBuilder } from "./policy-rule-builder";

export type { PolicyActionStage } from "./policy-rule-builder";

export interface ResourceConfig<
  TResource,
  TRole extends string,
  TOrgRole extends string,
  TActions extends readonly string[] = readonly string[],
> {
  actions: TActions;
  policies: (
    builder: PolicyBuilder<TResource, TRole, TOrgRole, TActions[number]>
  ) => PolicyRule<TResource, TRole>[];
  resolveOrganization?: (resource: TResource) => string | null | undefined;
  resolveOwner?: (resource: TResource) => string;
}

export interface ResourceDef<
  TResource,
  TRole extends string,
  TAction extends string = string,
> {
  readonly actions: readonly TAction[];
  readonly name: string;
  readonly policies: PolicyRule<TResource, TRole>[];
  readonly resolveOrganization?: (
    resource: TResource
  ) => string | null | undefined;
}

export class PolicyBuilder<
  TResource,
  TRole extends string,
  TOrgRole extends string,
  TAction extends string,
> {
  private readonly opts: {
    resolveOwner?: (resource: TResource) => string;
    validOrgRoles?: readonly string[];
  };

  constructor(opts: {
    resolveOwner?: (resource: TResource) => string;
    validOrgRoles?: readonly string[];
  }) {
    this.opts = opts;
  }

  allow(
    role: TRole | "*"
  ): PolicyActionStage<TResource, TRole, TOrgRole, TAction> {
    const roles = role === "*" ? ("*" as const) : [role];

    return new PolicyRuleBuilder<TResource, TRole, TOrgRole, TAction>(
      "allow",
      roles,
      this.opts
    );
  }

  deny(
    role: TRole | "*"
  ): PolicyActionStage<TResource, TRole, TOrgRole, TAction> {
    const roles = role === "*" ? ("*" as const) : [role];

    return new PolicyRuleBuilder<TResource, TRole, TOrgRole, TAction>(
      "deny",
      roles,
      this.opts
    );
  }
}

export const createResourceDefinition = <
  TResource,
  TRole extends string,
  TOrgRole extends string,
  const TActions extends readonly string[] = readonly string[],
>(
  name: string,
  config: ResourceConfig<TResource, TRole, TOrgRole, TActions>,
  schemaOpts?: { validOrgRoles?: readonly string[] }
): ResourceDef<TResource, TRole, TActions[number]> => {
  const builder = new PolicyBuilder<
    TResource,
    TRole,
    TOrgRole,
    TActions[number]
  >({
    resolveOwner: config.resolveOwner,
    validOrgRoles: schemaOpts?.validOrgRoles,
  });

  const policies = config.policies(builder);

  return {
    actions: config.actions,
    name,
    policies,
    resolveOrganization: config.resolveOrganization,
  };
};

export type ActionsOf<TR> =
  TR extends ResourceDef<infer _R, infer _Role, infer A> ? A : string;

export type ResourceTypeFor<TR> =
  TR extends ResourceDef<infer R, infer _Role, infer _A> ? R : unknown;
