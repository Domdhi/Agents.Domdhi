# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project

Domdhi.Agents is a portable `.claude/` directory template for AI-assisted software development. Drop it into any project for structured workflows from idea to implementation using slash commands, native subagents, and a memory system. Tech-agnostic until specialized via `/review:specialize`.

## Three-Tier Architecture

```
Commands (.claude/commands/**/*.md)   — Orchestration (gates, interviews, delegation, validation, commit)
Agents (.claude/agents/*.md)          — 11 subagents with personalities, auto-load skills via frontmatter
Skills (.claude/skills/*/SKILL.md)    — Domain knowledge (templates, quality criteria, checklists)
```

**No duplication between layers.** Commands reference skill checklists — they don't copy them. Agents auto-load skills via frontmatter — commands don't tell them to read skill files.

## Agents

| Agent | Model | Role | Skills |
|-------|-------|------|--------|
| `product-strategist` | inherit | Brainstorming, research, briefs, PRDs | project-planning |
| `architect` | inherit | System design, ADRs, tech stack | architecture |
| `ux-designer` | inherit | UX specs, wireframes, themes | ux-design, brand-guidelines, tailwind-css-patterns, design-taste-frontend, redesign-existing-projects |
| `project-planner` | inherit | Epics, stories, backlog | project-planning |
| `general-purpose` | sonnet | Code implementation | full-output-enforcement, systematic-debugging, verification-before-completion, finishing-a-development-branch, using-git-worktrees |
| `code-reviewer` | inherit | Code quality review (read-only) | code-review |
| `security-auditor` | inherit | Security review (write scope: reviews only) | code-review |
| `qa-engineer` | sonnet | Test strategy and execution | qa-engineer |
| `doc-writer` | sonnet | Documentation and changelogs | project-planning, documentation |
| `playwright` | sonnet | Browser testing and automation | playwright-cli |
| `shadow` | sonnet | Voice-matched ghostwriting and articles | ghostwriting, content-formats |

**Model hierarchy:** Opus plans, verifies, reviews, and audits (owns the TaskList — `inherit` agents stay on Opus when called from commands). Sonnet does everything else — implementation, documentation, browser testing. Haiku is not used for agent work (it fabricates results — browser verification and TODO updates were moved off it). Resolution: env var > call-time param > frontmatter > inherit.

**Model Policy (the single swap point):** Commands do NOT pin a `model:` on review dispatches — every `code-reviewer` / `security-auditor` dispatch omits the param and inherits the agent's frontmatter. So each agent's `model:` line is THE place to change its tier; there are no scattered model strings to hunt down. Two named review tiers:
- **`review.default`** = `code-reviewer` / `security-auditor` frontmatter (`inherit` → Opus). Swap the default by editing that one frontmatter line.
- **`review.backup`** = **`sonnet`** — the cheaper, cross-tier second opinion used only by `/review:code-review --deep`. Swap the backup here. Commands reference it as `{review.backup}` rather than hardcoding a model.

