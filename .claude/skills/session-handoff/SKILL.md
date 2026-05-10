---
name: session-handoff
description: "Use WHEN writing or regenerating docs/__handoff.md after a session, task, or test run — provides the template and fill rules consumed by /end, /do, /run-todo, /run-tests, and /todo."
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [session, handoff, state, prime, continuity]
user-invocable: false
allowed-tools: Read, Write, Bash, Grep, Glob
---

# Session Handoff

## Overview

`docs/__handoff.md` is the file `/prime` reads on cold start to resume work. This skill owns the handoff template, rules, and fill guidance so every command that produces a handoff produces it the same way.

**Core principle:** Only write what git CAN'T tell you. Git knows what changed. The handoff carries **intent, decisions, blockers, and next actions** — the stuff that lives in your head, not in commits.

**Announce at start:** "I'm using the session-handoff skill to regenerate the handoff."

## When each command invokes this skill

| Command | When | Purpose |
|---------|------|---------|
| `/end` | End-of-session cleanup | Explicit save-state for next session |
| `/do` | After Step 9d commit | Every task leaves a fresh handoff — losing the session doesn't lose post-commit context |
| `/run-todo` | After each wave's commit (Phase 2 Step 8) AND after Phase 3 final report | Per-wave resumability + final state |
| `/run-tests` | After final report (Phase 3) | Test findings + bugs land in the handoff for next session triage |
| `/todo` | After Phase 6 report | A newly-created TODO is "ready to execute" — handoff points the next session at it |

The handoff is always a SNAPSHOT of current state, not a log. Each invocation **overwrites** — never appends.

## Step 1: Gather live state

```bash
git status --short
git log --oneline -5
```

No need to run tests — the caller has already gated.

## Step 2: Check for unfinished plans

```bash
ls docs/.output/plans/**/*.md 2>/dev/null
```

For each plan file, grep for `- [ ]` unchecked items. Any with unchecked items should be flagged in Decisions & Context with the plan path + what's left.

## Step 3: Write the handoff from conversation memory

You (the main agent) have the session context. Write the file directly — no sub-agent needed. Overwrite `docs/__handoff.md` completely; never append to old content.

### Template (target ~50 lines of content)

```markdown
# Session Handoff ({YYYY-MM-DD})

## Decisions & Context (max 5 bullets)
{Things NOT in git commits — decisions made, approaches rejected, discoveries.}
{If a plan file has unchecked items, note it here with the path.}
{Each bullet should be a full paragraph — explain the WHY and what was tried/rejected.}
{Include technical details that would take 10+ minutes to re-discover.}
-
-

## Current State
- **Branch:** {from git status}
- **Build:** {Clean — assumed, caller gated before reaching here}
- **Last commit:** {hash} — {subject}

## Next Actions (max 3)
{Actual work for next session. NOT "push" or "commit" — those already happened.}
{Each action should include enough detail to start immediately — file paths, what to search for, specific approach to try first.}
1. {first priority — why, and how to start}
2. {second priority}

## Blockers (omit section if none)
- {only real blockers — include what was tried}

## Key Files (max 5)
- {path} — {why relevant to Next Actions, what to look for}
```

**Key Files mechanics (read this before populating).** `/prime` Step 2 reads every listed file IN FULL — line-range annotations like `:47-89` are ignored by spec. The list directly controls cold-start token cost. Two repos' worth of audit data shows a single bad Key File entry can spike `/prime` from ~60k to ~100k tokens. The hard rules in **Key Files lifecycle** (between Steps 4 and 5) are mandatory, not advisory.

## Step 4: Command-specific tailoring

Different callers have different information to emphasize. Fill the template with these adjustments:

### `/end` — general session close
- **Decisions & Context:** everything that happened this session
- **Next Actions:** what the user wants to do next session
- **Last commit:** usually the most recent feature/fix commit

### `/do` — after a single task commit
- **Decisions & Context:** the task-specific decisions (rejected approaches, gotchas discovered)
- **Next Actions:** next story in TODO, OR next logical step from conversation
- **Last commit:** the `/do` commit itself
- The paired plan file at `docs/.output/plans/{date}-do-{slug}.md` should be mentioned in Key Files if the completion report has material worth re-reading

