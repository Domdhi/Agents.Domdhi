---
name: project-context
description: "Use WHEN generating or updating the project context quick-reference file that /prime loads at session start. Triggers: project context, project setup, project overview"
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [project-context, documentation, overview, quick-reference]
user-invocable: false
allowed-tools: Read, Write, Edit, Grep, Glob
---

# Project Context

Defines the format for `docs/_project-context.md` — the single-file quick reference that `/prime` loads first in every session.

## Document Template

```markdown
# Project Context: {Project Name}

| Attribute | Value |
|-----------|-------|
| **Initialized** | {YYYY-MM-DD} |
| **Phase** | {current lifecycle phase} |
| **Tech Stack** | {backend} + {frontend} + {database} |
| **Deployment** | {target environment} |

---

## Quick Reference

### Documentation
| Document | Path | Status |
|----------|------|--------|
| Project Brief | [docs/_project-brief.md](_project-brief.md) | {status} |
| PRD | [docs/_project-requirements.md](_project-requirements.md) | {status} |
| UX Spec | [docs/_project-design.md](design/_project-design.md) | {status} |
| Wireframes | [docs/design/_wireframes.md](design/_wireframes.md) | {status} |
| Light Theme | [docs/design/_design.light.md](design/_design.light.md) | {status} |
| Dark Theme | [docs/design/_design.dark.md](design/_design.dark.md) | {status} |
| Mock Layout | [docs/design/_mock-layout.html](design/_mock-layout.html) | {status} |
| Architecture | [docs/_project-architecture.md](_project-architecture.md) | {status} |
| Backlog | [docs/todo/_backlog.md](todo/_backlog.md) | {status} |

### Key Commands
| Command | Purpose |
|---------|---------|
| `/prime` | Reload context in new session |
| `/do` | Implement next story |
| `/review:code-review` | Review code changes |
| `/review:qa` | Generate tests |
| `/review:retro` | Retrospective after epic |
| `/end` | Save session state |

---

## Current State

### Active Epic
{Epic name and progress}

### Recent Stories
| Story | Status | Date |
|-------|--------|------|
| {N.M} {title} | {status} | {date} |

### Build Status
- **Last build**: {pass/fail}
- **Tests**: {count passing}/{count total}
- **Coverage**: {percentage}

---

## Architecture Summary

{2-3 sentence summary from _project-architecture.md}

### Tech Stack
- **Backend**: {framework + language}
- **Frontend**: {framework + language}
- **Database**: {name}
- **Auth**: {method}
- **Hosting**: {target}

### Project Structure
```
{Abbreviated directory tree from _project-architecture.md}
```

---

## Conventions

{Key conventions extracted from _project-architecture.md Development Standards}

- **Branch naming**: {pattern}
- **Commit format**: {pattern}
- **Test naming**: {pattern}
- **File naming**: {pattern}

---

## Known Issues

{Any outstanding issues, blocked stories, or tech debt}
```

## Maintenance Rules

- **Updated by**: scaffold.js (creates), `/end` (updates state), `/do` (updates active work)
- **Read by**: `/prime` (first thing loaded each session)
- **Frequency**: Should be updated after every completed story or significant change
- Keep it under 100 lines — it's a quick reference, not documentation

## Quality Criteria

### Good _project-context.md
- Can understand the project in 30 seconds by reading this file
- All doc links are valid
- Current state reflects actual progress
- Tech stack summary matches _project-architecture.md

### Bad _project-context.md
- Outdated state (shows stories as pending that are done)
- Broken doc links
- Missing architecture summary
- No current state section

## Cross-References
- Created by: scaffold.js
- Updated by: `/end`, `/do`
- Read by: `/prime`
