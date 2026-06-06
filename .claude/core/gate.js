#!/usr/bin/env node

/**
 * Gate — Build and optionally test, parse results, write structured output.
 *
 * Project-agnostic: reads build/test commands from .claude/gate.config.json
 * or falls back to auto-detection based on project files.
 *
 * Usage:
 *   node .claude/core/gate.js                    # Build only
 *   node .claude/core/gate.js build              # Build only (explicit)
 *   node .claude/core/gate.js test               # Build + test
 *
 * Output:
 *   docs/.output/telemetry/logs/gate-{timestamp}.log    — Full output
 *   docs/.output/telemetry/_latest-build.json           — Parsed build results
 *   docs/.output/telemetry/_latest-test.json            — Parsed test results (if --test)
 *   docs/.output/telemetry/_latest-summary.json         — Combined summary
 *
 * Configuration (.claude/gate.config.json):
 *   {
 *     "build": { "command": "npm run build", "timeout": 300000 },
 *     "test":  { "command": "npm test", "timeout": 600000 }
 *   }
 *
 * Auto-detection order (if no config):
 *   1. package.json → npm run build / npm test
 *   2. Cargo.toml → cargo build / cargo test
 *   3. go.mod → go build ./... / go test ./...
 *   4. *.sln or *.slnx → dotnet build / dotnet test
 *   5. pyproject.toml → ruff check + format --check + mypy --strict / pytest
 *   6. Makefile → make build / make test
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getTelemetryDir } = require('./_lib/telemetry-paths');
const { writeSummary } = require('./_lib/gate-summary');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
const GATE_DIR = getTelemetryDir(PROJECT_ROOT);
const LOG_DIR = path.join(getTelemetryDir(PROJECT_ROOT), 'logs');
const LOCK_FILE = path.join(GATE_DIR, '.gate.lock');
const CONFIG_FILE = path.join(PROJECT_ROOT, '.claude', 'gate.config.json');

// ── Args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const skipBuild = args.includes('--no-build');
const changedOnly = args.includes('--changed');
// --no-build implies --test (build-skip without testing is meaningless)
const runTests = skipBuild || args.includes('--test') || args.includes('test');

// ── Lock ────────────────────────────────────────────────────────────

function acquireLock() {
    fs.mkdirSync(GATE_DIR, { recursive: true });
    try {
        const fd = fs.openSync(LOCK_FILE, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
        fs.closeSync(fd);
        return true;
    } catch (err) {
        if (err.code === 'EEXIST') {
            try {
                const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
                const age = Date.now() - new Date(lock.started).getTime();
                if (age > 600000) {
                    console.log(`[GATE] Stale lock detected (${Math.round(age / 60000)}m old, PID ${lock.pid}). Breaking it.`);
                    fs.unlinkSync(LOCK_FILE);
                    return acquireLock();
                }
            } catch {
                fs.unlinkSync(LOCK_FILE);
                return acquireLock();
            }
            return false;
        }
        throw err;
    }
}

function releaseLock() {
    try { fs.unlinkSync(LOCK_FILE); } catch { /* already gone */ }
}

// ── Config / Auto-Detection ─────────────────────────────────────────

