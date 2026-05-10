# Memory

Memory in this system is a persistent, compounding record of what each session learned — written to disk, scored by confidence, decayed over time, and surfaced into future sessions automatically. It is how the template gets smarter as you use it, without you having to keep re-explaining things. When a new session starts and `session-start-prime.cjs` injects a block of `[patterns]` concepts into the context, that's memory in action: the top-ranked things this project has figured out, handed to you before the first turn.

It is deliberately not a database. There's no query language, no schema migration, no indexing beyond SQLite FTS5 for search. It's a pile of files under `docs/.output/memories/` that five small scripts shape into something useful. The point is durability across sessions, not structured retrieval.

## The pipeline

Each session runs memory through five stages. The four-stage automated pipeline runs on hooks; **Acquire** is Main Agent's job at session-handoff time and lives outside the pipeline diagram below.

```
┌─────────┐    ┌─────────────────┐    ┌──────────────────┐    ┌─────────┐
│ capture │ -> │ curate (strict) │ -> │ extract (manual) │ -> │ promote │
└─────────┘    └─────────────────┘    └──────────────────┘    └─────────┘
 daily logs     dedup,                 Haiku-powered            mark for
 from session   merge,                 structured               templates
 events         contradict             extraction               and skills
```

1. **Capture** — every session ends with `memory-capture.cjs` firing on the `Stop` hook. It writes a daily log entry summarizing what happened (tasks, commits, decisions). `pre-compaction-archive.cjs` also captures a log before context compaction, so work survives auto-compression. Opt-in: `edit-capture.cjs` records edits to canonical docs (CLAUDE.md, architecture, skills) as daily-log entries when `MEMORY_PROFILE=strict`.
2. **Acquire** — Main Agent writes 0–3 structured memories per session via `memory-manager.js create`; the daily log feeds optional brownfield extraction (`memory-extractor.js extract`) for adopter projects.
3. **Curate** — `memory-curator.js` runs on `Stop` when `MEMORY_PROFILE=strict`. Haiku analyzes the concept set for duplicates, contradictions, and merge candidates. Outside strict profile, this stage is skipped.
4. **Extract** — `memory-extractor.js` pulls structured facts from daily logs via `claude -p` (Haiku). Manual/brownfield-only: no hook or command fires this automatically. Run it by hand via `node .claude/core/memory-extractor.js extract` when onboarding an existing project with historical daily logs, or via `/review:memory-health` which runs it as part of the periodic health check. In-process memory acquisition is owned by Main Agent at session-handoff time — see `docs/.output/reviews/2026-04-20-adr-memory-unification.md`.
5. **Promote** — `memory-promoter.js scan` ranks concepts by their decayed confidence × recency × usage. High-ranked concepts get reviewed for promotion into templates, skills, or agent instructions — the point where a memory graduates from "knowledge the system remembers" to "knowledge the system enforces."

Most of this runs on hooks without you thinking about it (see [`./hooks.md`](./hooks.md)). The `memory-*.js` scripts are also runnable directly when you want to inspect, search, or manually curate.

## Confidence

Every memory carries a confidence score from 0.5 to 0.9. The scale corresponds to how much evidence backs it:

| Level | Label | Assigned when |
|-------|-------|---------------|
| 0.9 | architecture | Locked by an ADR or the architecture document |
| 0.8 | retro-validated | Confirmed by an epic retrospective |
| 0.7 | implementation-proven | Survived actual implementation and stayed true |
| 0.6 | story-discovered | Surfaced during a single story's execution |
| 0.5 | session-observed | Noticed in one session, not yet repeated |

A memory can start at 0.5 and climb as it accumulates sources and gets validated. It can also start higher if it's written hand — `memory-manager.js create` lets you assign confidence directly. Hand-created memories bypass the `sources >= 2` filter because intentional human curation doesn't need a noise floor.

## Decay

Confidence doesn't stay fixed. Memories decay on **active work-days** — days with at least one git commit in this repo — not calendar days. A project untouched for three months has the same memory state it had when you left it. The clock only moves when you do.

Per-category decay rates:

| Category | Rate | ~Half-life (work-days) |
|----------|------|------------------------|
| `decisions` | `0.98^days` | ~35 |
| `constraints` | `0.97^days` | ~23 |
| `patterns` | `0.95^days` | ~14 |
| `workflows` | `0.93^days` | ~10 |

