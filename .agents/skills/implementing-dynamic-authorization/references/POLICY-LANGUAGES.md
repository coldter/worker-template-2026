# Policy Languages

This file explains PARC model mappings, comparative strengths, and selection criteria for major policy languages (XACML, OPA/Rego, OpenFGA, AWS IAM, Cedar).

---

## PARC Model Mapping Across Languages

**PARC (Principal, Action, Resource, Context) is a common authorization request framework across policy languages.**

### Comparison Table

| Language | Principal | Action | Resource | Context |
|-----|-----------|--------|----------|---------|
| **XACML** | subject attributes | action:id attribute | resource attributes | environment attributes |
| **OPA/Rego** | input.principal | input.action | input.resource | input.context |
| **OpenFGA** | Tuple (`user:alice`) | Permission (`can_view`) | Tuple (`doc:123`) | Not supported (external processing) |
| **AWS IAM** | aws:PrincipalTag | Action name (`s3:GetObject`) | ARN | aws condition keys (RequestTime, etc.) |
| **Cedar** | Structural scope | Structural scope | Structural scope | when/unless |

---

## XACML: Historical Standard

### Overview

**XACML (eXtensible Access Control Markup Language) was the first comprehensive policy language standardized by OASIS in 2003.**

| Item | Details |
|-----|------|
| **Developed by** | OASIS (standards body) |
| **Version** | 3.0 (2013) |
| **Format** | XML |
| **Architecture** | Originator of the PEP/PDP/PAP/PIP model |

### XML Syntax

**Example: allow access only within the same department**

```xml
<Policy PolicyId="ConfidentialDocAccess" RuleCombiningAlgId="permit-overrides">
  <Target>
    <Subjects>
      <AnySubject/>
    </Subjects>
    <Resources>
      <Resource>
        <Attribute AttributeId="resource:type" DataType="string">
          <AttributeValue>confidential-doc</AttributeValue>
        </Attribute>
      </Resource>
    </Resources>
  </Target>

  <Rule RuleId="PermitSameDept" Effect="Permit">
    <Condition>
      <Apply FunctionId="string-equal">
        <AttributeDesignator AttributeId="subject:department" Category="access-subject" DataType="string"/>
        <AttributeDesignator AttributeId="resource:owner-department" Category="resource" DataType="string"/>
      </Apply>
    </Condition>
  </Rule>
</Policy>
```

**Cedar equivalent**:

```cedar
permit(principal, action, resource)
when {
    resource.confidential == true &&
    principal.department == resource.owner.department
};
```

### ALFA: Simplified XACML Syntax

**ALFA (Abbreviated Language for Authorization) addresses XACML XML verbosity**:

```
namespace acme
policy ConfidentialDocAccess {
    target clause resource.confidential == true;
    apply permit if principal.department == resource.owner.department;
}
```

**Characteristics**:
- Compilable to XACML 3.0
- Programming-language-like syntax
- Developed by Axiomatics and standardized by OASIS

### PARC Mapping

| PARC element | XACML representation | Characteristics |
|---------|-----------|------|
| **Principal** | `<AttributeDesignator AttributeId="subject:xxx" Category="access-subject">` | Attributes only (no entity references) |
| **Action** | `<AttributeDesignator AttributeId="action:id">` | String values (no type system) |
| **Resource** | `<AttributeDesignator AttributeId="resource:xxx" Category="resource">` | Attributes only (no hierarchy model) |
| **Context** | `<AttributeDesignator Category="environment">` | Environmental factors (time/location, etc.) |

### Strengths & Limitations

| Strengths | Limitations |
|------------------|-------------------|
| Standardized (proven in government/regulatory industries) | Verbose XML, hard to author |
| Comprehensive architecture definition | Limited tooling, poor developer experience |
| Fine-grained attribute-based control | Performance challenges |

### Suitable / Unsuitable Scenarios

| Suitable | Unsuitable |
|---------|----------|
| Legacy systems with existing XACML assets | New projects |
| Regulatory requirements requiring standard compliance | Cloud-native environments |
| | Developer-experience-first teams |

---

## OPA/Rego: Cloud-native General-purpose Engine

### Overview

**OPA (Open Policy Agent) is a general-purpose policy engine for Kubernetes and microservices.**

