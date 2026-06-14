// AC→source map (skill-merger):
//   Exports: PROJECT_ADDITIONS_MARKER, hasProjectAdditions(text), splitAtMarker(text),
//            mergeSkillContent(src, dst), mergeSkillFile(srcPath, dstPath)
//   mergeSkillContent — dest has no marker → source verbatim (overwrite, preserved:false);
//                       dest has marker → source head + dest tail (preserved:true)
//   mergeSkillFile — dst missing: copy; dst present: refresh head, preserve tail
//                    returns { changed, preserved, detail }

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const { createTmpDir } = require('../../__tests__/_helpers/tmp-dir');
const {
    PROJECT_ADDITIONS_MARKER,
    hasProjectAdditions,
    splitAtMarker,
    mergeSkillContent,
    mergeSkillFile,
} = require('../skill-merger');

let tmp;
beforeEach(() => { tmp = createTmpDir({ prefix: 'skill-merger-test-' }); });
afterEach(() => { tmp.cleanup(); });

const MARKER = PROJECT_ADDITIONS_MARKER;

const SRC_V2 = `---
name: tailwind-css-patterns
description: Tailwind patterns
---

# Tailwind Patterns

Template body v2 — improved.
`;

const SRC_V1 = `---
name: tailwind-css-patterns
description: Tailwind patterns
---

# Tailwind Patterns

Template body v1.
`;

const DST_WITH_TAIL = `---
name: tailwind-css-patterns
description: Tailwind patterns
---

# Tailwind Patterns

Template body v1.

${MARKER}

## Project Additions

This project uses a custom \`brand-\` prefix and the \`obsidian-void\` palette.
`;

// ─────────────────────────────────────────────────────────────────────────────
// hasProjectAdditions / splitAtMarker
// ─────────────────────────────────────────────────────────────────────────────

describe('hasProjectAdditions', () => {
    it('detects the marker', () => {
        expect(hasProjectAdditions(DST_WITH_TAIL)).toBe(true);
    });
    it('is false when absent', () => {
        expect(hasProjectAdditions(SRC_V2)).toBe(false);
    });
});

describe('splitAtMarker', () => {
    it('returns null tail when no marker', () => {
        const { head, tail } = splitAtMarker(SRC_V2);
        expect(tail).toBeNull();
        expect(head).toBe(SRC_V2);
    });
    it('keeps the marker line intact in the tail', () => {
        const { head, tail } = splitAtMarker(DST_WITH_TAIL);
        expect(tail.startsWith(MARKER)).toBe(true);
        expect(head.includes(MARKER)).toBe(false);
        expect(head).toContain('Template body v1.');
    });
    it('handles a marker on the first line', () => {
        const text = `${MARKER}\nproject only\n`;
        const { head, tail } = splitAtMarker(text);
        expect(head).toBe('');
        expect(tail).toBe(text);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeSkillContent
// ─────────────────────────────────────────────────────────────────────────────

describe('mergeSkillContent', () => {
    it('overwrites when dest has no marker (preserved:false)', () => {
        const r = mergeSkillContent(SRC_V2, SRC_V1);
        expect(r.preserved).toBe(false);
        expect(r.content).toBe(SRC_V2);
    });

    it('refreshes head and preserves tail when dest has marker', () => {
        const r = mergeSkillContent(SRC_V2, DST_WITH_TAIL);
        expect(r.preserved).toBe(true);
        // head refreshed to v2
        expect(r.content).toContain('Template body v2 — improved.');
        expect(r.content).not.toContain('Template body v1.');
        // tail preserved
        expect(r.content).toContain('obsidian-void');
        expect(r.content).toContain(MARKER);
        // exactly one marker
        expect(r.content.split(MARKER).length - 1).toBe(1);
    });

    it('does not duplicate the marker when source also ships a stub', () => {
        const srcWithStub = `${SRC_V2}\n${MARKER}\n`;
        const r = mergeSkillContent(srcWithStub, DST_WITH_TAIL);
        expect(r.content.split(MARKER).length - 1).toBe(1);
        // the dest's real additions win, not the source stub
        expect(r.content).toContain('obsidian-void');
        expect(r.content).toContain('Template body v2 — improved.');
    });

    it('ends with a trailing newline', () => {
        const r = mergeSkillContent(SRC_V2, DST_WITH_TAIL);
        expect(r.content.endsWith('\n')).toBe(true);
    });

    it('places exactly one blank line before the marker', () => {
        const r = mergeSkillContent(SRC_V2, DST_WITH_TAIL);
        const idx = r.content.indexOf(MARKER);
        const before = r.content.slice(0, idx);
        expect(before.endsWith('\n\n')).toBe(true);
        expect(before.endsWith('\n\n\n')).toBe(false);
    });

    it('normalizes CRLF in the overwrite path', () => {
        const r = mergeSkillContent('a\r\nb\r\n', 'old\n');
        expect(r.content).toBe('a\nb\n');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeSkillFile
// ─────────────────────────────────────────────────────────────────────────────

describe('mergeSkillFile', () => {
    it('copies on fresh install (dst missing)', () => {
        const src = path.join(tmp.root, 'src.md');
        const dst = path.join(tmp.root, 'sub', 'dst.md');
        fs.writeFileSync(src, SRC_V2);
        const r = mergeSkillFile(src, dst);
        expect(r.changed).toBe(true);
        expect(r.preserved).toBe(false);
        expect(fs.readFileSync(dst, 'utf8')).toBe(SRC_V2);
    });

    it('preserves the project tail across a head refresh', () => {
        const src = path.join(tmp.root, 'src.md');
        const dst = path.join(tmp.root, 'dst.md');
        fs.writeFileSync(src, SRC_V2);
        fs.writeFileSync(dst, DST_WITH_TAIL);
        const r = mergeSkillFile(src, dst);
        expect(r.changed).toBe(true);
        expect(r.preserved).toBe(true);
        const out = fs.readFileSync(dst, 'utf8');
        expect(out).toContain('Template body v2 — improved.');
        expect(out).toContain('obsidian-void');
    });

    it('reports unchanged when head already current and tail intact', () => {
        const src = path.join(tmp.root, 'src.md');
        const dst = path.join(tmp.root, 'dst.md');
        fs.writeFileSync(src, SRC_V2);
        // dst built from the same v2 head + a tail → a second merge is a no-op
        fs.writeFileSync(dst, DST_WITH_TAIL);
        mergeSkillFile(src, dst);              // first merge → v2 head + tail
        const r = mergeSkillFile(src, dst);    // second merge → identical
        expect(r.changed).toBe(false);
        expect(r.preserved).toBe(true);
    });

    it('overwrites a markerless dst (no project additions)', () => {
        const src = path.join(tmp.root, 'src.md');
        const dst = path.join(tmp.root, 'dst.md');
        fs.writeFileSync(src, SRC_V2);
        fs.writeFileSync(dst, SRC_V1);
        const r = mergeSkillFile(src, dst);
        expect(r.preserved).toBe(false);
        expect(fs.readFileSync(dst, 'utf8')).toBe(SRC_V2);
    });
});
