# Architecture Patterns

This file explains the authorization reference architecture (PEP/PDP/PAP/PIP), deployment patterns, centralized vs distributed topologies, and governance.

---

## Authorization Reference Architecture Details

**The 4-component model proposed by XACML (PEP/PDP/PAP/PIP) is the modern standard for authorization systems.**

### Details of Each Component

#### 1. PEP (Policy Enforcement Point)

**Role**: Intercepts requests and enforces PDP decisions

| Placement | Implementation examples | Characteristics |
|---------|--------|------|
| **In-application** | Embedded in application code | Full context access, fine-grained control |
| **API Gateway** | Kong, AWS API Gateway, Envoy | Centralized management across services |
| **Sidecar** | Istio, Linkerd | Service mesh, zero trust |

#### 2. PDP (Policy Decision Point)

**Role**: Evaluates policies and returns decisions (Allow/Deny)

| Implementation style | Details |
|---------|------|
| **Centralized PDP** | Single PDP service, consistency-first |
| **Distributed PDP** | PDP in each service, low latency |
| **Authorization Client** | Bundle of PEP + PDP + entity cache |

#### 3. PAP (Policy Administration Point)

**Role**: Policy authoring, management, versioning, deployment

| Management form | Implementation examples |
|---------|--------|
| **Version control** | Git (policy-as-code) |
| **Dedicated store** | AWS Verified Permissions, dedicated PolicyDB |
| **UI** | Google Docs share button (ReBAC), admin console |

#### 4. PIP (Policy Information Point)

**Role**: Provides attribute and context data

| Attribute category | Source examples |
|------------|---------|
| **Principal attributes** | IdP (Okta, Auth0), HR systems |
| **Resource attributes** | Metadata stores, relationship graph DB |
| **Environment attributes** | Time servers, MDM (device trust), IP geolocation |

---

## PEP Deployment Patterns

### 1. Embedded (in-application)

**Implements PEP directly in application code.**

#### Implementation Example

```typescript
// TypeScript example
import { CedarPDP } from '@cedar/policy';

async function handleDocumentEdit(req: Request) {
    const decision = await CedarPDP.evaluate({
        principal: `Employee::"${req.userId}"`,
        action: "Action::\"doc:edit\"",
        resource: `Document::"${req.docId}"`,
        context: {
            device: { managed: req.headers['device-managed'] === 'true' },
            time: { hour: new Date().getHours() }
        }
    });

    if (decision === 'Deny') {
        return res.status(403).json({ error: 'Access Denied' });
    }

    // Execute business logic
}
```

#### Comparison Table

| Perspective | Evaluation | Details |
|-----|------|------|
| **Pros** | ✅ Full context access | Can directly reference internal app state (session/local variables) |
| | ✅ Fine-grained control | Permission checks at UI-element/field level |
| | ✅ Low latency | No network hop required |
| **Cons** | ❌ Duplicate implementations | Same PEP logic across multiple services |
| | ❌ Hard centralized management | Policy updates require redeploying all services |
| | ❌ Maintenance cost | Testing/versioning needed in each service |

#### Suitable Scenarios

- **High-security applications**: Financial payments, medical record access
- **Fine-grained control**: UI field-level, row-level security
- **Monolithic apps**: Single-service systems

### 2. API Gateway

**Intercepts requests at the API Gateway and queries PDP.**

#### Architecture Diagram (Conceptual)

```
[Client] → [API Gateway + PEP]
             ↓ (PDP query)
             ↓
          [Service A] [Service B] [Service C]
```

#### Comparison Table

| Perspective | Evaluation | Details |
|-----|------|------|
| **Pros** | ✅ Centralized management | Unified policy enforcement across all services |
| | ✅ Easy updates | Policy updates completed at gateway layer |
| | ✅ Aggregated logs | Audit all requests in one place |
| **Cons** | ❌ Coarse-grained control | API-level control (UI-element level is difficult) |
| | ❌ Context constraints | No access to internal app state |
| | ❌ Single point of failure | Gateway outage impacts all services |

#### Suitable Scenarios

- **Microservice APIs**: Unified policy across multiple services
- **SaaS API products**: Tenant-level rate limits and permission management
- **Zero-trust gateway**: Centralized protection for public APIs

### 3. Sidecar

**Deploys PEP as a sidecar container per service pod** (service mesh pattern).

#### Architecture Diagram (Conceptual)

```
[Pod: Service A]
  ├─ [App Container]
  └─ [Sidecar PEP] → PDP

[Pod: Service B]
  ├─ [App Container]
  └─ [Sidecar PEP] → PDP
```

#### Comparison Table