| Item | Details |
|-----|------|
| **Developed by** | Styra (now CNCF graduated project) |
| **Language** | Rego (Datalog-derived) |
| **Use cases** | Authorization, Kubernetes admission control, config validation |
| **Characteristics** | General-purpose, flexible, high learning cost |

### Rego Policy Example

**Example: allow access only within the same department**

```rego
package acme.authz

import rego.v1

default allow := false

allow if {
  input.resource.confidential == true
  input.principal.department == input.resource.owner.department
}
```

**Cedar equivalent**:

```cedar
permit(principal, action, resource)
when {
    resource.confidential == true &&
    principal.department == resource.owner.department
};
```

### Structural Difference: Cedar vs Rego

**Cedar has scope filtering; Rego does not:**

| Language | Scope filter | Evaluation method |
|-----|----------------|---------|
| **Cedar** | ✅ Yes | Pre-select policies by Principal/Action/Resource |
| **Rego** | ❌ No | Evaluate all policies for all inputs |

**Impact**:
- **Cedar**: Skips irrelevant policies → faster
- **Rego**: Flexible but requires manual conditions → performance risk

### PARC Mapping

| PARC element | Rego representation | Characteristics |
|---------|---------|------|
| **Principal** | `input.principal.*` | User-defined structure (no type constraints) |
| **Action** | `input.action` | String etc. (untyped) |
| **Resource** | `input.resource.*` | Arbitrary JSON structure |
| **Context** | `input.context.*` | Flexible (nested/array allowed) |

### Strengths & Limitations

| Strengths | Limitations |
|------------------|-------------------|
| General-purpose (beyond authorization) | Not authorization-specific (no built-in structure) |
| Proven Kubernetes track record | High learning curve (Datalog) |
| Flexible input model | No type safety |
| CNCF standard | No scope filter (performance concerns) |

### Suitable / Unsuitable Scenarios

| Suitable | Unsuitable |
|---------|----------|
| Kubernetes admission control | Authorization-only use cases (Cedar, etc. fit better) |
| Config validation and compliance | Type safety is mandatory |
| Infrastructure policy | Teams that cannot absorb learning cost |

---

## OpenFGA: Zanzibar-derived, ReBAC-specialized

### Overview

**OpenFGA is a relationship-based authorization system based on Google Zanzibar.**

| Item | Details |
|-----|------|
| **Developed by** | Auth0 (now Okta), open source |
| **Model** | ReBAC (Relationship-Based Access Control) |
| **Format** | Tuples + schema |
| **Characteristics** | Relationship graph traversal, ideal for delegation/sharing |

### Schema Example

**Example: document access control**

```
type user
  relations
    define manager: [user]

type document
  relations
    define viewer: [user]
    define owner: [user]
    define can_access as viewer or owner or owner->manager
```

### Tuple Example

**Relationship data**:

```
document:doc1#owner@user:alice
user:alice#manager@user:carol
```

**Meaning**:
- Alice is owner of doc1
- Carol is Alice’s manager

### Permission Check

**Request**:

```json
{
  "user": "user:carol",
  "relation": "can_access",
  "object": "document:doc1"
}
```

**Evaluation**:
1. `can_access = viewer or owner or owner->manager`
2. Alice is owner; Carol has no direct relation
3. Traverse `owner->manager` → Carol is Alice’s manager → **Allow**

### PARC Mapping

| PARC element | OpenFGA representation | Characteristics |
|---------|-------------|------|
| **Principal** | `user:alice` | Tuple format (no attributes) |
| **Action** | `can_view`, `can_edit`, etc. | Permission name (schema-defined) |
| **Resource** | `document:doc1` | Tuple format |
| **Context** | Not supported | Time/device handled externally |

### Strengths & Limitations

| Strengths | Limitations |
|------------------|-------------------|
| Natural modeling of relationships and delegation | No context attributes (time/device, etc.) |
| Easy UI integration (share buttons) | No conditional logic (not ideal for ABAC) |
| Zanzibar-proven model | Policy = data (not code-managed) |
| Fast graph traversal | Hard to debug large graphs |

### Suitable / Unsuitable Scenarios

| Suitable | Unsuitable |
|---------|----------|
| Collaboration tools (Google Docs style) | Mandatory time/device constraints |
| Document sharing, ticket management | Complex conditional logic |
| Multi-tenant SaaS | Attribute-based fine-grained control |

---

## AWS IAM: AWS-specific

### Overview