function loadConfig() {
    // Try explicit config first
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        } catch (err) {
            console.log(`[GATE] Warning: could not parse ${CONFIG_FILE}: ${err.message}`);
        }
    }

    // Auto-detect from project files
    const files = fs.readdirSync(PROJECT_ROOT);

    if (files.includes('package.json')) {
        let pkg;
        try {
            pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
        } catch (err) {
            console.log(`[GATE] Warning: could not parse package.json: ${err.message}`);
            pkg = {};
        }
        const scripts = pkg.scripts || {};
        return {
            build: { command: scripts.build ? 'npm run build' : 'npx tsc --noEmit', timeout: 300000 },
            test: { command: scripts.test ? 'npm test' : 'echo "No test script"', timeout: 600000 },
            stack: 'node'
        };
    }

    if (files.includes('Cargo.toml')) {
        return {
            build: { command: 'cargo build', timeout: 300000 },
            test: { command: 'cargo test', timeout: 600000 },
            stack: 'rust'
        };
    }

    if (files.includes('go.mod')) {
        return {
            build: { command: 'go build ./...', timeout: 300000 },
            test: { command: 'go test ./...', timeout: 600000 },
            stack: 'go'
        };
    }

    const slnx = files.find(f => f.endsWith('.slnx'));
    const sln = files.find(f => f.endsWith('.sln'));
    const solution = slnx || sln;
    if (solution) {
        return {
            build: { command: `dotnet build "${solution}" --configuration Release --verbosity minimal`, timeout: 300000 },
            test: { command: `dotnet test "${solution}" --configuration Release --verbosity minimal --no-build`, timeout: 600000 },
            stack: 'dotnet'
        };
    }

    if (files.includes('pyproject.toml')) {
        // Prefer .venv/bin/ tools when present (project-local venv pattern).
        const venvBin = path.join(PROJECT_ROOT, '.venv', 'bin');
        const hasVenv = fs.existsSync(path.join(venvBin, 'ruff'));
        const prefix = hasVenv ? `${venvBin}/` : '';
        const buildCmd = [
            `${prefix}ruff check src tests`,
            `${prefix}ruff format --check src tests`,
            `${prefix}mypy --strict src`,
        ].join(' && ');
        return {
            build: { command: buildCmd, timeout: 300000 },
            test: { command: `${prefix}pytest`, timeout: 1200000 },
            stack: 'python'
        };
    }

    if (files.includes('Makefile')) {
        return {
            build: { command: 'make build', timeout: 300000 },
            test: { command: 'make test', timeout: 600000 },
            stack: 'make'
        };
    }

    return {
        build: { command: 'echo "No build command detected"', timeout: 60000 },
        test: { command: 'echo "No test command detected"', timeout: 60000 },
        stack: 'unknown'
    };
}

// ── Helpers ─────────────────────────────────────────────────────────

