# Domdhi.Agents

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Built for Claude Code](https://img.shields.io/badge/Built_for-Claude_Code-orange.svg)](https://claude.com/claude-code)

A portable `.claude/` directory that turns Claude Code into a full development lifecycle system. Drop it into any project for structured workflows from brainstorm to deployment — slash commands, 11 specialized agents, 23 skill modules, and a memory system that compounds across sessions.

**Tech-agnostic by default.** Works with any stack. Run `/review:specialize` to generate project-specific agents from your architecture doc.

## What You Get

- **Three-tier architecture** — commands orchestrate, agents work with personality, skills hold domain knowledge. No duplication between layers.
- **11 baseline agents** — product strategist, architect, UX designer, planner, coder, reviewer, security auditor, QA engineer, doc-writer, browser tester, ghostwriter. Extend with `/review:specialize` for your stack; name and personalize them with `/review:personalize`.
- **23 skill modules** — templates, checklists, and quality criteria for everything from ADR writing to code review to TDD.
- **Memory that compounds** — every session handoff writes structured memories; FTS5 search surfaces them on demand. On Node 24+ this runs on the built-in `node:sqlite` with **zero dependencies**; older Node falls back to the optional `better-sqlite3` or a plain JSON scan. Confidence decays on active work days, so idle projects don't rot.
- **Hooks as rails** — secret scanning, destructive-command guardrails, and command telemetry out of the box.
- **Build gate on autopilot** — `gate.js` auto-detects Node, Rust, Go, .NET, and Make projects. Override with `gate.config.json`.

## Repo Layout

```
.claude/                     Template runtime — this is what you're adopting
├── agents/                  11 agent definitions (extensible)
├── commands/                Slash commands — setup, build loop, review
├── skills/                  23 domain-knowledge modules
├── hooks/                   12 event-driven hooks
├── core/                    Runtime scripts (gate, scaffold, memory, status)
├── templates/               Blank doc templates with marker convention
└── settings.json            Permissions, hook wiring, plan directory

docs/                        Adopter-facing documentation + generated planning docs
CLAUDE.md                    Auto-loaded project instructions for Claude Code
```

## Install

**Prerequisites.** Claude Code installed and working in your terminal. If `claude` doesn't launch, start with the [Claude Code install docs](https://docs.claude.com/claude-code) before adopting this template. **Node 24+ is recommended** — its built-in `node:sqlite` gives the memory system FTS5 search with zero dependencies. The toolkit still works on older Node (JSON-scan fallback, or `npm install` for the optional `better-sqlite3`), and the hooks need no Node at all.

There are two ways to adopt the template, depending on whether you're starting fresh or adding it to an existing project.

### New project (greenfield)

```bash
# Clone the template into a fresh project directory
git clone https://github.com/Domdhi/Domdhi.Agents.git my-project
cd my-project
rm -rf .git && git init

# Open in Claude Code
claude
```

Inside Claude Code, run:

```
/create:new-project
```

That's the one command to get from zero to implementation-ready. It scaffolds the `docs/` tree, interviews you, chains the planning pipeline (brief → PRD → architecture → epics), specializes the agents for your stack, and commits the whole initialization.

### Existing codebase (brownfield)

Don't run `/create:new-project` in a project that already has code — it's built for an empty repo. Instead, copy the `.claude/` directory in and let the zone-aware updater merge it without clobbering anything you've customized:

```bash
# From a clone of this template, sync .claude/ into your project
node .claude/core/template-updater.js update /path/to/your-project --merge
```

This preserves your `settings.json`, agent personalities, and any local customizations while bringing in the latest commands, agents, skills, and hooks. **To update an existing install later, re-run `template-updater` — don't re-clone.** A first-class one-command installer (`install.js`) and an `/onboard` command that reverse-engineers planning docs from your existing code are on the roadmap.

## Getting Started

Full walkthrough with a concrete sample project: [**docs/getting-started.md**](./docs/getting-started.md) — about thirty minutes from clone to specialized, implementation-ready project.

## Customize for Your Stack

- [`docs/guides/specialize.md`](./docs/guides/specialize.md) — `/review:specialize` reads your architecture doc, appends stack context to every baseline agent, and generates new stack-specific agents
- [`docs/guides/personalize.md`](./docs/guides/personalize.md) — `/review:personalize` gives your agents names, personas, and soul-level identities — cosmetic until you work at scale, then it becomes how you think about the team

## Documentation

See [`docs/README.md`](./docs/README.md) for the full index — three reading orders by role (newcomer / adopter / contributor). Highlights:

- **Concepts** — [commands](./docs/concepts/commands.md), [agents](./docs/concepts/agents.md), [skills](./docs/concepts/skills.md), [memory](./docs/concepts/memory.md), [hooks](./docs/concepts/hooks.md)
- **Reference** — [commands](./docs/reference/commands.md), [system-map](./docs/reference/system-map.md), [customization](./docs/reference/customization.md), [memory-flow](./docs/reference/memory-flow.md)
- **Guides** — [specialize](./docs/guides/specialize.md), [personalize](./docs/guides/personalize.md), [contributing](./docs/guides/contributing.md)

## Contributing

To extend the system with a new agent, command, or skill without breaking the three-tier architecture, see [`docs/guides/contributing.md`](./docs/guides/contributing.md). The decision gate at the top of that guide — *agent vs. skill vs. command* — is the highest-leverage choice in any contribution.

## License

MIT. See [LICENSE](./LICENSE).