**AWS IAM is a fine-grained authorization system dedicated to AWS.**

| Item | Details |
|-----|------|
| **Developed by** | Amazon Web Services |
| **Format** | JSON |
| **Scope** | AWS services only |
| **Evaluation scale** | 500M+ requests per second |

### Policy Example

**Example: allow S3 object access only in same department (tag-based)**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::acme-docs/*",
      "Condition": {
        "StringEquals": {
          "aws:PrincipalTag/department": "${s3:ExistingObjectTag/owner-department}"
        },
        "StringEqualsIfExists": {
          "s3:ExistingObjectTag/confidential": "true"
        }
      }
    }
  ]
}
```

**Characteristics**:
- **Tag-to-tag comparison**: Dynamic comparison of principal and resource tags
- **Condition keys**: `aws:PrincipalTag`, `s3:ExistingObjectTag`, `aws:RequestTime`, etc.

### PARC Mapping

| PARC element | AWS IAM representation | Characteristics |
|---------|------------|------|
| **Principal** | `aws:PrincipalTag/*`, IAM roles | Automatic tag synchronization via IAM Identity Center |
| **Action** | `s3:GetObject`, `dynamodb:PutItem`, etc. | AWS service API names |
| **Resource** | ARN (`arn:aws:s3:::bucket/key`) | AWS-specific identifier |
| **Context** | `aws:RequestTime`, `aws:SourceIp`, etc. | AWS condition keys |

### Strengths & Limitations

| Strengths | Limitations |
|------------------|-------------------|
| Native AWS integration | AWS-only (not cross-cloud) |
| Tag-based fine-grained control | Verbose JSON |
| Ultra-high performance | Learning curve (AWS-specific concepts) |
| Rich condition keys | No portability |

### Suitable / Unsuitable Scenarios

| Suitable | Unsuitable |
|---------|----------|
| General AWS workloads | Multi-cloud |
| Fine-grained control for S3, DynamoDB, etc. | On-premises |
| Identity Center integration | Non-AWS applications |

---

## Cedar: Type-safe, Structural Scope, Static Analysis

### Overview

**Cedar is an AWS-origin, open-source, type-safe policy language.**

| Item | Details |
|-----|------|
| **Developed by** | AWS (open-sourced) |
| **License** | Apache 2.0 |
| **Characteristics** | Type safety, structural scope, static analysis, high performance |
| **Integration** | Amazon Verified Permissions / Verified Access |

### Policy Example

**Example: allow access only for same department, managed device, and business hours**

```cedar
permit(
    principal in Employee::*,
    action == Action::"doc:view",
    resource in Document::*
)
when {
    resource.confidential == true &&
    principal.department == resource.owner.department &&
    context.device.managed == true &&
    context.time.hour >= 9 &&
    context.time.hour < 17
};
```

### PARC Mapping

| PARC element | Cedar representation | Characteristics |
|---------|----------|------|
| **Principal** | `principal in Employee::"alice"` | Structural scope, entity references |
| **Action** | `action == Action::"view"` | Schema-defined, type-safe |
| **Resource** | `resource in Document::*` | Entity type and hierarchy support |
| **Context** | `context.device.managed`, `context.time.hour` | Schema-defined, typed |

### Strengths & Limitations

| Strengths | Limitations |
|------------------|-------------------|
| Type safety, schema enforcement | Emerging language (public since 2023) |
| Structural scope (high performance) | Ecosystem still maturing |
| Static analysis (SMT solver) | Fewer non-AWS implementations |
| Unified RBAC/ReBAC/ABAC support | No regex support (intentional) |

### Suitable / Unsuitable Scenarios

| Suitable | Unsuitable |
|---------|----------|
| Type safety is mandatory | Reuse of existing XACML/OPA assets |
| Multi-model integration (PBAC) | Need extreme flexibility (Rego) |
| Static analysis/formal verification | No need for dedicated non-AWS implementation |
| Using AWS Verified Permissions | |

---

## Language Selection Criteria Table

### Feature Comparison

| Language | Type safety | Scope filter | Static analysis | ReBAC | ABAC | Learning cost |
|-----|-------|----------------|---------|-------|------|----------|
| **XACML** | ❌ | ❌ | ❌ | ❌ | ✅ | High |
| **OPA/Rego** | ❌ | ❌ | ❌ | △ | ✅ | High |
| **OpenFGA** | ✅ | ✅ | ❌ | ✅ | ❌ | Medium |
| **AWS IAM** | △ | △ | ❌ | ❌ | ✅ | High (AWS-specific) |
| **Cedar** | ✅ | ✅ | ✅ | ✅ | ✅ | Medium |

### Performance Comparison

| Language | Evaluation speed | Scalability | Notes |
|-----|---------|---------------|------|
| **XACML** | Low | Low | XML parsing overhead |
| **OPA/Rego** | Medium to high | High | No scope filter → full evaluation |
| **OpenFGA** | High | High | Optimized graph traversal |
| **AWS IAM** | Very high | Very high | AWS-specific optimization |
| **Cedar** | High | High | Scope filter + static optimization |

---

## Strength Map (PARC Elements + Portability)

**How well each language supports each PARC element:**

| Language | Principal | Action | Resource | Context | Portability |
|-----|-----------|--------|----------|---------|-------------|
| **XACML** | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **OPA/Rego** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **OpenFGA** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐ |
| **AWS IAM** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐ |
| **Cedar** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

**Scoring guide**:
- ⭐ = basic support
- ⭐⭐⭐⭐⭐ = highest level (type-safe, structured, extensible)

---

## Selection Questions (AskUserQuestion Recommended)

### 1. Deployment Scope

**Question**: Which platform/environment will this run in?

| Answer | Recommended language |
|-----|---------|
| AWS-only | AWS IAM (first choice), Cedar (if using Verified Permissions) |
| Multi-cloud | Cedar, OPA/Rego |
| On-premises | Cedar, OPA/Rego |
| Kubernetes-centric | OPA/Rego (proven track record) |

### 2. Primary Pattern

**Question**: What is central to authorization?

| Answer | Recommended language |
|-----|---------|
| Relationships/sharing/delegation | OpenFGA, Cedar (supports ReBAC) |
| Attributes/context | Cedar, OPA/Rego |
| Role-centric (simple) | Cedar (RBAC pattern), AWS IAM (IAM roles) |

### 3. Type Safety

**Question**: Are type safety and static analysis mandatory?

| Answer | Recommended language |
|-----|---------|
| Mandatory | Cedar (supports SMT analysis) |
| Flexibility first | OPA/Rego |

### 4. Existing Systems

**Question**: Do you have an existing authorization system?

| Answer | Recommended language |
|-----|---------|
| Existing XACML | Continue XACML (consider ALFA), or gradually migrate to Cedar |
| Existing OPA | Continue OPA, or use Cedar for new areas |
| None | Cedar (modern/type-safe) or OPA (general-purpose) |

### 5. Development Resources

**Question**: How much learning cost can you accept?

| Answer | Recommended language |
|-----|---------|
| Low learning cost preferred | Cedar (simpler syntax) |
| High learning cost acceptable | OPA/Rego (maximum flexibility) |

---

## Hybrid Approach: Topaz

**Topaz** is a service that combines OPA/Rego and a Zanzibar-style graph:

| Element | Details |
|-----|------|
| **Policy engine** | OPA/Rego (conditional logic) |
| **Relationship store** | Zanzibar-style graph (ReBAC) |
| **Benefit** | ABAC + ReBAC in a single system |
| **Suitable scenario** | Complex requirements (time constraints + relationship-based permissions) |

**Official site**: [https://www.topaz.sh](https://www.topaz.sh)

---

## Summary: Policy Language Selection Flowchart

```
AWS-only?
  ├─ Yes → AWS IAM (first choice)
  └─ No
      ├─ Relationship/sharing centric?
      │   ├─ Yes → OpenFGA
      │   └─ No
      │       ├─ Type safety mandatory?
      │       │   ├─ Yes → Cedar
      │       │   └─ No
      │       │       ├─ Kubernetes?
      │       │       │   ├─ Yes → OPA/Rego
      │       │       │   └─ No → Cedar (general recommendation)
      │       └─ Legacy (existing XACML)?
      │           └─ Yes → XACML + ALFA consideration
      └─ Need multi-model integration (PBAC)?
          └─ Yes → Cedar (integrates RBAC/ReBAC/ABAC)
```

For detailed implementation patterns, see [CEDAR-POLICIES.md](CEDAR-POLICIES.md). For architecture, see [ARCHITECTURE-PATTERNS.md](ARCHITECTURE-PATTERNS.md).