function ensureDirs() {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function runCommand(cmd, cwd, timeoutMs) {
    try {
        const output = execSync(cmd, {
            cwd,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: timeoutMs,
            windowsHide: true,
        });
        return { exitCode: 0, output, stderr: '' };
    } catch (error) {
        return {
            exitCode: error.status || 1,
            output: error.stdout || '',
            stderr: error.stderr || ''
        };
    }
}

// ── Generic Output Parser ───────────────────────────────────────────

/** Remove ANSI escape codes so regexes work on raw terminal output. */
function stripAnsi(str) {
    // Covers SGR (\x1b[...m) and all CSI sequences (\x1b[...letter)
    return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function parseBuildOutput(output, exitCode) {
    const errors = [];
    const warnings = [];
    const lines = output.split('\n');

    for (const rawLine of lines) {
        const line = stripAnsi(rawLine);
        // Common error patterns across stacks
        // TypeScript: src/file.ts(10,5): error TS2345: ...
        // ESLint: /path/file.ts:10:5: error ...
        // Generic: file:line:col: error ...
        // mypy: src/file.py:42: error: Cannot assign ...  [assignment]
        // ruff:  src/file.py:10:5: F401 `os` imported but unused
        const errorPatterns = [
            /(.+?)\((\d+),(\d+)\):\s*error\s+(\w+\d+):\s*(.+)/,          // TS/C# style
            /(.+?):(\d+):(\d+):\s*error\s*(.+)/,                           // ESLint/generic style
            /(.+\.py):(\d+):\s*error:\s*(.+)/,                             // mypy style (no column)
            /(.+\.py):(\d+):(\d+):\s*([A-Z]+\d+)\s+(.+)/,                  // ruff style
            /^error(?:\[(\w+)\])?:\s*(.+)/,                                 // Rust/generic prefix
        ];

        for (const pattern of errorPatterns) {
            const match = line.match(pattern);
            if (match) {
                errors.push({
                    file: match[1]?.trim() || '',
                    line: parseInt(match[2]) || 0,
                    column: parseInt(match[3]) || 0,
                    code: match[4]?.trim() || '',
                    message: match[5]?.trim() || match[2]?.trim() || ''
                });
                break;
            }
        }

        // Warning patterns
        const warnPatterns = [
            /(.+?)\((\d+),(\d+)\):\s*warning\s+(\w+\d+):\s*(.+)/,
            /(.+?):(\d+):(\d+):\s*warning\s*(.+)/,
            /^warning(?:\[(\w+)\])?:\s*(.+)/,
        ];

        for (const pattern of warnPatterns) {
            const match = line.match(pattern);
            if (match) {
                warnings.push({
                    file: match[1]?.trim() || '',
                    line: parseInt(match[2]) || 0,
                    column: parseInt(match[3]) || 0,
                    code: match[4]?.trim() || '',
                    message: match[5]?.trim() || match[2]?.trim() || ''
                });
                break;
            }
        }
    }

    return { succeeded: exitCode === 0, errors, warnings };
}

function parseTestOutput(output, exitCode) {
    const tests = { passed: 0, failed: 0, skipped: 0, total: 0, failures: [] };
    const lines = output.split('\n');

    for (const rawLine of lines) {
        // Strip ANSI colour codes — Vitest 2.x embeds them in summary lines
        const line = stripAnsi(rawLine);

        // Vitest/Jest v1 style: Tests: 5 passed, 1 failed, 2 skipped, 8 total
        const vitestV1Match = line.match(/Tests:\s*(?:(\d+)\s*passed)?[,\s]*(?:(\d+)\s*failed)?[,\s]*(?:(\d+)\s*skipped)?[,\s]*(\d+)\s*total/i);
        if (vitestV1Match) {
            tests.passed = parseInt(vitestV1Match[1] || 0);
            tests.failed = parseInt(vitestV1Match[2] || 0);
            tests.skipped = parseInt(vitestV1Match[3] || 0);
            tests.total = parseInt(vitestV1Match[4] || 0);
            continue;
        }

        // Vitest 2.x style: "Tests  2 passed (2)" or "Tests  1 failed | 251 passed (252)"
        // No colon, no "total" word — total is in parens at the end. Order of
        // passed/failed/skipped varies (failures come first when present).
        // Strategy: match the outer envelope, then scan body for each keyword.
        const vitestV2Envelope = line.match(/Tests\s{2,}(.+)\s*\((\d+)\)/i);
        if (vitestV2Envelope) {
            const body = vitestV2Envelope[1];
            const totalStr = vitestV2Envelope[2];
            const pM = body.match(/(\d+)\s*passed/i);
            const fM = body.match(/(\d+)\s*failed/i);
            const sM = body.match(/(\d+)\s*skipped/i);
            tests.passed = pM ? parseInt(pM[1]) : 0;
            tests.failed = fM ? parseInt(fM[1]) : 0;
            tests.skipped = sM ? parseInt(sM[1]) : 0;
            tests.total = parseInt(totalStr);
            continue;
        }

        // dotnet test: Passed! - Failed: 0, Passed: 10, Skipped: 0, Total: 10
        const dotnetMatch = line.match(/(?:Passed!|Failed!)\s*-\s*Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*(\d+),\s*Total:\s*(\d+)/);
        if (dotnetMatch) {
            tests.failed += parseInt(dotnetMatch[1]);
            tests.passed += parseInt(dotnetMatch[2]);
            tests.skipped += parseInt(dotnetMatch[3]);
            tests.total += parseInt(dotnetMatch[4]);
            continue;
        }

        // Go: ok/FAIL package lines + test count
        const goMatch = line.match(/^(?:ok|FAIL)\s+\S+\s+[\d.]+s/);
        if (goMatch) {
            // Go doesn't give granular counts in the summary line
            continue;
        }

        // Rust: test result: ok. N passed; N failed; N ignored
        const rustMatch = line.match(/test result:\s*\w+\.\s*(\d+)\s*passed;\s*(\d+)\s*failed;\s*(\d+)\s*ignored/);
        if (rustMatch) {
            tests.passed = parseInt(rustMatch[1]);
            tests.failed = parseInt(rustMatch[2]);
            tests.skipped = parseInt(rustMatch[3]);
            tests.total = tests.passed + tests.failed + tests.skipped;
            continue;
        }

        // pytest summary: "===== 5 passed, 1 failed, 2 skipped in 1.23s =====".
        // Counters may appear in any order; "warnings" / "errors" / "deselected"
        // segments are ignored. Match the envelope, then scan the body for keywords.
        const pytestMatch = line.match(/={2,}\s+(.+?)\s+in\s+[\d.]+s\s*={2,}/);
        if (pytestMatch && /\b(passed|failed|skipped|error|errors)\b/.test(pytestMatch[1])) {
            const body = pytestMatch[1];
            const pM = body.match(/(\d+)\s+passed/);
            const fM = body.match(/(\d+)\s+failed/);
            const sM = body.match(/(\d+)\s+skipped/);
            const eM = body.match(/(\d+)\s+errors?/);
            tests.passed = pM ? parseInt(pM[1]) : 0;
            tests.failed = (fM ? parseInt(fM[1]) : 0) + (eM ? parseInt(eM[1]) : 0);
            tests.skipped = sM ? parseInt(sM[1]) : 0;
            tests.total = tests.passed + tests.failed + tests.skipped;
            continue;
        }

        // pytest individual failure: "FAILED tests/test_foo.py::test_bar - AssertionError: ..."
        const pytestFailMatch = line.match(/^FAILED\s+(\S+)(?:\s+-\s+(.+))?$/);
        if (pytestFailMatch) {
            tests.failures.push({ name: pytestFailMatch[1] });
            continue;
        }

        // Individual failure lines
        const failMatch = line.match(/^\s*(?:FAIL|Failed|✗|✘|×)\s+(.+?)(?:\s+\[|$)/);
        if (failMatch) {
            tests.failures.push({ name: failMatch[1].trim() });
        }
    }

    tests.succeeded = exitCode === 0 && tests.failed === 0;
    return tests;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
    const startedAt = Date.now();
    ensureDirs();

    if (!acquireLock()) {
        console.error('[GATE] Another gate is already running. Wait for it to finish.');
        process.exit(3);
    }

    process.on('exit', releaseLock);
    process.on('SIGINT', () => { releaseLock(); process.exit(130); });
    process.on('SIGTERM', () => { releaseLock(); process.exit(143); });

    const config = loadConfig();
    console.log(`[GATE] Detected stack: ${config.stack || 'configured'}`);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(LOG_DIR, `gate-${timestamp}.log`);
    const mode = skipBuild
        ? (changedOnly ? 'TEST (changed only)' : 'TEST ONLY')
        : (runTests ? 'BUILD + TEST' : 'BUILD');
    let fullLog = `${mode} gate started at ${new Date().toISOString()}\nStack: ${config.stack || 'configured'}\n${'='.repeat(60)}\n`;

    // ── Step 1: Build ───────────────────────────────────────────────

    let build;
    if (skipBuild) {
        console.log('[GATE] Build: SKIPPED (--no-build)');
        fullLog += '\n--- Build SKIPPED (--no-build) ---\n';
        build = {
            succeeded: true,
            errors: [],
            warnings: [],
            exitCode: 0,
            command: '(skipped)',
            timestamp: new Date().toISOString(),
            skipped: true,
        };
        fs.writeFileSync(
            path.join(GATE_DIR, '_latest-build.json'),
            JSON.stringify(build, null, 2)
        );
    } else {
        console.log(`[GATE] Building... (${config.build.command})`);
        fullLog += '\n--- Build ---\n';

        const buildResult = runCommand(config.build.command, PROJECT_ROOT, config.build.timeout);
        const buildCombined = buildResult.output + '\n' + buildResult.stderr;
        fullLog += buildCombined + '\n';

        build = parseBuildOutput(buildCombined, buildResult.exitCode);
        build.exitCode = buildResult.exitCode;
        build.command = config.build.command;
        build.timestamp = new Date().toISOString();

        fs.writeFileSync(
            path.join(GATE_DIR, '_latest-build.json'),
            JSON.stringify(build, null, 2)
        );

        const buildStatus = build.succeeded ? 'PASSED' : 'FAILED';
        console.log(`[GATE] Build: ${buildStatus} (${build.errors.length} errors, ${build.warnings.length} warnings)`);
    }

    // ── Step 2: Test (if requested and build passed) ────────────────

    let test = null;
    if (runTests) {
        if (!build.succeeded) {
            console.log('[GATE] Skipping tests — build failed');
            fullLog += '\n--- Tests SKIPPED (build failed) ---\n';
        } else {
            // Inject --changed via `npm test -- --changed` (extra args after `--` pass through to vitest).
            // --passWithNoTests prevents false-failure when --changed matches zero files (e.g., docs-only wave).
            const testCmd = changedOnly
                ? `${config.test.command} -- --changed --passWithNoTests`
                : config.test.command;
            console.log(`[GATE] Testing... (${testCmd})`);
            fullLog += '\n--- Tests ---\n';

            const testResult = runCommand(testCmd, PROJECT_ROOT, config.test.timeout);
            const testCombined = testResult.output + '\n' + testResult.stderr;
            fullLog += testCombined + '\n';

            test = parseTestOutput(testCombined, testResult.exitCode);
            test.exitCode = testResult.exitCode;
            test.command = testCmd;
            test.timestamp = new Date().toISOString();

            fs.writeFileSync(
                path.join(GATE_DIR, '_latest-test.json'),
                JSON.stringify(test, null, 2)
            );

            const testStatus = test.succeeded ? 'PASSED' : 'FAILED';
            console.log(`[GATE] Tests: ${testStatus} (${test.passed} passed, ${test.failed} failed, ${test.skipped} skipped)`);
        }
    }

    // ── Summary ─────────────────────────────────────────────────────

    const overall = build.succeeded && (!runTests || (test && test.succeeded));

    const summary = {
        timestamp: new Date().toISOString(),
        mode,
        stack: config.stack || 'configured',
        overall,
        // Wall-clock duration of the whole gate run. Read by command-usage-logger
        // to populate gate_run telemetry's duration_ms (the PostToolUse:Bash hook
        // has no timing of its own — see that hook's gate_run branch).
        durationMs: Date.now() - startedAt,
        build: {
            succeeded: build.succeeded,
            errorCount: build.errors.length,
            warningCount: build.warnings.length
        }
    };

    if (test) {
        summary.test = {
            succeeded: test.succeeded,
            passed: test.passed,
            failed: test.failed,
            skipped: test.skipped,
            total: test.total,
            failureNames: test.failures.map(f => f.name)
        };
    }

    writeSummary(PROJECT_ROOT, summary);

    fullLog += `\n${'='.repeat(60)}\n${mode} gate completed at ${new Date().toISOString()}\n`;
    fullLog += `Overall: ${overall ? 'PASSED' : 'FAILED'}\n`;
    fs.writeFileSync(logPath, fullLog);

    console.log(`[GATE] Log: ${logPath}`);
    console.log(`[GATE] Overall: ${overall ? 'PASSED' : 'FAILED'}`);

    process.exit(overall ? 0 : 1);
}

if (require.main === module) {
    main().catch(err => {
        console.error('[GATE] Fatal error:', err.message);
        process.exit(2);
    });
}

module.exports = { loadConfig, parseBuildOutput, parseTestOutput, acquireLock, releaseLock };
