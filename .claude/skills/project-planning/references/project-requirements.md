# Project Requirements (PRD)

Expert in product requirements documentation. Produces comprehensive PRDs that define WHAT to build (not HOW — that's architecture's job).

## Document Template

```markdown
# Product Requirements Document: {Project Name}

| Attribute | Value |
|-----------|-------|
| **Project** | {Project Name} |
| **Version** | 1.0 |
| **Status** | Draft / Review / Approved |
| **Author** | {name} |
| **Date** | {YYYY-MM-DD} |
| **Tech Stack** | {language + framework + database} |

---

## Executive Summary

{2-3 paragraphs: What this product does, who it's for, and the key value proposition. Should be readable by non-technical stakeholders.}

---

## User Personas

### Persona 1: {Name} ({Role})
- **Background**: {context about this user}
- **Goals**: {what they want to accomplish}
- **Frustrations**: {current pain points}
- **Tech Comfort**: {Low / Medium / High}

### Persona 2: {Name} ({Role})
...

---

## Functional Requirements

### Module: {Module Name}

#### FR-{N}: {Requirement Title}
- **Priority**: Must Have / Should Have / Could Have / Won't Have
- **Persona**: {which persona(s)}
- **Description**: {what the system must do}
- **Acceptance Criteria**:
  - Given {precondition}, When {action}, Then {expected result}
  - Given {precondition}, When {action}, Then {expected result}
- **Notes**: {edge cases, clarifications}

#### FR-{N+1}: {Requirement Title}
...

### Module: {Module Name}
...

---

## Non-Functional Requirements

### Performance
| ID | Requirement | Target | Priority |
|----|------------|--------|----------|
| NFR-P1 | {requirement} | {metric} | Must Have |

### Security
| ID | Requirement | Standard | Priority |
|----|------------|----------|----------|
| NFR-S1 | {requirement} | {reference} | Must Have |

### Scalability
| ID | Requirement | Target | Priority |
|----|------------|--------|----------|
| NFR-SC1 | {requirement} | {metric} | Should Have |

### Reliability
| ID | Requirement | Target | Priority |
|----|------------|--------|----------|
| NFR-R1 | {requirement} | {metric} | Must Have |

### Accessibility
| ID | Requirement | Standard | Priority |
|----|------------|----------|----------|
| NFR-A1 | {requirement} | {WCAG level} | Should Have |

---

## User Flows

### Flow 1: {Flow Name}
```
{Step-by-step flow using simple numbered steps or ASCII diagram}
1. User navigates to {page}
2. System displays {content}
3. User clicks {action}
4. System {response}
   - If {condition}: {alternate path}
   - If {error}: {error handling}
5. User sees {result}
```

### Flow 2: {Flow Name}
...

---

## Data Model (Conceptual)

{High-level entities and relationships — NOT the database schema, just the domain model}

### Entities
| Entity | Description | Key Attributes |
|--------|------------|----------------|
| {name} | {what it represents} | {important fields} |

### Relationships
- {Entity A} has many {Entity B}
- {Entity C} belongs to {Entity D}

---

## API Surface (if applicable)

{High-level API groupings — NOT implementation details}

| Group | Purpose | Key Operations |
|-------|---------|----------------|
| {group} | {what it handles} | CRUD, search, export |

---

## Security Requirements

- **Authentication**: {method — SSO, OAuth, local, etc.}
- **Authorization**: {model — RBAC, ABAC, etc.}
- **Data Protection**: {encryption, PII handling}
- **Audit**: {what gets logged}
- **Compliance**: {standards — HIPAA, SOC2, GDPR, etc.}

---

## Assumptions & Dependencies

### Assumptions
- {Things assumed to be true}

### Dependencies
- {External systems, APIs, or teams this depends on}

---

## Success Criteria

| Criteria | Target | Measurement |
|----------|--------|-------------|
| {what} | {target} | {how measured} |

---

## Glossary

| Term | Definition |
|------|-----------|
| {term} | {definition} |

---

## Related Documents
- Project Brief: [_project-brief.md](_project-brief.md)
- UX Spec: [design/_project-design.md](design/_project-design.md)
- Architecture: [_project-architecture.md](_project-architecture.md)
```

## Required Sections Checklist

A PRD is COMPLETE when it has:
- [ ] Executive Summary (readable by non-technical stakeholders)
- [ ] At least 1 User Persona with goals and frustrations
- [ ] Functional Requirements with MoSCoW priority and acceptance criteria
- [ ] Non-Functional Requirements (at minimum: performance, security)
- [ ] At least 1 User Flow
- [ ] Data Model (conceptual entities and relationships)
- [ ] Security Requirements
- [ ] Assumptions & Dependencies
- [ ] Success Criteria

## Quality Criteria

### Good PRD
- Each FR has clear acceptance criteria (Given/When/Then)
- MoSCoW prioritization is used — not everything is "Must Have"
- NFRs have measurable targets ("page loads in <2s" not "fast")
- User flows cover happy path AND error paths
- Data model uses domain language, not database terms
- Security section is explicit about auth model

### Bad PRD
- Acceptance criteria are vague ("system works correctly")
- Everything is Must Have priority
- NFRs have no targets ("should be secure")
- Only happy-path flows, no error handling
- Mixes WHAT (requirements) with HOW (implementation)
- No personas — requirements float without user context

## Interview Questions

1. "What are the main modules or feature areas?"
2. For each module: "What must a user be able to do?" (extract FRs)
3. "Walk me through the most important user journey start to finish"
4. "What are the performance expectations? (concurrent users, response times)"
5. "What security/compliance requirements exist?"
6. "What systems does this need to integrate with?"
7. "What are the hard constraints vs nice-to-haves?"
8. "Is there an existing data model or database to work with?"

## Output Paths
- Reads from: `docs/_project-brief.md` (recommended)
- Produces: `docs/_project-requirements.md`
- Feeds into: `docs/_project-architecture.md`, `docs/_project-design.md`, `docs/todo/_backlog.md`