### `/run-todo` — after a wave commit OR final report
- **Decisions & Context:** agent misalignments, wave-level decisions, stories blocked/deferred
- **Next Actions:** next wave OR next epic OR `/review:retro` if all done
- **Last commit:** the most recent wave commit
- If stories are blocked (`[!]`), call them out in Blockers
- The paired plan file at `docs/.output/plans/{date}-run-todo-{slug}.md` is always a Key File

### `/run-tests` — after test execution
- **Decisions & Context:** bug summaries, blocker root causes, flaky test patterns
- **Next Actions:** fix bugs found (ordered by severity), re-run failed categories, or retro
- **Blockers:** every `[!]` category from testing, with root cause
- **Key Files:** `docs/.output/screenshots/{date}/{task}/TEST-REPORT.md` always listed

### `/todo` — after TODO creation
- **Decisions & Context:** one bullet on why this TODO was created, what it accomplishes
- **Next Actions:** always `/run-todo {path}` as #1, `/do {first-story-id}` as #2
- **Key Files:** the new TODO path + research files from `docs/.output/work/{date}/{slug}/`

## Key Files lifecycle (mandatory — applies to every caller)

`/prime` Step 2 reads every Key File in full. Listing the wrong files turns one cold start into a 90-100k token session. The rules below come from cross-repo token-economics audits (`docs/.output/investigations/2026-04-25-token-economics.md` and `…-DISPATCH.md`); they are mandatory, not advisory.

### Never list as Key Files

- **`CLAUDE.md` and `docs/CLAUDE.md`.** Both auto-load at session start. Listing them causes `/prime` to read them again — pure waste. Measured cost: 116k tokens of redundant loading over 14 days on Agents (21 occurrences × 5.5k tokens each).
- **Raw telemetry: `*.jsonl`, hook-events logs, command-usage logs.** Append-only data files, not session-resumption context. `hook-events.jsonl` alone added 20.7k tokens to a single `/prime` in the audit window. If telemetry needs analysis, the next session can read it on demand — not at cold start.
- **Files over 20kb (~5k tokens).** Line-range annotations (`:47-89`) do NOT save tokens — `/prime` Step 2 explicitly ignores them and reads the whole file. If a heavy file is genuinely needed for resume, split it: smaller live file + archive on disk. Reference precedent: `docs/.output/agent-updates.md` 38kb → 1kb live + 37kb archive on 2026-04-25.
- **TODO files for closed epics.** Once the epic's final wave commits, the TODO becomes historical record. Replace with a one-line summary in Decisions & Context: *"Epic X complete — N stories, see commit Y."* Drop the file from Key Files on the same `/end` that closes the epic.
- **Source files past their story commit.** During active structural work on `routes/login.tsx` (or any source file), listing it as a Key File is correct — the next session needs the full file to resume. After the story closes, drop it. Source-file Key Files carrying 2-3 sessions past completion add 2-5k tokens of cold-start detail with zero resumption value.
- **Large reference docs** (`docs/reference/commands.md`, system maps, etc.) outside the specific session's scope. They're CLAUDE.md-equivalent overviews — useful when researching commands, noise on every other session.

### Legitimate Key Files

