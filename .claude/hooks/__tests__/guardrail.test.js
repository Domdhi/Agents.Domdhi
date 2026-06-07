// AC→source map (TDD-5.2 / guardrail):
//   - parseYaml: fixture YAML with block list, confirm list, nested keys, comments, quoted strings
//   - stripComment: inline comments, # inside quotes preserved, empty lines
//   - matchPatterns: exact match, prefix/substring match, regex match → correct block/confirm/pass
//   - checkRules: rm -rf / → block; git push --force → confirm; ls → allow
//   - processEvent: end-to-end with fixture rules file; rules missing → graceful default
//
// Note: AC named the function "matchesRule" and "checkRules(command, rules)".
//   matchesRule → source name preserved as matchPatterns (takes an array, not a rule).
//   checkRules is a NEW named function extracted from runClaudeHook during refactor.
//
// CJS cache-busting strategy:
//   guardrail.cjs loads rules via loadRules() which reads CLAUDE_PROJECT_DIR at call time.
//   The module exports are pure functions OR functions that read env at call time.
//   loadRules() reads CLAUDE_PROJECT_DIR every invocation — no cache-busting needed for
//   processEvent tests; we manipulate CLAUDE_PROJECT_DIR and use tmp dirs instead.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
    processEvent,
    parseYaml,
    stripComment,
    matchPatterns,
    stripCommitMessages,
    checkRules,
    loadRules,
} = require('../guardrail.cjs');

const { createTmpDir } = require('../../core/__tests__/_helpers/tmp-dir');

// ─── Fixture YAML ─────────────────────────────────────────────────────────────

const FIXTURE_YAML = `
# Test rules
block_patterns:
  - "rm -rf /"
  - "/dangerous.*/"

confirm_patterns:
  - "git push --force"

nested:
  sub_key: "value with # hash inside"
  another:
    - item1
    - item2

string_val: "quoted value"
unquoted: plain text
`;

// ─── parseYaml ────────────────────────────────────────────────────────────────

