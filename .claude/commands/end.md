---
name: end
description: Save session context for continuing work in a new conversation
argument-hint: [optional notes]
---

# End Session

Write `docs/__handoff.md` — the handoff file that `/prime` reads next session.

This command is the **end-of-session** invocation of the handoff writer. `/do`, `/run-todo`, `/run-tests`, and `/todo` also produce handoffs as part of their own pipelines, so running `/end` after one of those is optional — but it's harmless and gives you a dedicated save point.

## Shared writer

The handoff template, fill rules, and command-specific tailoring all live in the **`session-handoff` skill** (`.claude/skills/session-handoff/SKILL.md`). Read it before writing. That skill is the single source of truth for what goes in `docs/__handoff.md`; this command is the orchestrator.

## Steps

### 1. Organize loose files

```bash
node .claude/hooks/organize.cjs
```

### 2. Gather live state (per the skill, Step 1 + 2)

```bash
git status --short
git log --oneline -5
ls docs/.output/plans/**/*.md 2>/dev/null
```

Check unfinished plans (grep for `- [ ]` in each plan file).

### 3. Write the handoff

Follow the `session-handoff` skill template. Tailor for the `/end` case (Step 4 in the skill): general session close, covering everything that happened this session.

**Overwrite `docs/__handoff.md` completely.** Never append.

### 4. Commit the handoff

Write the commit message to `.git/CLAUDE_COMMIT_MSG` (Write tool — no shell escaping):

```
docs: /end — {brief summary of session focus}
```

Then run:

```bash
git add docs/__handoff.md
node .claude/core/commit.js
```

### 5. Show the user

Output the file content for review.

## Rules

All rules live in the `session-handoff` skill — read them there. Two reminders specific to `/end`:

- **Commit, don't push.** `/end` commits the handoff but does NOT auto-push. The user decides when to push.
- **Memory acquisition happens via the session-handoff skill's Step 6** (Main Agent writes 0–3 structured memories from handoff bullets that qualify as reusable learnings). No auto-extraction fires from `/end` or any other command. The Stop hook still captures raw daily logs and runs the curator under `MEMORY_PROFILE=strict`. See `docs/.output/reviews/2026-04-20-adr-memory-unification.md`.
