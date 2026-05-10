---
description: Create a structured, execution-ready TODO checklist with acceptance criteria, file lists, research, dependency optimization, and wave parallelism
argument-hint: [task description, file path, or module name]
---

# /todo — Create Execution-Ready TODO

Create a TODO checklist that `/run-todo` can execute without additional research. Every story has acceptance criteria, file lists, estimates, and research notes. Dependencies are optimized, waves are pre-computed.

Main Agent does all planning and assembly. Research agents (Sonnet) scan the codebase. The output is a contract — `/run-todo` trusts it completely.

## Variables

INPUT: $ARGUMENTS

---

## Phase 1: Context Gathering (Main Agent — direct reads, no agents)

### 1. Determine Input Type

```
IF INPUT is a file path → read it as source material
IF INPUT is a module name → find docs/app/{name}/_brief.md, read it
IF INPUT is a task description → use as the brief
IF INPUT is empty → infer from:
  1. Current conversation context
  2. docs/__handoff.md next actions
  3. Recent git log (what was just completed → what's next)
  4. Ask user only as last resort
```

### 2. Gather Project Context

Read in parallel:
- `docs/_project-architecture.md` — architecture boundaries, schemas, ADRs
- Module docs: `docs/app/{module}/_brief.md` (if module-scoped)

---

## Phase 2: Research (Sonnet agents — scaled to complexity)

**CRITICAL: All research agents MUST persist their output to files.** Agent results evaporate when context compresses — persisted files are the permanent record.

### Estimate Story Count First

Skim the input. Count distinct changes needed. This determines agent count:

| TODO Size | Stories | Research Agents | Review |
|-----------|---------|-----------------|--------|
| **Small** | 1-4 | 0 (Main Agent reads inline) | None |
| **Medium** | 5-7 | 1 Sonnet (Codebase + Deps) | Optional |
| **Large** | 8+ | 2 Sonnet (parallel) | 1 Sonnet |

### Research Output Location

```
docs/.output/work/YYYY-MM-DD/{slug}/
  HHMM-research-codebase.md    ← Agent 1 (medium + large)
  HHMM-research-patterns.md    ← Agent 2 (large only)
```

### Agent 1: Codebase + Dependencies (Medium and Large)

**Use `general-purpose` (NOT `Explore`) — Explore is read-only and cannot write its findings to disk, which means output evaporates on context compaction.**

```
Agent(
  subagent_type: "general-purpose",
  model: "sonnet",
  prompt: """
  Research the codebase for: {INPUT}

  ## Codebase Scan
  1. Find all files that will need modification — exact paths
  2. Find existing implementations to use as patterns
  3. Find test files for affected components
  4. Check for guard tests that may break

  ## Dependency Analysis
  5. Map every file each proposed change would touch
  6. Identify overlaps — which files appear in multiple changes?
  7. Build dependency graph — which changes must complete before others?
  8. **Hotspot detection:** identify any file that would be touched by 3+ stories. If ALL stories share a single hotspot file, flag the TODO as single-hotspot — Main Agent will apply the collapse shape in Phase 3.
  9. Compute candidate wave groupings under both shapes: (a) file-overlap partitioning (zero overlap per wave) and (b) functional grouping for single-hotspot collapse. Leave the final shape decision to Main Agent.

  Write findings to: docs/.output/work/{YYYY-MM-DD}/{slug}/{HHMM}-research-codebase.md
  """,
  description: "Research codebase for {slug}"
)
```

### Agent 2: Pattern + Convention Scanner (Large only — 8+ stories)

**Use `general-purpose` (NOT `Explore`) — same reason as Agent 1.**

```
Agent(
  subagent_type: "general-purpose",
  model: "sonnet",
  prompt: """
  Research patterns and conventions for: {INPUT}

  1. How are similar features implemented in this codebase?
  2. What shared components, services, or utilities exist?
  3. What naming conventions, file organization patterns apply?
  4. What test patterns are used (framework, structure, naming)?

  Write findings to: docs/.output/work/{YYYY-MM-DD}/{slug}/{HHMM}-research-patterns.md
  """,
  description: "Research patterns for {slug}"
)
```

