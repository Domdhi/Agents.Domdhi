// AC→source map (TDD-5.5 / post-read-scrubber):
//   - processEvent: exported named function
//   - Secret in tool_output → writes warning to stderr, returns null (non-blocking)
//   - Path in skip list (node_modules) → no warning, returns null
//   - No file_path → returns null, no warning
//   - No tool_output / empty → returns null, no warning
//   - Clean content → no warning, returns null
//
// Note: post-read-scrubber.cjs currently has only a main() + require.main guard.
//   After refactor it must export processEvent as a pure function.
//   The AWS key in the secret test uses runtime concatenation to avoid the pre-commit hook.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { processEvent } = require('../post-read-scrubber.cjs');

// ─── Fake secret builders (runtime concatenation avoids pre-commit hook) ──────

function fakeAwsKey() {
    return 'AKIA' + 'FAKETESTKEY' + 'X'.repeat(5);
}

// ─── processEvent ─────────────────────────────────────────────────────────────

describe('post-read-scrubber', () => {
    describe('processEvent', () => {
        let stderrSpy;

        beforeEach(() => {
            stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        });

        afterEach(() => {
            stderrSpy.mockRestore();
        });

        it('processEvent_isExported', () => {
            expect(typeof processEvent).toBe('function');
        });

        it('processEvent_secretInContent_writesWarningToStderr', () => {
            const fakeKey = fakeAwsKey();
            processEvent({
                tool_input: { file_path: '/some/file.js' },
                tool_output: `export const key = "${fakeKey}";`
            });
            expect(stderrSpy).toHaveBeenCalled();
            const output = stderrSpy.mock.calls.map(c => c[0]).join('');
            expect(output).toMatch(/AWS Access Key|SECRET SCRUBBER/);
        });

        it('processEvent_secretInContent_returnsNull', () => {
            // Non-blocking: always returns null regardless of findings
            const fakeKey = fakeAwsKey();
            const result = processEvent({
                tool_input: { file_path: '/some/file.js' },
                tool_output: `export const key = "${fakeKey}";`
            });
            expect(result).toBeNull();
        });

        it('processEvent_skipPath_noWarning', () => {
            processEvent({
                tool_input: { file_path: 'node_modules/foo/index.js' },
                tool_output: 'whatever'
            });
            expect(stderrSpy).not.toHaveBeenCalled();
        });

        it('processEvent_noFilePath_returnsNull', () => {
            const result = processEvent({
                tool_input: {},
                tool_output: `export const key = "${fakeAwsKey()}";`
            });
            expect(result).toBeNull();
            expect(stderrSpy).not.toHaveBeenCalled();
        });

        it('processEvent_noToolOutput_returnsNull', () => {
            const result = processEvent({
                tool_input: { file_path: '/some/file.js' },
                tool_output: ''
            });
            expect(result).toBeNull();
            expect(stderrSpy).not.toHaveBeenCalled();
        });

        it('processEvent_cleanContent_noWarning', () => {
            processEvent({
                tool_input: { file_path: '/some/clean.js' },
                tool_output: 'const x = 42;\nconsole.log(x);\n'
            });
            expect(stderrSpy).not.toHaveBeenCalled();
        });

        // ─── R7 — output redaction via hookSpecificOutput.updatedToolOutput ───
        // Below-block tests cover the new behavior added 2026-05-10:
        //   - emit JSON to stdout when redacting (Read + Bash)
        //   - no stdout when content is clean
        //   - return null preserved (non-blocking semantics)
        //   - Bash event handling (no file_path; uses tool_response.stdout)

        describe('R7 redaction', () => {
            let stdoutSpy;

            beforeEach(() => {
                stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
            });

            afterEach(() => {
                stdoutSpy.mockRestore();
            });

            it('processEvent_readSecretInContent_emitsRedactedJsonToStdout', () => {
                // AC4: Read event with secret → JSON to stdout AND stderr warning
                const fakeKey = fakeAwsKey();
                processEvent({
                    tool_name: 'Read',
                    tool_input: { file_path: '/some/file.js' },
                    tool_output: `key = "${fakeKey}"`
                });

                expect(stdoutSpy).toHaveBeenCalled();
                const stdoutText = stdoutSpy.mock.calls.map(c => c[0]).join('');
                const parsed = JSON.parse(stdoutText.trim());
                expect(parsed.hookSpecificOutput.hookEventName).toBe('PostToolUse');
                expect(parsed.hookSpecificOutput.updatedToolOutput).toContain('<REDACTED:AWS Access Key>');
                expect(parsed.hookSpecificOutput.updatedToolOutput).not.toContain(fakeKey);

                // Existing stderr warning must still fire
                expect(stderrSpy).toHaveBeenCalled();
            });

            it('processEvent_bashSecretInStdout_emitsRedactedJsonToStdout', () => {
                // AC3: Bash event with secret in tool_response.stdout → JSON to stdout
                const fakeKey = fakeAwsKey();
                processEvent({
                    tool_name: 'Bash',
                    tool_input: { command: 'cat .env' },
                    tool_response: { stdout: `AWS_KEY=${fakeKey}\n`, stderr: '', interrupted: false }
                });

                expect(stdoutSpy).toHaveBeenCalled();
                const stdoutText = stdoutSpy.mock.calls.map(c => c[0]).join('');
                const parsed = JSON.parse(stdoutText.trim());
                expect(parsed.hookSpecificOutput.hookEventName).toBe('PostToolUse');
                expect(parsed.hookSpecificOutput.updatedToolOutput).toContain('<REDACTED:AWS Access Key>');
                expect(parsed.hookSpecificOutput.updatedToolOutput).not.toContain(fakeKey);
            });

            it('processEvent_cleanContent_noStdoutOutput', () => {
                // AC5: clean Read content → no stdout (no JSON emitted when not needed)
                processEvent({
                    tool_name: 'Read',
                    tool_input: { file_path: '/some/clean.js' },
                    tool_output: 'const x = 42;'
                });

                expect(stdoutSpy).not.toHaveBeenCalled();
            });

            it('processEvent_bashCleanOutput_noStdoutOutput', () => {
                // AC5: clean Bash output → no JSON emitted
                processEvent({
                    tool_name: 'Bash',
                    tool_input: { command: 'ls' },
                    tool_response: { stdout: 'file1.txt\nfile2.txt\n', stderr: '' }
                });

                expect(stdoutSpy).not.toHaveBeenCalled();
                expect(stderrSpy).not.toHaveBeenCalled();
            });

            it('processEvent_returnsNullEvenWhenRedacting', () => {
                // AC6: non-blocking semantics preserved even on redaction path
                const fakeKey = fakeAwsKey();
                const result = processEvent({
                    tool_name: 'Read',
                    tool_input: { file_path: '/some/file.js' },
                    tool_output: `key = "${fakeKey}"`
                });

                expect(result).toBeNull();
            });

            it('processEvent_bashWithoutToolName_inferredFromCommand', () => {
                // Tolerate missing tool_name when tool_input.command is present
                // (defensive against payload-shape variations across Claude Code versions)
                const fakeKey = fakeAwsKey();
                processEvent({
                    tool_input: { command: 'printenv' },
                    tool_response: { stdout: `KEY=${fakeKey}\n` }
                });

                expect(stdoutSpy).toHaveBeenCalled();
                const stdoutText = stdoutSpy.mock.calls.map(c => c[0]).join('');
                const parsed = JSON.parse(stdoutText.trim());
                expect(parsed.hookSpecificOutput.updatedToolOutput).toContain('<REDACTED:AWS Access Key>');
            });
        });
    });
});
