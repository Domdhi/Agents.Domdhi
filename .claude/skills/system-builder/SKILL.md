---
name: system-builder
description: "Templates, quality criteria, and conventions for creating agents, commands, and skills within the .claude/ system. Triggers: create agent, create command, create skill, new agent, new command, new skill"
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [meta, system, agent, command, skill, template]
user-invocable: false
allowed-tools: Read, Write, Edit, Grep, Glob
---

# System Builder

Expert in creating new agents, commands, and skills that follow established conventions. Ensures every component is properly structured, wired, and consistent with the three-tier architecture.

## Three-Tier Architecture Rules

1. **Commands** own orchestration — gates, delegation, validation, commit logic
2. **Agents** own personality and working style — auto-load skills via frontmatter
3. **Skills** own domain knowledge — templates, quality criteria, checklists, interview questions
4. **No duplication between layers** — commands never inline skill content, agents never duplicate command logic

---

## Agent Template

### Frontmatter (required fields, in this order)

```yaml
---
name: {kebab-case-name}
nickname: {short-name}
aliases: [{alias1}, {alias2}, {alias3}]
model: {inherit|sonnet|haiku}
description: {1-2 sentences. What it does. When to use it.}
tools: {comma-separated tool list}
skills:
  - {skill-name}
memory: project
---
```

### Field Rules

| Field | Required | Convention |
|-------|----------|------------|
| `name` | Yes | kebab-case, matches filename without `.md` |
| `nickname` | Yes | Short name used in `# {Nickname} — {Role Title}` heading |
| `aliases` | Yes | Inline YAML array `[...]`, 2-5 aliases for invocation |
| `model` | Yes | `inherit` for planning agents (stay on Opus), `sonnet` for implementation, `haiku` for documentation |
| `description` | Yes | Concise, no quotes needed. Format: "{What it does}. Use for {when to use it}." |
| `tools` | Yes | Unquoted comma-separated list. Common sets: `Read, Write, Edit, Bash, Grep, Glob` (implementation), `Read, Write, Edit, Grep, Glob, WebSearch, WebFetch` (research/strategy) |
| `skills` | Yes | YAML list of skill names, or `[]` if none |
| `memory` | Yes | Always `project` |

### Body Structure

```markdown
# {Nickname} — {Role Title}

{2-3 sentences: core identity and what makes this agent distinct from others.}

## Identity

{2-3 paragraphs: how this agent thinks, what it prioritizes, what it's skeptical of.
Should read like a person describing their professional worldview.}

## Decision Philosophy

{3-5 numbered principles (max 5). Each principle is bold + explanation.
Principles are first-person beliefs, not duties — convictions the agent holds,
not job responsibilities assigned to it.}

## Working Style

{6-8 bullet points. Concrete behaviors: what the agent does first, how it structures work,
what tools it reaches for, what it produces.}

## Quality Standards

{5-7 bullet points. Observable quality criteria for the agent's output.
Must include anti-sycophancy rule: "No hedging — never say 'that's an interesting approach'..."}
```

### Calibration

Before creating a new agent, read `.claude/agents/architect.md` as a format reference — the prose style, section structure, and principle density set the bar. For complex domains, spawn Task sub-agents to read source material before synthesizing the agent's identity — don't rely on recall for domain-specific standards.

### Thin-Default Shipping

A new agent ships with **soul only** — enough personality to be useful without coupling to any specific project:
- `/personalize` adds deeper personality (optional, per-project)
- `/specialize` adds project context (optional, per-project)

Write the thin default and stop. Don't over-engineer the identity for hypothetical projects.

### Model Selection Guide

| Role Type | Model | Reasoning |
|-----------|-------|-----------|
| Planning, strategy, research, design | `inherit` | Stays on Opus for complex reasoning |
| Code implementation, code review, testing | `sonnet` | Fast, capable, cost-effective for code |
| Documentation, changelogs | `haiku` | Sufficient quality at lowest cost |
| Security audit | `sonnet` | Needs thoroughness but not Opus cost |
| Browser automation | `sonnet` | Needs reliability for DOM interaction |

### Decision Gate: Agent or Skill?

Before creating an agent, apply the **agents-vs-skills decision rule**:
- Does this role require a **distinct point of view** AND should Claude auto-delegate to it? → Agent
- Is it **knowledge or methodology** that multiple agents could use? → Skill

An agent that "helps with documentation" is a skill. A system architect who believes every decision is a constraint imposed on the future — that's an agent.

### The Obvious Test for Principles

Every principle in Decision Philosophy must pass the **Obvious Test**: "Would this be obvious to anyone in this role?" If yes, cut it.
- "Write clean code" → obvious to any developer. **Cut.**
- "Every commit is documentation for the developer who hasn't been hired yet" → not obvious. **Keep.**

If a principle applies equally to every agent in the same role, it adds no value.

### First Principle Pattern

The first principle should always activate expert domain knowledge:
```
1. **Channel expert [domain] knowledge: draw upon [specific frameworks, mental models, patterns].**
```
This primes the agent with the right lens before it starts working.

