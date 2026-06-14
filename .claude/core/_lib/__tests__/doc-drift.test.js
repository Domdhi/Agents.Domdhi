// Tests for doc-drift.js — detection of legacy/duplicate planning docs (F2).
//
// Coverage targets:
//   line 97  — catch { return; } inside findMisplacedTodos walk when readdirSync fails
//   lines 154-183 — main() CLI output paths (no-drift, legacy, duplicates, misplacedTodos)
//   line 188 — require.main guard (NOT COVERED: evaluates true only when node is entry)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const DOC_DRIFT_PATH = require.resolve('../doc-drift');
const { detectDocDrift, stripTemplateMarker, isRealDoc, findMisplacedTodos } = require('../doc-drift');

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-drift-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function write(rel, content = '# real doc\n') {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
}

describe('detectDocDrift', () => {
    it('cleanRepo_noDrift', () => {
        write('docs/_project-architecture.md');
        write('docs/todo/_backlog.md');
        const r = detectDocDrift(root);
        expect(r.hasDrift).toBe(false);
        expect(r.legacy).toEqual([]);
        expect(r.duplicates).toEqual([]);
    });

    it('flagsLegacyDoc_andWhetherCanonicalAlsoExists', () => {
        write('docs/_architecture.md');            // legacy
        write('docs/_project-architecture.md');    // canonical also present → BOTH
        write('docs/_prd.md');                     // legacy, no canonical
        const r = detectDocDrift(root);
        expect(r.hasDrift).toBe(true);
        const arch = r.legacy.find(l => l.file === 'docs/_architecture.md');
        expect(arch.canonical).toBe('docs/_project-architecture.md');
        expect(arch.canonicalExists).toBe(true);
        const prd = r.legacy.find(l => l.file === 'docs/_prd.md');
        expect(prd.canonicalExists).toBe(false);
    });

    it('flagsDuplicateBasenameAcrossRootAndCanonical', () => {
        write('docs/_backlog.md');         // root (non-canonical)
        write('docs/todo/_backlog.md');    // canonical
        const r = detectDocDrift(root);
        expect(r.duplicates).toHaveLength(1);
        expect(r.duplicates[0].name).toBe('_backlog.md');
    });

    it('ignoresTemplateStubs', () => {
        // An unfilled scaffold stub is not real drift.
        write('docs/_architecture.md', '<!-- @@template -->\n# stub\n');
        const r = detectDocDrift(root);
        expect(r.hasDrift).toBe(false);
    });

    // ── F17: misplaced TODO files outside docs/ root and docs/todo/ ──
    it('flagsMisplacedTodoOutsideCanonicalDirs', () => {
        write('docs/TODO_Project.md');                       // canonical master (docs/ root)
        write('docs/todo/TODO_epic01_foo.md');               // canonical per-epic
        write('docs/work/TODO_epic00_doc-review.md');        // MISPLACED (stale plan)
        const r = detectDocDrift(root);
        expect(r.hasDrift).toBe(true);
        expect(r.misplacedTodos).toHaveLength(1);
        expect(r.misplacedTodos[0].file).toBe('docs/work/TODO_epic00_doc-review.md');
    });

    it('doesNotFlagCanonicalTodos', () => {
        write('docs/TODO_Project.md');
        write('docs/todo/TODO_epic01_foo.md');
        write('docs/todo/TODO_epic02_bar.md');
        const r = detectDocDrift(root);
        expect(r.misplacedTodos).toEqual([]);
        expect(r.hasDrift).toBe(false);
    });

    it('ignoresTodosUnderOutputAndArchive', () => {
        write('docs/.output/work/2026-01-01/task/TODO_scratch.md');  // ephemeral, skipped
        write('docs/.archive/TODO_old.md');                           // archive, skipped
        const r = detectDocDrift(root);
        expect(r.misplacedTodos).toEqual([]);
        expect(r.hasDrift).toBe(false);
    });

    // ── EV7: /evolve parks closed cycles under docs/todo/_archive/ (underscore) ──
    it('ignoresTodosUnder_evolveCycleArchive', () => {
        write('docs/TODO_Project.md');                                       // live master
        write('docs/todo/TODO_epic01_foo.md');                              // live per-epic
        write('docs/todo/_archive/cycle-1-260606-1214/_backlog.md');        // archived backlog
        write('docs/todo/_archive/cycle-1-260606-1214/TODO_DomdhiCrypto.md'); // archived master
        write('docs/todo/_archive/cycle-1-260606-1214/TODO_epic01_foo.md');  // archived per-epic
        const r = detectDocDrift(root);
        expect(r.misplacedTodos).toEqual([]);   // _archive (underscore) is skipped, not flagged
        expect(r.hasDrift).toBe(false);
    });

    it('flagsAllLegacyNames', () => {
        // Covers all entries in LEGACY_TO_CANONICAL
        write('docs/_requirements.md');
        write('docs/_brief.md');
        write('docs/_design.md');
        write('docs/_context.md');
        const r = detectDocDrift(root);
        expect(r.legacy.map(l => l.file)).toEqual(
            expect.arrayContaining([
                'docs/_requirements.md',
                'docs/_brief.md',
                'docs/_design.md',
                'docs/_context.md',
            ])
        );
    });

    it('flagsDuplicateFeatureIdeas', () => {
        // _feature-ideas.md also has a canonical location in todo/
        write('docs/_feature-ideas.md');
        write('docs/todo/_feature-ideas.md');
        const r = detectDocDrift(root);
        expect(r.duplicates.find(d => d.name === '_feature-ideas.md')).toBeTruthy();
    });
});

