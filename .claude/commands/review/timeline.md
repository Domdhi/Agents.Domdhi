---
description: "Generate or update _project-timeline.md with weekly commit history"
---

# Timeline

Generate or update `docs/_project-timeline.md` — a weekly-grouped, daily-breakdown history of all project commits.

## Variables

ARGUMENTS: $ARGUMENTS

Parse ARGUMENTS:
- `full` — regenerate from first commit (or if file doesn't exist)
- `update` — incremental from last documented commit (default if no arg)

## Workflow

Run the script:

```bash
node .claude/core/gen-timeline.js $ARGUMENTS
```

The script handles everything: git data gathering, grouping, formatting, and writing.

Report the script output to the user.

After reporting, commit the updated timeline:

```bash
git add docs/_project-timeline.md
git commit -m "docs: /review:timeline — update project timeline

Co-Authored-By: 🤖"
```

## Format Reference

The script produces this structure:

```markdown
# {ProjectName} Project Timeline

## Week of Mar 17, 2026

### Mon Mar 17 (2 commits, 14 files)
- feat: add Rate Tracker help articles
- feat: add HelpContent.Seeder tool

### Tue Mar 18 (13 commits, 127 files)
**Icon System Migration** (8 commits)
- Migrated Material Symbols to Fluent UI SVGs
- Icons.cs type-safe constants

**Employee Directory** (1 commit)
- Card grid with avatars, smart drawer filters
```

### Rules (implemented in script)
- **5 or fewer commits/day**: list individually
- **More than 5**: group by theme (conventional commit prefix + scope)
- Weekly headers Monday-anchored, most recent at top
- Co-Authored-By lines stripped
- `<!-- last:HASH -->` comment tracks incremental update position

## Staleness Check

`/end` should check if the timeline is >7 days stale and suggest `/review:timeline update`:
```bash
date -r docs/_project-timeline.md +%s 2>/dev/null
```
