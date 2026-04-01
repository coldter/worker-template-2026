# Implementing Dynamic Authorization

## Overview

Dynamic Authorization is an approach that makes access decisions based on **runtime attributes, relationships, and context**, rather than static roles or permissions. It solves the following limitations of traditional ACL (Access Control List) and RBAC (Role-Based Access Control):

- **Scalability**: Difficulty managing tens of thousands of static lists
- **Flexibility**: Inability to handle dynamic context such as time, location, and device state
- **Maintainability**: Human and system costs required to keep up with resource and role changes
- **Auditability**: Difficulty tracking who can access what
- **Security**: Risk of data leakage due to unnecessary residual permissions

**Dynamic authorization evaluates policies at runtime and determines Allow or Deny based on current state, attributes, and relationships.** This provides the following benefits:

- **Context-aware decisions**: Considers dynamic factors such as time, location, and device trust
- **Real-time adaptation**: Immediately reflects role and resource changes
- **Clear audit trails**: Decision rationale is traceable through policies and logs
- **Flexible delegation**: Adapts to changes in organizations, teams, and project structures

---

## Authorization Model Selection Guide

**The right authorization model depends on application requirements and use cases.** Use the table below for guidance:

| Model | Best-fit scenario | Primary characteristic | Example use cases |
|--------|---------|---------|--------|
| **ACL** | Simple file/resource-level access control | Per-resource allow list | Unix file permissions, basic file sharing |
| **RBAC** | Permission management based on organizational job functions | Role-to-permission mapping | Department-based access in internal systems |
| **ReBAC** | Collaboration, sharing, and delegation centric systems | Relationship-graph-based decisions | Google Docs, Slack, team collaboration tools |
| **ABAC** | Fine-grained control based on dynamic context and attributes | Real-time decisions via attribute evaluation | Financial systems, medical records, government agencies |
| **PBAC** | Integrated operation across multiple models | Combination of roles, attributes, and relationships | Multi-tenant SaaS, enterprise platforms |

**Decision points that require user confirmation (use AskUserQuestion):**

1. **Authorization model selection**: ReBAC vs ABAC vs PBAC?
   - Sharing/delegation-centric → ReBAC
   - Context/attribute-centric → ABAC
   - Combination of multiple requirements → PBAC

2. **Policy language selection**: Cedar vs OPA/Rego vs OpenFGA
   - See [POLICY-LANGUAGES.md](./references/POLICY-LANGUAGES.md) for details

3. **Architecture pattern**: PEP placement (Embedded/Gateway/Sidecar), centralized vs distributed PDP
   - See [ARCHITECTURE-PATTERNS.md](./references/ARCHITECTURE-PATTERNS.md) for details

---

## Unified PBAC Approach

**Policy-Based Access Control (PBAC) is a higher-level concept that unifies RBAC, ABAC, and ReBAC.** By externalizing policies as code or data and evaluating them at runtime, PBAC enables flexible and consistent authorization.

### Policy as Code

**A method where policies are written as executable code and managed through versioning, testing, and deployment** (the mainstream ABAC approach).

- **Form**: Declarative languages such as Cedar, Rego (OPA), and XACML
- **Characteristics**:
  - Fine-grained logic based on attributes and conditions
  - Managed through CI/CD pipelines
  - Supports static analysis and testing
- **Use cases**: Time-based restrictions, device trust checks, clearance-level evaluation

### Policy as Data

**A method where policies are stored as relationship graphs or metadata and dynamically evaluated by static rules** (the mainstream ReBAC approach).

- **Form**: Relationship graphs (Zanzibar, OpenFGA), tuples (`user:alice#viewer@doc:123`)
- **Characteristics**:
  - Access changes via relationship add/remove
  - Policy logic stays fixed while data changes dynamically
  - Can be operated directly from UI (e.g., Google Docs share button)
- **Use cases**: Document sharing, team membership, ownership-based control

**PBAC combines both approaches as needed.**

---

## Authorization Reference Architecture Overview

**The 4-component model proposed by XACML (PEP/PDP/PAP/PIP) is the standard architecture for modern authorization systems.**

### Component Overview

| Component | Role | Implementation examples |
|--------------|------|--------|
| **PEP** (Policy Enforcement Point) | Intercepts requests and enforces decisions | App code, API Gateway, Sidecar |
| **PDP** (Policy Decision Point) | Evaluates policy and returns decisions | Cedar Engine, OPA, AWS IAM |
| **PAP** (Policy Administration Point) | Policy management and versioning | Git, dedicated policy stores |
| **PIP** (Policy Information Point) | Supplies attributes and context | IdP, HR systems, device management, time servers |

