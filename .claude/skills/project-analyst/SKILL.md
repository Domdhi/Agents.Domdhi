---
name: project-analyst
description: "Use WHEN facilitating a brainstorm, conducting problem space research, or validating assumptions before requirements are written. Triggers: brainstorm, research, problem space, market analysis, ideation"
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [brainstorming, research, analysis, ideation, market-research]
user-invocable: false
allowed-tools: Read, Write, Edit, Grep, Glob, WebSearch, WebFetch
---

# Project Analyst

Expert in problem space exploration, brainstorming facilitation, and research methodology. Knows how to guide structured ideation and validate assumptions.

## Brainstorming Report Template

```markdown
# Brainstorming Report: {Project Name}

**Date**: {YYYY-MM-DD}
**Participants**: {who contributed}
**Facilitator**: Claude (AI-assisted)

---

## Problem Space

### Problem Statement
{1-2 sentences describing the core problem}

### Who Suffers Most
{Primary affected users/stakeholders and the impact on them}

### Current Solutions & Their Gaps
| Current Solution | What Works | What Doesn't |
|-----------------|------------|--------------|
| {solution} | {pros} | {gaps} |

---

## Solution Ideas

### Idea 1: {Name}
- **Description**: {what it does}
- **Feasibility**: {Low/Medium/High} — {why}
- **Impact**: {Low/Medium/High} — {why}
- **Effort**: {S/M/L/XL}
- **Risks**: {key risks}

### Idea 2: {Name}
...

### Idea 3: {Name}
...

---

## Evaluation Matrix

| Idea | Feasibility | Impact | Effort | Risk | Score |
|------|------------|--------|--------|------|-------|
| {name} | H/M/L | H/M/L | S-XL | H/M/L | {1-10} |

---

## Recommended Direction
{Which idea(s) to pursue and why}

## Open Questions
- {Unanswered questions that need research}

## Next Steps
- {Concrete next actions}
```

## Research Findings Template

```markdown
# Research Findings: {Topic}

**Date**: {YYYY-MM-DD}
**Research Type**: {Market / Technical / Domain / Competitive}

---

## Executive Summary
{2-3 sentence summary of key findings}

## Research Questions
1. {Question being investigated}
2. {Question being investigated}

## Methodology
{How the research was conducted — web search, code analysis, documentation review, etc.}

## Findings

### Finding 1: {Title}
- **Evidence**: {What was found}
- **Confidence**: {High/Medium/Low}
- **Implication**: {What this means for the project}

### Finding 2: {Title}
...

## Recommendations
{What to do based on findings}

## Sources
- {Links or references}
```

## Quality Criteria

### Good Brainstorming Report
- Problem statement is specific, not vague ("users can't find documents quickly" not "the system is slow")
- At least 3 solution ideas explored
- Each idea has feasibility AND impact assessed
- Clear recommended direction with rationale
- Open questions are actionable, not rhetorical

### Good Research Findings
- Research questions are stated upfront
- Findings cite specific evidence
- Confidence levels are honest (not everything is "High")
- Recommendations connect directly to findings

## Interview Questions (for brainstorming)

Use these when facilitating a brainstorm session:

1. **Problem Discovery**
   - "What problem are you trying to solve?"
   - "Who experiences this problem most acutely?"
   - "What happens today when someone encounters this problem?"
   - "How big is this problem? (users affected, frequency, cost)"

2. **Solution Exploration**
   - "What solutions have been tried before?"
   - "What would the ideal solution look like?"
   - "What constraints exist? (budget, timeline, tech, regulatory)"
   - "What's the simplest version that would still be valuable?"

3. **Validation**
   - "How would you measure success?"
   - "What's the biggest risk?"
   - "Who needs to approve this?"
   - "What's the timeline pressure?"

## Cross-References
- Produces: feature-scoped output goes to `docs/app/{feature}/brainstorm.md` or `docs/app/{feature}/research.md`; project-wide output goes to `docs/.output/research/{date}-{slug}.md`
- Feeds into: `docs/_project-brief.md` (via `/create:project-brief`)
