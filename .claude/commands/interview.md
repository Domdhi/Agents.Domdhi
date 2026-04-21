---
name: interview
description: Ask interactive questions to gather requirements, preferences, or decisions before building something
argument-hint: <topic to discuss>
---

# Interview

Ask the user interactive questions to gather information before taking action. Use `AskUserQuestion` tool for structured multi-choice questions, not open-ended text prompts.

## When to Use

- Before building a new feature, command, or component
- When requirements are vague and need clarification
- When there are multiple valid approaches and the user should choose
- When designing a new file structure, naming convention, or workflow
- Anytime you'd otherwise guess at what the user wants

## How It Works

1. **Read the topic** from the argument (e.g., `/interview rate tracker export options`)
2. **Think about what you need to know** to take action on that topic
3. **Ask 1-4 questions per round** using `AskUserQuestion` with concrete options
4. **Summarize answers** after each round
5. **Ask follow-up rounds** if needed (max 3 rounds)
6. **Output a decision summary** when done — what was decided and why

## Rules

- **Max 4 questions per round, max 3 rounds** — don't interrogate
- **Every question must have concrete options** with descriptions — no open-ended "what do you think?"
- **Use previews** when comparing visual layouts, code patterns, or file structures
- **Use multiSelect** when choices aren't mutually exclusive
- **Short headers** (max 12 chars) — they render as chips
- **Lead with a recommendation** — put your suggested option first with "(Recommended)"
- **Stop when you have enough** — don't ask questions you can answer from CLAUDE.md or the codebase
- **End with a summary** — "Here's what we decided: ..." so it's clear what to do next

## Example Flow

```
User: /interview notification system design

Round 1: [4 questions about delivery, persistence, real-time vs batch, UI placement]
Round 2: [2 follow-ups based on answers about grouping and priority]
Summary: "Decided: SignalR push for real-time, toast + badge count, grouped by entity,
         stored in app.Notifications with 30-day retention. Ready to build."
```