---

## Phase 3: Assembly (Main Agent — direct authorship, not delegated)

Main Agent writes the TODO directly. Do NOT delegate assembly to a subagent — Main Agent has the full context from Phase 1 + Phase 2 research files.

### Template (ENFORCED — all sections required)

```markdown
# TODO: {Title}

| Attribute | Value |
|-----------|-------|
| **Status** | Specification Complete |
| **Author** | {user} |
| **Created** | {YYYY-MM-DD} |

---

## Executive Summary

{2-3 sentences: what this TODO accomplishes and why}

---

## Dependency Graph

{ASCII art showing story dependencies and wave groupings}

---

## Phase N: {Phase Name}

**Goal:** {One sentence}

---

### Epic {PREFIX}-N: {Epic Name}

**Objective:** {One sentence}

---

* **Story {PREFIX}-N.N ({Size}): {Story Title}**
  * **As a** {role}, **I want** {action}, **So that** {benefit}.
  * **AC:**
    * [ ] {Specific, testable acceptance criterion}
    * [ ] {Another specific criterion}
  * **Estimate:** {XS|S|M|L}
  * **Dependencies:** {None | Story X.X}
  * **Files:**
    * `{exact/path/to/file}` — {what changes}
  * **Research notes:** {What currently exists, what's missing, gotchas}

---

## Story Index

| Story | Title | Size | Wave | Status | Dependencies |
|-------|-------|------|------|--------|--------------|
| {PREFIX}-N.N | {title} | {XS/S/M/L} | {wave #} | [ ] | {deps} |

**Total: N stories. Estimated: ~N hours.**

---

## Wave Plan

**Shape:** {role-based | single-hotspot collapsed | file-overlap partitioned} — {one-sentence justification. If single-hotspot collapsed, also include: "Collapsed N original stories into M bundled stories by functional grouping."}

### Wave 1 — {Tests | functional bundle name | independent stories}
| Story | Agent Type | Files Owned | Needs QA? |
|-------|-----------|-------------|-----------|
| {ID} | general-purpose | {files} | Yes/No |

### Wave 2 — {Code | next bundle | next independent group} (depends on Wave 1)
| Story | Agent Type | Files Owned | Needs QA? |
|-------|-----------|-------------|-----------|
| {ID} | general-purpose | {files} | Yes/No |

### Wave 3 — {Verify | final bundle | ...} (depends on Wave 2)
| Story | Agent Type | Files Owned | Needs QA? |
|-------|-----------|-------------|-----------|
| {ID} | general-purpose | {files} | Yes/No |

### Shared Hotspot Files
- **{file}** — touched by stories {X, Y}. In file-overlap shape: must be in different waves. In single-hotspot shape: expected (this is the hotspot that drove collapse).

---

## Key Findings from Research

1. **{Finding}** — {detail with file paths}
2. **{Finding}** — {detail}
```

### Template Rules (NON-NEGOTIABLE)

1. **Every story has AC bullets with checkboxes** — specific, testable, used as gates by `/do` and `/run-todo`
2. **Every story has a Files section** — exact paths from codebase research, not guesses
3. **Every story has Research notes** — what exists now, patterns to follow, gotchas
4. **Every story has an Estimate** — XS (< 30 min), S (30-60 min), M (1-2 hr), L (2-4 hr)
5. **Story Index with wave column** — `/run-todo` reads this to know execution order
6. **Wave Plan with file ownership, QA flag, and Shape line** — `/run-todo` reads this directly. Shape line is required (see Wave Shape Decision below).
7. **File overlap constraint depends on the Shape** — in `file-overlap partitioned` shape, zero overlap per wave is mandatory. In `single-hotspot collapsed` shape, the hotspot file appears across waves *by design*. In `role-based` shape, overlap is allowed at the role-wave level but stories within a role-wave have zero overlap when dispatched in parallel.
8. **Dependency Graph** — ASCII art showing what blocks what
9. **No code blocks** — file paths and descriptions only. Implementation is the dev agent's job
10. **AC bullets are NEVER stripped or summarized** — they flow verbatim into `/do` and `/run-todo`