### Two-Zone Rule

Agent files have two zones with clear ownership:
1. **Soul Zone** (Identity, Decision Philosophy, Working Style, Quality Standards) — written at creation, preserved on template update
2. **Specialize Zone** (`## Project Context`) — written by `/specialize` only, never included at creation time

A new agent ships **without** `## Project Context`. That section gets added when deployed to a real project.

### Anti-Patterns

- Generic personality ("I am a helpful assistant...") — every agent must have a distinct perspective
- Overlapping with existing agents — check the agent inventory first
- Tools that don't match the role — review agents (code-reviewer, security-auditor) get `Write` for review artifacts only; do NOT include `Edit` (frontmatter is a whitelist — omitting a tool already disallows it); pure inspectors (e.g., `Explore`) get neither. Match tools to the agent's actual write surface, not its label.
- Missing anti-sycophancy rule in Quality Standards
- Principles that fail the Obvious Test — cut anything that's just a job description
- Including `## Project Context` — that's for `/specialize`, not creation

---

## Command Template

### Decision Gate: Command or Inline Behavior?

Apply the **three-test rule** before writing any command:
1. Is this **invoked by a user** (not triggered automatically)?
2. Is it **reusable across projects** (not project-specific)?
3. Does it produce a **tangible artifact or state change** that needs human initiation?

All three yes → command. Any no → inline behavior in an agent prompt or a hook.

### Design Approach: Report-First

Write the **Report section first**, then build the Workflow that produces it. A command without a Report section has no finish line — "done" becomes ambiguous. Knowing what success looks like shapes every step.

### Obligation Language

Non-trivial steps MUST use obligation language — "MUST", "BEFORE", "NEVER" — not "should" or "consider." Claude skips soft suggestions under pressure. Hard obligations hold.

Every step that can fail needs an **explicit failure path**: how many retries, what gets surfaced, when to stop. A command without failure handling is abandoned at the first obstacle.

Use **Iron Law gates** at stage transitions where skipping would invalidate all downstream work.

Use **consequence framing** on critical steps: "Skipping this step means [specific bad outcome]." This is more effective than "this step is important."

### Pressure Test

Before finishing a command, ask: **"Would this hold under production pressure?"** If a step can be rationalized away in 3 seconds, it needs an Iron Law gate. If it can't be rationalized away, it's already clear enough.

### Calibration

Before writing a new command, read existing commands as calibration:
- **Complex pipeline commands**: read `do.md` — size-aware delegation, multi-step verification, failure handling
- **Simple utility commands**: read `organize.md` — minimal steps, clear output
- **Always Glob first**: `Glob .claude/commands/**/*.md` — never duplicate an existing command

Know when to break the template. Complex commands need inline pipeline stages with explicit failure paths. Simple commands need a checklist output pattern. Fit the format to the work.

### Parallel Agent Delegation

When a command runs multiple agents in parallel, the Task calls MUST be shown in a single message block — not sequenced across separate steps.

### Frontmatter

```yaml
---
description: {1 sentence — what the command does}
argument-hint: [{argument description}]
---
```

### Body Structure

```markdown
# {Command Title}

{1-2 sentences: what this command does and when to use it.}

## Variables

VARIABLE_NAME: $ARGUMENTS

- `VARIABLE_NAME` (required|optional): {description}

## Workflow

### Step 1: {Name}

{Detailed instructions. Commands should be explicit about:}
- What to read
- What agent to delegate to (if any)
- What gates/checks to run
- What output to produce

### Step N: Commit (main agent)

Follow the **Post-Command Commit Convention** in CLAUDE.md.

### Step N+1: Report

{Structured output showing what was created/modified.}

## Anti-Patterns

- {What NOT to do — 3-5 bullets}
```

### Command Conventions

| Convention | Rule |
|-----------|------|
| Location | `.claude/commands/` for build loop, `create/` for setup, `review/` for review |
| Gates | Check prerequisites exist before proceeding (use `constants.js` for paths) |
| Delegation | Spawn agents via `Task(agent-name, ...)` — never inline agent work |
| Commit | Stage specific files, commit with convention from CLAUDE.md, include hash in report |
| Read-only commands | review commands that don't modify files should NOT have a commit step |
| `$ARGUMENTS` | Always captured in a named variable at the top of the workflow |

### Commands That Commit vs Read-Only

- **Commits**: All `/create:*`, `/brainstorm`, `/research`, `/review:optimize-*`, `/review:specialize`, `/review:retro`, `/review:changelog`, `/review:update-docs`, `/review:qa`
- **Read-only**: `/prime`, `/review:check-readiness`, `/review:check-sync`, `/review:code-review`, `/review:memory-health`, `/todo`, `/organize`
- **Own commit logic**: `/do`, `/run-todo`

---

## Skill Template

### Description Field: Claude Search Optimization (CSO)

The `description` field is how Claude decides whether to load a skill. It must describe **when to use** the skill, not what the skill does.