### Decision Flow

```
[User] → [PEP: Request Interception]
              ↓
         [PDP: Policy Evaluation]
              ↓ ← [PAP: Policy Retrieval]
              ↓ ← [PIP: Attribute Retrieval]
              ↓
         [Decision: Allow/Deny]
              ↓
         [PEP: Enforcement]
```

**Separation of concerns is critical:**
- **Maintainability**: Policies are managed independently from application code
- **Consistency**: The same policy is applied across multiple services
- **Transparency**: Decision rationale is traceable via policies and logs
- **Scalability**: Distributed PDP deployment avoids bottlenecks

See [ARCHITECTURE-PATTERNS.md](./references/ARCHITECTURE-PATTERNS.md) for details.

---

## Cedar Language Quick Start

**Cedar** is an AWS-origin open-source policy language that combines **expressiveness, performance, analyzability, and openness**.

### Cedar Policy Structure

All Cedar policies consist of three elements: **Effect, Scope, and Conditions**:

```cedar
permit(                                    // Effect: Allow
    principal in Employee::"eng-team",    // Scope: Principal
    action == Action::"deploy",           // Scope: Action
    resource in System::"production"      // Scope: Resource
)
when {                                     // Conditions
    context.device.managed == true        // Managed device
    && context.time.hour >= 9             // At or after 9:00
    && context.time.hour < 17             // Before 17:00
};
```

**`forbid` policies always override `permit`** (deny-overrides model).

### PARC Model

**PARC (Principal, Action, Resource, Context) is a common framework for authorization requests**:

| Element | Meaning | Cedar expression examples |
|-----|------|-----------|
| **Principal** | Requesting subject | `Employee::"alice"`, `Service::"api-gateway"` |
| **Action** | Intended operation | `Action::"view"`, `Action::"edit"` |
| **Resource** | Target object | `Document::"doc123"`, `Database::"prod-db"` |
| **Context** | Dynamic context | `context.time`, `context.device.ip`, `context.location` |

### Cedar Type System

**Cedar is strongly typed**, and only schema-defined entities and attributes can be used:

- **Primitive types**: Bool, String, Long (64-bit integer)
- **Extension types**: datetime, duration, ipaddr, decimal
- **Composite types**: Set, Record
- **Entity references**: `resource.owner == principal` (direct relationship evaluation)

### Operator Reference

| Category | Operators | Usage |
|---------|----------|------|
| Boolean | `&&`, `||`, `!` | Logical operations |
| String | `==`, `!=`, `like` | String comparison / wildcard |
| Long | `==`, `<`, `>`, `<=`, `>=`, `+`, `-`, `*` | Numeric comparison / arithmetic |
| Datetime/Duration | `==`, `<`, `<=`, `>`, `>=`, `datetime()`, `duration()` | Time and duration constraints |
| IP Address | `==`, `in`, `ip()` | IP range checks |
| Set | `in`, `.contains()`, `.containsAny()` | Membership checks |
| Entity | `is`, type qualifiers | Entity type checks |
| Tag | `.hasTag()`, `.getTag()` | Tag-based control |

See [CEDAR-POLICIES.md](./references/CEDAR-POLICIES.md) for details.

---

## Policy Language Selection Guide

**Comparison of major policy languages** (and PARC mapping):

| Language | Principal | Action | Resource | Context | Key characteristics |
|-----|-----------|--------|----------|---------|---------|
| **Cedar** | Structural scope | Structural scope | Structural scope | when/unless | Type-safe, static analysis, high performance |
| **OPA/Rego** | input.principal | input.action | input.resource | input.context | General-purpose, Datalog-derived, flexible |
| **OpenFGA** | Tuple (`user:alice`) | Permission (`can_view`) | Tuple (`doc:123`) | Not supported (external processing) | Zanzibar-derived, ReBAC-focused |
| **XACML** | Attribute-based | Attribute-based | Attribute-based | environment attributes | Historical standard, verbose XML |
| **AWS IAM** | aws:PrincipalTag | Action name (`s3:GetObject`) | ARN | aws condition keys | AWS-specific, tag-based |

### Language Selection Questions (use AskUserQuestion)

Use the following questions to select a policy language:

1. **Deployment scope**: AWS-only, or multi-cloud/on-prem?
   - AWS-only → AWS IAM
   - General-purpose → Cedar/OPA/OpenFGA

