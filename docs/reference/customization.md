# Customization Zones

When updating the template (via subtree, copy, or future update mechanism), some files are safe to overwrite and some contain project-specific content that must be preserved. This file maps the zones.

## Zone Map

| Path | Zone | Update Strategy |
|------|------|-----------------|
| `.claude/commands/**/*.md` | Template | **Overwrite** — commands are orchestration, never project-specific |
| `.claude/core/*.js` | Template | **Overwrite** — scripts are project-agnostic |
| `.claude/hooks/*.cjs` | Template | **Overwrite** — hooks are project-agnostic (project-specific hooks preserved) |
| `.claude/skills/**` | Template | **Overwrite** — entire skills tree (SKILL.md + references/, examples/, sibling `.md`/`.ts`/`.dot`/`.sh`) except `brand-guidelines/**` (see below) |
| `.claude/skills-optional/` | Template | **Overwrite** (gitignored — local-only aesthetic skills) |
| `.claude/templates/` | Template | **Overwrite** |
| `.claude/version.json` | Template | **Overwrite** — template version metadata |
| `.claude/agents/*.md` (11 base) | **Mixed** | **Merge** — see Agent File Zones below |
| `.claude/agents/*.md` (project-added) | **Project** | **Preserve** — agents added by `/specialize` or manually |
| `.claude/settings.json` | **Project** | **Preserve** — project-specific permissions, env vars, hook paths |
| `docs/reference/customization.md` | Template | **Overwrite** — this file |
| `CLAUDE.md` (target's root) | **Project** | **Never touch** — projects own their root Claude Code instructions |
| Source `CLAUDE.md` → target `.claude/README.md` | Doc redirect | **Overwrite** — template self-documentation co-located with the files it documents |
| `.githooks/` | Template | **Overwrite** |
| `docs/` | **Project** | **Never touch** — all project content |

## Agent File Zones

Agent files have three zones with clear ownership. `/personalize` and `/specialize` already respect these boundaries:

```
---                              FRONTMATTER (Template)
name: agent-name                   Overwrite on update — except:
nickname: {name}                     nickname  → Preserve (set by /personalize)
aliases: [...]                       aliases   → Preserve (set by /personalize)
model: sonnet                        model     → Overwrite
description: ...                     description → Overwrite
tools: ...                           tools     → Overwrite
skills: ...                          skills    → Overwrite
memory: project                      memory    → Overwrite
---

# {Name} — {Role Title}         SOUL ZONE (Project — /personalize)
                                   Preserve on update.
Identity, Decision Philosophy,     Written by /personalize with project-specific
Working Style, Quality Standards   personality. If never personalized, contains
                                   thin template defaults (safe to overwrite).
...

## Skills                        SKILLS ZONE (Template)
                                   Overwrite on update.
Read these files at the start...   Auto-generated from frontmatter skills list.

## Project Context               SPECIALIZE ZONE (Project — /specialize)
                                   Preserve on update.
> Specialized for {Project}...     Written by /specialize with project tech stack,
                                   ADRs, and conventions. If never specialized,
Tech Stack, ADRs, Conventions      this section doesn't exist (nothing to preserve).
```

**Update algorithm for agents:**
1. Overwrite frontmatter (except `nickname` and `aliases`)
2. If Soul Zone was personalized (not thin defaults) → preserve it
3. Overwrite Skills section
4. If Project Context section exists → preserve it
5. If neither personalized nor specialized → full overwrite is safe

## Skill Exceptions

Most skills are template content. One exception:

| Skill | Zone | Notes |
|-------|------|-------|
| `brand-guidelines/**` (whole tree) | **Project** | Customized per-project with brand colors, typography, visual identity, logo assets, palette files. Whole subtree preserved on update — any sub-docs added in the target stay project-owned. |
| All others (including `references/`, `examples/`, sibling `.md`/`.ts`/`.dot`/`.sh`) | Template | Overwrite on update. SKILL.md **and** its sibling support files (anthropic-best-practices, graphviz-conventions, references/*, etc.) propagate together — they're authored as a unit in the template, so partial propagation leaves SKILL.md pointing at missing references. |

## Detection Heuristics

To detect whether a file has been customized:

| Check | Means |
|-------|-------|
| Agent has `nickname:` in frontmatter | Personalized — preserve Soul Zone |
| Agent has `## Project Context` section | Specialized — preserve that section |
| `brand-guidelines/SKILL.md` differs from template | Customized — preserve |
| `settings.json` exists | Project-specific — always preserve |
| Target's root `CLAUDE.md` | Always project-specific — never touched by updater |

## Project-Specific Agents

Projects can add agents beyond the 11 base template agents. These are **Project zone** — template updates will never touch them. Name them by role (e.g., a compliance-reviewer for a regulated-industry project, a growth-experiment-designer for a SaaS product) and give them personas via `/review:personalize`.

These agents follow the same frontmatter format as base agents. The template updater detects them by comparing against the base agent list and skips them entirely.

## Settings.json Merging

`settings.json` is always **Preserve** — never overwritten. When the template adds new hooks, they must be manually wired into project settings. Key areas that differ per project:

- `env` — project-specific environment variables and feature flags
- `permissions.allow` — project-specific tool permissions (npm, supabase, wrangler, etc.)
- `hooks` — project-specific hooks (auto-formatting, linting, typecheck, migration timestamps)

When updating a project, compare the template's `settings.json` hooks section against the project's to find missing entries. Add new template hooks without removing project-specific ones.

## Template Update Mechanism

`template-updater.js` implements the zone-aware merge strategy defined above. Field-tested and manually verified against multiple downstream projects (April 2026).

```bash
node .claude/core/template-updater.js update <target-path> [--merge] [--dry-run]
```

Behavior:
1. Reads this file's zone map to determine template vs project ownership
2. **Overwrite** zones: replaces entirely
3. **Preserve** zones: skips entirely (includes project-specific agents, settings.json, and the target's root CLAUDE.md)
4. **Merge** zones: uses agent zone boundaries (Soul Zone, Project Context preserved)
5. **Doc redirect**: source `CLAUDE.md` is copied to target's `.claude/README.md` as template self-documentation; target's root `CLAUDE.md` is never touched
6. **New files** in template: copies them in
7. **Deleted files** from template: warns but doesn't auto-delete
8. `--dry-run` previews changes without writing; `--merge` enables zone-aware agent merging

### Manual Steps After Template Update
1. Compare `settings.json` hooks — add any new template hooks to project settings
2. Run `node .claude/core/memory-manager.js lint` — verify memory system health
3. Run `/review:check-templates` — verify system wiring integrity
