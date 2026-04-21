#!/usr/bin/env node

// Command Usage Logger Hook
//
// PostToolUse hook — logs slash-command invocations and gate runs to a local
// JSONL file for telemetry. Feeds /retro with actual usage data.
//
// Despite the previous name ("command-usage-logger"), this does NOT track skill
// invocations. Skills are markdown files auto-loaded into agent context via
// frontmatter — there is no "skill invoked" event to hook. What this logs is:
//
//   PostToolUse:Skill — when a /command is invoked (exact command name from tool_input.skill)
//   PostToolUse:Bash  — when gate.js is run (build/test gate signal)
//
// Output: docs/.output/telemetry/command-usage.jsonl
//
// Exit codes:
//   0 = always (PostToolUse hooks cannot block)

const fs = require('fs');
const path = require('path');

const MAX_JSONL_LINES = 1000;
const TAIL_KEEP_LINES = 500;

function readStdin() {
    return new Promise((resolve) => {
        if (process.stdin.isTTY) { resolve(''); return; }
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', () => resolve(''));
        setTimeout(() => resolve(data), 1000);
    });
}

/**
 * Infer whether a bash command is a gate.js invocation and return the gate type.
 *
 * @param {string|null} command - The bash command string
 * @returns {'gate:test'|'gate:build'|null}
 */
function inferGateRun(command) {
    if (!command || !command.includes('gate.js')) return null;
    // Match: gate.js --test, gate.js test → gate:test
    // Match: gate.js build, gate.js (bare) → gate:build
    if (/gate\.js\s+(--test|test)\b/.test(command)) return 'gate:test';
    if (/gate\.js/.test(command)) return 'gate:build';
    return null;
}

/**
 * Read gate.js's `_latest-summary.json` to determine the most recent gate's
 * pass/fail outcome. Used as a fallback when Claude Code's PostToolUse:Bash
 * payload omits exit_code (which it always does as of this writing — the
 * tool_response shape is { stdout, stderr, interrupted, isImage }, no exit code).
 *
 * Without this fallback every gate_run telemetry entry logs outcome:fail —
 * surfaced as a 3-strikes finding across TDD-3, TDD-5, and TDD-6 retros.
 *
 * @param {string} cwd - Project root
 * @returns {{ overall: boolean } | null} Parsed summary, or null on any read/parse failure
 */
function readGateSummary(cwd) {
    try {
        const summaryPath = path.join(cwd, 'docs', '.output', 'telemetry', '_latest-summary.json');
        const content = fs.readFileSync(summaryPath, 'utf8');
        const parsed = JSON.parse(content);
        return typeof parsed.overall === 'boolean' ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Append a JSONL entry to the given path. Creates parent directories if needed.
 * Tail-rotates to TAIL_KEEP_LINES when the file exceeds MAX_JSONL_LINES.
 * Silent on any error (telemetry must not block the workflow).
 *
 * @param {string} jsonlPath - Absolute path to the JSONL file
 * @param {object} event - The event object to append
 */
function appendJsonl(jsonlPath, event) {
    try {
        fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });

        // Append event
        fs.appendFileSync(jsonlPath, JSON.stringify(event) + '\n', 'utf8');

        // Tail-sample if over limit
        const content = fs.readFileSync(jsonlPath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length > MAX_JSONL_LINES) {
            const trimmed = lines.slice(-TAIL_KEEP_LINES).join('\n') + '\n';
            fs.writeFileSync(jsonlPath, trimmed, 'utf8');
        }
    } catch {
        // Graceful degradation — never block on telemetry failure
    }
}

/**
 * Process a PostToolUse event and append a telemetry entry if relevant.
 *
 * @param {object} parsedJson - { tool_name, tool_input, tool_output, tool_response, cwd }
 * @returns {null} Always returns null
 */
function processEvent(parsedJson) {
    let event = null;

    // Check for command invocation (PostToolUse:Skill)
    const skillName = parsedJson?.tool_input?.skill;
    if (skillName) {
        event = {
            timestamp: new Date().toISOString(),
            type: 'command_invocation',
            command: skillName,
        };
    }

    // Check for gate run (PostToolUse:Bash)
    const bashCommand = parsedJson?.tool_input?.command || '';
    const gateCommand = inferGateRun(bashCommand);
    if (gateCommand) {
        // Outcome resolution precedence:
        //   1. exit_code from tool_response/tool_output if present (preferred —
        //      backward-compatible with any future Claude Code version that
        //      adds exit_code to the Bash hook payload)
        //   2. _latest-summary.json from gate.js (current production path —
        //      Claude Code's PostToolUse:Bash payload does NOT include exit_code,
        //      so without this fallback every gate_run logged 'fail')
        //   3. Default 'fail' — safer to under-report success than to claim a
        //      green gate that never actually happened
        const exitCode = parsedJson?.tool_response?.exit_code ?? parsedJson?.tool_output?.exit_code ?? null;
        const cwdForSummary = parsedJson?.cwd || process.cwd();

        let outcome;
        if (exitCode !== null) {
            outcome = exitCode === 0 ? 'pass' : 'fail';
        } else {
            const summary = readGateSummary(cwdForSummary);
            outcome = summary?.overall === true ? 'pass' : 'fail';
        }

        event = {
            timestamp: new Date().toISOString(),
            type: 'gate_run',
            command: gateCommand,
            outcome,
        };
    }

    if (!event) { return null; }

    // Write to JSONL
    const cwd = parsedJson?.cwd || process.cwd();
    const jsonlPath = path.join(cwd, 'docs', '.output', 'telemetry', 'command-usage.jsonl');

    appendJsonl(jsonlPath, event);

    return null;
}

async function main() {
    const input = await readStdin();
    if (!input) { process.exit(0); }

    let data;
    try {
        data = JSON.parse(input);
    } catch {
        process.exit(0);
    }

    processEvent(data);
    process.exit(0);
}

if (require.main === module) {
    main().catch(() => process.exit(0));
}

module.exports = { processEvent, inferGateRun, appendJsonl };