// ── isRealDoc ────────────────────────────────────────────────────────────────

describe('isRealDoc', () => {
    it('returns true for a file with real content', () => {
        write('docs/real.md', '# Real content\n');
        expect(isRealDoc(path.join(root, 'docs', 'real.md'))).toBe(true);
    });

    it('returns false for a non-existent file (catch branch, line 64)', () => {
        // Covers the catch branch in isRealDoc at line 64: file not readable → returns false
        expect(isRealDoc(path.join(root, 'docs', 'no-such-file.md'))).toBe(false);
    });

    it('returns false for a template stub (starts with marker)', () => {
        write('docs/stub.md', '<!-- @@template -->\n# stub\n');
        expect(isRealDoc(path.join(root, 'docs', 'stub.md'))).toBe(false);
    });
});

// ── findMisplacedTodos — line 97: readdirSync failure branch ─────────────────

describe('findMisplacedTodos', () => {
    it('returns empty array when docs dir does not exist — covers line 97 catch branch', () => {
        // docsDir does not exist → readdirSync throws → catch { return; } → misplaced stays []
        const nonExistentDocs = path.join(root, 'docs-nonexistent');
        const result = findMisplacedTodos(nonExistentDocs);
        expect(result).toEqual([]);
    });

    it('finds TODO files nested in non-canonical dirs', () => {
        write('docs/subdir/nested/TODO_stale.md');
        const result = findMisplacedTodos(path.join(root, 'docs'));
        expect(result.some(m => m.file.includes('TODO_stale.md'))).toBe(true);
    });

    it('skips design dir (in TODO_SKIP_DIRS)', () => {
        write('docs/design/TODO_design-notes.md');
        const result = findMisplacedTodos(path.join(root, 'docs'));
        expect(result).toHaveLength(0);
    });

    it('skips node_modules dir (in TODO_SKIP_DIRS)', () => {
        write('docs/node_modules/TODO_internal.md');
        const result = findMisplacedTodos(path.join(root, 'docs'));
        expect(result).toHaveLength(0);
    });
});

// ── stripTemplateMarker ──────────────────────────────────────────────────────

