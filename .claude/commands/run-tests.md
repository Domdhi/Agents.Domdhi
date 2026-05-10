---
description: Execute a manual/E2E testing checklist with parallel agents, screenshots, and TODO updates
argument-hint: [path to testing TODO file]
---

# /run-tests — Manual Testing Executor

Execute structured manual/E2E testing checklists against a running app. Main Agent owns the TaskList, triages results, and makes every judgment call. Playwright agents handle browser interactions. Main Agent handles non-browser checks directly — no delegation overhead for code/schema verification.

## Model Rule

**All browser-facing agents (playwright or chrome MCP) MUST use `model: "haiku"`.** Haiku reads the accessibility tree and DOM identically to Sonnet — it correctly verifies element existence, text content, disabled states, aria attributes, and interaction flows. Neither model evaluates rendered pixels, so Sonnet's extra reasoning buys nothing for functional browser verification. Visual/design QA (spacing, alignment, color, responsive) is a separate human pass.

## Browser Tool Selection

Two browser tools are available. Use the RIGHT one for the job:

| Tool | Agent Type | When to Use |
|------|-----------|-------------|
| `playwright-cli` | `playwright` agent | Headless automation, screenshots, form fills, navigation. Best for spec file generation and repeatable tests. |
| `mcp__claude-in-chrome__*` | `general-purpose` agent | Live Chrome DevTools interaction. Best for visual inspection, debugging, exploring pages interactively. Requires Chrome running. |

**Default to `general-purpose` with chrome MCP** when Chrome is available (check with `mcp__claude-in-chrome__tabs_context_mcp`). Fall back to `playwright` agent when Chrome is not available or for headless-only environments.

When dispatching `general-purpose` agents for browser testing, include this in the prompt:
```
BROWSER TOOLS: Use the mcp__claude-in-chrome__* tools for browser interaction.
Start with mcp__claude-in-chrome__tabs_context_mcp to see current tabs.
Use mcp__claude-in-chrome__navigate to go to pages.
Use mcp__claude-in-chrome__read_page to inspect content.
Use mcp__claude-in-chrome__computer for clicks and interactions.
```

## Repeated runs via `/loop`

`/run-tests` is one-shot — it executes the checklist once and reports. For repeated execution (post-deploy verification, mid-day regression polling, pre-merge canary), wrap it with the built-in `/loop` primitive instead of re-implementing scheduling here:

```
/loop 10m /run-tests docs/app/{feature}/TODO_testing.md
```

`/loop` is session-scoped (lives until the session ends or 7 days — Claude Code 2.1.x) and fires the inner command on the chosen interval. Pick the cadence to match what you're watching for:

| Cadence | Use case |
|---------|----------|
| `5m`–`15m` | Active deploy window — catch regressions immediately after each push |
| `30m`–`1h` | Mid-day polling on a busy branch — smoke checklist re-run |
| `2h`–`6h` | Background canary — broader checklist, low-frequency assurance |

Each iteration writes a fresh report to `docs/.output/screenshots/{date}/{Task}/TEST-REPORT.md`, so subsequent loops overwrite prior reports for the same task. If you need history, vary the task slug per loop or copy reports out before the next fire. **Don't build a project-local `/canary` or `/run-tests --watch` flag** — those are just `/loop` wrappers, and re-implementing scheduling primitives we already have is duplication. The same applies to any future scheduled-command idea (cleanup, listen, monitor): start by trying `/loop /<command>` first.

## Persistent Test Output

**Agents SHOULD produce permanent, rerunnable test artifacts — not throwaway reports.**

When the project has an E2E test framework (Playwright, Cypress, etc.):
- Agents write spec files to the project's test directory (e.g., `test/__test__/`, `e2e/`, `tests/`)
- Specs follow the project's existing patterns (auth/unauth separation, setup files, fixtures)
- Main Agent runs the test suite after spec generation to verify they pass
- Spec files are committed to source control

When no test framework exists:
- Agents still write structured verification scripts or checklists
- Screenshots and reports go to `docs/.output/screenshots/{date}/{task}/`

The goal: every test run leaves behind artifacts that can be re-executed without Claude.

## Variables

TODO_FILE: $ARGUMENTS

---

## Phase 0: Pre-Flight

### Step 1: Locate the Testing Checklist

