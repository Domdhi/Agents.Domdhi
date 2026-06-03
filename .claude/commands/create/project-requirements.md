---
description: Create a Product Requirements Document (PRD) with functional and non-functional requirements
argument-hint: [project name or project-brief path] [--yolo]
---

# Create PRD

Create a comprehensive Product Requirements Document. Produces `docs/_project-requirements.md`.

## Agent Delegation

> **Orchestration rule**: You (the main agent) handle upstream checks, mode detection, and user interviews. The `product-strategist` agent handles document generation. Do NOT write the PRD inline — delegate via Task tool.

**Agent**: `product-strategist` (via Task tool with `subagent_type: "product-strategist"`)

## Variables

INPUT: $ARGUMENTS

## Workflow

### 1. Check Upstream (main agent)

#### 1a. Check --yolo flag
If `$ARGUMENTS` contains `--yolo`, set YOLO_MODE = true. Strip `--yolo` from INPUT before continuing.

#### 1b. Hard Gate: Require at least one Phase 1 artifact
Check that at least ONE of these files exists AND does not contain `<!-- @@template -->` on its first line:
- `docs/_project-brief.md`
- `docs/_brainstorm.md`
- Any file matching `docs/app/*/research.md` or `docs/.output/research/**`

**If NONE of them are real (all missing or all template-only):**
- If YOLO_MODE → warn: "No Phase 1 artifacts found (brief, brainstorm, or research). Proceeding in yolo mode with Interview Mode." → go to Interview Mode
- Otherwise → **STOP**: "No Phase 1 artifacts found. Run `/create:project-brief`, `/brainstorm`, or `/research` first. Use `--yolo` to bypass this gate."

**If at least one is real** → read whichever exist for context and proceed to mode detection.

- **Optional**: Read `docs/todo/_feature-ideas.md` — if it has captured ideas from brainstorming, use them as input for functional requirements

### 2. Check for Existing Output (main agent)

- If `docs/_project-requirements.md` exists → ask: **update** (add/modify sections) or **replace** (start fresh)?

### 3. Detect Mode (main agent)

- If `_project-brief.md` exists with substantive content → **Context Mode**
- If no brief or user wants fresh start → **Interview Mode**
- For existing codebases → **Reverse-Engineering Mode** (read code to extract requirements)

### 4a. Interview Mode (main agent)

Use AskUserQuestion to gather requirements. Use the Interview Questions from the `project-planning` skill's `references/project-requirements.md` as the question bank — cover modules, user capabilities, performance, security, data model, and integrations. End with a MoSCoW prioritization round.

### 4b. Context Mode (main agent)

Synthesize a requirements brief from upstream docs:
- Extract personas from project brief's Target Users
- Extract feature areas from Key Features
- Extract constraints from Constraints section
- Extract success criteria from brief
- Gather feature ideas from `_feature-ideas.md` if available

### 5. Delegate to Agent

Use the Task tool with `subagent_type: "product-strategist"` to generate the PRD.

**Task prompt must include**:
1. Project name and what to produce (`docs/_project-requirements.md`)
2. Summary of upstream context (brief vision, personas, features, constraints)
3. User's answers from interview rounds (if any)
4. Feature ideas from `_feature-ideas.md` (if available)
5. Mode (Context/Interview/Reverse-Engineering)

The `product-strategist` agent auto-loads the `project-planning` skill via frontmatter — do NOT tell it to read the skill file.

### 6. Validate (main agent)

After the agent completes, read `docs/_project-requirements.md` and validate against the **Required Sections Checklist** in `.claude/skills/project-planning/references/project-requirements.md`. Also verify MoSCoW is used (not everything Must Have) and NFRs have measurable targets. If anything is missing, delegate back to the agent to fill it.

### 7. Commit (main agent)

Follow the **Post-Command Commit Convention** in CLAUDE.md. Stage all files created or modified by this command and commit with a descriptive message.

### 8. Report (main agent)

```markdown
## PRD Complete

**Output**: docs/_project-requirements.md
**Modules**: {count}
**Functional Requirements**: {count} ({must-have count} Must Have)
**Non-Functional Requirements**: {count}
**User Flows**: {count}

**Committed**: {hash} — `docs: /create:project-requirements — {summary}`
**Next step**: Run `/create:project-design` for UX design, or `/create:project-architecture` for technical architecture.
```