---

### Wave Shape Decision (Main Agent — apply before writing the Wave Plan)

Wave shape is not always file-overlap partitioning. Choose the shape that minimizes ceremony for the TODO's story composition, then fill in file ownership as a constraint within each wave.

Evaluate in this order and pick the first that fits:

**Shape A — Single-hotspot collapsed (check first).** Triggers when ALL stories would touch the same hotspot file AND no story is > M AND dependencies are strictly linear (story N depends on N−1). Collapse adjacent small stories into bundled M-size stories until there are at most 3 waves, ordered by **functional grouping** (e.g., "Layout + card shell" / "Form chrome" / "Footer + E2E coverage"), not by arbitrary story count.

  - Target: 2–3 bundled stories, 2–3 waves.
  - **Required warning line in the Executive Summary:** `Wave shape: single-hotspot collapsed — collapsed {N_original} stories into {M_bundled} bundled stories by functional grouping. File-overlap partitioning would have produced {N_original} forced-serial waves.`
  - Why: under pure file-overlap partitioning, one-hotspot TODOs force `waves = stories`. That pays full per-wave machinery (commits, handoff regen, gate runs, review cycles) for zero parallelism benefit. Field-measured cost on a 6-story single-hotspot TODO: ~30 min total, ~15 min pure ceremony, ~80k context on orchestration, and no offsetting speedup.

**Shape B — Role-based (Tests / Code / Verify) — the default for heterogeneous TODOs.** When stories span multiple files and conceptual areas and none of them qualifies for Shape A, organize as three role-scoped waves:
  - **Wave 1 — Tests:** one story per eventual feature that authors failing tests from AC. These stories have no file-overlap with each other (one test file per feature) and dispatch in parallel.
  - **Wave 2 — Code:** implementation stories that make the Wave 1 tests pass. Zero file-overlap within the wave; parallel dispatch.
  - **Wave 3 — Verify:** AC verification, E2E coverage, code review, and final commit.

  This replaces the old "file-overlap is the only partitioning rule" default. `/run-todo`'s per-wave TDD rhythm (Step 2b) still applies *within* each role-wave, but redundancy is minimized because Wave 1 is explicitly and solely about tests.

**Shape C — File-overlap partitioned (fallback).** Use when neither A nor B fits — deeply interdependent stories spanning many files where role-splitting creates artificial couplings, or where story-level AC is so heterogeneous that bundling under roles would lose reviewability. Historical default; remains available.

**Always declare the chosen shape in the Wave Plan heading** so `/run-todo` and human reviewers can see the intent:
- `## Wave Plan` + `**Shape:** single-hotspot collapsed — ...`
- `## Wave Plan` + `**Shape:** role-based (Tests / Code / Verify) — ...`
- `## Wave Plan` + `**Shape:** file-overlap partitioned — ...`

If the research agent flagged single-hotspot in Phase 2 and you chose a different shape anyway, the Executive Summary must include a one-sentence rationale (e.g., "Single-hotspot detected but not collapsed because two stories are M and exceed the collapse threshold").

---

## Phase 3b: Self-Review — No Placeholders (Main Agent — always run)

Before handing off to external review, Main Agent scans its own output for plan failures. If ANY of these are found, fix them before proceeding.

**Automatic failure conditions (fix immediately):**
- [ ] Any story contains "TBD", "TODO", "to be determined", or "placeholder"
- [ ] Any story says "similar to Story X" without specifying exact differences
- [ ] Any AC bullet says "properly", "correctly", "as needed", or "appropriate" without measurable criteria
- [ ] Any AC bullet says "add error handling" without specifying which errors
- [ ] Any story is missing the Files section or has only guessed paths (not from research)
- [ ] Any story is missing Research notes
- [ ] Any story is missing an Estimate
- [ ] Any story references an undefined story ID in Dependencies
- [ ] Wave Plan is missing the **Shape** line (role-based | single-hotspot collapsed | file-overlap partitioned) — required for every TODO
- [ ] In `file-overlap partitioned` shape: any wave has file overlap between stories (must be zero)
- [ ] In `single-hotspot collapsed` shape: Executive Summary is missing the required warning line (collapsed N → M stories) OR any bundled story is larger than M
- [ ] Research Agent 1 flagged single-hotspot but Main Agent chose a different shape without a one-sentence rationale in the Executive Summary
- [ ] Story Index is missing stories that appear in the body