describe('stripTemplateMarker', () => {
    let tmpRoot;
    beforeEach(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-marker-')); });
    afterEach(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

    function writeTmp(name, content) {
        const p = path.join(tmpRoot, name);
        fs.writeFileSync(p, content);
        return p;
    }

    it('stripTemplateMarker_markerPresent_stripsMarkerAndReturnsTrue', () => {
        const p = writeTmp('doc.md', '<!-- @@template -->\n# Real content\n');
        const result = stripTemplateMarker(p);
        expect(result).toBe(true);
        const after = fs.readFileSync(p, 'utf8');
        expect(after.startsWith('<!-- @@template -->')).toBe(false);
        expect(after).toContain('# Real content');
    });

    it('stripTemplateMarker_markerAbsent_noopReturnsFalse', () => {
        const original = '# Already real content\n';
        const p = writeTmp('doc.md', original);
        const result = stripTemplateMarker(p);
        expect(result).toBe(false);
        const after = fs.readFileSync(p, 'utf8');
        expect(after).toBe(original);
    });

    it('stripTemplateMarker_idempotent_stripTwiceNoChange', () => {
        const p = writeTmp('doc.md', '<!-- @@template -->\n# Content\n');
        stripTemplateMarker(p);
        const afterFirst = fs.readFileSync(p, 'utf8');
        const result = stripTemplateMarker(p);
        expect(result).toBe(false);
        const afterSecond = fs.readFileSync(p, 'utf8');
        expect(afterSecond).toBe(afterFirst);
    });

    it('stripTemplateMarker_afterStrip_isRealDocReturnsTrue', () => {
        const p = writeTmp('doc.md', '<!-- @@template -->\n# Filled backlog\n');
        expect(isRealDoc(p)).toBe(false);  // before strip: it's a stub
        stripTemplateMarker(p);
        expect(isRealDoc(p)).toBe(true);   // after strip: now a real doc
    });

    it('stripTemplateMarker_nonexistentFile_returnsFalse', () => {
        const result = stripTemplateMarker(path.join(tmpRoot, 'no-such-file.md'));
        expect(result).toBe(false);
    });
});

// ── main() — in-process coverage of lines 154-183 ────────────────────────────
// main() is exported from doc-drift.js (behavior-preserving addition).
// Mock process.exit to throw, capture stdout/stderr output, set process.argv.

describe('main() — lines 154-183', () => {
    let originalArgv;
    let stdoutCapture;
    let stderrCapture;

    beforeEach(() => {
        originalArgv = process.argv.slice();
        stdoutCapture = [];
        stderrCapture = [];
        vi.spyOn(process, 'exit').mockImplementation((code) => {
            throw new Error(`process.exit(${code ?? 'undefined'})`);
        });
        vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
            stdoutCapture.push(String(s));
            return true;
        });
        vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
            stderrCapture.push(String(s));
            return true;
        });
    });

    afterEach(() => {
        process.argv = originalArgv;
        vi.restoreAllMocks();
        delete require.cache[DOC_DRIFT_PATH];
    });

    function freshMain() {
        delete require.cache[DOC_DRIFT_PATH];
        return require('../doc-drift').main;
    }

    function stdout() { return stdoutCapture.join(''); }

    it('exits 0 when no drift detected — covers lines 157-159', () => {
        // Empty project root → docs dir does not exist → no drift
        process.argv = ['node', 'doc-drift.js', root];
        expect(() => freshMain()()).toThrow('process.exit(0)');
        expect(stdout()).toMatch(/No legacy\/duplicate planning docs detected/);
    });

    it('exits 1 and reports legacy docs without canonical counterpart — covers lines 162-169', () => {
        write('docs/_prd.md');
        process.argv = ['node', 'doc-drift.js', root];
        expect(() => freshMain()()).toThrow('process.exit(1)');
        const out = stdout();
        expect(out).toMatch(/Legacy-named docs/);
        expect(out).toMatch(/_prd\.md/);
        expect(out).toMatch(/rename\/migrate to canonical/);
    });

    it('exits 1 and prints BOTH-exist message when legacy and canonical coexist — covers line 167', () => {
        write('docs/_architecture.md');
        write('docs/_project-architecture.md');
        process.argv = ['node', 'doc-drift.js', root];
        expect(() => freshMain()()).toThrow('process.exit(1)');
        expect(stdout()).toMatch(/BOTH exist/);
    });

    it('exits 1 and reports duplicate docs — covers lines 171-174', () => {
        write('docs/_backlog.md');
        write('docs/todo/_backlog.md');
        process.argv = ['node', 'doc-drift.js', root];
        expect(() => freshMain()()).toThrow('process.exit(1)');
        const out = stdout();
        expect(out).toMatch(/Duplicate docs/);
        expect(out).toMatch(/keep canonical, remove the root copy/);
    });

    it('exits 1 and reports misplaced TODO files — covers lines 176-179', () => {
        write('docs/work/TODO_stale.md');
        process.argv = ['node', 'doc-drift.js', root];
        expect(() => freshMain()()).toThrow('process.exit(1)');
        const out = stdout();
        expect(out).toMatch(/Misplaced TODO files/);
        expect(out).toMatch(/TODO_stale\.md/);
        expect(out).toMatch(/move to docs\/todo\//);
    });

    it('exits 1 and prints reconcile guidance — covers line 181', () => {
        write('docs/_brief.md');
        process.argv = ['node', 'doc-drift.js', root];
        expect(() => freshMain()()).toThrow('process.exit(1)');
        expect(stdout()).toMatch(/Reconcile via \/onboard/);
    });

    it('uses CLAUDE_PROJECT_DIR env var when no argv[2] — covers line 154', () => {
        write('docs/_brief.md');
        process.argv = ['node', 'doc-drift.js'];
        const originalEnv = process.env.CLAUDE_PROJECT_DIR;
        process.env.CLAUDE_PROJECT_DIR = root;
        try {
            expect(() => freshMain()()).toThrow('process.exit(1)');
            expect(stdout()).toMatch(/_brief\.md/);
        } finally {
            if (originalEnv === undefined) delete process.env.CLAUDE_PROJECT_DIR;
            else process.env.CLAUDE_PROJECT_DIR = originalEnv;
        }
    });
});
