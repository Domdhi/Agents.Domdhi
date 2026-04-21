---
description: Review code changes against architecture standards, security best practices, and project conventions
argument-hint: [file path, PR number, or git diff range]
---

# Code Review

Review code for quality, security, and architecture compliance. Uses the `code-reviewer` skill.

## Agent Delegation

> **Orchestration rule**: You (the main agent) handle scope detection and standards loading. The `code-reviewer` agent handles the actual review analysis. Do NOT perform the review inline — delegate via Task tool. You DO handle the final report output.

**Agent**: `code-reviewer` (via Task tool with `subagent_type: "code-reviewer"`)

## Variables

INPUT: $ARGUMENTS

**Flags:**
- `--deep` — Run a cross-model second opinion: dispatches two review agents in parallel (Sonnet primary + Opus secondary), then compares findings for higher-confidence results. Without this flag, only Sonnet reviews (default behavior).

## Workflow

### 1. Determine Scope (main agent)

**If INPUT is a file path:**
- Read the specific file(s)

**If INPUT is a PR number:**
- Run `gh pr diff {number}` to get the diff

**If INPUT is a git range (e.g., "HEAD~3"):**
- Run `git diff {range}` to get the diff

**If no INPUT:**
- Run `git diff` for unstaged changes
- If no unstaged changes, run `git diff HEAD~1` for last commit

### 2. Load Standards (main agent)

- Read `docs/_project-architecture.md` — Development Standards, API conventions, project structure
- Read `CLAUDE.md` — project-specific rules (if exists)
- Check relevant skills for domain patterns:
  - `.css`/`.html` with Tailwind → check `tailwind-css-patterns` skill
- Search memory system for established project patterns:
  ```bash
  # Search for patterns related to the changed files' domain
  node .claude/core/memory-manager.js search "{domain inferred from file extensions}"

  # Check for known constraints that might be violated
  node .claude/core/memory-manager.js list constraints

  # Check for relevant architecture decisions
  node .claude/core/memory-manager.js list decisions
  ```
  Memory patterns complement skill checklists: skills define general best practices, memories capture project-specific conventions discovered during implementation.

### 2b. Classify Risk Tiers (main agent)

Classify each changed file into a risk tier to determine review depth.

**If risk map exists** (check `code-reviewer` agent's `## Project Context > ### Risk Map`):
1. Read the risk map from `.claude/agents/code-reviewer.md`
2. For each changed file, match its path against risk map patterns
3. Assign the matching tier: HIGH, MEDIUM, or LOW

**If no risk map exists** (project hasn't run `/specialize`):
- Default all files to **MEDIUM** risk

**Build the risk classification table:**
```markdown
| File | Risk Tier | Review Depth | Source |
|------|-----------|-------------|--------|
| {path} | {HIGH/MEDIUM/LOW} | {Deep/Standard/Fast-Lane} | {risk map pattern or "default"} |
```

**Determine overall review depth** — use the highest tier in the changeset:
- Any HIGH file → overall Deep Review
- All MEDIUM → overall Standard Review
- All LOW → overall Fast-Lane Review

### 3. Delegate to Agent (main agent → code-reviewer)

Use the Task tool with `subagent_type: "code-reviewer"` to perform the review.

**If `--deep` flag is set:** Dispatch TWO review agents in parallel:
1. **Primary** — `subagent_type: "code-reviewer"`, `model: "sonnet"` (default)
2. **Secondary** — `subagent_type: "code-reviewer"`, `model: "opus"` (deep second opinion)

Both receive the same prompt. Results are compared in Step 4.

**If no `--deep` flag:** Dispatch single agent as normal (Sonnet only).

**Task prompt must include**:
1. The diff or file contents to review
2. Architecture standards and conventions from Step 2
3. Memory patterns and constraints relevant to the changed code
4. The risk classification table from Step 2b (per-file risk tiers and overall review depth)
5. The `code-reviewer` agent auto-loads the `code-reviewer` and `code-review-playbook` skills via frontmatter.
6. Instruction to use the playbook's routing: Deep Review checklist for HIGH files, Standard for MEDIUM, Fast-Lane for LOW
7. Instruction to evaluate: Correctness, Security, Performance, Architecture Compliance, Memory Pattern Compliance, Test Coverage
8. Instruction to classify findings by severity: CRITICAL > MAJOR > MINOR > NIT
9. Instruction to include the Risk Assessment section in the report (between Summary and Findings)

### 4. Persist Output (main agent)

Write the full review analysis to disk before reporting:

```bash
mkdir -p docs/.output/reviews
```

Write the complete review output (risk classification table + all agent findings) to:
`docs/.output/reviews/{YYYY-MM-DD}-code-review.md`

File format:
```markdown
# Code Review — {YYYY-MM-DD}

**Scope**: {files/PR/diff reviewed}
**Verdict**: {Approved / Approved with Comments / Changes Requested}

{full report content — risk table, findings, cross-model analysis if --deep}
```

### 5. Commit (main agent)

Stage and commit the review output file:

```
git add docs/.output/reviews/{YYYY-MM-DD}-code-review.md
git commit -m "docs: /review:code-review — {verdict}, {N} findings ({critical}C/{major}M/{minor}m)"
```

### 6. Report (main agent)

Read the agent's output and present the final report, including the output file path:

```markdown
## Code Review Complete

**Verdict**: {Approved / Approved with Comments / Changes Requested}
**Files**: {count} reviewed
**Output**: `docs/.output/reviews/{YYYY-MM-DD}-code-review.md`
**Overall Review Depth**: {Deep / Standard / Fast-Lane}
**Findings**: {critical} critical, {major} major, {minor} minor, {nit} nits

### Risk Assessment

| File | Risk Tier | Review Depth | Source |
|------|-----------|-------------|--------|
| {path} | {HIGH/MEDIUM/LOW} | {Deep/Standard/Fast-Lane} | {risk map pattern or "default"} |

{If Changes Requested: list the critical/major items that must be fixed}

### Cross-Model Analysis (--deep only)

**Models:** Sonnet (primary) + Opus (secondary)
**Agreement rate:** {N}%

| Finding | Sonnet | Opus | Confidence |
|---------|--------|------|------------|
| {description} | {severity or —} | {severity or —} | {Both agree: HIGH / One only: REVIEW} |

{Findings where both models agree → high confidence, fix these.}
{Findings where only one model flags → surface for human judgment with rationale from each.}
```
