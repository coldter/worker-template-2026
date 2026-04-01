# Cedar Policies

This file explains the detailed structure of the Cedar policy language, type system, operators, implementation patterns, schema design, and analysis methods.

---

## Cedar Overview

**Why Cedar?** Cedar is a policy language that combines **expressiveness, performance, analyzability, and openness**.

| Feature | Details |
|------|------|
| **Expressiveness** | Unified expression of RBAC, ReBAC, and ABAC |
| **Performance** | Sub-millisecond evaluation, scales to hundreds/thousands of policies |
| **Analyzability** | Static analysis and formal verification via SMT solvers |
| **Open** | Open-source and embeddable (Rust/WASM) |

**Developed by**: AWS (used in Amazon Verified Permissions / Verified Access)
**License**: Apache 2.0
**Official site**: [https://www.cedarpolicy.com](https://www.cedarpolicy.com)

---

## Policy Structure

**All Cedar policies consist of Effect, Scope, and Conditions.**

### 1. Effect

**Either `permit` (allow) or `forbid` (deny)**:

```cedar
permit(...)  // Allow
forbid(...)  // Deny (always overrides permit)
```

**Evaluation rules (deny-overrides):**
1. If `forbid` applies → **Deny** (ignore other permits)
2. Else if `permit` applies → **Allow**
3. If neither applies → **Deny** (implicit deny)

### 2. Scope

**Defines who (Principal), what action (Action), and which resource (Resource) the policy applies to**:

```cedar
permit(
    principal in Employee::"eng-team",    // Principal: engineering team
    action == Action::"deploy",           // Action: deploy
    resource in System::"production"      // Resource: production system
)
```

**Benefits of scope**:
- **Efficiency**: Cedar evaluates only policies whose scope matches
- **Type safety**: Cannot use entities/actions outside schema definitions
- **Readability**: Policy target is explicit

### 3. Conditions

**`when` (positive conditions) and `unless` (negative conditions)**:

```cedar
when {
    context.device.managed == true        // managed device
    && context.time.hour >= 9             // at or after 9:00
    && context.time.hour < 17             // before 17:00
}

unless {
    context.location == "restricted"      // not in restricted region
}
```

**Conditions are optional**. If omitted, decision is scope-only.

---

## PARC Model

**PARC (Principal, Action, Resource, Context) is the common framework for authorization requests.**

### Request Structure (JSON)

```json
{
  "principal": "Employee::\"alice\"",
  "action": "Action::\"deploy\"",
  "resource": "System::\"production\"",
  "context": {
    "device": { "managed": true },
    "time": { "hour": 10, "weekday": "Monday" }
  }
}
```

### PARC-to-Policy Mapping

| PARC element | Policy representation | Evaluation method |
|---------|------------|---------|
| **Principal** | `principal in Employee::"alice"` | Scope matching |
| **Action** | `action == Action::"deploy"` | Scope matching |
| **Resource** | `resource in System::"production"` | Scope matching |
| **Context** | `context.device.managed == true` | Condition evaluation |

### Evaluation Flow

1. **Scope matching**: Select policies where Principal/Action/Resource matches
2. **Condition evaluation**: Evaluate `when`/`unless` on selected policies
3. **Decision**: Resolve final result using deny-overrides

---

## Policy Evaluation

### Scope Matching Example

```cedar
// Policy
permit(
    principal in Group::"admins",
    action == Action::"delete",
    resource in Document::*
)
when { context.device.managed == true };

// Request 1: Alice (in admins) deletes → scope match → evaluate conditions
// Request 2: Bob (not in admins) deletes → scope mismatch → skip evaluation
```

### Condition Evaluation

**All `when` expressions must be true, and all `unless` expressions must be false**:

```cedar
when {
    principal.clearance == "high"         // must be true
    && context.device.managed == true      // must be true
}
unless {
    context.time.hour < 9                  // must be false (at or after 9:00)
    || context.time.hour >= 17             // must be false (before 17:00)
}
```

### Deny-overrides Model

**Example: enforce device constraints**

```cedar
// 1. Allow only from managed devices (permit)
permit(
    principal in Employee::*,
    action,
    resource
)
when { context.device.managed == true };

// 2. Forbid unmanaged devices (forbid)
forbid(
    principal in Employee::*,
    action,
    resource
)
when { context.device.managed == false };
```

**Evaluation results**:
- Managed device → permit matches, forbid does not → **Allow**
- Unmanaged device → forbid matches → **Deny** (permit ignored)

---

## Cedar Type System

**Cedar is strongly typed, and only schema-defined entities/attributes can be used.**

### Schema Example

```cedar
namespace ACME

entity Employee {
    attributes {
        department: String,
        clearance: optional { String },
        manager: Employee                 // entity reference
    }
}

entity Document {
    attributes {
        owner: Employee,
        classification: String,
        readers_team: Team
    }
}

entity Team {
    attributes { name: String }
}

action "doc:view"
    appliesTo { principal: [Employee, Customer], resource: Document }

context {
    device: { managed: Bool },
    time: { hour: Long, weekday: String }
}
```

### Type Categories

| Category | Types | Examples |
|---------|---|---|
| **Primitive** | Bool, String, Long (64-bit integer) | `true`, `"finance"`, `100` |
| **Extension** | datetime, duration, ipaddr, decimal | `datetime("2025-01-01T00:00:00Z")`, `duration("30d")` |
| **Composite** | Set, Record | `Set<String>`, `{ managed: Bool }` |
| **Entity** | Employee, Document, Team, etc. | `Employee::"alice"` |

### Namespace

**All entities/actions are organized by namespace**:

```cedar
namespace ACME

// Entities: ACME::Employee, ACME::Document
// Actions: ACME::Action::"doc:view"
```

**Benefits**:
- Avoids name collisions (same entity names across apps)
- Clarifies scope (which application a policy belongs to)

---

## Operator Reference

### Boolean Operators

```cedar
&& || !
Example: principal.clearance == "high" && context.device.managed
```

### String Operators

| Operator | Usage | Example |
|----------|------|---|
| `==`, `!=` | Exact match | `principal.department == "finance"` |
| `like` | Wildcard | `context.device.name like "corp-*"` |

### Long (Integer) Operators

```cedar
==, <, >, <=, >=, +, -, *
Example: resource.size <= 1048576  // <= 1MB
```

### DateTime/Duration Operators

```cedar
// datetime comparison
context.requestTime >= datetime("2025-07-01T00:00:00Z")

// duration comparison
context.sessionDuration < duration("8h")
```

### IP Address Operators

```cedar
// IP range check
ip(context.clientIp) in ip("10.0.0.0/8")
```

### Set Operators

| Operator | Usage | Example |
|----------|------|---|
| `in` | Membership | `principal in Group::"admins"` |
| `.contains()` | Contains element | `principal.roles.contains("manager")` |
| `.containsAny()` | Contains any element | `principal.tags.containsAny(["sensitive", "restricted"])` |

### Entity Operators

```cedar
// type check
resource is Document

// entity comparison
resource.owner == principal
```

### Tag Operators

```cedar
// tag existence
resource.hasTag("sensitive")

// tag value
resource.getTag("classification") == "confidential"
```

---

## Policy Patterns

### 1. Discretionary

**Resource owner decides who to share with**:

```cedar
permit(
    principal,
    action == Action::"doc:view",
    resource in Document::*
)
when {
    principal in resource.readers_team    // owner adds users to team
};
```

**Characteristics**:
- UI-based sharing operations (Google Docs style)
- No policy changes needed (handled via team membership changes)

### 2. Membership

**Group/role-based access (RBAC-style)**:

```cedar
permit(
    principal in Team::"legal",
    action in [Action::"doc:view", Action::"doc:edit"],
    resource in Document::*
)
when { resource.classification == "Legal" };
```

**Characteristics**:
- Department/team-level permission management
- Explicit group targeting in scope

### 3. Relationship

**Access via relationship traversal (ReBAC-style)**:

```cedar
permit(
    principal in Employee::*,
    action in [Action::"doc:view", Action::"doc:edit"],
    resource in Document::*
)
when {
    resource.owner.manager == principal    // manager relationship
};
```

**Characteristics**:
- Automatic grants based on org hierarchy/ownership
- Uses relationships from entity store graph

---

## Schema Design Best Practices

### 1. Strict Action Typing

**Bad example**:
```cedar
action "doc:view"
    appliesTo { principal: Any, resource: Any }
```

**Good example**:
```cedar
action "doc:view"
    appliesTo { principal: [Employee, Customer], resource: Document }
```

**Reason**: `Any` weakens type safety and can apply policies to unintended entity types.

### 2. Avoid Attribute Overloading

**Bad example**:
```cedar
entity Employee {
    attributes {
        dept_role: String  // compound value like "Eng-Manager"
    }
}
```

**Good example**:
```cedar
entity Employee {
    attributes {
        department: String,
        role: String
    }
}
```

**Reason**: Requires string parsing and makes policies more complex.

### 3. Consistent Naming Conventions

**Recommended conventions**:
- Entities: PascalCase (`Employee`, `Document`)
- Actions: `namespace::action` form (`doc:view`, `system:deploy`)
- Attributes: snake_case (`owner_department`, `clearance_level`)

### 4. Explicit Context Attributes

**Define all context attributes in schema**:

```cedar
context {
    device: { managed: Bool, ip: String },
    time: { hour: Long, weekday: String },
    location: String
}
```

**Reason**: Enables context simulation during testing.

---

## Policy Templates and Overrides

### Templates

**Parameterize reusable policy patterns**:

```cedar
// Template definition
permit(
    principal in ?readers_team,
    action == Action::"doc:view",
    resource in Document::*
)
when { resource.owner == ?owner };

// Instantiation
{ "readers_team": "Team::\"project-alpha\"", "owner": "Employee::\"alice\"" }
```

**Benefits**:
- Maintains consistency
- Applies same logic across multi-tenant environments

### Overrides

**Enforce organization-wide constraints with `forbid`**:

```cedar
// Global constraint
forbid(
    principal,
    action,
    resource
)
when { context.device.managed == false };

// Individual permit (forbid above takes precedence)
permit(
    principal in Employee::*,
    action,
    resource
);
```

---

## Cedar vs Other Languages

**Presence of scope matching**:

| Language | Scope matching | Evaluation method |
|-----|-----------------|---------|
| **Cedar** | ✅ Yes | Condition evaluation after scope filtering |
| **OPA/Rego** | ❌ No | Evaluate all rules against all inputs |

**Advantages of Cedar**:
- **Performance**: Skips irrelevant policies
- **Readability**: Explicit policy scope
- **Static analysis**: Verify applicability in advance via scope

---

## SMT Analysis and Cedar Analysis

**Cedar Analysis uses an SMT solver (Z3) for formal policy verification.**

### What Can Be Verified

| Verification | Details |
|---------|------|
| **Satisfiability** | Is a policy applicable at all? (detect dead code) |
| **Conflicts** | Contradictions across policies (permit vs forbid) |
| **Coverage** | Which policies cover a given request |
| **Reachability** | Reachable decisions under specific conditions |

### Usage Examples

```bash
# Validate a policy set
cedar analyze --policies policy.cedar --schema schema.cedar

# Check coverage for a specific request
cedar analyze --request request.json --policies policy.cedar
```

**Benefits**:
- Detect bugs before deployment
- Discover security gaps
- Improve refactoring safety

---

## Implementing Policy Tests

### Unit Test Example

```json
{
  "policies": "policy.cedar",
  "entities": "entities.json",
  "tests": [
    {
      "description": "Alice can edit as the document owner",
      "principal": "Employee::\"alice\"",
      "action": "Action::\"doc:edit\"",
      "resource": "Document::\"doc1\"",
      "context": { "device": { "managed": true } },
      "expected": "Allow"
    },
    {
      "description": "Bob cannot access from an unmanaged device",
      "principal": "Employee::\"bob\"",
      "action": "Action::\"doc:view\"",
      "resource": "Document::\"doc1\"",
      "context": { "device": { "managed": false } },
      "expected": "Deny"
    }
  ]
}
```

### CI/CD Integration

```yaml
# .github/workflows/cedar-validation.yml
- name: Validate Cedar Policies
  run: cedar validate --policies policies/ --schema schema.cedar

- name: Run Cedar Tests
  run: cedar test --tests tests/policy-tests.json
```

---

## Integration with Entity Stores

**Cedar is used together with an entity store (relationship graph).**

### Entity Data Example (JSON)

```json
[
  {
    "uid": { "type": "Employee", "id": "alice" },
    "attrs": { "department": "eng", "clearance": "high" },
    "parents": [{ "type": "Team", "id": "eng-team" }]
  },
  {
    "uid": { "type": "Document", "id": "doc1" },
    "attrs": { "owner": { "type": "Employee", "id": "alice" } }
  }
]
```

### Data Flow During Policy Evaluation

```
[Request] → [Cedar Engine]
             ↓ ← [Entity store: relationship/attribute retrieval]
             ↓ ← [Policy set]
         [Decision: Allow/Deny]
```

**Relationship traversal**:
```cedar
resource.owner.manager == principal
```
→ Traverse in entity store: `Document::doc1 --owner--> Employee::alice --manager--> Employee::carol`.

---

## Summary: Cedar Implementation Checklist

- [ ] Complete schema design (define entities, actions, context)
- [ ] Enforce strict action typing (no `Any`)
- [ ] Select policy pattern (Discretionary/Membership/Relationship)
- [ ] Define global constraints with `forbid`
- [ ] Create test cases (unit + scenario tests)
- [ ] Run static analysis (`cedar analyze`)
- [ ] Integrate CI/CD (automated validation/testing)
- [ ] Integrate entity store (relationship graph + attribute synchronization)

For detailed architecture patterns, see [ARCHITECTURE-PATTERNS.md](ARCHITECTURE-PATTERNS.md). For language comparison, see [POLICY-LANGUAGES.md](POLICY-LANGUAGES.md).