**Native types:** Commands also use `Explore` (Claude Code's built-in codebase research agent) — this is not a custom agent in `.claude/agents/`.

**Agent-shape exception:** `shadow` intentionally omits the standard `## Skills` section and role-suffix heading — its prose-heavy ghostwriting persona is its convention, not a template violation. `/review:check-templates` treats Shadow as conforming.

`/review:specialize` creates additional stack-specific agents from the project's architecture document. `/review:personalize` gives agents names and personalities.

## Commands

### Setup (run once per project)
- `/brainstorm` — Guided ideation session → `_brainstorm.md` + `_feature-ideas.md`
- `/research` — Validate assumptions → `_research.md`
- `/interview` — Interactive Q&A to gather requirements
- `/create:project-brief` — Strategic vision → `_project-brief.md`
- `/create:project-requirements` — PRD with FRs/NFRs → `_project-requirements.md`
- `/create:project-design` — UX spec, wireframes, themes, mock → `docs/design/`
- `/create:project-architecture` — Tech stack, ADRs → `_project-architecture.md`
- `/create:project-epics` — Break requirements into stories → `todo/_backlog.md`
- `/create:project-todo` — Master implementation index → `TODO_{ProjectName}.md`
- `/create:project-epics-todo` — Per-epic story checklists → `todo/TODO_epic{NN}.md`
- `/create:component` — Create a new agent, command, or skill following established conventions
- `/create:new-project` — Master orchestrator — scaffolds `docs/` and walks the full planning pipeline to implementation-ready
- `/onboard` — Brownfield bootstrapper — reverse-engineers `_project-architecture.md` + `_project-context.md` from an existing codebase; merges CLAUDE.md additively; chains `/review:specialize`

### Build Loop (daily)
- `/prime` — Load context at session start from `__handoff.md` + git log
- `/todo` — Create execution-ready checklist with research, AC, wave plan, self-review
- `/do` — Execute one task: size-aware (Opus direct or Sonnet delegate) → gate → AC verify → commit
- `/run-todo` — Execute entire checklist with wave-based execution, AC gates, and auto-commit
- `/run-tests` — Manual/E2E testing with parallel playwright agents, screenshots, and status protocol
- `/end` — Save handoff context → `__handoff.md`

### Supporting
- `/status` — Parse TODO files, show progress, generate HTML dashboard → `docs/.output/status.html`
- `/create:module` — Add new feature area → `docs/app/{module}/` + TODO checklist
- `/organize` — Move plan files to dated folders
- `/investigate` — Structured debug investigation with root cause analysis before fixes → `docs/.output/investigations/`
- `/remember` — Capture a conversational insight to the daily log for memory acquisition
- `/listen` — **Post-MVP lifecycle (Tier 1):** aggregate signals (git, telemetry, agent-updates, backlog drift, external) into `docs/.output/intake/{date}.md`. For when the initial backlog drains and work shifts from pull-from-plan to push-from-reality. Pairs with a future `/triage` (signals → backlog). Research: `docs/research/competitive/_post-mvp-lifecycle-synthesis.md`

### Review (periodic)
- `/review:code-review` — Risk-tiered architecture compliance review (read-only)
- `/review:feedback` — Template-performance report: automated telemetry digest (`feedback-digest.js`) + agent self-review → `docs/.output/reviews/feedback-{date}.md` + `.json`. Auto-chained as the final step of `/onboard` and `/create:new-project`; run standalone anytime. Distinct axis from `/listen` (product signals) and `/status` (workflow progress). **Fleet rollup:** `npm run feedback:rollup -- <projectDir>...` (or `--registry <file>`) sweeps the per-project `.json` sidecars from many repos into one cross-project view — version drift, gate pass-rates, anomalies (`tools/feedback-aggregate.js`, maintainer-only, not shipped).
- `/review:security` — OWASP audit, vulnerability detection, secret scanning (writes to `docs/.output/reviews/`)
- `/review:qa` — Generate tests for existing code
- `/review:check-readiness` — Gate check before implementation (read-only)
- `/review:check-sync` — Detect documentation drift (read-only)
- `/review:check-templates` — Audit `.claude/` system health — orphaned agents, unused skills, missing hooks, broken wiring
- `/review:update-docs` — Fix drift found by check-sync
- `/review:optimize-backlog` — Dependency graph, critical path analysis
- `/review:retro` — Epic retrospective + pattern extraction
- `/review:changelog` — Release notes from stories + git
- `/review:specialize` — Customize agents for your tech stack
- `/review:optimize-agents` — Re-align agents with actual codebase
- `/review:personalize` — Give agents names and personalities
- `/review:memory-health` — Compile + lint + decay report (headless-compatible)
- `/review:promote-memories` — Surface high-confidence concepts for promotion to templates/skills
- `/review:sweep` — Autonomous post-work maintenance: orchestrates code-review → retro → implement recs → promote → optimize-agents → defrag → memory-health as one auto-approved pass (defrag runs LAST on the grown store). Per-phase commits, resumable Phase Log, final report.
- `/review:timeline` — Generate or update weekly commit history → `_project-timeline.md`

## Document Naming

All generated docs use underscore prefix in `docs/`:

| Doc | File | Created By |
|-----|------|------------|
| Project Brief | `_project-brief.md` | `/create:project-brief` |
| Requirements (PRD) | `_project-requirements.md` | `/create:project-requirements` |
| Architecture | `_project-architecture.md` | `/create:project-architecture` |
| UX Design | `_project-design.md` | `/create:project-design` |
| Backlog | `todo/_backlog.md` | `/create:project-epics` |
| Session Handoff | `__handoff.md` | `/end` |
| Project Context | `_project-context.md` | scaffold.js |
| Timeline | `_project-timeline.md` | `/review:timeline` |
| Brainstorm output | `_brainstorm.md` (seed) + topic-driven satellites as warranted (e.g., `_feature-ideas.md`) | `/brainstorm` |

`/brainstorm` is a dynamic utility command — it writes whatever feature/topic-related files make sense for the session, not a fixed schema. The seed file (`_brainstorm.md`) is always produced; additional files emit as the conversation warrants.

### Directory Structure
```
docs/
├── _project-*.md          # Planning pipeline documents
├── __handoff.md            # Session continuity
├── design/                 # UX spec, wireframes, themes, mock layout
├── todo/                   # _backlog.md, _feature-ideas.md, TODO_epic*.md
├── app/                    # Per-module briefs, research, brainstorms (/create:module)
│   └── {module}/           # Feature-scoped: _brief.md, brainstorm.md, research.md
└── .output/                # All operational output
    ├── reviews/            # Code review, security, readiness, sync results
    ├── investigations/     # Root cause analysis
    ├── research/           # General (non-feature) research
    ├── plans/              # Execution plans
    ├── memories/           # Auto-compounded daily logs + compiled concepts (replaces old /recap)
    ├── telemetry/          # Command usage logs
    ├── intake/             # /listen post-MVP signal intake ({YYYY-MM-DD}.md, day-rotated)
    └── agent-updates/      # Agent misalignment feedback ({YYYY-MM-DD}.md, day-rotated)
```

## Template Marker Convention

Template files contain `<!-- @@template -->` as their first line. When `scaffold.js` copies these into `docs/`, the marker is preserved. Hard gate checks treat files with this marker as non-existent.

**Skill-owned document templates live in each producing skill's `assets/`** (e.g. `ux-design/assets/_project-design.md`, `project-planning/assets/_backlog.md`) — single-sourced so the skill and scaffold share one copy. `scaffold.js` seeds `docs/` from them via the `SKILL_TEMPLATE_MANIFEST` constant. Only templates with **no owning skill** remain in `.claude/templates/`: the `CLAUDE.md` docs-structure guide and the `root/` configs.

When a command fills a template, it writes entirely new content without the marker. This distinguishes "scaffolded but unfilled" from "actually created."

## Skill Authoring & Spec Conformance

Skills follow the [Agent Skills open standard](https://agentskills.io/specification). The rules below are enforced by `node .claude/core/skill-conformance.js`, wired into `/review:check-templates` (Step 2b):

| Rule | Limit | Severity |
|------|-------|----------|
| `SKILL.md` body | ≤ 500 lines (keep the always-loaded part small) | WARN if over |
| `name` frontmatter | must equal the parent directory name | ERROR if mismatched |
| `description` frontmatter | ≤ 1024 characters | ERROR if over |

**`description` content (CSO):** state **both** what the skill does (a brief clause) **and** when to use it, keeping the `"Use WHEN… Triggers: …"` structure. Naming *what it covers* is fine; **never summarize the step-by-step workflow** — that lets Claude follow the description as a shortcut and skip the body. (Authoritative guidance: `skill-authoring/SKILL.md`, `system-builder/SKILL.md`. Agent descriptions — `system-builder` :35/:51 — are a separate concern from skill descriptions.)

**Progressive disclosure — move heavy content out of `SKILL.md` into the spec's optional subdirectories, one logical unit per file, referenced one level deep:**

| Directory | Holds | Example |
|-----------|-------|---------|
| `references/` | Documentation the agent *reads on demand* | `tailwind-css-patterns/references/patterns.md` |
| `assets/` | Templates / resources *copied into output* — **document templates here are the scaffold source of record** (raw, with `<!-- @@template -->`; wired into `scaffold.js`'s `SKILL_TEMPLATE_MANIFEST`) | `ux-design/assets/_project-design.md` (one file per template) |
| `scripts/` | Executable code the agent runs | — |

The split is the largest recurring token win in the system: a skill's whole `SKILL.md` loads on every activation, while subdirectory files load only when a pointer in `SKILL.md` calls for them. When relocating content, move it **verbatim** (byte-for-byte) and verify with a set-difference against the git blob — do not paraphrase.

## Hard Gates

Create commands enforce prerequisite checks that prevent out-of-sequence execution:

| Command | Requires (real, non-template) |
|---------|-------------------------------|
| `/create:project-requirements` | At least one of: `_project-brief.md`, `_brainstorm.md`, `_research.md` |
| `/create:project-architecture` | `_project-requirements.md` |
| `/create:project-epics` | `_project-requirements.md` AND `_project-architecture.md` |
| `/create:project-design` | `_project-requirements.md` |
| `/create:project-todo` | `todo/_backlog.md` |
| `/create:project-epics-todo` | `todo/_backlog.md` |
| `/review:optimize-backlog` | `todo/_backlog.md` |
| `/review:check-readiness` | Existing required docs PLUS no unacknowledged epic file overlaps in `_backlog.md` (per `epic-overlap.js`) |

**`--yolo` flag**: Any gated command accepts `--yolo` to bypass hard gates (downgrades to warnings).

## TODO Hierarchy

```
/create:project-epics          →  docs/todo/_backlog.md        (epic definitions — source of truth)
  ↓
/create:project-todo           →  docs/TODO_{Project}.md       (master index — epic-level status)
  ↓
/create:project-epics-todo     →  docs/todo/TODO_epic{NN}.md   (per-epic checklists — story tasks)
  ↓
/do | /run-todo                →  picks task, implements, updates checklists
```

## Build & Test Gate

`gate.js` auto-detects the project's build system:

| Detection | Build | Test |
|-----------|-------|------|
| `package.json` | `npm run build` | `npm test` |
| `Cargo.toml` | `cargo build` | `cargo test` |
| `go.mod` | `go build ./...` | `go test ./...` |
| `*.sln` / `*.csproj` | `dotnet build` | `dotnet test` |
| `pyproject.toml` | `ruff check` + `ruff format --check` + `mypy --strict` | `pytest` |
| `Makefile` | `make` | `make test` |

Override with `gate.config.json` in your project root.

### This repo (self-hosted)

`package.json` lives at the repo root (from TDD-1.1 bootstrap), so `node .claude/core/gate.js test` detects `node` automatically and runs the real Vitest suite. No `gate.config.json` needed — auto-detect is sufficient.

```
$ node .claude/core/gate.js test
[GATE] Detected stack: node
[GATE] Building... (npm run build)
[GATE] Build: PASSED (0 errors, 0 warnings)
[GATE] Testing... (npm test)
[GATE] Tests: PASSED (829 passed, 0 failed, 0 skipped)
[GATE] Overall: PASSED
```

`_latest-summary.json` records `{ stack: "node", overall: true, ... }`.

## Publishing

Two-repo workflow: this private workshop publishes a curated subset to a public storefront (`Agents.Domdhi`).

```bash
npm run publish:public -- <path-to-public-repo> --dry-run   # preview
npm run publish:public -- <path-to-public-repo>             # do it
```

Ships only what `tools/publish-manifest.json` (the allowlist) permits. A hardcoded `DEFAULT_EXCLUDES` in `tools/publish.js` always strips working state (`docs/__handoff.md`, `docs/.output/**`, `docs/todo/**`, `docs/research/**`, `docs/app/**`, `docs/design/**`, `docs/_project-timeline.md`, `.claude/settings.local.json`, `.claude/push-guardrail.json`, `.claude/agent-memory/**`, `tools/**`, `**/coverage/**`, `**/test-results/**`) even if the manifest would otherwise match them.

**Publish vs update — two different operations.** Use `publish:public` for the FIRST publish to an empty target repo (creates the target's `.claude/` directory). For incremental sync to an existing `.claude/`-bearing project, use `node .claude/core/template-updater.js update <path>` instead — that tool enforces the zone model (Template/Project/Mixed) to preserve customizations.

## Output Persistence Convention

**All agent output MUST be written to a file before reporting to chat.** Work that only exists in chat is lost on context compaction. No exceptions.

### Output Path Rules

| Output type | Path | Examples |
|---|---|---|
| **Planning pipeline docs** | `docs/_project-*.md` | Brief, requirements, architecture, design |
| **Feature-scoped research** | `docs/app/{feature}/` | Brainstorm, research, investigation for a specific feature/module |
| **General research** | `docs/.output/research/` | Research not tied to a specific feature |
| **Reviews & audits** | `docs/.output/reviews/` | Code review, security audit, readiness check, sync check, retros (`retro-{epic-slug}.md`) |
| **Investigations** | `docs/.output/investigations/` | Root cause analysis from `/investigate` |
| **Execution plans** | `docs/.output/plans/` | Plans from Plan Mode |
| **Task working files** | `docs/.output/work/{date}/{task}/` | Research, spikes from `/todo`, `/run-todo` |
| **Status & metrics** | `docs/.output/` | `status.html`, `decisions.html` |
| **Session context** | `docs/__handoff.md` | Handoff from `/end` |
| **Telemetry** | `docs/.output/telemetry/` | Command usage logs, gate build/test logs |
| **Agent feedback** | `docs/.output/agent-updates/{YYYY-MM-DD}.md` | Misalignment logs from `/do`, `/run-todo`, `/run-tests` (day-rotated folder; legacy flat `agent-updates.md` still read as fallback) |
| **Signal intake** | `docs/.output/intake/{YYYY-MM-DD}.md` | Post-MVP signals aggregated by `/listen` (day-rotated) |

### Context-Bundled Output

When brainstorm, research, or investigation is **about a specific feature or module**, output goes with that feature:
```
docs/app/{feature}/brainstorm.md
docs/app/{feature}/research.md
docs/app/{feature}/investigation-{date}.md
```

When it's **project-wide or general**, output goes to `.output/`:
```
docs/.output/research/{date}-{topic}.md
docs/.output/investigations/{date}-{summary}.md
```

The command determines the path based on context. If unclear, ask the user.

## Post-Command Commit Convention

After any lifecycle command that creates or modifies files, commit before reporting:

1. Stage the specific files created/modified (not `git add .`)
2. Write the commit message to `docs/.output/.commit-msg` using the Write tool (no shell escaping needed). Format: `docs|feat|refactor: /command-name — brief summary` with an optional body. Do NOT add a `Co-Authored-By` line — `commit.js` appends the trailer automatically and exactly once. Then run `node .claude/core/commit.js`. Inline `git commit -m` is blocked by the commit-guard hook.
3. Do NOT push — commit locally only
4. Include the commit hash in the Report output

**Commands that commit**: All `/create:*`, `/brainstorm`, `/research`, `/review:*` (all reviews now persist output), `/investigate`

**Chat-only (no file output)**: `/prime`, `/todo`, `/organize`

**Own commit logic**: `/do`, `/run-todo` (commit per wave)

## Memory System

```bash
node .claude/core/memory-manager.js report              # View all memories
node .claude/core/memory-manager.js search "topic"      # Search by relevance
node .claude/core/memory-manager.js create {cat} {id} '{json}'  # Create memory
node .claude/core/memory-manager.js update {cat} {id} '{json}'  # Merge into a memory's content
node .claude/core/memory-manager.js delete {cat} {id}    # Remove a memory (file + index)
node .claude/core/memory-manager.js inbox-list           # List staged draft memories
node .claude/core/memory-manager.js inbox-promote {id} [--category C] [--id new-id]  # Promote a draft to a real memory
node .claude/core/memory-manager.js inbox-discard {id}   # Drop a draft without promoting
node .claude/core/memory-manager.js decay-report         # Show decayed confidence (stalest first)
node .claude/core/memory-manager.js lint                 # 7-point health check (score 0-70)
node .claude/core/memory-extractor.js extract [--dry-run] # Sonnet-powered structured extraction from daily logs
node .claude/core/memory-extractor.js status              # Show extraction pipeline status
node .claude/core/memory-promoter.js scan [--top N]       # Rank memories for promotion to templates/skills
node .claude/core/memory-promoter.js mark <slug> <target> # Mark a memory as promoted
```

`scan` and `mark` operate on hand-created JSON memories (`docs/.output/memories/{cat}/{slug}.json` from `memory-manager.js create`) and extractor output (same path). Hand-created memories bypass any minimum-source eligibility filter — intentional human curation, no noise floor needed.

Confidence levels: 0.9 (architecture) → 0.8 (retro-validated) → 0.7 (implementation-proven) → 0.6 (story-discovered) → 0.5 (session-observed)

**Memory acquisition:** Main Agent writes 0–3 structured memories per session-handoff invocation (every `/do`, `/run-todo` wave, `/run-tests`, `/todo`, `/end`) by reviewing the Decisions & Context bullets it just authored in `docs/__handoff.md` and promoting the reusable-learning ones via `memory-manager.js create`. Zero ongoing in-process LLM cost — Main Agent already holds full context when writing the handoff, so no second-model extraction round-trip is needed. The `memory-extractor.js` CLI still exists but is a manual/brownfield tool for backfilling memories from historical docs in adopter projects; it does not fire from any command automatically. Decision record: `docs/.output/reviews/2026-04-20-adr-memory-unification.md`. When authoring each memory, assign an `importance` score of 1–5 in `content.importance` (1 = ephemeral/narrow, 5 = architecture-level/foundational, default 3 when unsure); the manager uses this as the retention floor so low-importance memories decay out on active repos while high-importance ones resist.

**Inbox staging (sub-agents):** Sub-agents never write straight into the curated store. When a dispatched agent discovers something unexpected and reusable mid-task, it drops a draft JSON into `docs/.output/memories/_inbox/` (the **Memory Inbox Protocol** section in each agent's definition). Drafts are inert until the Main Agent reviews them — `inbox-list` to see them, `inbox-promote` to turn keepers into real memories (with optional category/id override), `inbox-discard` to drop the rest. This adds the missing review gate between "an agent noticed something" and "it's a curated memory." Only the Main Agent — which holds full session context — promotes.

The Stop hook (`memory-capture.cjs`) captures raw daily logs and optionally runs the Sonnet curator under `MEMORY_PROFILE=strict`. Those are separate concerns from memory acquisition — the curator dedups existing memories, it does not create new ones.

Confidence decay: based on **active work days** (days with git commits), not calendar days. A project untouched for months has zero decay. Rates — `decisions: 0.98^days` (~35 work-day half-life), `constraints: 0.97^days` (~23), `patterns: 0.95^days` (~14), `workflows: 0.93^days` (~10). Below 0.3 = stale, below 0.1 = archive candidate. Config in `constants.js MEMORY_DECAY`.

**Importance is the retention floor.** Each memory carries an `importance` score 1–5 (`content.importance`, default 3, backfilled on read for legacy memories). `calculateDecayedConfidence` multiplies the decay curve by `importance / 3`: importance 3 is unchanged (the existing store is untouched), ≤2 lowers the floor so a low-value never-recalled memory can cross the stale threshold **even on an actively-committed repo where decay alone never fires** (the hoarding root cause), ≥4 resists decay. The decay curve itself in `_lib/memory-decay.js` is unchanged — importance is an added factor in the manager wrapper. Decay-independent dead-weight is surfaced by `memory-manager.js analytics` (the `dead_weight` queue) and prunable via `memory-manager.js prune-unused` (dry-run by default).

**Supersession forgets by validity.** Memories that became *wrong* (not just decayed) are marked with `invalid_at` + `superseded_by` columns and hidden from all current-state reads (`listMemories`/`searchMemories`/injection exclude them by default; `{ includeSuperseded: true }` reads history). It's flag-then-confirm: `createMemory` flags overlapping predecessors as `supersedes_candidates` via a cheap FTS5 query (LLM-free), and the Main Agent confirms at `/end` with `memory-manager.js supersede <category> <oldId> <newId>`. Never automatic.

**Honest usage ranking.** `usage_count` increments only on genuine retrieval (`searchMemories`, write-through to JSON+SQLite, once per recall) — `updateMemory` and passive injection never touch it (so it stays an honest lower bound). It ages via `halveUsageCount` (halves every `USAGE_HALVE_EVERY_DAYS`=14 silent active-days). Injection ranking (`session-start-prime.cjs`) is now `importance-floored decayed_confidence × recency` primary, with aged usage as a **tiebreaker only** and a hard top-N size budget. The `memory-eval.js` harness (`npm run memory:eval`) validates that pruning improves retrieval accuracy. Full design: `docs/.output/research/2026-06-04-memory-eviction-retention-research.md`.

## Hooks

| Hook | Trigger | Purpose |
|------|---------|---------|
| `session-start-prime.cjs` | SessionStart | Injects top structured memories (`memories/{category}/*.json`) as system-reminder at session opening |
| `secret-scanner.cjs` | Pre-Write/Edit | Blocks secrets from being written to files |
| `guardrail.cjs` | Pre-Bash | Blocks/confirms destructive commands via `guardrail-rules.yaml` |
| `pre-compaction-archive.cjs` | Pre-Compact | Snapshots state + daily log before context compaction (snapshot only — extraction no longer triggered here) |
| `post-read-scrubber.cjs` | Post-Read | Warns on secrets in read files (non-blocking) |
| `organize.cjs` | Post-ExitPlanMode, Post-Bash | Organizes plans to `docs/.output/plans/{date}/` and screenshots to `docs/.output/screenshots/{date}/{task}/` |
| `damage-control.cjs` | Post-Bash | Error analysis on failures — prevents retry spin loops |
| `command-usage-logger.cjs` | Post-Skill/Bash | Logs command invocations + gate runs to `docs/.output/telemetry/`; reads `_latest-summary.json` for gate pass/fail outcome |
| `memory-guard.cjs` | Post-Write | Warns when memory category approaches limit |
| `memory-capture.cjs` | Stop, PostToolUse:Bash | Daily-log capture on Stop + curate (strict only); commit context enrichment on Bash. Extraction retired from in-process; `memory-extractor.js` is now manual-only (see `docs/concepts/memory.md`). |
| `edit-capture.cjs` | Post-Edit | Captures edits to canonical docs (CLAUDE.md, architecture, skills) as daily-log entries (`MEMORY_PROFILE=strict` only) |
| `path-guardrail.cjs` | PreToolUse:Write/Edit/MultiEdit/NotebookEdit | Blocks write/edit ops via the four-tier path schema (zeroAccessPaths/readOnlyPaths/noDeletePaths) and freeze-state checks |

Secret hooks share `secret-patterns.cjs`. The scanner runs ONLY as a Claude Code `PreToolUse:Write/Edit` hook — the historical `.githooks/pre-commit` fallback was retired 2026-05-09. Adopters who commit outside Claude Code (manual `git commit` from a plain terminal) get no scan. To restore the belt-and-suspenders behavior, install `.githooks/pre-commit` from a previous template version manually.

## Key File Paths

| File | Purpose |
|------|---------|
| `.claude/core/gate.js` | Build/test gate with auto-detection |
| `.claude/core/constants.js` | System-wide constants, phase artifacts, doc chain |
| `.claude/core/daily-log.js` | Standalone daily log capture — called by `/end` and pre-compaction hook |
| `.claude/core/memory-manager.js` | Memory CRUD + search + decay + linting (JSON + SQLite FTS5) |
| `.claude/core/memory-extractor.js` | Sonnet-powered structured extraction from daily logs (manual/brownfield only — see `docs/.output/reviews/2026-04-20-adr-memory-unification.md`) |
| `.claude/core/memory-curator.js` | Sonnet-powered dedup/contradiction/merge analyzer (runs on Stop when `MEMORY_PROFILE=strict`) |
| `.claude/core/memory-promoter.js` | Scan/rank/mark concepts for promotion to templates/skills |
| `.claude/core/gen-timeline.js` | Weekly commit history generator → `docs/_project-timeline.md` |
| `.claude/core/telemetry-log.js` | Self-instrumentation for user-typed slash commands (e.g. `/onboard`) that don't fire `PostToolUse:Skill` — appends a `command_invocation` row to `command-usage.jsonl` |
| `.claude/core/feedback-digest.js` | Automated telemetry rollup (commands, gate, hooks, agents, memory, system-files) behind `/review:feedback`; `--json` for the collectible sidecar. Root-parameterized + headless |
| `.claude/core/skill-conformance.js` | Agent Skills spec checker (body ≤500 lines, name==dir, description ≤1024 chars) — run by `/review:check-templates` Step 2b |
| `.claude/core/metrics.js` | Workflow metrics from telemetry + git + TODOs |
| `.claude/core/template-updater.js` | Zone-aware template sync to downstream projects |
| `.claude/core/status.js` | TODO progress + metrics → text + HTML dashboard |
| `.claude/core/scaffold.js` | Seeds `docs/` from skill-owned templates (`SKILL_TEMPLATE_MANIFEST` → skill `assets/`) + residual `.claude/templates/` (CLAUDE.md docs-guide, root configs) |
| `.claude/version.json` | Template version (semver), used by template-updater |
| `.claude/hooks/secret-scanner.cjs` | Secret/credential detection (50+ patterns) |
| `.claude/templates/` | Residual no-owner templates only (CLAUDE.md docs-guide + `root/`); skill-owned doc templates now live in each producing skill's `assets/` |
| `.claude/templates/root/` | Root-level configs (`gitignore` → renamed to `.gitignore` at scaffold time, `.playwright/`) |
| `.claude/agents/*.md` | Subagent definitions |
| `.claude/skills/` | 21 skill modules |
| `docs/reference/system-map.md` | Complete system inventory and workflow graphs |
| `docs/reference/customization.md` | Zone map for template update merge strategy |
| `docs/reference/engineering-conventions.md` | Durable engineering rules for toolkit contributors (static constants, idempotent SQLite migrations, stub-contract testing, require-cache reload) |

## Build & Test

**The toolkit itself has zero runtime dependencies** — `git clone` and the hooks work immediately, no `npm install` required. `npm install` only pulls **devDeps** (vitest), which are needed solely to run the test suite, not to use the `.claude/` system. (The guardrail rule-file validator is hand-rolled; it formerly used `zod` but that runtime dep was dropped so adopter projects that aren't already Node projects stay drop-in.)

**Memory FTS5 search is also zero-dependency on Node 24+.** The memory system's full-text search runs on the built-in `node:sqlite`, which ships FTS5 compiled in as of Node 24 (stable). `memory-manager.js` probes this capability at load time and reports it via `generateReport().storage.sqliteSupportsFts5`. `better-sqlite3` is an **optional** fallback (declared as an `optionalDependency` in the root `package.json`, not a required dep of `.claude/core/`) for Node < 24, where the built-in may lack FTS5; without either, search degrades gracefully to a JSON linear scan. There is **no mandatory `npm install` step** for memory search — earlier guidance to that effect was based on a stale false-negative in the capability flag and is wrong.

Vitest is configured at the repo root. Tests live colocated with their source under `.claude/core/__tests__/` and `.claude/hooks/__tests__/`.

- `npm install` — install devDeps (vitest, @vitest/coverage-v8) — only needed to run tests, not to use the toolkit
- `npm test` — run all test suites
- `npm run test:watch` — watch mode
- `npm run test:coverage` — run with v8 coverage report (output to `docs/.output/telemetry/coverage/`)

`node .claude/core/gate.js test` auto-detects the Node stack via `package.json` and runs `npm test`. Coverage thresholds on `.claude/core/**`: 70% lines, 60% branches.

Test directories (`__tests__/`, `_helpers/`) are excluded from `template-updater.js` propagation — they stay local to this repo.

After `/review:specialize` customizes for a downstream project, this section should describe the project's actual build/test commands alongside the Vitest setup.
