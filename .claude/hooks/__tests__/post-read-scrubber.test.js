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
    });
});
