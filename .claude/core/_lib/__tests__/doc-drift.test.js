// Tests for doc-drift.js — detection of legacy/duplicate planning docs (F2).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { detectDocDrift, stripTemplateMarker, isRealDoc } = require('../doc-drift');

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
