# Project Brief

Expert in capturing strategic product vision. Produces concise briefs that inform PRDs and architecture documents downstream.

## Document Template

```markdown
# Project Brief: {Project Name}

| Attribute | Value |
|-----------|-------|
| **Author** | {name} |
| **Date** | {YYYY-MM-DD} |
| **Status** | Draft / Review / Approved |
| **Version** | 1.0 |

---

## Vision

{1-2 sentences: What is this product and why does it matter?}

## Problem Statement

### The Problem
{What problem exists today? Be specific about who is affected and how.}

### Current State
{How are people solving this today? What are the pain points with current solutions?}

### Desired State
{What does the world look like after this product exists?}

---

## Target Users

### Primary Persona: {Name/Role}
- **Who**: {description}
- **Goal**: {what they need to accomplish}
- **Pain**: {current frustration}
- **Frequency**: {how often they encounter this}

### Secondary Persona: {Name/Role}
- **Who**: {description}
- **Goal**: {what they need}

---

## Key Features (High Level)

| # | Feature | Priority | Description |
|---|---------|----------|-------------|
| 1 | {name} | Must Have | {brief description} |
| 2 | {name} | Must Have | {brief description} |
| 3 | {name} | Should Have | {brief description} |
| 4 | {name} | Nice to Have | {brief description} |

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| {metric} | {target value} | {measurement method} |

---

## Constraints

- **Timeline**: {deadline or timeframe}
- **Budget**: {financial constraints}
- **Technical**: {platform, language, infrastructure constraints}
- **Regulatory**: {compliance requirements}
- **Team**: {who's building this, skill constraints}

---

## Out of Scope

{Explicitly list what this product will NOT do in v1}

- {item}
- {item}

---

## Open Questions

- {Questions that need answers before proceeding}

---

## Appendix

### Competitive Landscape
{Brief notes on alternatives/competitors if relevant}

### Related Documents
- Brainstorming: link to `docs/app/{feature}/brainstorm.md` or `docs/.output/research/{date}-{slug}.md` (if exists)
- Research: link to `docs/app/{feature}/research.md` or `docs/.output/research/{date}-{slug}.md` (if exists)
```

## Required Sections Checklist

A project brief is COMPLETE when it has:
- [ ] Vision (1-2 sentences, clear value proposition)
- [ ] Problem Statement (specific, measurable pain)
- [ ] At least 1 Target User persona
- [ ] Key Features with priorities (Must/Should/Nice)
- [ ] Success Metrics (at least 2)
- [ ] Constraints listed
- [ ] Out of Scope defined
- [ ] Open Questions (even if empty — acknowledge there are none)

## Quality Criteria

### Good Brief
- Vision fits in a tweet (concise, compelling)
- Problem is specific: "HR managers spend 3 hours/week on manual reports" not "reporting is hard"
- Features map directly to user pain points
- Out of scope is explicit (prevents scope creep)
- Constraints are realistic, not aspirational

### Bad Brief
- Vision is generic: "improve the user experience"
- No personas defined
- Features are solutions, not outcomes
- No success metrics
- Missing constraints (everything is possible!)

## Interview Questions

1. "In one sentence, what are you building?"
2. "Who is the primary user, and what's their biggest frustration today?"
3. "If this succeeds, what changes? How would you measure it?"
4. "What are the 3-5 must-have features for v1?"
5. "What is explicitly NOT in scope?"
6. "What constraints do you have? (timeline, tech, budget, team)"
7. "Are there any regulatory or compliance requirements?"

## Output Paths
- Reads from: brainstorm/research docs if available — feature-scoped: `docs/app/{feature}/brainstorm.md`; general: `docs/.output/research/{date}-{slug}.md`
- Produces: `docs/_project-brief.md`
- Feeds into: `docs/_project-requirements.md` (via `/create:project-requirements`)
