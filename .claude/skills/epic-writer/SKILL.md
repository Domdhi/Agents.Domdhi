---
name: epic-writer
description: "Use WHEN breaking requirements into epics and stories, structuring a backlog, or writing acceptance criteria for implementation work. Triggers: epic, story, backlog, sprint, user story, acceptance criteria"
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [epics, stories, backlog, planning, estimation, dependencies]
user-invocable: false
allowed-tools: Read Write Edit Grep Glob
---

# Epic Writer

Expert in breaking requirements into implementable work. Creates epics (logical feature groupings) and stories (single-session implementable units) with proper dependency ordering.

## Epic Document Template

The epic document follows the existing `/todo` checklist format for compatibility with `/do` and `/organize`.

```markdown
# Product Backlog: {Project Name}

| Attribute | Value |
|-----------|-------|
| **Project** | {Project Name} |
| **Version** | 1.0 |
| **Status** | Specification Complete / In Progress |
| **Author** | {name} |
| **Tech Stack** | {from _project-architecture.md} |

---

## Executive Summary

{Brief overview of the full product scope and how work is organized into phases/epics}

---

## Technology Stack

{Copied from _project-architecture.md for quick reference}

---

## Phase {N}: {Phase Name} (Sprint {X}-{Y})

**Goal:** {What this phase achieves}

---

### Epic {N}: {Epic Name}

**Objective:** {What this epic delivers}

* **Story {N}.1 ({Domain}): {Story Title}**
  * **As a** {persona},
  * **I want** {capability},
  * **So that** {benefit}.
  * **AC:**
    * {Acceptance criterion 1}
    * {Acceptance criterion 2}
    * {Acceptance criterion 3}
  * **Estimate:** {S/M/L/XL}
  * **Dependencies:** {Story X.Y, or "None"}
  * **Files:**
    * `path/to/file1.ext` — new | modify | delete
    * `path/to/file2.ext` — new | modify | delete

* **Story {N}.2 ({Domain}): {Story Title}**
  ...

---
```

## Story Index Template

```markdown
# Story Index: {Project Name}

Quick reference for all stories across epics.

| Story | Title | Phase | Epic | Estimate | Status | Dependencies |
|-------|-------|-------|------|----------|--------|-------------|
| 0.1 | {title} | 0 | Template Init | S | [ ] | None |
| 0.2 | {title} | 0 | Template Init | M | [ ] | 0.1 |
| 1.1 | {title} | 1 | {epic name} | L | [ ] | 0.2 |
| ... | ... | ... | ... | ... | ... | ... |
```

## Breakdown Rules

### Epic Sizing
- An epic represents a **coherent feature area** (e.g., "Authentication", "Dashboard", "User Management")
- An epic should have 3-8 stories
- If an epic has >8 stories, split it into sub-epics

### Story Sizing
- A story should be completable in **one coding session** (1-4 hours)
- If a story requires touching more than 5 files, consider splitting
- Each story must be independently testable

### Estimation Guide
| Size | Effort | Files Changed | Complexity |
|------|--------|---------------|------------|
| S | < 1 hour | 1-2 files | Configuration, simple CRUD |
| M | 1-2 hours | 2-4 files | New component, service + tests |
| L | 2-4 hours | 4-6 files | Feature with multiple pieces |
| XL | 4+ hours | 6+ files | Complex feature, should consider splitting |

### Domain Tags
Use domain tags to help `/do` select the right implementation agent:
- `(Backend)` — API, services, data access
- `(Frontend)` — Components, pages, styling
- `(DevOps)` — Build, deploy, infrastructure
- `(Database)` — Schema, migrations, queries
- `(Auth)` — Authentication, authorization
- `(Test)` — Test creation, test infrastructure
- `(Config)` — Configuration, settings, feature flags
- `(Docs)` — Documentation, API docs

### Dependency Ordering
- Stories within an epic should be ordered by dependency
- Cross-epic dependencies should be explicitly called out
- Phase ordering: Foundation → Data → Backend → Frontend → Integration → Polish

### Acceptance Criteria Patterns

**Good AC:**
- "Script generates `appsettings.Production.json` from template"
- "Login page redirects to dashboard after successful auth"
- "API returns 403 when user lacks required role"
- "Dashboard loads in under 2 seconds with 1000 records"

**Bad AC:**
- "Works correctly"
- "User can do stuff"
- "System is fast"

## Quality Criteria

### Good Epic Breakdown
- Clear phase ordering (foundation → features → polish)
- Stories have dependencies explicitly noted
- Every story has acceptance criteria (not just a title)
- Estimates are present and realistic
- Domain tags help route to correct implementation agent
- First phase is always foundation/infrastructure
- Each story lists the files it touches in a `**Files:**` block — `epic-overlap.js` parses these to flag epics that claim the same file, which would cause silent merge conflicts when `/run-todo` dispatches them in parallel waves

### Bad Epic Breakdown
- No dependency ordering (stories can't be built in sequence)
- Missing acceptance criteria
- Stories are too large (XL without split recommendation)
- No domain tags
- Phase 1 jumps straight to features without foundation

## Cross-References
- Reads from: `docs/_project-architecture.md` (required), `docs/_project-requirements.md` (required)
- Produces: `docs/todo/_backlog.md`
- Feeds into: `/do`, `/run-todo` (for implementation)
