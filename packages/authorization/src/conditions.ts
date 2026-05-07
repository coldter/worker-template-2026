import type { Condition, ConditionContext, ConditionEffect } from "./types";

export function principalNotActive(): Condition {
  return {
    type: "principalNotActive",
    effect: "principal_only",
    label: "principalNotActive",
    evaluate(ctx: ConditionContext): boolean {
      return ctx.principal.attributes.status !== "active";
    },
  };
}

export function principalHasRole(role: string): Condition {
  return {
    type: "principalHasRole",
    effect: "principal_only",
    label: `principalHasRole:${role}`,
    evaluate(ctx: ConditionContext): boolean {
      return ctx.principal.roles.includes(role);
    },
  };
}

export function createOwnerCondition<TResource>(
  resolveOwner: (resource: TResource) => string
): Condition<TResource> {
  return {
    type: "whereOwner",
    effect: "requires_resource",
    label: "whereOwner",
    evaluate(ctx: ConditionContext<TResource>): boolean {
      if (!ctx.resource) {
        return false;
      }
      return resolveOwner(ctx.resource) === ctx.principal.id;
    },
  };
}

export function createSelfTargetCondition<
  TResource = unknown,
>(): Condition<TResource> {
  return {
    type: "whereTargetIsSelf",
    effect: "requires_resource",
    label: "whereTargetIsSelf",
    evaluate(ctx: ConditionContext<TResource>): boolean {
      if (!ctx.resource) {
        return false;
      }
      // Resource shape is widened so condition factories don't force
      // upstream casts at every call site. At runtime a resource without
      // an id field naturally fails the equality check (false).
      const candidate = ctx.resource as { id?: unknown };
      return (
        typeof candidate.id === "string" && candidate.id === ctx.principal.id
      );
    },
  };
}

export function createPredicateCondition<TResource = unknown>(
  predicate: (ctx: ConditionContext<TResource>) => boolean | Promise<boolean>,
  label: string,
  effect: ConditionEffect = "requires_resource"
): Condition<TResource> {
  return {
    type: "where",
    effect,
    label: `where:${label}`,
    evaluate: predicate,
  };
}

export function createRelationCondition<TResource>(
  relation: string,
  targetKey: string,
  resolveTarget: (resource: TResource) => string,
  subjectType = "user"
): Condition<TResource> {
  return {
    type: "withRelation",
    effect: "requires_resource",
    label: `withRelation:${relation}:${targetKey}`,
    params: { relation, targetKey, subjectType },
    evaluate(ctx: ConditionContext<TResource>): boolean | Promise<boolean> {
      if (!(ctx.resource && ctx.resolveRelation)) {
        return false;
      }
      const objectId = resolveTarget(ctx.resource);
      return ctx.resolveRelation(
        subjectType,
        ctx.principal.id,
        relation,
        targetKey,
        objectId
      );
    },
  };
}

/**
 * Operator-side condition (D36 / D72). Allows the rule when the principal is
 * a `global_admin` AND, if `subRoles` is non-empty, their `globalAdminRole`
 * attribute is in the allow-list. Used together with the `OPERATOR_PERMISSIONS`
 * matrix to keep the admin-panel authorization matrix declarative.
 *
 * `subRoles=[]` means "any global_admin sub-role allowed" (e.g. `view`/`list`
 * actions). The condition only inspects the principal so it carries
 * `effect: "principal_only"` and is safe to evaluate without a resource.
 */
export function createGlobalAdminRoleCondition<TResource = unknown>(
  subRoles: readonly string[]
): Condition<TResource> {
  const frozenSubRoles = [...subRoles];
  const label =
    frozenSubRoles.length === 0
      ? "globalAdminRole(*)"
      : `globalAdminRole(${frozenSubRoles.join("|")})`;
  return {
    type: "globalAdminRole",
    effect: "principal_only",
    label,
    params: { subRoles: frozenSubRoles },
    evaluate(ctx: ConditionContext<TResource>): boolean {
      if (!ctx.principal.roles.includes("global_admin")) {
        return false;
      }
      // Defense in depth: a deactivated global_admin whose `globalAdminRole`
      // attribute lingered in the principal must NOT pass this condition.
      // The canonical pipeline already denies via `principalNotActive`, but
      // this redundant check keeps the operator gate fail-closed even if a
      // consumer forgets to wire the global deny.
      const status = ctx.principal.attributes.status;
      if (status !== "active") {
        return false;
      }
      const sub = ctx.principal.attributes.globalAdminRole;
      if (typeof sub !== "string" || sub.length === 0) {
        return false;
      }
      if (frozenSubRoles.length === 0) {
        return true;
      }
      return frozenSubRoles.includes(sub);
    },
  };
}

export function createOrgRoleCondition<TResource = unknown>(
  orgRoles: string[]
): Condition<TResource> {
  const frozenRoles = [...orgRoles];
  return {
    type: "withOrgRole",
    effect: "principal_only",
    label: `withOrgRole:${frozenRoles.join(",")}`,
    params: { orgRoles: frozenRoles },
    evaluate(ctx: ConditionContext<TResource>): boolean {
      const org = ctx.principal.organization;
      if (!org) {
        return false;
      }
      return frozenRoles.includes(org.role);
    },
  };
}
