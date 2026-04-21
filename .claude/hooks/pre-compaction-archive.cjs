#!/usr/bin/env node

/**
 * Pre-Compaction Archive Hook
 *
 * PreCompact hook — snapshots key project context before Claude Code
 * compresses the conversation. Captures git status, in-progress TODO items,
 * recent commits, and key decisions so context survives compaction.
 *
 * Fires on both manual (/compact) and auto-compact triggers.
 *
 * Output:
 *   - Session snapshot: docs/.output/sessions/{YYYY-MM-DD}/{HHMM}-pre-compaction.md
 *   - Daily log entry:  docs/.output/memories/daily/{YYYY-MM-DD}.md (via daily-log.js)
 *
 * Exit codes:
 *   0 = always (PreCompact hooks cannot block compaction)
 */

const fs = require('fs');
const path = require('path');
const DailyLog = require('../core/daily-log');

function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', () => resolve(''));
        setTimeout(() => resolve(data), 1000);
    });
}

function buildSnapshot(cwd, log, trigger) {
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 19).replace('T', ' ');

    const gitStatus = log.run('git status --short');
    const gitLog = log.run('git log --oneline -5');
    const branch = log.run('git branch --show-current');
    const inProgress = log.findInProgressTodos();
    const decisions = log.findKeyDecisions();

    // Read handoff context if available
    let handoffContext = '';
    const handoffPath = path.join(cwd, 'docs', '__handoff.md');
    if (fs.existsSync(handoffPath)) {
        try {
            const handoffContent = fs.readFileSync(handoffPath, 'utf8');
            const decisionsMatch = handoffContent.match(/## Decisions & Context\s*\n([\s\S]*?)(?=\n## |\n---|\n$)/);
            const actionsMatch = handoffContent.match(/## Next Actions\s*\n([\s\S]*?)(?=\n## |\n---|\n$)/);
            const parts = [];
            if (decisionsMatch) parts.push(`### Decisions & Context\n${decisionsMatch[1].trim()}`);
            if (actionsMatch) parts.push(`### Next Actions\n${actionsMatch[1].trim()}`);
            if (parts.length > 0) handoffContext = parts.join('\n\n');
        } catch {
            // Graceful degradation
        }
    }

    // Read recent agent updates if available
    let agentUpdates = '';
    const updatesPath = path.join(cwd, 'docs', '.output', 'agent-updates.md');
    if (fs.existsSync(updatesPath)) {
        try {
            const updatesContent = fs.readFileSync(updatesPath, 'utf8');
            const sections = updatesContent.split(/(?=^## )/m).filter(s => s.trim());
            const recent = sections.slice(-5).join('\n').trim();
            if (recent) agentUpdates = recent;
        } catch {
            // Graceful degradation
        }
    }

    const sessionContext = (handoffContext || agentUpdates)
        ? `\n## Session Context\n\n${handoffContext}${handoffContext && agentUpdates ? '\n\n' : ''}${agentUpdates ? `### Recent Agent Updates\n${agentUpdates}` : ''}\n`
        : '';

    return `# Pre-Compaction Snapshot

**Timestamp:** ${timestamp}
**Trigger:** ${trigger}
**Branch:** ${branch}

## Git Status
\`\`\`
${gitStatus || '(clean)'}
\`\`\`

## Recent Commits
\`\`\`
${gitLog || '(no commits)'}
\`\`\`

## In-Progress Work
${inProgress}

## Recent Key Decisions
${decisions}
${sessionContext}`;
}

function processEvent(parsedJson) {
    const trigger = parsedJson?.trigger || 'unknown';
    const cwd = parsedJson?.cwd || process.cwd();

    const log = new DailyLog(cwd);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 16).replace(':', '');

    const snapshot = buildSnapshot(cwd, log, trigger);

    const sessionsDir = path.join(cwd, 'docs', '.output', 'sessions', dateStr);
    fs.mkdirSync(sessionsDir, { recursive: true });

    const snapshotPath = path.join(sessionsDir, `${timeStr}-pre-compaction.md`);
    fs.writeFileSync(snapshotPath, snapshot, 'utf8');

    process.stderr.write(`\n  Pre-compaction snapshot saved: ${path.relative(cwd, snapshotPath)}\n\n`);

    // Write daily log entry via shared utility
    try {
        const { logPath } = log.capture('Pre-Compaction');
        process.stderr.write(`  Daily log entry appended: ${path.relative(cwd, logPath)}\n\n`);
    } catch {
        // Graceful degradation — daily log failure does not affect snapshot or exit code
    }

    // Memory extraction is no longer triggered from the compaction path.
    // It now fires unconditionally from the session-handoff skill (Step 6)
    // on every /do, /run-todo wave, /run-tests, /todo, /end completion.
    // See .claude/skills/session-handoff/SKILL.md for details.
}

async function main() {
    const input = await readStdin();
    let data = {};
    try {
        data = JSON.parse(input);
    } catch {
        // Continue with defaults
    }

    processEvent(data);
    process.exit(0);
}

if (require.main === module) {
    main();
}

module.exports = { processEvent, buildSnapshot };
