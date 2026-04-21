---
name: architecture-writer
description: "Use WHEN creating or updating a system architecture document, designing tech stack, or writing ADRs. Triggers: architecture, system design, ADR, tech stack, infrastructure, deployment"
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [architecture, system-design, ADR, tech-stack, infrastructure]
user-invocable: false
allowed-tools: Read, Write, Edit, Grep, Glob
---

# Architecture Writer

Expert in technical architecture documentation. Produces architecture documents with ADRs (Architecture Decision Records), component diagrams (ASCII), and explicit tech stack rationale.

## Document Template

```markdown
# Architecture: {Project Name}

| Attribute | Value |
|-----------|-------|
| **Version** | 1.0 |
| **Status** | Draft / Review / Approved |
| **Author** | {name} |
| **Date** | {YYYY-MM-DD} |
| **Source** | Based on PRD v{X} |

---

## System Overview

{2-3 paragraphs describing the system at a high level. What it does, who uses it, how it fits into the broader ecosystem.}

### Architecture Style
{Monolith / Microservices / Modular Monolith / Serverless / Hybrid}

### Key Quality Attributes
| Attribute | Priority | Target |
|-----------|----------|--------|
| Performance | {H/M/L} | {specific metric} |
| Scalability | {H/M/L} | {specific metric} |
| Security | {H/M/L} | {standard} |
| Availability | {H/M/L} | {SLA %} |
| Maintainability | {H/M/L} | {metric} |

---

## Tech Stack

### Backend
| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Framework | {name} | {ver} | {why chosen} |
| Language | {name} | {ver} | {why chosen} |
| ORM/Data | {name} | {ver} | {why chosen} |
| Real-time | {name} | {ver} | {why chosen} |
| Background Jobs | {name} | {ver} | {why chosen} |
| Logging | {name} | {ver} | {why chosen} |

### Frontend
| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Framework | {name} | {ver} | {why chosen} |
| Language | {name} | {ver} | {why chosen} |
| UI Library | {name} | {ver} | {why chosen} |
| Styling | {name} | {ver} | {why chosen} |
| State | {name} | {ver} | {why chosen} |

### Database
| Role | Technology | Version | Rationale |
|------|-----------|---------|-----------|
| Primary | {name} | {ver} | {why chosen} |
| Cache | {name} | {ver} | {why chosen} |
| Search | {name} | {ver} | {why chosen} |

### Infrastructure
| Service | Technology | Rationale |
|---------|-----------|-----------|
| Hosting | {name} | {why chosen} |
| CI/CD | {name} | {why chosen} |
| Monitoring | {name} | {why chosen} |

---

## Architecture Diagram

```
{ASCII diagram showing major components and their relationships}
```

---

## Component Architecture

### {Component Name}
- **Responsibility**: {what it does}
- **Technology**: {framework/library}
- **Dependencies**: {what it depends on}
- **API Surface**: {how other components interact with it}

### {Component Name}
...

---

## Data Architecture

### Entity-Relationship Overview
```
{ASCII ER diagram or description}
```

### Key Entities
| Entity | Storage | Access Pattern | Volume |
|--------|---------|---------------|--------|
| {name} | {table/collection} | {read-heavy/write-heavy/balanced} | {estimated rows} |

### Data Flow
```
{ASCII data flow diagram}
```

---

## API Design

### API Style
{REST / GraphQL / gRPC / Hybrid}

### Endpoint Groups
| Group | Base Path | Auth Required | Description |
|-------|-----------|---------------|-------------|
| {name} | /api/{group} | {Yes/No} | {purpose} |

### API Conventions
- Versioning: {strategy}
- Pagination: {approach}
- Error format: {structure}
- Rate limiting: {policy}

---

## Authentication & Authorization

### Authentication
- **Provider**: {method — AD, Azure AD, OAuth, JWT, etc.}
- **Flow**: {authorization code, client credentials, etc.}
- **Token**: {JWT, cookie, session, etc.}
- **Lifetime**: {duration, refresh strategy}

### Authorization
- **Model**: {RBAC / ABAC / Claims-based}
- **Roles**: {list of roles}
- **Policies**: {key policies}

---

## Infrastructure & Deployment

### Deployment Architecture
```
{ASCII deployment diagram — servers, load balancers, databases}
```

### Environments
| Environment | Purpose | URL | Notes |
|------------|---------|-----|-------|
| Development | Local dev | localhost | {notes} |
| Staging | Pre-prod testing | {url} | {notes} |
| Production | Live | {url} | {notes} |

### CI/CD Pipeline
```
{Build → Test → Stage → Deploy flow}
```

---

## Architecture Decision Records (ADRs)

### ADR-001: {Decision Title}
- **Status**: Accepted / Superseded / Deprecated
- **Date**: {YYYY-MM-DD}
- **Context**: {Why this decision was needed}
- **Decision**: {What was decided}
- **Alternatives Considered**:
  - {Option A}: {pros/cons}
  - {Option B}: {pros/cons}
- **Consequences**: {What this means going forward}

### ADR-002: {Decision Title}
...

---

## Cross-Cutting Concerns

### Logging
- **Framework**: {name}
- **Levels**: {Debug, Info, Warning, Error, Critical}
- **Structured**: {Yes/No}
- **Destination**: {file, database, service}

### Error Handling
- **Strategy**: {global handler, middleware, result pattern}
- **User-facing**: {how errors are presented}
- **Internal**: {how errors are logged and alerted}

### Caching
- **L1**: {in-memory — strategy, TTL}
- **L2**: {distributed — strategy, TTL}
- **Invalidation**: {approach}

### Configuration
- **Source**: {appsettings, environment vars, config service}
- **Secrets**: {vault, user-secrets, env vars}
- **Feature Flags**: {service or config-based}

---

## Development Standards

### Project Structure
```
{Directory tree showing the canonical project layout}
```

### Coding Conventions
- {Key conventions specific to this project}

### Testing Strategy
| Level | Framework | Coverage Target | What's Tested |
|-------|-----------|-----------------|---------------|
| Unit | {name} | {%} | {scope} |
| Integration | {name} | {%} | {scope} |
| E2E | {name} | {%} | {scope} |

---

## Related Documents
- PRD: [_project-requirements.md](_project-requirements.md)
- UX Spec: [design/_project-design.md](design/_project-design.md)
- Epics: [todo/_backlog.md](todo/_backlog.md)
```

