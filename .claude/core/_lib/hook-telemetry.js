/**
 * Hook Telemetry — duration instrumentation wrapper for hook execution.
 *
 * Hook-duration telemetry is a blind-spot opportunity noted in Section D of
 * the competitive comparison; no competitor measures hook execution time.
 * See `docs/research/competitive/_hooks-and-core-scripts-comparison.md` §D.
 *
 * Usage from a hook:
 *
 *     const { startHookTiming, emitHookEvent } = require('../core/_lib/hook-telemetry');
 *     const t = startHookTiming('my-hook');
 *     try { ... } finally { emitHookEvent(t, outcome); }
 *
 * Events land at docs/.output/telemetry/hook-events.jsonl and can be consumed
 * by a future /retro or /listen command for latency analysis.
 *
 * Hook adoption shipped in P1.7 (command-usage-logger.cjs, damage-control.cjs,
 * memory-capture.cjs); path-guardrail.cjs also wraps its body in
 * startHookTiming/emitHookEvent.
 */

const path = require('path');
const { appendJsonl } = require('./jsonl-writer');
const { getJsonlPath } = require('./telemetry-paths');

// Match command-usage-logger's caps so hook-events.jsonl tail-rotates the same
// way command-usage.jsonl does. Without these, the file grows unbounded —
// every Bash hook + every Write/Edit hook + every Stop hook appends per
// invocation, ~12 events per /do, ~50+ per /run-todo wave.
const HOOK_EVENTS_MAX_LINES = 1000;
const HOOK_EVENTS_TAIL_KEEP = 500;

function getProjectRoot() {
    return process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..', '..');
}

/**
 * Start a timing token for a hook invocation.
 *
 * @param {string} hookName  Name of the hook (used as the event `name` field)
 * @returns {{ hookName: string, startMs: number }}
 */
function startHookTiming(hookName) {
    return { hookName, startMs: Date.now() };
}

/**
 * Emit a hook event to the JSONL log. Computes duration from the token's
 * startMs and appends {event:'hook', name, duration_ms, outcome, timestamp}.
 *
 * @param {{ hookName: string, startMs: number }} token  Timing token from startHookTiming
 * @param {string} outcome  Outcome label (e.g. 'success', 'failure', 'unknown')
 */
function emitHookEvent(token, outcome) {
    const now = Date.now();
    const entry = {
        event: 'hook',
        name: token.hookName,
        duration_ms: Math.max(0, now - token.startMs),
        outcome,
        timestamp: new Date(now).toISOString(),
    };
    appendJsonl(getJsonlPath(getProjectRoot(), 'hook-events.jsonl'), entry, {
        maxLines: HOOK_EVENTS_MAX_LINES,
        tailKeep: HOOK_EVENTS_TAIL_KEEP,
    });
}

module.exports = {
    startHookTiming,
    emitHookEvent,
    HOOK_EVENTS_MAX_LINES,
    HOOK_EVENTS_TAIL_KEEP,
};