describe('guardrail', () => {
    describe('parseYaml', () => {
        it('parseYaml_blockPatterns_parsedAsArray', () => {
            // Arrange / Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert
            expect(Array.isArray(result.block_patterns)).toBe(true);
            expect(result.block_patterns).toContain('rm -rf /');
            expect(result.block_patterns).toContain('/dangerous.*/');
        });

        it('parseYaml_confirmPatterns_parsedAsArray', () => {
            // Arrange / Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert
            expect(Array.isArray(result.confirm_patterns)).toBe(true);
            expect(result.confirm_patterns).toContain('git push --force');
        });

        it('parseYaml_nestedKeys_parsedAsObject', () => {
            // Arrange / Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert
            expect(typeof result.nested).toBe('object');
            expect(result.nested).not.toBeNull();
            expect(result.nested.sub_key).toBe('value with # hash inside');
        });

        it('parseYaml_nestedList_parsedAsArray', () => {
            // Arrange / Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert
            expect(Array.isArray(result.nested.another)).toBe(true);
            expect(result.nested.another).toContain('item1');
            expect(result.nested.another).toContain('item2');
        });

        it('parseYaml_quotedStringValue_stripsQuotes', () => {
            // Arrange / Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert
            expect(result.string_val).toBe('quoted value');
        });

        it('parseYaml_unquotedValue_preservedAsIs', () => {
            // Arrange / Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert
            expect(result.unquoted).toBe('plain text');
        });

        it('parseYaml_topLevelComment_ignored', () => {
            // Arrange / Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert — "# Test rules" line should not appear as a key
            const keys = Object.keys(result);
            expect(keys.every(k => !k.startsWith('#'))).toBe(true);
        });

        it('parseYaml_hashInsideQuotedSubKey_preserved', () => {
            // Arrange — the fixture has: sub_key: "value with # hash inside"
            // Act
            const result = parseYaml(FIXTURE_YAML);

            // Assert — the # is inside quotes, so it must NOT be stripped
            expect(result.nested.sub_key).toContain('# hash inside');
        });

        it('parseYaml_emptyInput_returnsEmptyObject', () => {
            // Arrange / Act
            const result = parseYaml('');

            // Assert
            expect(result).toEqual({});
        });
    });

    // ─── stripComment ──────────────────────────────────────────────────────────

    describe('stripComment', () => {
        it('stripComment_noHash_returnsLineUnchanged', () => {
            // Arrange / Act / Assert
            expect(stripComment('plain text here')).toBe('plain text here');
        });

        it('stripComment_hashOutsideQuotes_stripsFromHash', () => {
            // stripComment returns line.slice(0, hashIdx) — preserves the space
            // before the #. Don't trim; downstream parsers do that.
            expect(stripComment('key: value # inline comment')).toBe('key: value ');
        });

        it('stripComment_hashInsideDoubleQuotes_preserved', () => {
            // Arrange / Act / Assert
            const line = 'sub_key: "value with # hash inside"';
            expect(stripComment(line)).toBe(line);
        });

        it('stripComment_hashInsideSingleQuotes_preserved', () => {
            // Arrange / Act / Assert
            const line = "sub_key: 'value with # hash inside'";
            expect(stripComment(line)).toBe(line);
        });

        it('stripComment_hashAtStart_returnsEmpty', () => {
            // Arrange / Act / Assert
            expect(stripComment('# full line comment').trim()).toBe('');
        });

        it('stripComment_emptyLine_returnsEmpty', () => {
            // Arrange / Act / Assert
            expect(stripComment('')).toBe('');
        });
    });

    // ─── matchPatterns ────────────────────────────────────────────────────────

    describe('matchPatterns', () => {
        it('matchPatterns_exactSubstringMatch_returnsMatchedPattern', () => {
            // Arrange
            const patterns = ['rm -rf /'];
            const command = 'rm -rf /tmp/foo';

            // Act
            const result = matchPatterns(command, patterns);

            // Assert
            expect(result).toBe('rm -rf /');
        });

        it('matchPatterns_caseInsensitiveMatch_returnsPattern', () => {
            // Arrange
            const patterns = ['GIT PUSH --FORCE'];
            const command = 'git push --force origin main';

            // Act
            const result = matchPatterns(command, patterns);

            // Assert
            expect(result).toBe('GIT PUSH --FORCE');
        });

        it('matchPatterns_prefixSubstringMatch_returnsPattern', () => {
            // Arrange
            const patterns = ['git push'];
            const command = 'git push --force main';

            // Act
            const result = matchPatterns(command, patterns);

            // Assert
            expect(result).toBe('git push');
        });

        it('matchPatterns_regexPattern_matchesWhenRegexMatches', () => {
            // Arrange
            const patterns = ['/dangerous.*/'];
            const command = 'dangerous command here';

            // Act
            const result = matchPatterns(command, patterns);

            // Assert
            expect(result).toBe('/dangerous.*/');
        });

        it('matchPatterns_regexPattern_noMatchWhenRegexDoesNotMatch', () => {
            // Arrange
            const patterns = ['/dangerous.*/'];
            const command = 'safe command here';

            // Act
            const result = matchPatterns(command, patterns);

            // Assert
            expect(result).toBeNull();
        });

        it('matchPatterns_noMatchingPattern_returnsNull', () => {
            // Arrange
            const patterns = ['rm -rf /', 'git push --force'];
            const command = 'ls -la';

            // Act
            const result = matchPatterns(command, patterns);

            // Assert
            expect(result).toBeNull();
        });

        it('matchPatterns_emptyPatternArray_returnsNull', () => {
            // Arrange / Act / Assert
            expect(matchPatterns('rm -rf /', [])).toBeNull();
        });

        it('matchPatterns_nonArrayPatterns_returnsNull', () => {
            // Arrange / Act / Assert
            expect(matchPatterns('rm -rf /', null)).toBeNull();
            expect(matchPatterns('rm -rf /', undefined)).toBeNull();
        });

        it('matchPatterns_invalidRegex_skipsAndContinues', () => {
            // Arrange — invalid regex followed by a valid plain pattern
            const patterns = ['/[invalid/', 'rm -rf /'];
            const command = 'rm -rf /tmp';

            // Act
            const result = matchPatterns(command, patterns);

            // Assert — skips the bad regex, matches the plain pattern
            expect(result).toBe('rm -rf /');
        });
    });

    // ─── checkRules ───────────────────────────────────────────────────────────

    describe('checkRules', () => {
        const rules = {
            block_patterns: ['rm -rf /'],
            confirm_patterns: ['git push --force'],
        };

        it('checkRules_commandMatchesBlockPattern_returnsBlock', () => {
            // Arrange / Act
            const result = checkRules('rm -rf /tmp/foo', rules);

            // Assert
            expect(result.action).toBe('block');
            expect(result.pattern).toBe('rm -rf /');
        });

        it('checkRules_commandMatchesConfirmPattern_returnsConfirm', () => {
            // Arrange / Act
            const result = checkRules('git push --force main', rules);

            // Assert
            expect(result.action).toBe('confirm');
            expect(result.pattern).toBe('git push --force');
        });

        it('checkRules_commandMatchesNeither_returnsAllow', () => {
            // Arrange / Act
            const result = checkRules('ls -la', rules);

            // Assert
            expect(result.action).toBe('allow');
            expect(result.pattern).toBeUndefined();
        });

        it('checkRules_blockPatternTakesPrecedenceOverConfirm', () => {
            // Arrange — command that could match both if both lists had it
            const overlappingRules = {
                block_patterns: ['git push'],
                confirm_patterns: ['git push --force'],
            };

            // Act
            const result = checkRules('git push --force main', overlappingRules);

            // Assert — block wins because it is checked first
            expect(result.action).toBe('block');
        });

        it('checkRules_emptyRules_returnsAllow', () => {
            // Arrange / Act
            const result = checkRules('rm -rf /', { block_patterns: [], confirm_patterns: [] });

            // Assert
            expect(result.action).toBe('allow');
        });

        it('checkRules_missingPatternKeys_returnsAllow', () => {
            // Arrange — rules object without block_patterns or confirm_patterns
            const result = checkRules('rm -rf /', {});

            // Assert
            expect(result.action).toBe('allow');
        });
    });

    // ─── processEvent ─────────────────────────────────────────────────────────

    describe('processEvent', () => {
        let tmp;
        let originalDir;

        beforeEach(() => {
            tmp = createTmpDir();
            originalDir = process.env.CLAUDE_PROJECT_DIR;
        });

        afterEach(() => {
            if (originalDir === undefined) {
                delete process.env.CLAUDE_PROJECT_DIR;
            } else {
                process.env.CLAUDE_PROJECT_DIR = originalDir;
            }
            tmp.cleanup();
        });

        function writeRules(content) {
            tmp.write('.claude/guardrail-rules.yaml', content);
            process.env.CLAUDE_PROJECT_DIR = tmp.root;
        }

        const STANDARD_RULES = `
block_patterns:
  - "rm -rf /"
confirm_patterns:
  - "git push --force"
`;

        it('processEvent_rmRfSlash_returnsBlock', () => {
            // Arrange
            writeRules(STANDARD_RULES);

            // Act
            const result = processEvent({ tool_input: { command: 'rm -rf /tmp/foo' } });

            // Assert
            expect(result).not.toBeNull();
            expect(result.block).toBe(true);
            expect(result.feedback).toEqual(expect.stringContaining('BLOCKED'));
        });

        it('processEvent_gitPushForce_returnsConfirm', () => {
            // Arrange
            writeRules(STANDARD_RULES);

            // Act
            const result = processEvent({ tool_input: { command: 'git push --force main' } });

            // Assert
            expect(result).not.toBeNull();
            expect(result.confirm).toBe(true);
            expect(typeof result.reason).toBe('string');
            expect(result.reason).toContain('git push --force');
        });

        it('processEvent_safeCommand_returnsNull', () => {
            // Arrange
            writeRules(STANDARD_RULES);

            // Act
            const result = processEvent({ tool_input: { command: 'ls -la' } });

            // Assert
            expect(result).toBeNull();
        });

        const NUDGE_RULES = `
block_patterns:
  - "rm -rf /"
nudge_patterns:
  - "rm -rf"
confirm_patterns:
  - "git push --force"
`;

        it('processEvent_nudgeMatch_returnsSoftDenyWithAlternativeMessage', () => {
            // Arrange
            writeRules(NUDGE_RULES);

            // Act — plain destructive command, no escalation marker
            const result = processEvent({ tool_input: { command: 'rm -rf build' } });

            // Assert — delivered on the block channel (exit 2) but with the nudge message
            expect(result).not.toBeNull();
            expect(result.block).toBe(true);
            expect(result.feedback).toEqual(expect.stringContaining('SAFER ALTERNATIVE'));
            expect(result.feedback).toEqual(expect.stringContaining('# guardrail:confirm'));
        });

        it('processEvent_nudgeWithEscalationMarker_returnsConfirm', () => {
            // Arrange
            writeRules(NUDGE_RULES);

            // Act — same command, re-run with the escalation marker
            const result = processEvent({ tool_input: { command: 'rm -rf build  # guardrail:confirm' } });

            // Assert — now the user is prompted
            expect(result).not.toBeNull();
            expect(result.confirm).toBe(true);
            expect(result.reason).toContain('rm -rf build');
        });

        it('processEvent_rulesMissing_returnsNullAndWarnsStderr', () => {
            // Arrange — point to an empty tmp dir with no rules file
            process.env.CLAUDE_PROJECT_DIR = tmp.root;
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            try {
                // Act
                const result = processEvent({ tool_input: { command: 'rm -rf /tmp/foo' } });

                // Assert
                expect(result).toBeNull();
                expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[guardrail]'));
            } finally {
                stderrSpy.mockRestore();
            }
        });

        it('processEvent_emptyCommand_returnsNull', () => {
            // Arrange
            writeRules(STANDARD_RULES);

            // Act
            const result = processEvent({ tool_input: { command: '' } });

            // Assert
            expect(result).toBeNull();
        });

        it('processEvent_missingToolInput_returnsNull', () => {
            // Arrange
            writeRules(STANDARD_RULES);

            // Act
            const result = processEvent({});

            // Assert
            expect(result).toBeNull();
        });

        it('processEvent_commitMessageContainingBlockedPhrase_notBlocked', () => {
            // Arrange — commit message mentions "rm -rf /" but the actual command is just git commit
            writeRules(STANDARD_RULES);
            const command = `git commit -m "fix: prevent rm -rf / accidents"`;

            // Act
            const result = processEvent({ tool_input: { command } });

            // Assert — stripCommitMessages removes the -m content so no false positive
            expect(result).toBeNull();
        });

        // ─── hit-counter telemetry metadata (emitted by runClaudeHook, carried on
        //     the processEvent result so it can be asserted without side effects) ──

        it('processEvent_block_carriesTelemetryMetadata', () => {
            writeRules(STANDARD_RULES);
            const result = processEvent({ tool_input: { command: 'rm -rf /tmp/foo' } });
            expect(result.telemetry).toEqual({ decision: 'block', rule: 'rm -rf /', tier: null });
        });

        it('processEvent_confirm_carriesTelemetryMetadata', () => {
            writeRules(STANDARD_RULES);
            const result = processEvent({ tool_input: { command: 'git push --force main' } });
            expect(result.telemetry).toEqual({ decision: 'confirm', rule: 'git push --force', tier: null });
        });

        it('processEvent_nudge_carriesTelemetryMetadata', () => {
            writeRules(`
nudge_patterns:
  - "rm -rf build"
`);
            const result = processEvent({ tool_input: { command: 'rm -rf build' } });
            expect(result.telemetry.decision).toBe('nudge');
            expect(result.telemetry.rule).toBe('rm -rf build');
        });

        it('processEvent_allow_hasNoTelemetry', () => {
            writeRules(STANDARD_RULES);
            const result = processEvent({ tool_input: { command: 'ls -la' } });
            expect(result).toBeNull();   // allows are never counted
        });
    });

    // ─── loadRules (missing file) ─────────────────────────────────────────────

    describe('loadRules', () => {
        let tmp;
        let originalDir;

        beforeEach(() => {
            tmp = createTmpDir();
            originalDir = process.env.CLAUDE_PROJECT_DIR;
        });

        afterEach(() => {
            if (originalDir === undefined) {
                delete process.env.CLAUDE_PROJECT_DIR;
            } else {
                process.env.CLAUDE_PROJECT_DIR = originalDir;
            }
            tmp.cleanup();
        });

        it('loadRules_missingFile_returnsNull', () => {
            // Arrange — empty tmp dir, no guardrail-rules.yaml
            process.env.CLAUDE_PROJECT_DIR = tmp.root;
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            try {
                // Act
                const result = loadRules();

                // Assert
                expect(result).toBeNull();
            } finally {
                stderrSpy.mockRestore();
            }
        });

        it('loadRules_missingFile_writesWarningToStderr', () => {
            // Arrange
            process.env.CLAUDE_PROJECT_DIR = tmp.root;
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            try {
                // Act
                loadRules();

                // Assert
                expect(stderrSpy).toHaveBeenCalledWith(
                    expect.stringContaining('guardrail-rules.yaml not found')
                );
            } finally {
                stderrSpy.mockRestore();
            }
        });

        it('loadRules_validFile_returnsRulesObject', () => {
            // Arrange
            tmp.write('.claude/guardrail-rules.yaml', `
block_patterns:
  - "rm -rf /"
confirm_patterns:
  - "git push --force"
`);
            process.env.CLAUDE_PROJECT_DIR = tmp.root;

            // Act
            const result = loadRules();

            // Assert
            expect(result).not.toBeNull();
            expect(Array.isArray(result.block_patterns)).toBe(true);
            expect(Array.isArray(result.confirm_patterns)).toBe(true);
        });
    });
});

