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
| `product-strategist` | inherit | Brainstorming, research, briefs, PRDs | project-analyst, prd-writer, project-brief-writer |
| `architect` | inherit | System design, ADRs, tech stack | architecture-writer |
| `ux-designer` | inherit | UX specs, wireframes, themes | ux-designer, brand-guidelines, tailwind-css-patterns, design-taste-frontend, redesign-existing-projects |
| `project-planner` | inherit | Epics, stories, backlog | epic-writer |
| `general-purpose` | sonnet | Code implementation | full-output-enforcement, systematic-debugging, verification-before-completion, finishing-a-development-branch, using-git-worktrees |
| `code-reviewer` | sonnet | Code quality review (read-only) | code-reviewer, code-review-playbook |
| `security-auditor` | sonnet | Security review (write scope: reviews only) | code-reviewer, code-review-playbook |
| `qa-engineer` | sonnet | Test strategy and execution | qa-engineer |
| `doc-writer` | haiku | Documentation and changelogs | project-context, documentation |
| `playwright` | haiku | Browser testing and automation | playwright-cli |
| `shadow` | sonnet | Voice-matched ghostwriting and articles | article-writer, content-formats |

**Model hierarchy:** Opus plans and verifies (owns the TaskList). Sonnet implements code. Haiku documents. Planning agents (`inherit`) stay on Opus when called from commands. Resolution: env var > call-time param > frontmatter > inherit.

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
- `/remember` — Capture a conversational insight to the daily log for memory compilation

### Review (periodic)
- `/review:code-review` — Risk-tiered architecture compliance review (read-only)
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
    └── agent-updates.md    # Agent misalignment feedback