Workflows decay fastest because how a team works changes fastest. Architecture decisions decay slowest because they're expensive to change. The rates are tuned in `constants.js MEMORY_DECAY` — overridable per project.

Thresholds: below 0.3 is stale (still visible, but deprioritized in ranking). Below 0.1 is archive-candidate (hide from defaults, keep on disk for audit). `node .claude/core/memory-manager.js decay-report` lists the stalest memories first so you can prune or refresh them.

### Memory data model — hand-created vs (retired) compiled

The primary path into the memory system is hand-created:

- **Hand-created memories** — `docs/.output/memories/{cat}/{slug}.json`. Produced by `memory-manager.js create`. No source-count filter. Represents deliberate human curation — use for rules, decisions, or context you want remembered whether or not it came up in session transcripts. Main Agent writes 0–3 of these per session at handoff time.
- **Compiled concepts (legacy)** — `docs/.output/memories/concepts/{cat}/{slug}.md`. Produced by `memory-compiler.js` from daily logs. Needed 2+ sources to file. Represents observed reality accumulated across sessions.

Both paths feed the same ranking and decay pipeline. `memory-promoter.js scan` and `mark` operate on both. The distinction matters only when you're deciding how to add a new memory: want to lock in a fact now? Create it by hand via `memory-manager.js create`. Working from historical logs in an adopter project? Run `memory-extractor.js extract` (manual Haiku).

Note: compiled concept articles produced by `memory-compiler.js` were retired 2026-04-20 — the file remains for backward compat in adopter projects but is not part of the active pipeline.

## Key scripts

| Script | What it does |
|--------|--------------|
| `memory-manager.js` | CRUD + search + decay + 7-point health lint (SQLite FTS5 index) |
| `memory-compiler.js` | Daily logs → concept articles (retired 2026-04-20 — preserved for backward compat; not part of active pipeline) |
| `memory-extractor.js` | Haiku-powered structured extraction from daily logs (manual/brownfield only — no auto-fire) |
| `memory-curator.js` | Haiku-powered dedup / contradiction / merge analyzer (strict profile only) |
| `memory-promoter.js` | Scan/rank/mark concepts for promotion to templates and skills |

`memory-manager.js report` is the one-liner for "show me everything." `memory-manager.js search "topic"` hits the FTS5 index. `memory-manager.js decay-report` lists the stalest memories first. Running these by hand never hurts.

The hook that drives the auto-compound is `memory-capture.cjs`, not a `memory-*.js` script — it lives under `.claude/hooks/`. See [`./hooks.md`](./hooks.md) for the full hook inventory.

## When to lean on memory (and when not to)

Lean on it when:

- **A future session will benefit from something you figured out now.** Store the rule, the decision, the rejected approach. Future-you or a future agent will thank you.
- **You want the next `/prime` to surface context automatically.** `session-start-prime.cjs` pulls top-ranked concepts into every new session's opening context. Memory is the way to get something on that list.
- **You keep re-explaining the same thing.** If you've corrected the same mistake twice, that's a memory. Create it by hand if the compiler hasn't caught it yet.

Don't lean on it when:

- **The information belongs in code or config.** Memory is not a substitute for writing the rule into a hook, skill, or command. Memories are what you notice; artifacts are what you enforce. The promotion pipeline exists exactly to migrate high-signal memories from one to the other.
- **The knowledge is ephemeral.** In-session state belongs in a plan file or a TaskList, not memory. Memory is for things that will still matter next week.
- **You want authoritative answers right now.** Memory can be stale, decayed, or contradicted by newer state. Read the file or run the command when you need ground truth — memory is context, not oracle.

---

See also: [`./hooks.md`](./hooks.md) for the hooks that drive the auto-compound (`memory-capture.cjs`, `session-start-prime.cjs`, `edit-capture.cjs`, `pre-compaction-archive.cjs`), [`./agents.md`](./agents.md) for the agents that read and write memory during their work, [`./commands.md`](./commands.md) for `/remember`, `/review:memory-health`, and `/review:promote-memories`, [`./skills.md`](./skills.md) for the skill catalog.
