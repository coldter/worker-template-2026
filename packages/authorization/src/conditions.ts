import type { Condition, ConditionContext, ConditionEffect } from "./types";

export const principalNotActive = (): Condition => ({
  effect: "principal_only",
  evaluate(ctx: ConditionContext): boolean {
    return ctx.principal.attributes.status !== "active";
  },
  label: "principalNotActive",
  type: "principalNotActive",
});

export const createOwnerCondition = <TResource>(
  resolveOwner: (resource: TResource) => string
): Condition<TResource> => ({
  effect: "requires_resource",
  evaluate(ctx: ConditionContext<TResource>): boolean {
    if (!ctx.resource) {
      return false;
    }

    return resolveOwner(ctx.resource) === ctx.principal.id;
  },
  label: "whereOwner",
  type: "whereOwner",
});

export const createSelfTargetCondition = <
  TResource = unknown,
>(): Condition<TResource> => ({
  effect: "requires_resource",
  evaluate(ctx: ConditionContext<TResource>): boolean {
    if (!ctx.resource) {
      return false;
    }

    // SAFETY: resources evaluated by whereTargetIsSelf expose an `id` at runtime; the coercion identity rejects non-string ids without changing equality semantics.
    const candidate = ctx.resource as { id?: unknown };
    const candidateId = candidate.id;

    return (
      candidateId === String(candidateId) && candidateId === ctx.principal.id
    );
  },
  label: "whereTargetIsSelf",
  type: "whereTargetIsSelf",
});

export const createPredicateCondition = <TResource = unknown>(
  predicate: (ctx: ConditionContext<TResource>) => boolean | Promise<boolean>,
  label: string,
  effect: ConditionEffect = "requires_resource"
): Condition<TResource> => ({
  effect,
  evaluate: predicate,
  label: `where:${label}`,
  type: "where",
});

export const createOrgRoleCondition = <TResource = unknown>(
  orgRoles: string[]
): Condition<TResource> => {
  if (orgRoles.length === 0) {
    throw new Error("withOrgRole() requires at least one org role.");
  }

  const frozenRoles = [...orgRoles];

  return {
    effect: "principal_only",
    evaluate(ctx: ConditionContext<TResource>): boolean {
      const org = ctx.principal.organization;

      if (!org) {
        return false;
      }

      return frozenRoles.includes(org.role);
    },
    label: `withOrgRole:${frozenRoles.join(",")}`,
    params: { orgRoles: frozenRoles },
    type: "withOrgRole",
  };
};
