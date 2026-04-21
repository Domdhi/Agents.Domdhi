---
description: Break requirements into epics and stories for implementation
argument-hint: [project name or architecture path] [--yolo]
---

# Create Epics

Break product requirements into implementable epics and stories. Produces `docs/todo/_backlog.md`.

## Agent Delegation

> **Orchestration rule**: You (the main agent) handle upstream checks and requirement analysis. The `project-planner` agent handles epic/story breakdown. Do NOT write the epics document inline — delegate via Task tool.

**Agent**: `project-planner` (via Task tool with `subagent_type: "project-planner"`)

## Variables

INPUT: $ARGUMENTS

## Workflow

### 1. Check Upstream (main agent)

#### 1a. Check --yolo flag
If `$ARGUMENTS` contains `--yolo`, set YOLO_MODE = true. Strip `--yolo` from INPUT before continuing.

#### 1b. Hard Gate: Require real PRD AND Architecture
Read the first line of each file. Check that both exist AND neither contains `<!-- @@template -->`.

- `docs/_project-requirements.md` — source of functional requirements
- `docs/_project-architecture.md` — source of technical structure

**If either is missing or template-only:**
- If YOLO_MODE → warn: "{missing file(s)} not found. Proceeding in yolo mode." → continue with whatever context is available
- Otherwise → **STOP**: "`{missing file}` has not been created yet. Run `/{command}` first. Use `--yolo` to bypass this gate."
  - If `_project-requirements.md` missing → suggest `/create:project-requirements`
  - If `_project-architecture.md` missing → suggest `/create:project-architecture`

- **Optional**: Read `docs/_project-design.md` for UI-specific stories (only if real, not template)

### 2. Check for Existing Output (main agent)

- If `docs/todo/_backlog.md` exists → ask: **update** (add new epics) or **replace**?
- If replacing, confirm with user (this is destructive if implementation is in progress)

### 3. Analyze Requirements (main agent)

Synthesize a planning brief from upstream docs:
1. List all Functional Requirements from PRD (by module)
2. List architecture component boundaries
3. Map FRs to architecture components
4. Identify cross-cutting concerns that need their own stories
5. Note any UI-specific requirements from UX spec

### 4. Delegate to Agent

Use the Task tool with `subagent_type: "project-planner"` to generate epics and stories.

**Task prompt must include**:
1. What to produce (`docs/todo/_backlog.md`)
2. Full list of FRs with their MoSCoW priorities and acceptance criteria
3. Architecture component list and boundaries
4. FR-to-component mapping
5. Cross-cutting concerns identified
6. Phase structure guidance:
   - Phase 0: Foundation & Configuration (ALWAYS first)
   - Phase 1: Data & Core
   - Phase 2: Auth (can merge with Phase 1 if simple)
   - Phase 3+: Feature phases ordered by dependency and Must Have priority
   - Final Phase: Polish & Launch

The `project-planner` agent auto-loads the `epic-writer` skill via frontmatter — do NOT tell it to read the skill file.

### 5. Validate (main agent)

After the agent completes, verify the output:
- Every FR from PRD maps to at least one story?
- No circular dependencies?
- Phase 0 is foundation?
- No XL stories without a split recommendation?
- Must-Have FRs are in early phases?
- Stories have acceptance criteria and size estimates?
- If issues found, delegate back to the agent to fix

### 6. Commit (main agent)

Follow the **Post-Command Commit Convention** in CLAUDE.md. Stage all files created or modified by this command and commit with a descriptive message.

### 7. Report (main agent)

```markdown
## Epics Complete

**Output**: docs/todo/_backlog.md
**Phases**: {count}
**Epics**: {count}
**Stories**: {count} ({S count} S, {M count} M, {L count} L, {XL count} XL)
**Must-Have coverage**: All {count} Must-Have FRs mapped to stories

**Committed**: {hash} — `docs: /create:project-epics — {summary}`
**Next step**: Run `/review:optimize-backlog` for dependency graph analysis and parallel workstreams, then `/review:check-readiness` to validate implementation readiness.
```