```yaml
# BAD: Summarizes workflow — Claude may follow this instead of reading the skill
description: "Dispatches subagent per task with code review between tasks"

# BAD: Too vague
description: "For async testing"

# GOOD: Triggering conditions only, no workflow summary
description: "Use WHEN tests have race conditions, timing dependencies, or pass/fail inconsistently"
```

**Why this matters:** Testing revealed that when a description summarizes the skill's workflow, Claude follows the description as a shortcut instead of reading the full skill content. Descriptions that describe *triggering conditions* force Claude to read the actual skill body.

### Frontmatter

```yaml
---
name: {kebab-case-name}
description: "{triggering conditions — Use WHEN... Triggers: {keyword1}, {keyword2}}"
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [{tag1}, {tag2}, {tag3}]
user-invocable: false
allowed-tools: {tool list}
---
```

### Body Structure

```markdown
# {Skill Name}

{1-2 sentences: what domain knowledge this skill provides.}

## Document Template (if the skill produces a document)

{Markdown template with `{placeholders}` for variable content.}

## Required Sections Checklist (if the skill validates output)

{Numbered list of sections that must be present in the output.}

## Quality Criteria

{Bulleted list of quality checks.}

## Interview Questions (if the skill gathers requirements)

{Numbered list of questions the agent should ask to gather requirements.}

## References (optional)

{Links to external resources, standards, or exemplars.}
```

### Skill Conventions

| Convention | Rule |
|-----------|------|
| Location | `.claude/skills/{skill-name}/SKILL.md` |
| Naming | kebab-case directory matching the `name:` field |
| Wiring | Skills are loaded by agents via frontmatter `skills:` list — never by commands directly |
| Content | Domain knowledge only — no orchestration logic (that belongs in commands) |
| `user-invocable` | `false` unless the skill should appear as a slash command |
| References | Put supplementary files in the same directory (e.g., `references/`) |

### Skills With No Command Consumers

Some skills are loaded directly by agents but not referenced by any command. This is valid — the agent uses the skill knowledge whenever it's invoked, regardless of which command triggered it.

---

## Wiring Checklist

After creating any component, verify the wiring:

### New Agent
- [ ] File at `.claude/agents/{name}.md`
- [ ] Frontmatter has all required fields in correct order
- [ ] Skills listed in frontmatter exist in `.claude/skills/`
- [ ] No tool/role overlap with existing agents
- [ ] At least one command delegates to it, OR it's for direct invocation

### New Command
- [ ] File at `.claude/commands/{name}.md` or `create/{name}.md` or `review/{name}.md`
- [ ] Frontmatter has `description` and `argument-hint`
- [ ] Gates check prerequisites before proceeding
- [ ] Agents delegated to actually exist
- [ ] Commit step follows CLAUDE.md convention (if not read-only)
- [ ] Report section shows structured output

### New Skill
- [ ] Directory at `.claude/skills/{name}/SKILL.md`
- [ ] At least one agent lists it in frontmatter `skills:`
- [ ] Content is domain knowledge, not orchestration
- [ ] No duplication of content already in another skill
- [ ] Description starts with "Use WHEN..." — triggering conditions, not workflow summary

---

## Don't Duplicate Claude Code Platform Primitives

Before designing a command, check whether Claude Code already provides the verb. The platform's surface grew significantly in 2.1.x — what felt like a gap a few months ago may now be covered.

- **Scheduling/recurrence**: use `/loop {interval} /<command>` (Claude Code 2.1.x). Don't build bespoke timers, cron, or hook re-trigger loops. Layer custom logic INSIDE the wrapped command, not around the scheduling.
- **Project state cleanup**: Anthropic owns `claude project purge [path]` (Claude Code 2.1.126+). When designing /sunset or any cleanup command, scope it to PRODUCT-level deprecation rituals (CHANGELOG, migration guide, archival commit) — not Claude Code state.

Ask "is the verb already in Claude Code?" before authoring. If yes, your command layers on top, not parallel to.

---

## Parser Patterns

When a command or library parses markdown structures (bullet lists, headings, fence blocks, key:value labels), the regex patterns must tolerate variable indentation:

- **Use `\s*` (zero-or-more) for leading whitespace, not `\s+` (one-or-more)** — unless indentation is structurally significant. Markdown authors and dispatched agents both produce mixed indentation; `\s+` silently misses zero-indent occurrences with no error, so the parser returns clean-looking empty results when it should be matching.
- **Verify the source-of-truth template emits the structure your parser keys off** — if a parser reads `**Files:**` blocks under stories, the skill template that generates the markdown MUST include those blocks. A parser dispatched without this verification step ships correct against fixtures and useless against real artifacts.

Both rules apply at *dispatch time* — a parser-implementing story's prompt should explicitly require both checks.

---

## Related Skills

For deeper methodology on writing effective skills and commands:
- **`writing-skills`** — TDD for documentation, CSO optimization, pressure testing, rationalization tables
- **`writing-skills/persuasion-principles.md`** — obligation language research (Cialdini/Meincke), principle combinations by skill type
- **`writing-skills/anthropic-best-practices.md`** — official Anthropic skill authoring guidelines
