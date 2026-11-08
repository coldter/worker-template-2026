# @repo/authorization

Deny-by-default authorization engine for TypeScript. It combines roles (RBAC), principal attributes (ABAC), ownership, organization roles, and tenant scoping. Policies live in code.

## Quick example

```ts
import {
  createAuthSchema,
  principalNotActive,
  type Principal,
} from "@repo/authorization";

export const auth = createAuthSchema({
  roles: ["admin", "user"],
  systemAdminRoles: ["admin"],
  globalPolicies: (p) => [
    p.deny("*").to("*").whereCondition(principalNotActive()),
  ],
});

export type AppPrincipal = Principal<
  "admin" | "user",
  { status: "active" | "inactive" | "deleted" | "locked" }
>;

type UserRecord = { id: string };

export const users = auth.createResource<UserRecord>()("user", {
  actions: ["list", "view", "create", "update", "delete"],
  policies: (p) => [
    p.allow("admin").to("*"),
    p.allow("user").to("view", "update").whereOwner(),
    p.deny("*").to("delete").whereTargetIsSelf(),
  ],
  resolveOwner: (resource) => resource.id,
});

export const authorization = auth.buildRegistry({ user: users });
```

## Core API

- createAuthSchema({ roles, systemAdminRoles, organizationRoles?, globalPolicies }) creates the schema. Global policies are deny-only.
- schema.createResource<T>()(name, config) defines a resource; actions are inferred as a literal union.
- schema.buildRegistry(resources) validates the registry and returns it.
- principalNotActive() is a prebuilt condition for inactive principals.
- AuthorizationError is thrown by assertCan and carries reason and matchedPolicy.

The registry exposes can, assertCan, evaluateCapabilities, and resources.

## Hono adapter

```ts
import {
  createAuthorize,
  getAuthorizedResource,
} from "@repo/authorization/hono";

const authorize = createAuthorize<
  typeof authorization.resources,
  { Variables: { principal: AppPrincipal | null } }
>(authorization, { resolvePrincipal: (c) => c.get("principal") ?? null });

app.get("/users", authorize("user", "list"), listUsers);
app.get(
  "/users/:userId",
  authorize("user", "view", {
    loadResource: (c) => findUserById(c.req.param("userId") ?? ""),
  }),
  (c) => c.json(getAuthorizedResource<UserRecord>(c))
);
```

- authorize(resource, action, { loadResource? }) narrows resource/action to the registry vocabulary.
- getAuthorizedResource(c) returns the loaded record.
- isAuthorizationGuard(middleware) detects authorize middleware for route-coverage tests.
- Denials map to 401 (no principal), 404 (missing resource), 403 (policy), and 500 (evaluation error).

## Evaluation

1. No principal: deny (UNAUTHENTICATED).
2. Global deny: deny (GLOBAL_DENY).
3. Resource deny: deny (EXPLICIT_DENY).
4. Resource allow: allow.
5. No match: deny (NO_MATCHING_POLICY).

Resource-dependent conditions run only when a resource is supplied. whereOwner, whereTargetIsSelf, and where with the default effect are resource-dependent; where(predicate, { effect: "principal_only" }) is not.

If a resource defines resolveOrganization, tenant checks run before resource policies: missing principal organization gives ORG_CONTEXT_MISSING, an unresolved resource organization gives ORG_RESOLUTION_FAILED, and a different organization gives TENANT_MISMATCH. System admins bypass tenancy for matching roles, but explicit denies still apply. Thrown conditions are logged and denied with EVALUATION_ERROR.

## Conditions

| Builder | Checks |
| --- | --- |
| whereOwner() | resolveOwner(resource) equals principal.id |
| whereTargetIsSelf() | resource.id equals principal.id |
| where(predicate, opts?) | custom predicate; defaults to requires_resource |
| withOrgRole(...) | principal.organization.role is in the listed org roles |
| whereCondition(condition) | attaches a prebuilt condition |

to(...) is required before conditions. allow() and deny() expose only to(...).

## Capabilities

evaluateCapabilities(principal) returns a typed map keyed by resource:action. It is optimistic: resource-dependent conditions are treated as satisfied and resource-dependent denies are skipped; principal-only conditions run normally. Use it for navigation and broad action visibility, never for access enforcement.

## Validation

buildRegistry throws when systemAdminRoles is not a subset of roles, a policy references an unknown role, action, or org role, a policy has no roles or actions, a global policy is not a deny or uses a resource-dependent condition, a registry key does not match the resource name, or a resource uses withOrgRole without resolveOrganization. The builder also rejects empty actions, mixing "*" with explicit actions, whereOwner without resolveOwner, and withOrgRole without roles.

## In this repo

buildAuthorizationPrincipal lives in packages/shared/src/principal-builder.ts; the app registry is in packages/shared/src/authorization-schema.ts. No app resource uses org scoping yet.