## Required Sections Checklist

An architecture doc is COMPLETE when it has:
- [ ] System Overview with architecture style
- [ ] Tech Stack with rationale for every choice
- [ ] Architecture Diagram (ASCII)
- [ ] Component Architecture (at least 3 components)
- [ ] Data Architecture (entities + access patterns)
- [ ] API Design (style + endpoint groups)
- [ ] Authentication & Authorization
- [ ] Infrastructure & Deployment
- [ ] At least 1 ADR
- [ ] Cross-Cutting Concerns (logging, error handling, caching)
- [ ] Development Standards (project structure, testing strategy)

## Quality Criteria

### Good Architecture Doc
- Every tech choice has a "Rationale" column (not just "we like it")
- ADRs capture alternatives considered, not just the winner
- Diagrams use ASCII (no external tools required)
- Performance targets are measurable
- Security model is explicit
- Project structure is canonical (not "figure it out")

### Bad Architecture Doc
- Tech stack listed with no rationale
- No ADRs (decisions are invisible)
- Only happy-path architecture (no error handling, no monitoring)
- No deployment strategy
- Missing testing strategy

## Interview Questions

1. "What's the deployment target? (cloud, on-prem, hybrid)"
2. "What's the team's primary expertise? (affects tech choices)"
3. "Any existing infrastructure or services to integrate with?"
4. "What's the expected scale? (users, data volume, request rate)"
5. "Any regulatory constraints that affect architecture?"
6. "Monolith or microservices? Any strong preference?"
7. "What's the auth story? (existing SSO, build new, etc.)"
8. "What databases are acceptable? (constraints from IT/ops)"

## Cross-References
- Reads from: `docs/_project-requirements.md` (required), `docs/_project-design.md` (optional)
- Produces: `docs/_project-architecture.md`
- Feeds into: `docs/todo/_backlog.md` (via `/create:project-epics`)