| Perspective | Evaluation | Details |
|-----|------|------|
| **Pros** | ✅ Service mesh integration | Integrates naturally with Istio/Linkerd |
| | ✅ No app code changes | No modifications to existing application code |
| | ✅ Service-to-service authorization | Zero trust between microservices |
| **Cons** | ❌ Operational complexity | Sidecar lifecycle/network policy management |
| | ❌ Cache freshness | Time lag in local cache |
| | ❌ Resource overhead | PEP process per pod |

#### Suitable Scenarios

- **Kubernetes environments**: Service mesh already adopted
- **Zero trust**: Authorize all service-to-service communication
- **Microservices**: Per-service policy application

---

## PEP Deployment Pattern Comparison (Unified)

| Pattern | Pros | Cons | Suitable scenarios |
|---------|------|------|---------|
| **Embedded** | Full context, fine-grained control | Duplicate implementation, hard central management | High-security apps, UI-element control |
| **API Gateway** | Central management, log aggregation | Coarse-grained control, context constraints | Microservice APIs, SaaS APIs |
| **Sidecar** | Mesh integration, no app changes | Operational complexity, resource overhead | Kubernetes, zero trust |

---

## Centralized vs Distributed PDP

### Centralized PDP

**A single PDP service handles all decisions.**

#### Architecture Diagram (Conceptual)

```
[PEP: App1] ↘
[PEP: App2] → [Centralized PDP] → [PAP: Policy Store]
[PEP: App3] ↗                    → [PIP: Attribute Store]
```

#### Characteristics

| Perspective | Details |
|-----|------|
| **Pros** | Consistency (same policy across all services), simple operations, log aggregation |
| **Cons** | Increased latency, single point of failure, scalability constraints |
| **Suitable scenarios** | Internal systems, consistency-first requirements, moderate traffic |

### Distributed PDP (Authorization Client)

**Deploys PDP + entity cache in each service.**

#### Architecture Diagram (Conceptual)

```
[Service A]
  └─ [Authorization Client]
       ├─ PEP
       ├─ PDP (local)
       └─ Entity Cache
           ↓ periodic sync
       [PAP] [PIP]

[Service B]
  └─ [Authorization Client]
       ├─ PEP
       ├─ PDP (local)
       └─ Entity Cache
           ↓ periodic sync
       [PAP] [PIP]
```

#### Characteristics

| Perspective | Details |
|-----|------|
| **Pros** | Low latency (local evaluation), high availability (PDP fault tolerance), scalability |
| **Cons** | Operational complexity (cache sync), consistency drift (temporary skew), resource overhead |
| **Suitable scenarios** | Globally distributed systems, low-latency requirements, high-availability requirements |

### Comparison Table (Centralized vs Distributed)

| Perspective | Centralized PDP | Distributed PDP |
|-----|----------|-----------|
| **Latency** | High (network hop) | Low (local evaluation) |
| **Consistency** | Strong consistency | Eventual consistency (cache delay) |
| **Availability** | Single-point-of-failure risk | High availability (service-level independence) |
| **Operational complexity** | Simple | Complex (cache synchronization) |
| **Scalability** | PDP vertical scaling | Horizontal scaling (by service count) |

---

## Architecture Selection Guide (Field Guide)

**Select the right pattern using the questions below** (confirmation via AskUserQuestion is recommended):

### 1. Selecting the Enforcement Point (PEP)

| Question | Options |
|-----|--------|
| **Where is the trust boundary?** | ・In app (Embedded)<br>・At edge (API Gateway)<br>・Between services (Sidecar) |
| **What granularity is required?** | ・UI-element level → Embedded<br>・API level → Gateway<br>・Service-to-service → Sidecar |
| **What infrastructure already exists?** | ・Kubernetes → Sidecar candidate<br>・Existing API Gateway → Gateway candidate |

### 2. Selecting the Decision Point (PDP)

| Question | Options |
|-----|--------|
| **Latency requirement?** | ・Sub-millisecond → Distributed<br>・Within 10ms → Centralized feasible |
| **Consistency vs availability?** | ・Consistency-first → Centralized<br>・Availability-first → Distributed |
| **Traffic scale?** | ・Up to a few thousand req/s → Centralized feasible<br>・Tens of thousands req/s+ → Distributed recommended |

### 3. Selecting Context Retrieval (PIP)

| Question | Response |
|-----|------|
| **Which attributes are needed?** | ・Identify IdP, HR systems, MDM, time servers, etc. |
| **Attribute freshness requirement?** | ・Real-time → fetch every request<br>・Cacheable → define TTL |
| **Attribute retrieval latency?** | ・High latency → caching required<br>・Low latency → real-time feasible |

### 4. Selecting Policy Management (PAP)

| Question | Response |
|-----|------|
| **Who manages policies?** | ・Developers → Git (Policy as Code)<br>・Users → UI (Policy as Data) |
| **Change frequency?** | ・Low frequency → Git + CI/CD<br>・High frequency → dedicated UI |
| **Audit requirements?** | ・Strict → version control required<br>・Standard → log recording |