- The plan file paired with this session's work (`docs/.output/plans/{date}-{do|run-todo}-{slug}.md`).
- The current TODO file *while the epic is in flight* (only). Drop it once final wave commits.
- Investigation, audit, or review reports the next session needs to act on (drop once acted on).
- Specific source files the next session will edit *first* — but only if Next Actions name them as the starting point.
- The split live file when an archive pattern is in play (e.g., `agent-updates.md` post-split — keep listing it, it's 1kb).

### When in doubt

Ask: *"Will the next session need to read this file's full contents to do step 1 of Next Actions?"* If no, it's not a Key File. Decisions & Context can name a path without `/prime` having to read it. The mention costs ~30 tokens; reading it costs the file's full size.

## Step 5: Commit (caller-dependent)

- `/end` commits the handoff with `docs: /end — {brief}` since that's its whole job
- `/do`, `/run-todo`, `/run-tests`, `/todo` already commit their primary work in a prior step. For them, the handoff is **included in the same commit** (stage `docs/__handoff.md` alongside the other changes) OR committed separately with a `docs: handoff refresh` message. Including in the primary commit is preferred — one atomic unit per operation.

**Never push automatically.** The user decides when to push.

## Step 6: Promote reusable learnings to memory

After writing Decisions & Context, read your own bullets with fresh eyes and ask: would a future agent — either resuming this project next month or starting a brand-new project using this template — benefit from knowing this? If you find 1–3 bullets that meet that bar, write them to the memory store now. If you find zero, that is the correct and common answer. Do not manufacture memories to fill a quota — this is a judgment call, not a checkbox.

### Step 6a: Check the inbox first

Sub-agents may have flagged drafts to `docs/.output/memories/_inbox/` during the session (per the Memory Inbox Protocol in `.claude/agents/*.md`). The dispatch templates in `/do` and `/run-todo` are supposed to curate per-dispatch — but if a session was interrupted, or a curation step was skipped, drafts can survive into handoff time.

Run the listing:

```bash
node .claude/core/memory-manager-cli.js inbox-list
```

For each entry, decide promote (`inbox-promote <id>`) or discard (`inbox-discard <id>`) using the same qualification rules described below. The inbox is for transient capture; do not leave drafts lingering across sessions. If the inbox is empty, this step is a no-op — proceed to Step 6b.

### Step 6b: When a bullet qualifies

A Decisions & Context bullet qualifies as a reusable memory if it describes:

- **A pattern** — a technique, discipline, or approach that proved its value and should be repeated.
- **A constraint** — a platform limitation, tool incompatibility, or API behavior that will bite the next person who doesn't know it.
- **A workflow improvement** — a sequencing or process insight that made an operation safer or faster.
- **A rejected approach** — a path that looked correct but failed for a non-obvious reason, so future sessions don't retry the same dead end.

The key test: would this be useful in a future session on **this project** OR on **a new project using this template**? If yes, it qualifies. If the bullet only matters for the next 24 hours, it does not.

### When a bullet does NOT qualify

Do not write a memory for:

- **Pure project state** — epic progress, which branch is ahead, a specific story's completion percentage. Git and TODO files own that.
- **One-off fixes with no reusable principle** — "bumped lodash to 4.17.21 to fix build" tells the next session nothing generalizable.
- **Story-specific gotchas** — a detail that only applies to the exact feature just implemented and won't recur in any form.

### Eligible categories

Five categories are valid targets for handoff-sourced memories:

- **`decisions`** — Architectural or strategic choices with documented rationale that constrain future implementation direction. Longest decay half-life (~35 work days); write at 0.8–0.9 confidence when the decision is field-validated or ADR-backed.
- **`patterns`** — Repeatable techniques or disciplines with demonstrated value.
- **`constraints`** — Platform, environment, or tool limits that constrain how something must be done.
- **`workflows`** — Process sequencing or operational insights that make a recurring task safer or faster.
- **`rejected-approaches`** — Approaches that were tried, failed, and shouldn't be retried without new information.

### The write command

```bash
node .claude/core/memory-manager.js create {category} {kebab-slug} '{json-payload}'
```

The third argument is the **content object** — everything inside the `content` field of the stored memory. The manager wraps it with `id`, `type`, `category`, and timestamps automatically. Single-quote the payload in bash because the JSON contains double quotes.

Always include a `description` field. Beyond that, use the optional content fields below to capture what's in your head at write time — the whole point of a memory is that a future agent reads it and doesn't have to rediscover what you already know. Pick whichever fields apply; there's no fixed schema.

### Think about shape before you write

The single biggest failure mode is writing one thin sentence when you have ten rich ones in context. When you decide to write a memory, pause and ask yourself three questions:

1. **Do I have code?** If yes, paste it in a `code_example` field. Don't describe the fix in prose when you can show it. Future agents (and tools) grep for code far more reliably than they parse narrative.
2. **Did I consider alternatives?** If yes, list them in an `alternatives` array with a one-line rationale per option. The "why we didn't do X" context rots fast and is expensive to rederive.
3. **What specific incident proves this matters?** Anchor to a story ID, file path, commit hash, or date. A memory without a concrete incident reads like generic advice and gets ignored.

The `description` is the cover; the other fields are the body. Use both.

### Optional content fields (all categories)

| Field | Use when |
|---|---|
| `description` | **Required.** One-paragraph summary — what and why, no code. |
| `code_example` | You have a working snippet (preferred) or counter-example. Multi-line strings are fine in JSON. |
| `wrong_pattern` | The mistake to avoid, paired with `correct_pattern`. |
| `correct_pattern` | The shape that works. (Pairs well with `wrong_pattern` or `banned`.) |
| `alternatives` | Array of `{approach, why_not}` for options considered and rejected. |
| `steps` | Ordered procedure when "do X then Y then Z" matters. |
| `reference` | File:line pointer to where the fix/rule lives in code. |
| `evidence` | Concrete incident — story ID, commit hash, or one-line scenario that triggered the learning. |
| `confidence` | 0.0–1.0 numeric. See the scale above. |

**Category-specific defaults:**
- `decisions` — add `rationale` or `supersedes` when applicable; confidence 0.8–0.9.
- `patterns` / `workflows` — confidence 0.7–0.9 (higher when field-tested multiple times).
- `constraints` — add `correct_pattern`, `banned`, `reference` (file + line where the fix lives).
- `rejected-approaches` — add `why_rejected` (the specific symptom that proved it wrong).

### Worked examples

The three examples below show the richness range deliberately — a multi-paragraph description, a code-bearing payload, and a payload with a named alternatives array. None of them is a one-sentence stub. Aim for this bar.

#### Example 1 — pattern with multi-paragraph description + evidence anchor

> "Plan-first discipline paid off again — locked function signatures and AC table before dispatching agents, zero signature drift across 8 agents in Wave 4."

```bash
node .claude/core/memory-manager.js create patterns plan-first-before-agent-dispatch '{"description": "Before /run-todo dispatches dev agents, Main Agent writes a plan file that locks three things: the exact file list each story owns, the function signatures agents must implement, and the AC reconciliation table. Every dispatched agent then sees the same contract — no agent invents its own variable names, no two agents fight over the same file.\n\nThe cost is ~10 minutes of context assembly. The payoff scales with wave size: for 8+ agent waves, the alternative is cascading signature-drift fixes that take longer than the plan itself. Below 3 agents, the overhead usually outweighs the benefit — Main-Agent-direct is faster.", "evidence": "Field-tested across 4 epics: Wave 4 TDD-5 (8 agents, zero drift), Wave 6 TDD-6 (10 agents, zero drift), MU Wave 2 (3 agents, zero drift).", "confidence": 0.9}'
```

#### Example 2 — constraint with wrong/correct pattern pair + code_example

> "Rejected spawning the memory compiler with detached:true + windowsHide:true — the two flags conflict at CreateProcess, causing a brief console flash. Switched to stdio:'ignore' + windowsHide:true + child.unref()."

```bash
node .claude/core/memory-manager.js create constraints windows-detached-hide-conflict '{"description": "On Windows, combining spawn options detached:true with windowsHide:true causes a brief console flash — the child briefly owns a visible console before hide applies. The two flags conflict at the CreateProcess API layer.", "wrong_pattern": "spawn(cmd, args, { detached: true, windowsHide: true })", "correct_pattern": "spawn(cmd, args, { stdio: '\''ignore'\'', windowsHide: true }); child.unref();", "code_example": "// Fire-and-forget child on Windows without a console flash\nconst child = spawn(nodeBin, [script], {\n  stdio: '\''ignore'\'',\n  windowsHide: true,\n});\nchild.unref(); // parent can exit without waiting", "reference": ".claude/hooks/memory-capture.cjs spawnCurate() lines 67-78", "evidence": "Observed during MU testing on Windows 11 — flash was ~80ms, enough to be jarring."}'
```

#### Example 3 — workflow with alternatives array

> "Code-review gate caught two real AC gaps before commit in Wave 3 — a missing dup-count assertion and an order-sensitive toEqual. Fixing MAJOR findings inline before commit (not deferring) is what kept the suite trustworthy."

```bash
node .claude/core/memory-manager.js create workflows major-review-fix-before-commit '{"description": "MAJOR findings from code-reviewer must be fixed inline before the wave commit, never deferred to a follow-up story. Code-review is a quality gate, not advisory — deferring creates drift between the story status (done) and the actual correctness (incomplete).", "alternatives": [{"approach": "Defer MAJOR findings to a follow-up cleanup story", "why_not": "Follow-up stories get reprioritized or forgotten; the drift compounds."}, {"approach": "Downgrade MAJOR to MINOR if the test still passes", "why_not": "Conflates 'builds' with 'correct' — hides the real AC gap."}, {"approach": "Block the wave commit entirely until ALL findings (including MINOR) are fixed", "why_not": "MINOR findings are often cosmetic; blocking on them slows cadence without commensurate quality gain."}], "evidence": "Wave 3 of TDD-5 caught a missing dup-count assertion (would have let silent seeding failures pass); Wave 4 caught an order-sensitive toEqual (would have caused flaky tests on parallel runs).", "confidence": 0.85}'
```

**Note the shape difference:** the pre-bundle skill (before 2026-04-20) modeled thin one-sentence descriptions. These three examples are the new floor. If your bullet has enough substance to be worth a memory, it has enough substance for a payload of this richness.

### Writing multi-line content via `--payload-file`

When the payload has embedded newlines or complex escaping (code blocks, multi-line alternatives), bash single-quote escaping gets hostile. Write the JSON to a temp file and ingest via the `ingest` subcommand pattern, or construct the payload in your editor and paste it as one line. The shape matters more than the write mechanism.

### When NOT to write a memory

- **One-off fix with no reusable principle.** "Pinned dependency X to resolve a transient build failure" isn't actionable for anyone later.
- **Restates an existing memory.** If a similar entry already exists, use `/remember` to surface the update rather than creating a duplicate. Duplicate memories dilute search results.
- **Pure state that'll be stale in 24 hours.** "Wave 3 is 60% complete" is useful in the handoff; it's noise in the memory store.

### Mid-session capture — `/remember` vs. direct write

If you notice a reusable insight mid-session — before a handoff is due — you have two options:

- **`/remember`** — writes to the daily log immediately. Lightweight and fast, but the daily log is not indexed by `memory-manager.js search` and is not auto-extracted into structured memory. The insight reaches the structured store only when someone later runs `/review:memory-health` or `memory-extractor.js extract` manually.
- **Direct write via `memory-manager.js create`** — populates the structured store immediately and makes the memory searchable right away. Use this when the insight is clearly reusable and worth the extra 30 seconds to write the payload.

Default to `/remember` for fleeting captures you want off your mental stack. Use direct write when the insight is material enough that you want it grounded in the next sub-agent dispatch.

## Rules

- **Target ~50 lines of content.** Enough to cold-start without re-reading code. Under 30 is too sparse; over 60 is a novel.
- **Overwrite, don't append.** Each call nukes and rewrites the file.
- **Flag unfinished plans.** If `docs/.output/plans/` has active plans with unchecked items, call them out in Decisions & Context.
- **No git narration.** Don't write "committed 302 tests" — git log shows that.
- **No CLAUDE.md duplication.** Don't restate architecture, conventions, or infrastructure.
- **No task lists.** Those live in `_backlog.md` and TODO files, not the handoff.
- **No test runs.** The caller has already tested. Don't waste time re-running.
- **Decisions > descriptions.** "Rejected approach X because Y" beats "implemented feature Z."
- **No housekeeping as next actions.** Don't list "push to origin" or "commit changes" — those already happened.
- **No "uncommitted" or "ahead of origin"** fields — handoff reflects post-commit state.
- **Key Files lifecycle is mandatory.** See the **Key Files lifecycle** section between Steps 4 and 5 for the full hard-rule list. Every entry over 5k tokens compounds across every `/prime` until removed.
- **Never list `CLAUDE.md`, `docs/CLAUDE.md`, raw `*.jsonl` telemetry, or any file >20kb** as a Key File. Line-range annotations do not save tokens — `/prime` ignores them.
- **Drop closed-epic TODOs and post-story source files from Key Files.** When the wave that closes a story commits, edit the Key Files list in the same handoff. Replace the TODO with a one-line summary in Decisions & Context.

## Cross-References

- Template origin: originally lived inline in `.claude/commands/end.md`, extracted here for reuse.
- Reads: `git status`, `git log`, `docs/.output/plans/**/*.md` (for unfinished plans check)
- Produces: `docs/__handoff.md` (overwrite)
- Writes: structured memories to `docs/.output/memories/{category}/{slug}.json` via `memory-manager.js create` (Step 6, 0–3 per session)
- Consumed by: `/prime` — reads this file + its Key Files on cold start