```
IF TODO_FILE provided → read that file
ELSE → search:
  1. docs/app/**/TODO*Test*.md or docs/todo/**/TODO*Test*.md
  2. docs/app/**/*testing*.md or docs/todo/**/*testing*.md
IF multiple found → ask user which one
IF none found → ask user
```

### Step 2: Parse the Checklist

Extract:
- **Total checkpoints** by status: `[ ]` pending, `[x]` passed, `[!]` blocked/failed, `[S]` skipped
- **Categories** with dependency ordering (which categories gate others)
- **Target URL** and auth method
- **Known blockers** from previous runs

Identify:
- Categories already `[x]` → skip
- Categories `[!]` from prior run → re-test if user wants
- Categories `[ ]` pending → execute

### Step 3: Pre-flight checks

```bash
# Verify app is running
curl -s -o /dev/null -w "%{http_code}" {TARGET_URL}
```

- App not running → **HARD STOP**. Report that the app needs to be started. Do not test against nothing. Do not proceed to any other step. Do not dispatch any agents.
- App running but returning errors → warn, continue if user confirms

Create screenshot directories upfront:
```bash
mkdir -p docs/.output/screenshots/{YYYY-MM-DD}/{Task}/cat-{NN}/
```

### Step 4: Build the TaskList (spine)

Create TaskCreate items for the pipeline:

```
TaskCreate: "Pre-flight checks" → mark completed (already done)
TaskCreate: "Discover test selectors"
TaskCreate: "Non-browser checks (Main Agent direct)" (blockedBy: selectors)

--- Wave 1 (browser) ---
TaskCreate: "Wave 1: Cat {N} — {Name}" (blockedBy: non-browser)
TaskCreate: "Wave 1: Cat {M} — {Name}" (blockedBy: non-browser)
TaskCreate: "Wave 1: Triage results + update TODO" (blockedBy: wave 1 cats)

--- Wave 2 ---
TaskCreate: "Wave 2: Cat {P} — {Name}" (blockedBy: wave 1 triage)
...

--- Post ---
TaskCreate: "Cleanup + final report" (blockedBy: last wave)
```

---

## Phase 1: Preparation

### Step 5: Discover Test Selectors

`TaskUpdate: "Discover test selectors" → in_progress`

Before dispatching browser agents, verify actual test selectors exist in the codebase:

**Use `general-purpose` (NOT `Explore`) — Explore is read-only and cannot write the selector map to disk for reuse across browser agents.**

```
Agent(
  subagent_type: "general-purpose",
  prompt: "Search the source tree for all data-testid attributes related to {feature}. Write the exact selector map organized by component to docs/.output/work/{date}/{slug}/{time}-selectors.md, then return a concise summary.",
  description: "Find test selectors for {feature}"
)
```

This prevents agents from searching for selectors that don't exist. Save the selector map for inclusion in agent prompts.

`TaskUpdate: "Discover test selectors" → completed`

### Step 6: Non-Browser Checks (Main Agent Direct)

`TaskUpdate: "Non-browser checks" → in_progress`

Main Agent handles these directly — no delegation overhead:
- **Schema verification** — read migration/schema files, confirm structure
- **Seed data checks** — query or read seed files
- **Code inspection** — grep for expected patterns, imports, registrations
- **Config verification** — read config files, confirm values

Mark these categories `[x]` in the TODO file immediately after verification.

`TaskUpdate: "Non-browser checks" → completed`

---

## Phase 2: Browser Testing (Wave Execution)

### For each wave:

#### Step 7: Classify and dispatch agents

`TaskUpdate: "Wave {N}: Cat {X}" → in_progress` (for each category)

**Agent selection per checkpoint type:**

| Interaction Type | Who | Model | Rationale |
|-----------------|-----|-------|-----------|
| Code/file/schema verification | Main Agent (already done in Step 6) | — | No browser needed |
| Page load + screenshot | `general-purpose` agent (chrome MCP) | haiku | Navigate, screenshot, read text — chrome MCP preferred |
| Button click + form fill | `general-purpose` agent (chrome MCP) | haiku | Standard interaction via live Chrome |
| Complex UI + code inspection | `general-purpose` agent (chrome MCP) | haiku | Combine browser MCP and grep/read |
| Headless / CI environment | `playwright` agent | haiku | Primary for headless/CI environments |

**Prefer `general-purpose` with chrome MCP over `playwright` agent.** The chrome MCP tools interact with the user's actual browser — same session, same auth state, same cookies. `playwright` is the fallback for headless environments.

