---
name: prime
description: Gain a general understanding of the codebase and project lifecycle phase
argument-hint: [context]
---

# Prime

Cold-start a new session. CLAUDE.md + agent memory already auto-load — this command fills in the gaps: what happened recently, what's next, and is anything broken.

## Variables

TASK_DESCRIPTION: CONTEXT

- `CONTEXT` (optional): File(s) or folder(s) to read instead of the default workflow. Use when you need to deep-dive a specific area.

## Workflow

- If `CONTEXT` is provided:
  - Read each file or folder specified
  - Summarize what you found
  - Done — skip the rest

- Else run the **cold-start sequence**:

### Step 1: Read the handoff + git reality (parallel)
```
Read docs/__handoff.md
git log --oneline -20
git status --short
```
The handoff has decisions, intent, blockers, and next actions from the previous session. Git is the source of truth — do NOT trust the handoff over git. If the handoff doesn't exist, scan `docs/todo/_backlog.md` instead.

### Step 2: Read the handoff's Key Files (parallel)

The handoff's `## Key Files` section is the curated short list of files needed to resume work. Read every file path listed there in parallel. Rules:
- Extract paths from bullets under `## Key Files` (ignore line-range annotations like `:47-89` — just read the whole file)
- Skip anything that isn't a readable file (directories, globs, missing files — note them but don't fail)
- If the handoff has no `## Key Files` section, skip this step
- Also read any file path explicitly called out in `## Next Actions` as the first file to touch — but only one or two, don't chase every mention

This is the "did you read all of these?" fix. Listing files without reading them is worthless; the next session needs the content loaded to act on step one of Next Actions immediately.

### Step 3: Verify & synthesize

Compare the handoff against git reality:
- If handoff says "next: implement X" but `git log` shows X was already committed → **flag as stale**, ignore that action
- If handoff is missing or completely stale → scan `docs/todo/_backlog.md` for pending work
- If a Key File's current contents contradict the handoff's description of it → trust the file, flag the drift

## Report

Provide a substantive summary (**30-60 lines**) that gives enough context to start working immediately:

- **Recent work**: 3-5 bullet summary from `git log` — what changed and why it matters
- **State**: branch, uncommitted files, deployed status
- **Decisions & context**: key decisions from the handoff — include the reasoning, not just the conclusion
- **Files loaded**: explicit list of every Key File read in Step 2, one per line with a `✓` (read) or `✗ missing` / `✗ skipped` marker. This is the answer to "did you read all of these?" — if a handoff file couldn't be read, it has to show up here as skipped, not silently omitted.
- **Next actions**: from handoff (if fresh) or from epics (if stale/missing). Include enough detail to start immediately — file paths, what to search for, specific approach to try first
- **Blockers**: from handoff, only if still relevant — include what was already tried
- **Ready to work**: confirmation you understand what needs to be done

## What NOT to Do
- Do NOT read `_project-architecture.md` or `_project-context.md` — CLAUDE.md already has this
- Do NOT read CLAUDE.md — it auto-loads, reading it again wastes tokens
- Do NOT load full planning docs unless the handoff is stale/missing
- Do NOT produce a report under 20 lines — that's too sparse to cold-start from
- Do NOT exceed 60 lines — that's a novel
