---
name: project-planning
description: "Use when creating or updating any project planning document — brainstorm/research, project brief, or requirements/PRD. Covers: brainstorm, research, problem space, ideation, market analysis, validation, project brief, vision, strategic, PRD, requirements, functional requirements, non-functional, MoSCoW, user stories."
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [brainstorming, research, project-brief, prd, requirements, MoSCoW, user-stories, ideation, market-analysis, vision, strategic]
user-invocable: false
allowed-tools: Read Write Edit Grep Glob WebSearch WebFetch
---

# Project Planning

Consolidated methodology for the product planning pipeline — from problem space exploration through brainstorm/research, to project brief, to full product requirements document (PRD). Consolidates `project-analyst`, `project-brief-writer`, and `prd-writer`.

---

## Planning Pipeline Position

```
brainstorm / research   →   references/brainstorm-research.md
       ↓
project brief           →   references/project-brief.md
       ↓
PRD / requirements      →   references/project-requirements.md
       ↓
architecture / design / epics   →   standalone skills (see Navigation below)
```

---

## Cross-Cutting Rules

These rules apply across every document in the pipeline:

1. **Interview before generating.** Never fabricate user requirements, personas, or constraints. Use AskUserQuestion to gather what you don't know before writing any section.

2. **Every FR needs Given/When/Then acceptance criteria.** A functional requirement without a testable AC is not a requirement — it is a wish. Format: `Given {precondition}, When {action}, Then {expected result}`.

3. **MoSCoW must be mixed.** The target distribution is approximately Must Have ~40%, Should Have ~30%, Could Have ~20%, Won't Have ~10%. If everything is "Must Have", the prioritization is wrong — push back and force trade-offs.

---

## Navigation

| Task | Where |
|------|-------|
| Brainstorm / problem-space research | `references/brainstorm-research.md` |
| Project brief / vision | `references/project-brief.md` |
| PRD / requirements / MoSCoW / FR-NFR | `references/project-requirements.md` |
| Technical architecture / ADRs | standalone `architecture-writer` skill |
| UX design spec / wireframes / themes | standalone `ux-designer` skill |
| Epics / stories / backlog | standalone `epic-writer` skill |
| Project context for /prime | standalone `project-context` skill |