**Dispatch up to 4 parallel agents per wave.**

Each agent prompt MUST include:

```
CATEGORY: {N} — {Name}
TARGET: {URL}
AUTH: {method — e.g., "already logged in", "use test credentials X/Y"}

CHECKLIST:
{Paste exact checklist items with expected outcomes}

TEST SELECTORS:
{Selector map from Step 5 for this category's components}

SCREENSHOT FOLDER: docs/.output/screenshots/{YYYY-MM-DD}/{Task}/cat-{N}/
Create this directory first with mkdir.

BROWSER TOOLS (chrome MCP — preferred):
Use the mcp__claude-in-chrome__* tools for all browser interaction.
- mcp__claude-in-chrome__tabs_context_mcp — see current tabs
- mcp__claude-in-chrome__navigate — go to pages
- mcp__claude-in-chrome__read_page — inspect content and DOM
- mcp__claude-in-chrome__computer — clicks, typing, interactions
- mcp__claude-in-chrome__find — search for elements
- mcp__claude-in-chrome__form_input — fill form fields

If chrome MCP is not available, fall back to playwright-cli commands.

INSTRUCTIONS:
0. FIRST: Run `curl -s -o /dev/null -w "%{http_code}" {TARGET}/api/health` — if it does NOT return 200, report STATUS: BLOCKED with "dev server not running" and STOP IMMEDIATELY. Do NOT fall back to code review. Do NOT create verification documents. Do NOT proceed.
1. Take a page snapshot BEFORE interacting with any page
2. Use element refs from snapshots — never guess selectors
3. Take a screenshot at EVERY verification point
4. If a checkpoint is BLOCKED (element missing, page error), fast-fail remaining items in this category
5. Verify data state after UI actions — confirm the action persisted
6. NEVER pivot to code review if browser testing fails. Report BLOCKED and stop.

PERSISTENT OUTPUT:
If the project has an E2E test framework (check for playwright.config.*, cypress.config.*, etc.):
- Write a spec file for this category's checkpoints following the project's existing test patterns
- Place unauthenticated specs in the project's unauth test dir, authenticated specs in the auth test dir
- The spec should be permanent, rerunnable, and committable to source control

If no test framework exists:
- Write TEST_REPORT.md in the screenshot folder with results

STATUS — Report your completion status as ONE of:
- DONE — all checkpoints passed
- DONE_WITH_CONCERNS — passed but something was flaky or suspicious
- BLOCKED — could not test (explain what's missing or broken)
- NEEDS_CONTEXT — need more information (list specific questions)

OUTPUT:
- Each checkpoint: PASS / FAIL / BLOCKED / SKIP with evidence
- Screenshots referenced by filename
- Spec file path (if written)
- Your STATUS
```

**All agents for one wave go in a single message — prefer general-purpose with chrome MCP:**
```
Agent(subagent_type: "general-purpose", model: "haiku", prompt: "{cat N prompt with chrome MCP tools}", description: "Test Cat {N}: {Name}")
Agent(subagent_type: "general-purpose", model: "haiku", prompt: "{cat M prompt with chrome MCP tools}", description: "Test Cat {M}: {Name}")
```

#### Step 8: Triage results and update TODO

`TaskUpdate: "Wave {N}: Triage" → in_progress`

**8a. Read each agent's STATUS:**

| Status | Action |
|--------|--------|
| **DONE** | Mark all checkpoints `[x]` in TODO |
| **DONE_WITH_CONCERNS** | Read concerns. If flaky → mark `[x]` but note in report. If suspicious → re-run that category. Log to `docs/.output/agent-updates.md`. |
| **BLOCKED** | Read blocker. Mark affected checkpoints `[!]` with root cause. Assess impact on downstream waves. |
| **NEEDS_CONTEXT** | Answer questions, re-dispatch that agent only. |

**8b. Update TODO checkmarks (batch per wave):**

```
[x]  — checkpoint passed
[!]  — checkpoint blocked or failed (with reason after em dash)
[S]  — checkpoint skipped (not applicable in this environment)
```

**Annotation convention:**
```markdown
- [x] 2.1 — Icon renders in header
- [!] 4.1 — Toast appears — BLOCKED: component overlay intercepts clicks
- [!] 4.11 — Data column shows values — FAIL: BUG — data not persisted
- [S] 7.2 — Unauthorized user gets 403 — SKIP: only admin user available
- [x] 10.3 — Validation works (verified via code review)
```

