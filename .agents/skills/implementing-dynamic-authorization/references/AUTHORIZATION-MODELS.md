# Authorization Models

This file explains ACL, RBAC, ReBAC, ABAC, and PBAC in detail, including how each model works, strengths, limitations, and suitable use cases.

---

## ACL (Access Control List)

### Mechanism

**ACL (Access Control List) keeps, per resource, a list of allowed principals (users/groups) and actions (read/write/execute).**

- **Structure**: `<Resource> → <List of (Principal, Action)>`
- **Example**: Unix file permissions
  - File `report.txt` → `owner:alice:rwx, group:finance:r--, others:---`
- **Decision method**: Check the resource ACL and verify whether the requesting subject is included in the list

### Strengths / Limitations Table

| Strengths | Limitations |
|------------------|-------------------|
| Simple and intuitive | List management becomes difficult as resource count grows |
| Easy to implement | Must maintain lists per resource (redundant) |
| Good runtime performance | Cannot consider principal attributes or context |
| Suitable for small systems | Lacks scalability (breaks down at thousands of resources+) |

### Appropriate Usage Scenarios

- **File systems**: Unix/Linux permissions, basic file sharing
- **Simple resource protection**: Small systems with tens to hundreds of resources
- **Static access**: Rare permission changes, no need for dynamic factors (time/location, etc.)

**Scenarios to avoid**:
- Multi-tenant SaaS
- Thousands of resources or more
- Cases requiring dynamic context (time, device state, etc.)

---

## RBAC (Role-Based Access Control)

### Mechanism

**RBAC assigns users to roles, then maps roles to permissions.**

- **Structure**: `User → Role → Permission`
- **Example**:
  - Roles: `Manager`, `Engineer`, `Viewer`
  - Mapping: `Manager → [view, edit, delete]`, `Engineer → [view, edit]`
  - Assignments: `Alice → Manager`, `Bob → Engineer`
- **Decision method**: Retrieve user role(s), then verify permissions granted to those roles

### Strengths / Limitations Table

| Strengths | Limitations |
|------------------|-------------------|
| Maps naturally to organizational structure | **Role Explosion**: role count grows per exception/special case |
| Easier to manage than ACL | Cannot account for dynamic context (time, location, device) |
| Easy auditing (who has which role?) | Complexity increases with cross-team and temporary access |
| Suitable for medium-scale systems | Hard to scale in multi-tenant environments |

### Role Explosion Problem

**The biggest RBAC challenge is unbounded role proliferation to handle exceptions and special cases**:

| Scenario | RBAC response | Problem |
|---------|-------------|--------|
| Project manager should access Team A only | Create `ProjectManager-TeamA` role | Requires one role per team |
| Contractor can edit only a specific document | Create `Contractor-Editor-Doc123` role | Role count explodes per document |
| Sales can view customer data only in their region | `Sales-RegionUS`, `Sales-RegionEU`... | Combinatorial explosion: region × role |

**Solution**: Move to ABAC (attribute-based) or ReBAC (relationship-based), and evaluate by attributes/relationships instead of roles.

### Appropriate Usage Scenarios

- **Internal systems**: Clear departments/job functions, low change frequency
- **Enterprise applications**: Hundreds to thousands of employees
- **Audit requirements**: Need clear traceability of who has which role

**Scenarios to avoid**:
- Dynamic context is required (time/location/device state)
- Multi-tenant or highly diverse organizational structures
- Project/team-based permissions change frequently

---

## ReBAC (Relationship-Based Access Control)

### Relationship Graph

**ReBAC represents relationships between principals and resources as a graph and makes decisions by traversing paths.**

#### Structure Example

```
[User: Alice] --owner--> [Document: doc1]
[User: Carol] --manager--> [User: Alice]
[User: Bob] --viewer--> [Document: doc1]
```

#### Decision Method

- **Rule**: `permit view when principal has "viewer" or "owner" relationship to resource`
- **Rule**: `permit all when principal is "manager" of "owner"`
- Carol accesses `doc1` → Traverse graph `Carol --manager--> Alice --owner--> doc1` → **Allow**

