#!/usr/bin/env node

/**
 * Post-Read Secret Scrubber
 *
 * PostToolUse:Read hook — scans file contents AFTER they are read by Claude.
 * Warns about potential secrets in the conversation context.
 *
 * Unlike the pre-write scanner, this hook does NOT block — it warns only.
 * The secret is already in context, but the warning alerts the user.
 *
 * Pattern library shared with secret-scanner.cjs via secret-patterns.cjs.
 *
 * Exit codes:
 *   0 = always (post-read hooks cannot block)
 */

const {
    shouldSkipPath,
    scanContent,
    readStdin,
} = require('./secret-patterns.cjs');

/**
 * Process a PostToolUse:Read hook event.
 *
 * Payload shape note (2026-04-20): Claude Code sends the file content under
 * `tool_response` (object with `.content` or stringified) or legacy `tool_output`
 * (string). Handle both; tolerate object or string.
 *
 * @param {object} parsedJson — Hook event payload
 * @returns {null} Always null — non-blocking, warn-only
 */
function processEvent(parsedJson) {
    const toolInput = (parsedJson && parsedJson.tool_input) || {};
    const filePath = toolInput.file_path || '';

    if (!filePath || shouldSkipPath(filePath)) return null;

    // Extract content from either tool_response (current) or tool_output (legacy).
    // Each field may be an object (with .content/.stdout) or a raw string.
    const resp = (parsedJson && parsedJson.tool_response);
    const out = (parsedJson && parsedJson.tool_output);
    let toolOutput = '';
    if (typeof resp === 'string') toolOutput = resp;
    else if (resp && typeof resp === 'object') toolOutput = resp.content || resp.stdout || resp.text || '';
    if (!toolOutput) {
        if (typeof out === 'string') toolOutput = out;
        else if (out && typeof out === 'object') toolOutput = out.content || out.stdout || out.text || '';
    }
    if (!toolOutput) return null;

    const findings = scanContent(toolOutput, filePath);
    if (findings.length > 0) {
        // Warn on stderr — non-blocking
        process.stderr.write('\n');
        process.stderr.write('  ⚠ SECRET SCRUBBER — secrets detected in read file\n');
        process.stderr.write(`  File: ${filePath}\n`);
        process.stderr.write(`  Found: ${findings.length} potential secret(s)\n`);
        for (const f of findings) {
            const loc = f.line > 0 ? `:${f.line}` : '';
            process.stderr.write(`    - ${f.name} at ${f.file}${loc} (${f.match})\n`);
        }
        process.stderr.write('  These secrets are now in the conversation context.\n');
        process.stderr.write('  Consider removing them from the source file.\n');
        process.stderr.write('\n');
    }

    // Always return null — post-read cannot block
    return null;
}

async function main() {
    const input = await readStdin();
    if (!input) process.exit(0);

    let data;
    try {
        data = JSON.parse(input);
    } catch {
        process.exit(0);
    }

    processEvent(data);

    // Always exit 0 — post-read cannot block
    process.exit(0);
}

if (require.main === module) {
    main();
}

module.exports = { processEvent };