**8c. Gate check for next wave:**
- If a gate-required category failed → assess whether downstream waves can proceed
- If truly blocked → skip downstream, report at end

`TaskUpdate: "Wave {N}: Triage" → completed`

#### Step 9: Next wave

Move to next wave. Repeat from Step 7.

---

## Phase 3: Post-Execution

### Step 10: Cleanup

Run any cleanup from the checklist:
- Delete test data
- Reset modified configs
- Do NOT stop the dev server unless user asks

### Step 11: Final Report

`TaskUpdate: "Cleanup + final report" → completed`

Write `docs/.output/screenshots/{YYYY-MM-DD}/{Task}/TEST-REPORT.md`:

```markdown
## Manual Test Report

**Date:** {YYYY-MM-DD}
**Target:** {TARGET_URL}
**Total Checkpoints:** {N}

### Summary

| Metric | Count |
|--------|-------|
| **Passed** | X |
| **Failed** | X |
| **Blocked** | X |
| **Skipped** | X |

**Pass Rate (testable):** X/Y = Z%

### Results by Category
| Cat | Name | Total | Pass | Fail | Blocked | Skip | Wave | Agent | Status |
| ... |

### Bugs Found
#### BUG-1: {Title}
- **Severity:** High/Medium/Low
- **Description:** ...
- **Root Cause:** ...

### Blocked Checkpoints Root Cause
{Common root cause for blocked items}

### Agent Performance
| Metric | Count |
|--------|-------|
| Total agents dispatched | {n} |
| DONE | {n} |
| DONE_WITH_CONCERNS | {n} |
| BLOCKED | {n} |
| Issues logged to docs/.output/agent-updates.md | {n} |

### Recommendations
1. ...
```

### Step 12: Regenerate `docs/__handoff.md` — session-handoff skill

After the TEST-REPORT.md is written, refresh `docs/__handoff.md` using the **`session-handoff`** skill (`.claude/skills/session-handoff/SKILL.md`). Read that skill for the template, rules, and `/run-tests`-specific tailoring (Step 4 in the skill).

Why: bugs found during testing and blocked checkpoints are high-value context for the next session. They belong in the handoff's Decisions & Context and Blockers sections so `/prime` surfaces them immediately. The TEST-REPORT path goes in Key Files.

### Step 13: Commit test artifacts + handoff

```bash
# Permanent spec files, if any were written
git add {test spec files — test/__test__/**, e2e/**, etc.}
# Screenshots and test report
git add docs/.output/screenshots/{YYYY-MM-DD}/{Task}/
# TODO checkmark updates
git add {TODO_FILE}
# Handoff
git add docs/__handoff.md

git commit -m "test: {Task} — {PassCount}/{Total} passed, {BlockedCount} blocked

{one-line summary of most severe finding, if any}
Co-Authored-By: 🤖"
```

Skip the commit only if the user invoked `/run-tests` as a dry-run with no expectation of persisting findings.

---

## Rules

1. **TaskList is your spine.** Create it in Phase 0. Update at every step. It survives context compression.
2. **All browser agents use haiku. No exceptions.** Both playwright and general-purpose (chrome MCP) agents must specify `model: "haiku"`. Haiku reads DOM/a11y trees identically to Sonnet. Visual/design QA is a separate human pass.
3. **Main Agent does non-browser checks directly.** Schema, seed data, code inspection, config — no delegation needed. Playwright agents handle browser interactions.
4. **Status protocol is mandatory.** Every agent reports DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT.
5. **Don't trust agent reports — verify.** If an agent says DONE but the screenshot shows an error, it's not DONE.
6. **Selector discovery before dispatch.** Agents waste time searching for selectors that don't exist. Step 5 prevents this.
7. **Annotate blocked items with WHY.** `[!] BLOCKED` alone is useless. Always include root cause.
8. **Wave gating is real.** Dependencies between categories exist. Don't launch all at once.
9. **Screenshot at every verification point.** No screenshot = no evidence = no PASS.
10. **Log agent issues to `docs/.output/agent-updates.md`.** Flaky behavior, wrong selectors, missed checkpoints — all get logged.
11. **Don't stop the dev server.** Unless explicitly asked.
12. **Always regenerate `docs/__handoff.md` at the end (Step 12).** Bugs found and blocked checkpoints are critical next-session context. Use the `session-handoff` skill. Skip only for explicit dry-runs.
