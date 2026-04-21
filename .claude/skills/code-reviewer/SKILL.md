---
name: code-reviewer
description: "Code review expert. Severity classification, architecture compliance, security audit, best practice enforcement. Triggers: code review, review, pull request, PR review"
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [code-review, security, architecture-compliance, best-practices]
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Code Reviewer

Expert in code review. Evaluates code changes against architecture standards, security best practices, and project conventions.

## Review Report Template

```markdown
# Code Review: {description}

**Date**: {YYYY-MM-DD}
**Reviewer**: Claude (AI-assisted)
**Scope**: {files or diff range}

---

## Summary

**Verdict**: Approved / Approved with Comments / Changes Requested

**Stats**: {files reviewed} files, {lines added} added, {lines removed} removed

---

## Findings

### CRITICAL (must fix before merge)

#### C-{N}: {Title}
- **File**: {path}:{line}
- **Issue**: {description}
- **Fix**: {suggested fix}
- **Why**: {security risk, data loss, crash, etc.}

### MAJOR (should fix before merge)

#### M-{N}: {Title}
- **File**: {path}:{line}
- **Issue**: {description}
- **Suggestion**: {recommended change}

### MINOR (nice to fix, not blocking)

#### m-{N}: {Title}
- **File**: {path}:{line}
- **Note**: {observation}

### NITS (style, naming, formatting)

- {file}:{line} — {nit}

---

## Architecture Compliance
- [ ] Follows project structure from `docs/_project-architecture.md`
- [ ] Uses approved tech stack components
- [ ] Follows naming conventions
- [ ] Proper separation of concerns

## Security Checklist
- [ ] No hardcoded secrets or credentials
- [ ] Input validation present
- [ ] SQL injection protected (parameterized queries)
- [ ] XSS protected (output encoding)
- [ ] Auth checks on protected endpoints
- [ ] No sensitive data in logs

## Test Coverage
- [ ] New code has tests
- [ ] Edge cases covered
- [ ] Tests are meaningful (not just coverage padding)
```

## Severity Definitions

| Severity | Definition | Action |
|----------|-----------|--------|
| **CRITICAL** | Security vulnerability, data loss risk, crash in production | Must fix before merge |
| **MAJOR** | Bug, performance issue, architecture violation, missing validation | Should fix before merge |
| **MINOR** | Code smell, readability issue, missing optimization | Fix at developer's discretion |
| **NIT** | Style, naming, formatting preferences | Optional, non-blocking |

## Review Checklist (What to Check)

### Correctness
- Does the code do what the story/ticket says?
- Are edge cases handled?
- Are error paths covered?

### Security (OWASP Top 10)
- Injection (SQL, command, XSS)
- Broken authentication
- Sensitive data exposure
- Missing access control
- Security misconfiguration

### Performance
- N+1 queries
- Missing pagination
- Unbounded collections
- Missing caching where appropriate
- Unnecessary allocations in hot paths

### Maintainability
- Clear naming
- Single responsibility
- No magic numbers/strings
- Appropriate abstraction level (not over-engineered)

### Testing
- Unit tests for business logic
- Integration tests for data access
- Tests are readable and maintainable

### AC Compliance vs Test-Passing

Agents tend to optimize for "test passes" over "AC literal". Verify the AC is met by the **implementation**, not by a test the agent shaped to fit what they built.

- **Literal numbers in AC are literal.** AC says "10 entries" → assertion must be `toBe(10)`, not `toBeGreaterThanOrEqual(1)`. If the test softens, the implementation may not actually trigger the cap/threshold the AC describes. Force a re-seed and tighten the assertion.
- **Implementation gaps masked by test rewrites.** If the AC says "skip path X" and the test asserts "skip path Y" instead, the implementation is missing X — the agent worked around the gap. Force the impl change, not the test change.
- **Seeding return values when spies are present.** When a test uses `vi.spyOn` on a boundary, every seeding call (`createMemory`, `addCommit`, etc.) MUST assert its return value. Without this, silent seeding failures pass the test on canned spy data while the store is actually empty. One assertion per seeding call closes the false-confidence gap.
- **Prototype-spy boundary check.** `vi.spyOn(X.prototype, 'method')` is legitimate when the bypassed behavior has its own unit-test coverage. It hollows the test when the bypassed behavior IS the AC under review. If the AC is "search returns the right results" and the test spies on `search` → flag as MAJOR.

### MAJOR-Fix-Inline Discipline

MAJOR findings are fixed before commit, not deferred. This is a hard rule — held across every epic of the TDD-framework (TDD-3 walkDir/dual-dir-scan, TDD-4 hardcoded date + real claude exec, TDD-5 SKIP_PATHS gap, TDD-6.1 prototype-spy hardening). Zero CRITICAL findings landed across the framework because MAJORs were not deferred.

If a MAJOR finding can't be fixed in the same review pass (genuinely needs design discussion), classify as a follow-up story in the TODO and block the commit until the followup is filed. Do not silently downgrade MAJOR → MINOR to clear the review.

## Cross-References
- Reads: `docs/_project-architecture.md` (for standards), project code
- Produces: Review report (inline or file)

---

## Project-Specific Review Checks

> This section is added by `/specialize` or `/optimize-agents` based on the project's actual tech stack.
> When no project context exists, use the generic checklists above.
>
> To populate this section, run `/specialize --fix` after architecture docs are complete.

### Memory Pattern Compliance

During review, also check:
- Does the code follow patterns from the memory system? (`node .claude/core/memory-manager.js search "{domain}"`)
- Does it violate any known constraints? (`node .claude/core/memory-manager.js list constraints`)
- Does it contradict any ADR decisions? (`node .claude/core/memory-manager.js list decisions`)
- If code introduces a new reusable pattern, flag it for potential memory creation.