---

## Policy Governance

### Lifecycle Management

**Manage policies through the following lifecycle:**

```
[Authoring] → [Validation] → [Distribution] → [Audit & Rollback]
```

#### 1. Authoring

| Owner | Format | Tools |
|-----|------|--------|
| Security team | Cedar/Rego | IDE, Git |
| App team | Templates | Dedicated UI |
| End users (ReBAC) | Share button | Application UI |

#### 2. Validation

| Validation item | Method |
|---------|------|
| **Schema conformance** | `cedar validate --schema` |
| **Static analysis** | `cedar analyze` (SMT) |
| **Unit tests** | `cedar test` |
| **Conflict detection** | permit vs forbid analysis |

#### 3. Distribution

| Method | Implementation examples |
|-----|--------|
| **Centralized PDP** | Immediate reflection from policy store |
| **Distributed PDP** | Push delivery or pull polling |
| **Cache TTL** | 5 minutes to 1 hour (depends on requirements) |

#### 4. Audit & Rollback

| Capability | Implementation |
|-----|------|
| **Version control** | Git history, Policy DB history |
| **Decision logs** | Record `policy_id` + decision reason |
| **Rollback** | Immediate restore to previous version |

---

## Multi-tenant Authorization

### 3-layer Policy Model

**In multi-tenant SaaS, policies are managed in three layers:**

```
[System Policy] ← Platform operations team
    ↓
[Application Policy] ← SaaS product team
    ↓
[Tenant Policy] ← Each tenant administrator
```

#### Layer Details

| Layer | Owner | Scope | Example |
|---------|-------|------|---|
| **System** | Platform operations | Global infrastructure | Allow backup jobs to read all-tenant metadata |
| **Application** | SaaS product team | Entire SaaS application | Only employees can perform cross-tenant support operations, managed device required |
| **Tenant** | Tenant administrator | In-tenant collaboration | Allow sharing only with users in same domain |

### Policy Evaluation Order

**Evaluate from outer to inner (System → Application → Tenant):**

```
1. System forbid → Immediate Deny
2. Application forbid → Immediate Deny
3. Tenant forbid → Immediate Deny
4. Any permit matched → Allow
5. No matches → Deny (implicit deny)
```

**Tenant policies cannot relax upper-layer constraints** (guarantees deny-by-default).

---

## Tenant Control via Policy Templates

### Template Example

**The SaaS provider offers approved templates:**

```cedar
// Template: external sharing control
permit(
    principal,
    action == Action::"doc:share",
    resource in Document::*
)
when {
    resource.owner.tenant == context.tenant_id
    && context.target_email_domain in ?allowed_domains
};
```

### Instantiation

**Tenant admins provide parameters:**

```json
{
    "template_id": "external-sharing",
    "parameters": {
        "allowed_domains": ["example.com", "partner.com"]
    }
}
```

**Generated policy:**

```cedar
permit(
    principal,
    action == Action::"doc:share",
    resource in Document::*
)
when {
    resource.owner.tenant == context.tenant_id
    && context.target_email_domain in ["example.com", "partner.com"]
};
```

### Template Benefits

| Perspective | Details |
|-----|------|
| **Safety** | Tenants cannot free-write logic (validated logic only) |
| **Consistency** | Same pattern applied across all tenants |
| **Flexibility** | Customizable via parameters |

---

## ADR (Architecture Decision Record) Template

**Record important architecture decisions:**

```markdown
# ADR-001: Selecting PEP Placement Pattern

## Status
Accepted

## Context
In a microservice architecture, we need to apply unified policies across 10+ services.
Latency requirement is within 10ms. An existing API Gateway is available.

## Decision
Place PEP at the API Gateway.

## Consequences
- ✅ Centralized management and log aggregation
- ✅ Leverages existing infrastructure
- ❌ Gateway single point of failure risk → mitigated via HA cluster
- ❌ No fine-grained control → combine Embedded PEP for services that need it
```

---

## Summary: Architecture Selection Checklist

- [ ] Decide PEP placement (Embedded/Gateway/Sidecar)
- [ ] Decide PDP style (Centralized/Distributed)
- [ ] Identify PIP sources (IdP/HR systems/MDM, etc.)
- [ ] Decide PAP form (Git/dedicated UI/ReBAC UI)
- [ ] Define policy lifecycle (Authoring→Validation→Distribution→Audit)
- [ ] Address multi-tenancy (3-layer policy model)
- [ ] Design templates (tenant customization scope)
- [ ] Create ADRs (record key decisions)

For detailed policy language selection, see [POLICY-LANGUAGES.md](POLICY-LANGUAGES.md). For Cedar implementation patterns, see [CEDAR-POLICIES.md](CEDAR-POLICIES.md).
