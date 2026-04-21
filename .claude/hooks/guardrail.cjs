#!/usr/bin/env node

/**
 * Guardrail — PreToolUse:Bash Hook
 *
 * Reads .claude/guardrail-rules.yaml and checks the incoming bash command
 * against configured rule sets before Claude executes it.
 *
 * Usage:
 *   Claude hook:  Reads tool input from stdin (JSON with tool_input.command)
 *   Manual test:  echo '{"tool_input":{"command":"git push --force"}}' | node guardrail.cjs
 *
 * Exit codes (Claude Code semantics):
 *   0 = command is safe — proceed silently
 *   0 + JSON permissionDecision:"ask" = CONFIRM — user is prompted yes/no
 *   2 = command is BLOCKED — do not execute (hard block)
 *
 * Note: Exit code 1 is treated as a non-blocking error by Claude Code —
 * the command still executes. Only exit 2 prevents execution.
 * Confirmation uses exit 0 + JSON output, not exit 2.
 *
 * Graceful degradation:
 *   - Missing guardrail-rules.yaml  → warn to stderr, exit 0 (pass through)
 *   - Malformed YAML                → warn to stderr, exit 0 (pass through)
 *   - Missing/empty command input   → exit 0 (nothing to check)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ============================================
// Minimal YAML parser (no external deps)
// ============================================
// Supports the subset used in guardrail-rules.yaml:
//   - Top-level keys
//   - Indented list items (  - value)
//   - Nested keys (  key:)
//   - Inline comments (# ...)
//   - Quoted and unquoted string values
//   - Blank lines

function parseYaml(text) {
    const lines = text.split('\n');
    const result = {};
    let currentTopKey = null;
    let currentSubKey = null;

    for (let raw of lines) {
        // Strip inline comments (but not inside quotes)
        const line = stripComment(raw);
        if (!line.trim()) continue;

        const indent = line.search(/\S/);

        // Top-level key (no indent, ends with colon)
        if (indent === 0 && line.includes(':')) {
            const colonIdx = line.indexOf(':');
            const key = line.slice(0, colonIdx).trim();
            const value = line.slice(colonIdx + 1).trim();
            if (value) {
                result[key] = parseScalar(value);
                currentTopKey = null;
                currentSubKey = null;
            } else {
                currentTopKey = key;
                currentSubKey = null;
                if (!result[key]) result[key] = {};
            }
            continue;
        }

        // Indented list item under a top-level key
        if (indent > 0 && line.trim().startsWith('- ') && currentTopKey) {
            const value = line.trim().slice(2).trim();
            if (currentSubKey) {
                // List under a sub-key (e.g. zero_access list items)
                if (!Array.isArray(result[currentTopKey][currentSubKey])) {
                    result[currentTopKey][currentSubKey] = [];
                }
                result[currentTopKey][currentSubKey].push(parseScalar(value));
            } else {
                // List directly under top-level key
                if (!Array.isArray(result[currentTopKey])) {
                    result[currentTopKey] = [];
                }
                result[currentTopKey].push(parseScalar(value));
            }
            continue;
        }

        // Indented sub-key under a top-level mapping
        if (indent > 0 && line.includes(':') && currentTopKey) {
            const colonIdx = line.indexOf(':');
            const key = line.slice(0, colonIdx).trim();
            const value = line.slice(colonIdx + 1).trim();
            currentSubKey = key;
            if (value) {
                result[currentTopKey][key] = parseScalar(value);
            } else {
                result[currentTopKey][key] = [];
            }
        }
    }

    return result;
}

function stripComment(line) {
    // Walk character-by-character to avoid stripping # inside quotes
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "'" && !inDouble) inSingle = !inSingle;
        else if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (ch === '#' && !inSingle && !inDouble) {
            return line.slice(0, i);
        }
    }
    return line;
}

function parseScalar(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}

// ============================================
// Rule loader
// ============================================

function loadRules() {
    const projectDir = process.env.CLAUDE_PROJECT_DIR
        || path.resolve(__dirname, '..', '..');
    const rulesPath = path.join(projectDir, '.claude', 'guardrail-rules.yaml');

    if (!fs.existsSync(rulesPath)) {
        process.stderr.write(
            '[guardrail] WARNING: guardrail-rules.yaml not found at ' + rulesPath + '\n' +
            '[guardrail] All commands will pass through until the rule file is created.\n'
        );
        return null;
    }

    let raw;
    try {
        raw = fs.readFileSync(rulesPath, 'utf8');
    } catch (err) {
        process.stderr.write(
            '[guardrail] WARNING: Could not read guardrail-rules.yaml: ' + err.message + '\n' +
            '[guardrail] All commands will pass through.\n'
        );
        return null;
    }

    let rules;
    try {
        rules = parseYaml(raw);
    } catch (err) {
        process.stderr.write(
            '[guardrail] WARNING: Could not parse guardrail-rules.yaml: ' + err.message + '\n' +
            '[guardrail] All commands will pass through.\n'
        );
        return null;
    }

    // Validate that rule arrays are actually arrays after parsing.
    // If a YAML authoring error (e.g. a colon in a list item) caused the parser
    // to corrupt block_patterns or confirm_patterns from an array to an object,
    // we must fail safe and warn the operator rather than silently passing all commands.
    const arrayKeys = ['block_patterns', 'confirm_patterns'];
    for (const key of arrayKeys) {
        if (rules[key] !== undefined && !Array.isArray(rules[key])) {
            process.stderr.write(
                '[guardrail] WARNING: ' + key + ' in guardrail-rules.yaml is malformed (expected array, got ' +
                typeof rules[key] + ').\n' +
                '[guardrail] This may be caused by a colon in a list item. Check the rule file.\n' +
                '[guardrail] All commands will pass through until the file is corrected.\n'
            );
            return null;
        }
    }

    // One-time WARN if path_rules is defined AND non-empty. The hook does not yet
    // enforce path_rules — the YAML header documents this, but adopters who skip
    // the comments and populate zero_access/read_only expecting enforcement would
    // be silently unprotected. Surface the gap explicitly.
    if (rules.path_rules && typeof rules.path_rules === 'object') {
        const hasEntries = Object.values(rules.path_rules).some(
            v => Array.isArray(v) && v.length > 0
        );
        if (hasEntries) {
            process.stderr.write(
                '[guardrail] NOTICE: path_rules is populated in guardrail-rules.yaml but is reserved for future enforcement.\n' +
                '[guardrail] The hook does not currently block access to those paths. See the YAML file header for details.\n'
            );
        }
    }

    return rules;
}

// ============================================
// Pattern matching
// ============================================

/**
 * Match a command string against a list of pattern strings.
 * Each pattern is matched as a substring (case-insensitive) OR as a regex
 * if the pattern is wrapped in slashes: /pattern/
 */