// ─── Live guardrail-rules.yaml (the REAL repo file, not a fixture) ─────────────
// These lock in the narrowed rm -rf / find -exec confirm patterns against the
// actual shipped rule file — fixtures wouldn't catch a regression in the real
// YAML. (fixture-test-checker-not-live-tree lesson.)

const path = require('path');
const REPO_ROOT = path.resolve(path.dirname(require.resolve('../guardrail.cjs')), '..', '..');

describe('guardrail — live rules (tmp-exempt rm -rf + destructive find -exec)', () => {
    let originalDir;

    beforeEach(() => {
        originalDir = process.env.CLAUDE_PROJECT_DIR;
        process.env.CLAUDE_PROJECT_DIR = REPO_ROOT;
    });

    afterEach(() => {
        if (originalDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
        else process.env.CLAUDE_PROJECT_DIR = originalDir;
    });

    const decision = (command) => {
        const r = processEvent({ tool_input: { command } });
        if (r === null) return 'pass';
        if (r.confirm) return 'confirm';
        // A nudge is delivered via the block channel (exit 2) but with the
        // "try a safer alternative first" message — distinguish by feedback.
        if (r.block) return r.feedback && r.feedback.includes('SAFER ALTERNATIVE') ? 'nudge' : 'block';
        return '?';
    };

    it('rmRf_tmpVar_passesWithoutConfirm', () => {
        // sub-agent tmp cleanup — the exact shape that used to prompt every run
        expect(decision('rm -rf "$T"')).toBe('pass');
        expect(decision('rm -rf "$TMPDIR/scratch"')).toBe('pass');
    });

    it('rmRf_tmpPath_passesWithoutConfirm', () => {
        expect(decision('rm -rf /tmp/tmp.abc123')).toBe('pass');
    });

    it('rmRf_realProjectPath_nudges', () => {
        // Real project-path deletes now NUDGE first (try a safer alternative)
        // rather than going straight to a confirm prompt.
        expect(decision('rm -rf dist')).toBe('nudge');
        expect(decision('rm -fr build')).toBe('nudge');
    });

    it('rmRf_realProjectPath_withEscalationMarker_confirms', () => {
        // Re-running with the escalation marker flips the nudge to a user confirm.
        expect(decision('rm -rf dist  # guardrail:confirm')).toBe('confirm');
        expect(decision('rm -fr build # guardrail:confirm')).toBe('confirm');
    });

    it('findExec_readOnlyCommand_passes', () => {
        expect(decision('find . -name "*.js" -exec grep foo {} ;')).toBe('pass');
        expect(decision('find . -type f -exec cat {} ;')).toBe('pass');
    });

    it('findExec_destructiveCommand_nudges', () => {
        // Destructive find -exec moved confirm→nudge (2026-06-06): try a tighter
        // scope or dry -print first, escalate with the marker when intended.
        expect(decision('find . -exec rm {} ;')).toBe('nudge');
        expect(decision('find /var -name x -exec mv {} /dest ;')).toBe('nudge');
        expect(decision('find . -exec rm {} ;  # guardrail:confirm')).toBe('confirm');
    });

    it('localDestructiveGit_nudges_remoteAndPublish_confirm', () => {
        // Local, reversible destructive git → nudge (stash/backup/dry-run first).
        expect(decision('git reset --hard HEAD~1')).toBe('nudge');
        expect(decision('git clean -fd')).toBe('nudge');
        expect(decision('git rebase main')).toBe('nudge');
        expect(decision('git stash clear')).toBe('nudge');
        expect(decision('npm uninstall -g typescript')).toBe('nudge');
        // Escalation marker flips the nudge to a user confirm.
        expect(decision('git reset --hard HEAD~1  # guardrail:confirm')).toBe('confirm');
        // Outward-facing / irreversible-external → still an immediate confirm.
        expect(decision('git push origin --delete feature')).toBe('confirm');
        expect(decision('npm publish')).toBe('confirm');
    });

    it('gitPushForce_stillBlocked', () => {
        expect(decision('git push --force')).toBe('block');
    });

    it('zeroAccessPath_delete_isHardBlock_notEscalatableViaNudge', () => {
        // sweep A1: `rm -rf .env` matches the nudge rm pattern, but .env is a
        // zeroAccessPath. The path-tier hard block runs BEFORE the nudge/confirm
        // decision, so it wins and IGNORES the escalation marker — a protected
        // secret file can never be escalated to a user-approvable confirm.
        expect(decision('rm -rf .env')).toBe('block');
        expect(decision('rm -rf .env  # guardrail:confirm')).toBe('block');
        expect(decision('rm -rf .env.production')).toBe('block');
    });
});

// ─── Real rules file: rm autonomy exemptions (regression for 2026-06-05 widen) ──
//
// Guards the actual shipped .claude/guardrail-rules.yaml so the temp-path
// exemption that keeps autonomous sub-agents from stalling on `rm -rf` cleanups
// can't silently regress, while real project-path deletes still confirm.
describe('real guardrail-rules.yaml — rm -rf autonomy exemptions', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const here = path.dirname(new URL(import.meta.url).pathname);
    const realRules = parseYaml(
        fs.readFileSync(path.resolve(here, '..', '..', 'guardrail-rules.yaml'), 'utf8')
    );
    const act = (cmd) => checkRules(cmd, realRules).action;

    it('allows recursive deletes of clearly-disposable paths (no confirm)', () => {
        for (const cmd of [
            'rm -rf /tmp/install-test-xY',
            'rm -rf /tmp',
            'rm -rf "$TMPDIR/foo"',
            'rm -rf ./tmp/scratch',
            'rm -rf node_modules',
            'rm -rf .sandbox/mfahub',
            'rm -rf /var/folders/ab/cd/T/scratch',
        ]) {
            expect(act(cmd)).toBe('allow');
        }
    });

    it('nudges recursive deletes of real project paths (then confirm on escalation)', () => {
        for (const cmd of [
            'rm -rf ./src',
            'rm -rf /home/user/code/my-project',
            'rm -rf ~/Documents',
            'sudo rm -fr /etc',
        ]) {
            expect(act(cmd)).toBe('nudge');
            // Same command, escalation marker appended → user confirm.
            expect(act(cmd + '  # guardrail:confirm')).toBe('confirm');
        }
    });

    it('nudges dangerous deletes even when an exempt token appears LATER on the line (no whole-line bypass)', () => {
        // Regression for the whole-line-lookahead bypass: a trailing /tmp, a
        // chained safe rm, a node_modules comment, etc. must NOT disarm the guard
        // for a dangerous first target. The exemption binds to the FIRST arg.
        for (const cmd of [
            'rm -rf ~/important && echo /tmp',
            'rm -rf ~/important && echo done; ls /tmp',
            'rm -rf "$HOME" --no-preserve-root; mktemp -d',
            'rm -rf ~/data && npm run build  # node_modules',
            'rm -rf /tmp/a && rm -rf ~/b',          // chained: dangerous 2nd rm
            'rm -rf ~/node_modules_backup_critical', // substring look-alike
            'rm -rf ~/my-tmp/photos',
        ]) {
            expect(act(cmd)).toBe('nudge');
        }
    });

    it('exempts git rm (the history-preserving reversible alternative the nudge recommends)', () => {
        // `git rm` stages a removal that git checkout/restore fully reverses, so
        // it must NOT trip the rm -rf nudge — nudging it would loop the agent
        // against its own advice. (2026-06-06)
        expect(act('git rm -r .claude/skills/orphan')).toBe('allow');
        expect(act('git rm -rf src/legacy')).toBe('allow');
        expect(act('git rm --cached -r build')).toBe('allow');
        // A bare `rm -rf` of the same real path still nudges.
        expect(act('rm -rf .claude/skills/orphan')).toBe('nudge');
    });

    it('nudges PowerShell recursive force-remove in either flag order (sweep A2)', () => {
        // The old `/Remove-Item .+-Recurse .+-Force/` needed ≥1 char BETWEEN the
        // flags, so the canonical single-space form silently PASSed. The fixed
        // pattern matches single-space and reverse flag order.
        expect(act('Remove-Item foo -Recurse -Force')).toBe('nudge');
        expect(act('Remove-Item foo -Force -Recurse')).toBe('nudge');
        expect(act('Remove-Item -Recurse -Force ./build')).toBe('nudge');
        expect(act('Remove-Item foo')).toBe('allow');          // no recurse/force
        expect(act('Remove-Item foo -Recurse')).toBe('allow');  // recurse only
    });

    it('anchors the git rm exemption to a real git invocation (sweep A3)', () => {
        // A standalone `git rm` is exempt; a word ending in "git" (`legit`) or a
        // var-assignment prefix (`X=git`, where git is the value and rm is a real
        // command) is NOT a git invocation, so a real rm still nudges.
        expect(act('git rm -rf src/legacy')).toBe('allow');
        expect(act('cd x && git rm -rf src')).toBe('allow');
        expect(act('legit rm -rf ~/x')).toBe('nudge');
        expect(act('X=git rm -rf ~/x')).toBe('nudge');
    });

    it('still blocks catastrophic commands', () => {
        expect(act('git push --force')).toBe('block');
        expect(act('mkfs.ext4 /dev/sda')).toBe('block');
    });
});
