// Core authorization engine -- framework-agnostic, zero dependencies

export {
  createGlobalAdminRoleCondition,
  createOrgRoleCondition,
  createOwnerCondition,
  createPredicateCondition,
  createRelationCondition,
  createSelfTargetCondition,
  principalHasRole,
  principalNotActive,
} from "./conditions";
export { AuthorizationError } from "./errors";
export type { EvaluateInput } from "./evaluator";
export { evaluate } from "./evaluator";
export type {
  OperatorAuditLogger,
  RequireOperatorOptions,
} from "./hono-operator";
export { requireOperator } from "./hono-operator";
export type {
  GlobalAdmin as OperatorGlobalAdmin,
  GlobalAdminRole,
  OperatorAction,
  OperatorMatrix,
  OperatorMatrixDriftReport,
  OperatorMatrixRegistryLike,
} from "./operator";
export {
  assertOperatorMatrixMatchesPolicies,
  canOperator,
  OPERATOR_PERMISSIONS,
} from "./operator";
export type {
  CapabilityKey,
  CapabilityMap,
  RegistryInstance,
  RegistryOptions,
} from "./registry";
export { buildRegistryInstance } from "./registry";
export type {
  ActionsOf,
  PolicyActionStage,
  ResourceTypeFor,
} from "./resource";
export {
  createResourceDefinition,
  PolicyBuilder,
  PolicyRuleBuilder,
} from "./resource";
export type { AnyResourceDef, AuthSchema } from "./schema";
export { createAuthSchema, principalAttribute } from "./schema";
export type {
  Condition,
  ConditionContext,
  ConditionEffect,
  DenyReason,
  PolicyDecision,
  PolicyRule,
  Principal,
  ResourceDefinition,
} from "./types";
export { validateRegistry } from "./validation";