**This is a 30-second scan that catches 3-5 issues every time.** Do not skip it.

---

## Phase 4: Review (Sonnet — Large TODOs only, 8+ stories)

Skip for Small (1-4). Use judgment for Medium (5-7).

```
Agent(
  subagent_type: "code-reviewer",
  model: "sonnet",
  prompt: """
  Review the TODO at {path} for execution readiness.

  ## Coverage
  1. Every AC is specific and testable (no "properly", "correctly", "as needed")
  2. File lists are complete — no story references files outside its list
  3. Missing error/empty/loading states in ACs

  ## Structure
  4. Wave groupings have zero file overlap (check file ownership)
  5. Dependencies are correct — no story depends on something in a later wave
  6. ACs don't contradict each other across stories

  Write findings to: docs/.output/work/{YYYY-MM-DD}/{slug}/{HHMM}-review.md
  DO NOT edit the TODO file.
  """,
  description: "Review TODO for {slug}"
)
```

---

## Phase 5: Synthesis (Main Agent)

Read the review findings. Decide what to accept. Apply accepted findings to the TODO file directly.

Main Agent is the single author of the TODO — review agents advise, Main Agent decides.

---

## Phase 6: Report

```markdown
## /todo Complete

**TODO:** {path} ({N} stories, ~{N} estimated hours)
**Research:** `docs/.output/work/{YYYY-MM-DD}/{slug}/` ({N} files)

### Story Breakdown
| Wave | Stories | Sizes | Est. Hours |
|------|---------|-------|------------|
| 1 | {IDs} | {sizes} | {hours} |
| 2 | {IDs} | {sizes} | {hours} |

### Ready for execution:
  /run-todo {path}
  /do {first-story-id}
```

---

## Phase 7: Regenerate `docs/__handoff.md` — session-handoff skill

After the report, refresh `docs/__handoff.md` using the **`session-handoff`** skill (`.claude/skills/session-handoff/SKILL.md`). Read that skill for the template, rules, and `/todo`-specific tailoring (Step 4 in the skill).

**Why:** a newly-created TODO is "ready to execute." The handoff's Next Actions should point at `/run-todo {path}` as #1 so the next session's `/prime` immediately surfaces what to do next. The TODO path + research files go in Key Files.

---

## Phase 8: Commit

```bash
git add {TODO_PATH} docs/.output/work/{YYYY-MM-DD}/{slug}/ docs/__handoff.md
git commit -m "docs: /todo — create TODO for {slug} ({N} stories)

Co-Authored-By: 🤖"
```

---

## Rules

1. **Main Agent assembles the TODO directly** — do not delegate assembly to a planner agent. Main Agent has the full context.
2. **Research agents scan, Main Agent synthesizes** — agents find files and patterns, Main Agent makes decisions about story breakdown and wave grouping.
3. **ACs are sacred** — never strip, simplify, or summarize acceptance criteria. They are the contract.
4. **File lists come from code, not guessing** — research agents scan the actual codebase for paths.
5. **Wave plan is pre-computed** — `/run-todo` should not have to figure out parallelism.
6. **The TODO is a contract** — `/run-todo` and `/do` trust it completely. If it's wrong, they fail.
7. **No code blocks in stories** — file paths and descriptions only. Implementation is the dev agent's job.
8. **Always regenerate `docs/__handoff.md` (Phase 7) and commit (Phase 8).** A newly-created TODO that isn't surfaced in the handoff won't be picked up by the next session's `/prime`. Use the `session-handoff` skill.