### Google Zanzibar

**Google Zanzibar is a representative ReBAC implementation**:

- **Tuple-based**: Stores relations as `<object>#<relation>@<subject>`
  - Example: `document:doc1#viewer@user:alice`
- **Schema definition**: Defines relations and permissions
  - `type document { relations { viewer, owner }, permissions { view := viewer or owner } }`
- **High-speed evaluation**: Supports millions of requests/second
- **Implementations**: [OpenFGA](https://openfga.dev), [Authzed](https://authzed.com), Google Docs/Drive

### Mechanism (Static Rules + Dynamic Graph)

**ReBAC policies are static (rarely changed), while graph data is dynamic (frequently changed)**:

| Element | Nature | Management method |
|-----|------|---------|
| **Static rules** | Change frequency: low | Manage/deploy as code |
| **Dynamic graph** | Change frequency: high | Update via UI operations/API calls |

**Example (document sharing system)**:

```
Static rules:
  permit view when principal has "viewer" or "owner" relation
  permit edit when principal has "editor" or "owner" relation
  permit all when principal is "manager" of "owner"

Dynamic graph:
  document:doc1#owner@user:alice
  document:doc1#viewer@user:bob
  user:alice#manager@user:carol
```

Alice shares a document with Bob → Add `document:doc1#viewer@user:bob` to graph → **No policy change needed**

### Strengths / Limitations Table

| Strengths | Limitations |
|------------------|-------------------|
| Naturally expresses human relationships and org structures | No native support for dynamic context (time/device state, etc.) |
| Easy delegation and sharing (direct UI operations) | Debugging is hard in large/complex graphs |
| No policy change needed (handle with graph updates) | Requires graph management and path-trace tooling |
| Best fit for multi-tenant/collaboration | Conditional access (time limits, etc.) needs external handling |

### Appropriate Usage Scenarios

- **Collaboration tools**: Google Docs, Slack, Notion
- **SaaS**: Project management, ticket systems, CRM
- **Delegation-centric systems**: Document sharing, workspace management
- **Organizational hierarchy**: Managers accessing subordinates’ resources

**Scenarios to avoid**:
- Dynamic context (time/location/device) is mandatory
- Simple access control with few relationships (ACL/RBAC is enough)

---

## ABAC (Attribute-Based Access Control)

### Attribute Evaluation Matrix

**ABAC makes decisions by evaluating principal, resource, and environment attributes.**

#### Example: Access to deployment system

| Scenario | clearance_level | device_managed | hour_of_day | on_call | Decision |
|---------|----------------|----------------|-------------|---------|------|
| Alice, 22:00, on-call | high | true | 22 | true | ✅ Allow |
| Alice, 22:00, off-call | high | true | 22 | false | ❌ Deny |
| Bob, 14:00, weekday | medium | true | 14 | false | ❌ Deny (insufficient clearance) |
| Carol, 14:00, weekday | high | true | 14 | false | ✅ Allow |
| Alice, 10:00, unmanaged device | high | false | 10 | false | ❌ Deny (device) |

#### Policy Example (Cedar)

```cedar
permit(
    principal in Employee::*,
    action == Action::"deploy",
    resource in System::"production"
)
when {
    context.device.managed == true &&
    (
        (context.time.hour >= 9 && context.time.hour < 17 && principal.clearance == "high")
        || (principal.on_call == true && principal.clearance == "high")
    )
};
```

### Strengths / Limitations Table

| Strengths | Limitations |
|------------------|-------------------|
| Fine-grained, supports dynamic context | Policies can become complex |
| Scalable (attribute combinations) | Attribute retrieval reliability/freshness is critical |
| Real-time decisions | Debugging is difficult (many attributes/conditions) |
| Compliance-friendly (auditable) | Performance optimization required (attribute fetch latency) |

### Appropriate Usage Scenarios

- **Financial systems**: Clearance levels, time restrictions, risk score evaluation
- **Medical records**: Patient consent, department, data classification level
- **Government agencies**: Security clearance, geographic restrictions, audit requirements
- **Enterprise**: Combination of department/title/project/time/device

**Scenarios to avoid**:
- Relationship/delegation is central (prefer ReBAC)
- Attributes are simple (prefer RBAC)
- Attribute retrieval infrastructure is not ready

---

## PBAC (Policy-Based Access Control)

### Hybrid Approach

**PBAC is a higher-level concept that integrates RBAC, ABAC, and ReBAC.** By externalizing policies and evaluating at runtime, it provides flexible and unified authorization.

#### Integration Example

| Model | Input data | Use in policy |
|-------|----------|---------------|
| **RBAC** | Roles (`principal in Group::"admin"`) | Referenced in scope or conditions |
| **ReBAC** | Relationships (`resource.owner.manager == principal`) | Relationship traversal in conditions |
| **ABAC** | Attributes (`context.device.managed`, `principal.clearance`) | Dynamic evaluation in conditions |

#### Policy Example (Composite)

```cedar
// Composite policy: role + relationship + attributes
permit(
    principal in Employee::*,       // Scope: all employees
    action == Action::"edit",
    resource in Document::*
)
when {
    (
        resource.owner.manager == principal    // ReBAC: manager relationship
        || principal in Group::"legal"         // RBAC: legal team
    )
    && context.device.managed == true          // ABAC: device trust
    && context.time.hour >= 9                  // ABAC: time restriction
};
```

### Policy as Code vs Policy as Data

| Approach | Format | Main use case | Management method |
|-----------|------|---------|---------|
| **Policy as Code** | Cedar, Rego, XACML | ABAC-centric, conditional logic | Version control + CI/CD |
| **Policy as Data** | Relationship graphs, tuples | ReBAC-centric, delegation | UI operations + graph updates |

**PBAC can combine both**:

```cedar
// Policy as Code: static rule
permit(
    principal,
    action == Action::"view",
    resource in Document::*
)
when {
    principal in resource.readers_team      // Policy as Data: dynamic membership
    && context.device.managed == true       // Policy as Code: static condition
};
```

### Appropriate Usage Scenarios

- **Multi-tenant SaaS**: Flexible per-tenant policy
- **Enterprise platforms**: Combination of department/project/compliance requirements
- **Complex requirements**: Need to account for time, location, relationships, and roles together

---

## Reference Architecture Mapping Across Models

**All models map to the PEP/PDP/PAP/PIP architecture**:

| Model | PEP | PDP | PAP | PIP |
|-------|-----|-----|-----|-----|
| **ACL** | In-app | ACL list lookup | ACL management UI | User directory |
| **RBAC** | App/Gateway | Role mapping evaluation | Role management UI | IdP (role retrieval) |
| **ReBAC** | App/Gateway | Graph traversal | UI (share button, etc.) | Relationship graph DB |
| **ABAC** | App/Gateway/Sidecar | Policy engine | Git/policy store | IdP/HR system/device MDM/time server |
| **PBAC** | All above | Cedar/OPA, etc. | Version control + UI | Integrated PIP (multiple sources) |

### Importance of PIP in ABAC

**In ABAC, PIP (Policy Information Point) is the most critical component**:

| Attribute category | Source examples |
|------------|---------|
| **Principal attributes** | IdP (department/title), HR system (clearance) |
| **Resource attributes** | Metadata store (classification/owner) |
| **Environment attributes** | Time server, MDM (device trust), IP geolocation |

**Attribute freshness and reliability directly determine decision quality.** Cache strategy and synchronization frequency are critical.

---

## Model Selection Flowchart

```
Is dynamic context (time/location/device) mandatory?
  ├─ Yes → ABAC (attribute-based)
  └─ No
      ├─ Is sharing/delegation/collaboration central?
      │   ├─ Yes → ReBAC (relationship-based)
      │   └─ No
      │       ├─ Are organizational roles clear?
      │       │   ├─ Yes → RBAC (role-based)
      │       │   └─ No → ACL (per-resource list)
      └─ Need combination of multiple requirements?
          └─ Yes → PBAC (integrated)
```

For detailed selection criteria, see “Authorization Model Selection Guide” in [SKILL.md](../SKILL.md).
