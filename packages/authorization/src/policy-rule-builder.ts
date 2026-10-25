import {
  createOrgRoleCondition,
  createOwnerCondition,
  createPredicateCondition,
  createSelfTargetCondition,
} from "./conditions";
import type {
  Condition,
  ConditionContext,
  ConditionEffect,
  PolicyRule,
} from "./types";

export class PolicyRuleBuilder<
  TResource,
  TRole extends string,
  TOrgRole extends string = string,
  TAction extends string = string,
> implements PolicyRule<TResource, TRole> {
  readonly effect: "allow" | "deny";
  readonly roles: TRole[] | "*";
  actions: TAction[] | "*" = [];
  readonly conditions: Condition<TResource>[] = [];
  private readonly _resolveOwner?: (resource: TResource) => string;
  private readonly _validOrgRoles?: readonly string[];

  constructor(
    effect: "allow" | "deny",
    roles: TRole[] | "*",
    opts: {
      resolveOwner?: (resource: TResource) => string;
      validOrgRoles?: readonly string[];
    }
  ) {
    this.effect = effect;
    this.roles = roles;
    this._resolveOwner = opts.resolveOwner;
    this._validOrgRoles = opts.validOrgRoles;
  }

  get label(): string {
    const roleLabel = this.roles === "*" ? "*" : this.roles.join(",");
    const actionLabel = this.actions === "*" ? "*" : this.actions.join(",");
    const condLabels = this.conditions.map((c) => c.label).join("+");

    return `${this.effect}:${roleLabel}:${actionLabel}${condLabels ? `:${condLabels}` : ""}`;
  }

  to(action: TAction, ...actions: TAction[]): this;
  to(action: "*"): this;
  to(...actions: (TAction | "*")[]): this {
    if (actions.length === 0) {
      throw new Error(
        "to() requires at least one action. Use to('*') to match every action."
      );
    }

    if (actions.includes("*") && actions.length > 1) {
      throw new Error(
        "to('*', ...) cannot mix the wildcard with explicit actions. " +
          "Either pass a single '*' or list explicit actions."
      );
    }

    this.actions =
      actions.length === 1 && actions[0] === "*"
        ? "*"
        : actions.filter((action): action is TAction => action !== "*");

    return this;
  }

  whereOwner(): this {
    if (!this._resolveOwner) {
      throw new Error(
        "whereOwner() requires resolveOwner to be defined on the resource"
      );
    }

    this.conditions.push(createOwnerCondition(this._resolveOwner));

    return this;
  }

  whereTargetIsSelf(): this {
    this.conditions.push(createSelfTargetCondition<TResource>());

    return this;
  }

  where(
    predicate: (ctx: ConditionContext<TResource>) => boolean | Promise<boolean>,
    opts?: { effect?: ConditionEffect }
  ): this {
    this.conditions.push(
      createPredicateCondition(predicate, "custom", opts?.effect)
    );

    return this;
  }

  whereCondition(condition: Condition<TResource>): this {
    this.conditions.push(condition);

    return this;
  }

  withOrgRole(...orgRoles: TOrgRole[]): this {
    for (const role of orgRoles) {
      if (this._validOrgRoles && !this._validOrgRoles.includes(role)) {
        throw new Error(
          `withOrgRole() references org role "${role}" not in schema. Available: ${this._validOrgRoles.join(", ")}`
        );
      }
    }

    this.conditions.push(createOrgRoleCondition<TResource>(orgRoles));

    return this;
  }
}

export interface PolicyActionStage<
  TResource,
  TRole extends string,
  TOrgRole extends string,
  TAction extends string,
> {
  to: {
    (
      action: TAction,
      ...actions: TAction[]
    ): PolicyRuleBuilder<TResource, TRole, TOrgRole, TAction>;
    (action: "*"): PolicyRuleBuilder<TResource, TRole, TOrgRole, TAction>;
  };
}