2. **Primary pattern**: Relationship-based or attribute-based?
   - Sharing/delegation-centric → OpenFGA (ReBAC)
   - Context/condition-centric → Cedar/OPA (ABAC)

3. **Type safety**: Is static analysis/schema validation required?
   - Required → Cedar
   - Not required (flexibility prioritized) → OPA/Rego

4. **Existing infrastructure**: Kubernetes environment or serverless?
   - Kubernetes → OPA (proven track record)
   - AWS-centric → Cedar (Verified Permissions integration)

See [POLICY-LANGUAGES.md](./references/POLICY-LANGUAGES.md) for detailed selection criteria and PARC mappings.

---

## User Confirmation Principles (AskUserQuestion)

**If ambiguity exists, always confirm via the AskUserQuestion tool.** Decisions are required at the following points:

### 1. Authorization Model Selection

```python
AskUserQuestion(
    questions=[{
        "question": "Which authorization model should we adopt?",
        "header": "Authorization Model Selection",
        "options": [
            {
                "label": "ReBAC (Relationship-Based)",
                "description": "Best when sharing, delegation, and collaboration are central (Google Docs style)"
            },
            {
                "label": "ABAC (Attribute-Based)",
                "description": "Best when dynamic context such as time, location, and device is important"
            },
            {
                "label": "PBAC (Unified)",
                "description": "Operate with a combination of roles, attributes, and relationships"
            }
        ],
        "multiSelect": False
    }]
)
```

### 2. Policy Language Selection

```python
AskUserQuestion(
    questions=[{
        "question": "Which policy language should we use?",
        "header": "Policy Language",
        "options": [
            {"label": "Cedar", "description": "Type-safe, high-performance, static analyzable (integrates with AWS Verified Permissions)"},
            {"label": "OPA/Rego", "description": "General-purpose, proven in Kubernetes, flexible"},
            {"label": "OpenFGA", "description": "ReBAC-focused, Zanzibar-derived, relationship graph"},
            {"label": "AWS IAM", "description": "AWS-only, tag-based"}
        ],
        "multiSelect": False
    }]
)
```

### 3. PEP Deployment Pattern

```python
AskUserQuestion(
    questions=[{
        "question": "Where should we place the PEP (Policy Enforcement Point)?",
        "header": "PEP Placement",
        "options": [
            {"label": "Embedded (in-application)", "description": "Fine-grained control inside the app with full context"},
            {"label": "API Gateway", "description": "Centralized management across services with aggregated logs"},
            {"label": "Sidecar", "description": "Service mesh / zero trust at infrastructure layer"}
        ],
        "multiSelect": False
    }]
)
```

### 4. Centralized vs Distributed PDP

```python
AskUserQuestion(
    questions=[{
        "question": "Please choose the PDP (Policy Decision Point) architecture",
        "header": "PDP Architecture",
        "options": [
            {"label": "Centralized", "description": "Single PDP, consistency-first, simple operations"},
            {"label": "Distributed", "description": "PDP in each service, low latency, high availability"}
        ],
        "multiSelect": False
    }]
)
```

---

## Navigation to Sub-files

**See the following files for detailed information:**

- **[AUTHORIZATION-MODELS.md](./references/AUTHORIZATION-MODELS.md)**: Detailed ACL/RBAC/ReBAC/ABAC/PBAC comparison, strengths/limitations, best-fit scenarios
- **[CEDAR-POLICIES.md](./references/CEDAR-POLICIES.md)**: Cedar policy structure, type system, operators, patterns, schema design, analysis methods
- **[ARCHITECTURE-PATTERNS.md](./references/ARCHITECTURE-PATTERNS.md)**: PEP/PDP/PAP/PIP details, deployment patterns, centralized vs distributed, governance
- **[POLICY-LANGUAGES.md](./references/POLICY-LANGUAGES.md)**: Detailed XACML/OPA/OpenFGA/AWS IAM/Cedar comparison, PARC mappings, selection criteria

---

## Important Implementation Principles

1. **Prioritize schema design**: Define entities, actions, and attributes before writing policies
2. **Enforce deny-by-default**: Deny unless explicitly allowed
3. **Use `forbid` for global constraints**: Enforce cross-organization rules (e.g., managed devices required)
4. **Test-first**: Always run tests and static analysis on policies
5. **Manage policies as code**: Versioning, CI/CD, review, and rollback

See [CEDAR-POLICIES.md](./references/CEDAR-POLICIES.md) for detailed implementation patterns.