function matchPatterns(command, patterns) {
    if (!Array.isArray(patterns)) return null;

    for (const pattern of patterns) {
        if (!pattern || typeof pattern !== 'string') continue;

        // Regex pattern: /expr/
        if (pattern.startsWith('/') && pattern.endsWith('/')) {
            const expr = pattern.slice(1, -1);
            try {
                const re = new RegExp(expr, 'i');
                if (re.test(command)) return pattern;
            } catch {
                // Bad regex — skip
            }
            continue;
        }

        // Plain substring match (case-insensitive)
        if (command.toLowerCase().includes(pattern.toLowerCase())) {
            return pattern;
        }
    }

    return null;
}

// ============================================
// Command sanitization
// ============================================

/**
 * Strip git commit message content from a command string before pattern matching.
 *
 * Commit messages are user-authored text, not executable commands. Without
 * stripping, a message like 'fix: prevent git push --force' false-positives
 * on the "git push --force" block pattern.
 *
 * Handles:
 *   git commit -m "message"           → git commit -m ""
 *   git commit -m '...'               → git commit -m ""
 *   git commit -m "$(cat <<'EOF'      → git commit -m ""
 *     multi-line message
 *     EOF
 *     )"
 */
function stripCommitMessages(command) {
    let result = command;

    // Strip heredoc commit messages: -m "$(cat <<'EOF' ... EOF )"
    // or -m "$(cat <<EOF ... EOF )"
    result = result.replace(
        /-m\s*"\$\(cat\s*<<'?EOF'?\s*\n[\s\S]*?\nEOF\s*\)"/g,
        '-m ""'
    );

    // Strip double-quoted -m "..." (non-greedy, handles escaped quotes)
    result = result.replace(/-m\s*"(?:[^"\\]|\\.)*"/g, '-m ""');

    // Strip single-quoted -m '...'
    result = result.replace(/-m\s*'[^']*'/g, "-m ''");

    // Strip unquoted -m word (single word, no spaces)
    result = result.replace(/-m\s+([^\s"'][^\s]*)/g, '-m STRIPPED');

    return result;
}

// ============================================
// Output formatters
// ============================================

function formatBlocked(command, matchedPattern) {
    return [
        '',
        '========================================',
        '  GUARDRAIL — COMMAND BLOCKED',
        '========================================',
        '',
        '  Command : ' + command,
        '  Matched : ' + matchedPattern,
        '  Reason  : This command matches a block_pattern in',
        '            .claude/guardrail-rules.yaml and has been',
        '            stopped before execution.',
        '',
        '  To allow this command, either:',
        '    1. Remove or comment out the matching rule in guardrail-rules.yaml',
        '    2. Run the command manually in your terminal',
        '========================================',
        '',
    ].join('\n');
}

function formatConfirm(command, matchedPattern) {
    return [
        '',
        '========================================',
        '  GUARDRAIL — CONFIRMATION REQUIRED',
        '========================================',
        '',
        '  Command : ' + command,
        '  Matched : ' + matchedPattern,
        '  Reason  : This command matches a confirm_pattern in',
        '            .claude/guardrail-rules.yaml and requires',
        '            explicit approval before proceeding.',
        '',
        '  Reply "yes" or "proceed" to allow, or "no" to cancel.',
        '========================================',
        '',
    ].join('\n');
}

// ============================================
// Rule checker
// ============================================

/**
 * Check a command against all rule sets and return an action decision.
 * Block patterns take precedence over confirm patterns.
 *
 * @param {string} command - The sanitized command to check
 * @param {object} rules - Parsed rules object with block_patterns and confirm_patterns arrays
 * @returns {{ action: 'block'|'confirm'|'allow', pattern?: string }}
 */
function checkRules(command, rules) {
    const blockedBy = matchPatterns(command, rules.block_patterns);
    if (blockedBy) return { action: 'block', pattern: blockedBy };
    const confirmedBy = matchPatterns(command, rules.confirm_patterns);
    if (confirmedBy) return { action: 'confirm', pattern: confirmedBy };
    return { action: 'allow' };
}

// ============================================
// Event processor (testable core logic)
// ============================================

/**
 * Process a parsed hook event object and return a result object or null.
 *
 * Extracted from runClaudeHook so that tests can call it directly without
 * touching stdin/stdout/process.exit.
 *
 * @param {object} parsedJson - Parsed hook payload ({ tool_input: { command } })
 * @returns {null | { block: true, feedback: string } | { confirm: true, reason: string }}
 *   null means "allow" (no action needed).
 */
function processEvent(parsedJson) {
    const toolInput = (parsedJson && parsedJson.tool_input) || {};
    const command = (toolInput.command || '').trim();

    if (!command) return null;

    // Strip git commit message bodies before pattern matching.
    // Commit messages contain user-authored text that may mention blocked
    // commands (e.g. "fix: prevent force push" triggers "git push --force").
    const sanitizedCommand = stripCommitMessages(command);

    const rules = loadRules();

    // No rules loaded — pass through silently
    if (!rules) return null;

    const decision = checkRules(sanitizedCommand, rules);

    if (decision.action === 'block') {
        return { block: true, feedback: formatBlocked(command, decision.pattern) };
    }

    if (decision.action === 'confirm') {
        const reason = `Guardrail: "${decision.pattern}" — ${command}`;
        return { confirm: true, reason };
    }

    return null;
}

// ============================================
// Hook entry point
// ============================================

async function runClaudeHook() {
    const input = await readStdin();

    if (!input.trim()) process.exit(0);

    let data;
    try {
        data = JSON.parse(input);
    } catch {
        // Not JSON — nothing to check
        process.exit(0);
    }

    const result = processEvent(data);

    if (result === null) {
        process.exit(0);
    }

    if (result.block) {
        // Claude Code only blocks on exit code 2. Exit 1 is non-blocking (command still runs).
        process.stderr.write(result.feedback);
        process.exit(2);
    }

    if (result.confirm) {
        // Exit 0 with hookSpecificOutput.permissionDecision="ask" triggers
        // Claude Code's built-in confirmation prompt before proceeding.
        const output = {
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'ask',
                permissionDecisionReason: result.reason
            }
        };
        process.stdout.write(JSON.stringify(output));
        process.exit(0);
    }

    process.exit(0);
}

// ============================================
// Stdin reader (same pattern as secret-scanner)
// ============================================

function readStdin() {
    return new Promise((resolve) => {
        if (process.stdin.isTTY) {
            resolve('');
            return;
        }

        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', () => resolve(''));
    });
}

// ============================================
// Run
// ============================================

if (require.main === module) {
    runClaudeHook();
}

// ============================================
// Exports (for testing)
// ============================================

module.exports = {
    processEvent,
    parseYaml,
    stripComment,
    matchPatterns,      // AC called it "matchesRule" — source name preserved (takes array)
    stripCommitMessages,
    checkRules,         // NEW — extracted from runClaudeHook
    loadRules,          // already existed, exported for testability
};
