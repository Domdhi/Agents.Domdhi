---
name: verification-before-completion
description: "Use WHEN about to claim work is complete, fixed, or passing — BEFORE committing or creating PRs; blocks any success claim until a fresh verification command has been run and its output read"
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [quality, verification, workflow, testing]
user-invocable: false
allowed-tools: Read Bash
---

# Verification Before Completion

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

**Violating the letter of this rule is violating the spirit of this rule.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this message, you cannot claim it passes.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim
6. EMIT THE SHIP TOKEN: emit the literal `SHIP_CHECK_OK` once — and only once —
   BOTH of these hold in this message:
     (a) a fresh verification command ran THIS message and its output was read, AND
     (b) every acceptance-criteria bullet is checked off (verified, not assumed).
   The token is the deterministic signal that the work passed the gate. Downstream
   steps (commit, wave-close) look for this exact literal before they proceed.

Skip any step = lying, not verifying
```

### Emitting `SHIP_CHECK_OK`

`SHIP_CHECK_OK` is a textual contract, not a parser: emit the bare literal once the two
preconditions above are both true. It means "fresh verification passed AND all AC are
checked." Do not emit it speculatively, and do not emit it when verification was skipped
or any AC is unchecked.

**Audited override — `SHIP_CHECK_SKIP: <reason>`.** When verification genuinely cannot
run (no local runner, CI-only matrix job, manual/UI-only AC), emit `SHIP_CHECK_SKIP: <reason>`
instead — the literal followed by a one-line reason. This is the one path that lets work
proceed without `SHIP_CHECK_OK`, and it is audited: the reason is the record of why the
gate was bypassed. Use it for true cannot-verify cases, never as a shortcut to skip a
verification that could have run.

**Consumers.** The emit contract lives here; the commands that check for the token are `/do` (Step 8c, per-task precondition for commit) and `/run-todo` (per-wave ship-token gate before the wave commit). Keep this list current when a new command starts gating on the token, so the full producer→consumer contract is findable from one place.

## Critic vs Judge

Two distinct layers govern whether work ships. Keep them separate:

- **Critic** — the **review** layer. It advises and diagnoses; it can be wrong, over-confident,
  or under-confident. Code-reviewer findings are critic output: signal to weigh, not a verdict
  that blocks on its own.
- **Judge** — the **gate** layer. It is the deterministic pass/fail that actually blocks: the
  build/test gate (exit code), the line-by-line AC verification, and the `SHIP_CHECK_OK` ship
  token that records both passed. A critic can advise "this looks fine"; only the judge's
  evidence lets the work ship.

The token belongs to the judge: it is emitted by evidence, not by opinion.

## Common Failures

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once |
| Agent completed | VCS diff shows changes | Agent reports "success" |
| Requirements met | Line-by-line checklist | Tests passing |

## Red Flags - STOP

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!", etc.)
- About to commit/push/PR without verification
- Trusting agent success reports
- Relying on partial verification
- Thinking "just this once"
- Tired and wanting work over
- **ANY wording implying success without having run verification**

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler |
| "Agent said success" | Verify independently |
| "I'm tired" | Exhaustion ≠ excuse |
| "Partial check is enough" | Partial proves nothing |
| "Different words so rule doesn't apply" | Spirit over letter |

## Key Patterns

**Tests:**
```
✅ [Run test command] [See: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**Regression tests (TDD Red-Green):**
```
✅ Write → Run (pass) → Revert fix → Run (MUST FAIL) → Restore → Run (pass)
❌ "I've written a regression test" (without red-green verification)
```

**Build:**
```
✅ [Run build] [See: exit 0] "Build passes"
❌ "Linter passed" (linter doesn't check compilation)
```

**Requirements:**
```
✅ Re-read plan → Create checklist → Verify each → Report gaps or completion
❌ "Tests pass, phase complete"
```

**Agent delegation:**
```
✅ Agent reports success → Check VCS diff → Verify changes → Report actual state
❌ Trust agent report
```

## Why This Matters

False completion claims produce compounding failures:

- **Trust destruction** — Repeated unverified success claims make every subsequent claim suspect, requiring the reviewer to independently verify everything the agent says. This eliminates the value of delegation.
- **Crash-path shipping** — Undefined functions, missing imports, and broken contract assumptions reach review or production when the agent claims success without running the code.
- **AC gap masking** — When tests are shaped to pass rather than to verify the acceptance criterion, the gap between "tests pass" and "requirement met" is invisible until integration or production.
- **Rework cycles** — Time spent on redirecting after a false completion claim exceeds the time the verification step would have taken. False completion is not a time savings — it is a time debt.

Verification gates exist to make the agent's claims checkable. A claim without evidence is not a completion — it is a hypothesis.

## When To Apply

**ALWAYS before:**
- ANY variation of success/completion claims
- ANY expression of satisfaction
- ANY positive statement about work state
- Committing, PR creation, task completion
- Moving to next task
- Delegating to agents

**Rule applies to:**
- Exact phrases
- Paraphrases and synonyms
- Implications of success
- ANY communication suggesting completion/correctness

## The Bottom Line

**No shortcuts for verification.**

Run the command. Read the output. THEN claim the result.

This is non-negotiable.