```

## Template Marker Convention

Template files in `.claude/templates/` contain `<!-- @@template -->` as their first line. When `scaffold.js` copies these into `docs/`, the marker is preserved. Hard gate checks treat files with this marker as non-existent.

When a command fills a template, it writes entirely new content without the marker. This distinguishes "scaffolded but unfilled" from "actually created."

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

Ships only what `.claude/publish-manifest.json` (the allowlist) permits. A hardcoded `DEFAULT_EXCLUDES` in `publish.js` always strips working state (`docs/__handoff.md`, `docs/.output/**`, `docs/todo/**`, `docs/research/**`, `docs/app/**`, `docs/design/**`, `docs/_project-timeline.md`, `.claude/settings.local.json`, `.claude/agent-memory/**`) even if the manifest would otherwise match them.

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
| **Agent feedback** | `docs/.output/agent-updates.md` | Misalignment logs from `/do`, `/run-todo` |

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
2. Commit: `docs|feat|refactor: /command-name — brief summary\n\nCo-Authored-By: 🤖`
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
node .claude/core/memory-manager.js decay-report         # Show decayed confidence (stalest first)
node .claude/core/memory-manager.js lint                 # 7-point health check (score 0-70)
node .claude/core/memory-extractor.js extract [--dry-run] # Haiku-powered structured extraction from daily logs
node .claude/core/memory-extractor.js status              # Show extraction pipeline status
node .claude/core/memory-promoter.js scan [--top N]       # Rank memories for promotion to templates/skills
node .claude/core/memory-promoter.js mark <slug> <target> # Mark a memory as promoted
```

`scan` and `mark` operate on hand-created JSON memories (`docs/.output/memories/{cat}/{slug}.json` from `memory-manager.js create`) and extractor output (same path). Hand-created memories bypass any minimum-source eligibility filter — intentional human curation, no noise floor needed.

Confidence levels: 0.9 (architecture) → 0.8 (retro-validated) → 0.7 (implementation-proven) → 0.6 (story-discovered) → 0.5 (session-observed)

**Memory acquisition:** Main Agent writes 0–3 structured memories per session-handoff invocation (every `/do`, `/run-todo` wave, `/run-tests`, `/todo`, `/end`) by reviewing the Decisions & Context bullets it just authored in `docs/__handoff.md` and promoting the reusable-learning ones via `memory-manager.js create`. Zero ongoing in-process LLM cost — Main Agent already holds full context when writing the handoff, so no second-model extraction round-trip is needed. The `memory-extractor.js` CLI still exists but is a manual/brownfield tool for backfilling memories from historical docs in adopter projects; it does not fire from any command automatically. Decision record: `docs/.output/reviews/2026-04-20-adr-memory-unification.md`.

The Stop hook (`memory-capture.cjs`) captures raw daily logs and optionally runs the Haiku curator under `MEMORY_PROFILE=strict`. Those are separate concerns from memory acquisition — the curator dedups existing memories, it does not create new ones.

Confidence decay: based on **active work days** (days with git commits), not calendar days. A project untouched for months has zero decay. Rates — `decisions: 0.98^days` (~35 work-day half-life), `constraints: 0.97^days` (~23), `patterns: 0.95^days` (~14), `workflows: 0.93^days` (~10). Below 0.3 = stale, below 0.1 = archive candidate. Config in `constants.js MEMORY_DECAY`.

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

Secret hooks share `secret-patterns.cjs`. Scanner also runs as git pre-commit hook via `.githooks/pre-commit`.

## Key File Paths

| File | Purpose |
|------|---------|
| `.claude/core/gate.js` | Build/test gate with auto-detection |
| `.claude/core/constants.js` | System-wide constants, phase artifacts, doc chain |
| `.claude/core/daily-log.js` | Standalone daily log capture — called by `/end` and pre-compaction hook |
| `.claude/core/memory-manager.js` | Memory CRUD + search + decay + linting (JSON + SQLite FTS5) |
| `.claude/core/memory-extractor.js` | Haiku-powered structured extraction from daily logs (manual/brownfield only — see `docs/.output/reviews/2026-04-20-adr-memory-unification.md`) |
| `.claude/core/memory-curator.js` | Haiku-powered dedup/contradiction/merge analyzer (runs on Stop when `MEMORY_PROFILE=strict`) |
| `.claude/core/memory-promoter.js` | Scan/rank/mark concepts for promotion to templates/skills |
| `.claude/core/gen-timeline.js` | Weekly commit history generator → `docs/_project-timeline.md` |
| `.claude/core/metrics.js` | Workflow metrics from telemetry + git + TODOs |
| `.claude/core/template-updater.js` | Zone-aware template sync to downstream projects |
| `.claude/core/status.js` | TODO progress + metrics → text + HTML dashboard |
| `.claude/core/scaffold.js` | Copies templates → `docs/` and root configs |
| `.claude/version.json` | Template version (semver), used by template-updater |
| `.claude/hooks/secret-scanner.cjs` | Secret/credential detection (50+ patterns) |
| `.claude/templates/` | Blank document templates with `{placeholders}` |
| `.claude/templates/root/` | Root-level configs (`.gitignore`, `.githooks/`, `.playwright/`) |
| `.claude/agents/*.md` | Subagent definitions |
| `.claude/skills/` | 26 skill modules |
| `docs/reference/system-map.md` | Complete system inventory and workflow graphs |
| `docs/reference/customization.md` | Zone map for template update merge strategy |

## Build & Test

Vitest is configured at the repo root. Tests live colocated with their source under `.claude/core/__tests__/` and `.claude/hooks/__tests__/`.

- `npm install` — install devDeps (vitest, @vitest/coverage-v8)
- `npm test` — run all test suites
- `npm run test:watch` — watch mode
- `npm run test:coverage` — run with v8 coverage report (output to `docs/.output/telemetry/coverage/`)

`node .claude/core/gate.js test` auto-detects the Node stack via `package.json` and runs `npm test`. Coverage thresholds on `.claude/core/**`: 70% lines, 60% branches.

Test directories (`__tests__/`, `_helpers/`) are excluded from `template-updater.js` propagation — they stay local to this repo.

After `/review:specialize` customizes for a downstream project, this section should describe the project's actual build/test commands alongside the Vitest setup.
