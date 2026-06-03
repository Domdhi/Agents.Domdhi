# Pre-Review Checklist Reference

**Load this when:** completing a task, implementing a major feature, or before merging — to dispatch a code-reviewer subagent and verify work meets requirements.

---

## When to Request Review

**Mandatory:**
- After each task in subagent-driven development
- After completing a major feature
- Before merge to main

**Optional but valuable:**
- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing a complex bug

---

## How to Request

**Step 1 — Get git SHAs:**
```bash
BASE_SHA=$(git rev-parse HEAD~1)  # or origin/main
HEAD_SHA=$(git rev-parse HEAD)
```

**Step 2 — Dispatch code-reviewer subagent** using the template below.

**Step 3 — Act on feedback:**
- Fix Critical issues immediately
- Fix Important issues before proceeding
- Note Minor issues for later
- Push back with technical reasoning if reviewer is wrong

---

## Code Reviewer Subagent Prompt Template

```
Task tool (code-reviewer):
  description: "Review [WHAT_WAS_IMPLEMENTED]"
  prompt: |
    You are reviewing code changes for production readiness.

    ## What Was Implemented

    [DESCRIPTION]

    ## Requirements/Plan

    [PLAN_OR_REQUIREMENTS]

    ## Git Range to Review

    Base: [BASE_SHA]
    Head: [HEAD_SHA]

    git diff --stat [BASE_SHA]..[HEAD_SHA]
    git diff [BASE_SHA]..[HEAD_SHA]

    ## Review Checklist

    Code Quality:
    - Clean separation of concerns?
    - Proper error handling?
    - Type safety (if applicable)?
    - DRY principle followed?
    - Edge cases handled?

    Architecture:
    - Sound design decisions?
    - Scalability considerations?
    - Performance implications?
    - Security concerns?

    Testing:
    - Tests actually test logic (not mocks)?
    - Edge cases covered?
    - Integration tests where needed?
    - All tests passing?

    Requirements:
    - All plan requirements met?
    - Implementation matches spec?
    - No scope creep?
    - Breaking changes documented?

    Production Readiness:
    - Migration strategy (if schema changes)?
    - Backward compatibility considered?
    - Documentation complete?
    - No obvious bugs?

    ## Output Format

    ### Strengths
    [What's well done? Be specific.]

    ### Issues

    #### Critical (Must Fix)
    [Bugs, security issues, data loss risks, broken functionality]

    #### Important (Should Fix)
    [Architecture problems, missing features, poor error handling, test gaps]

    #### Minor (Nice to Have)
    [Code style, optimization opportunities, documentation improvements]

    For each issue:
    - File:line reference
    - What's wrong
    - Why it matters
    - How to fix (if not obvious)

    ### Recommendations
    [Improvements for code quality, architecture, or process]

    ### Assessment

    Ready to merge? [Yes/No/With fixes]
    Reasoning: [Technical assessment in 1-2 sentences]

    ## Critical Rules

    DO:
    - Categorize by actual severity (not everything is Critical)
    - Be specific (file:line, not vague)
    - Explain WHY issues matter
    - Acknowledge strengths
    - Give clear verdict
    - If code is clean and no issues found, say so — do NOT manufacture issues to meet a quota

    DON'T:
    - Say "looks good" without checking
    - Mark nitpicks as Critical
    - Give feedback on code you didn't review
    - Be vague ("improve error handling")
    - Avoid giving a clear verdict
    - Invent issues that don't exist
```

---

## Red Flags — Never Do These

- Skip review because "it's simple"
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback without reasoning

If reviewer is wrong: push back with technical reasoning, show code/tests that prove it works, request clarification.
