import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
const require = createRequire(import.meta.url);

describe('status', () => {
    it('loads without side effects and exports helpers', () => {
        const exports = require('../status');
        expect(exports).toBeDefined();
        expect(typeof exports.findTodoFiles).toBe('function');
        expect(typeof exports.parseTodoFile).toBe('function');
        expect(typeof exports.generateHtml).toBe('function');
        expect(typeof exports.esc).toBe('function');
    });

    it('generateHtml re-export uses the new (files, telemetry, gitMetrics, outputDir) signature', () => {
        // Regression guard for the P2.4 code-review M-1 — the re-export is now
        // `_lib/status-html.generateHtml` and has a different signature from the
        // pre-split version. This test proves the chain is live and the new
        // signature returns a string rather than throwing.
        const { generateHtml } = require('../status');

        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
        try {
            const files = [];
            const telemetry = { commands: {}, gates: {}, sessions: 0, memoryBenchmark: null };
            const gitMetrics = { commitCount: 0, branch: 'main', lastCommitAt: null, activeDays: 0 };
            const html = generateHtml(files, telemetry, gitMetrics, outputDir);
            expect(typeof html).toBe('string');
            expect(html.length).toBeGreaterThan(0);
        } finally {
            try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });

    it('esc re-export correctly escapes HTML special characters', () => {
        const { esc } = require('../status');
        expect(esc('<b>&"</b>')).toBe('&lt;b&gt;&amp;&quot;&lt;/b&gt;');
    });

    it('generateHtml accepts memMetrics 5th arg and renders Memory Health box when populated', () => {
        // Closes the M-3 deferred integration from the P2.4 code review:
        // loadMemoryMetrics output now flows through to the rendered dashboard.
        const { generateHtml } = require('../status');
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-mm-test-'));
        try {
            const memMetrics = {
                total: 12,
                byCategory: { patterns: 7, decisions: 5 },
                healthScore: 62,
                staleCount: 1,
            };
            const html = generateHtml(
                [],
                { commands: {}, gates: {}, sessions: 0, memoryBenchmark: null },
                { commitCount: 0, branch: 'main', lastCommitAt: null, activeDays: 0 },
                outputDir,
                memMetrics,
            );
            expect(html).toContain('Memory Health');
            expect(html).toContain('62');
        } finally {
            try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });

    it('generateHtml omits Memory Health box when memMetrics is null/missing (backward-compat)', () => {
        // Existing 4-arg callers must keep working.
        const { generateHtml } = require('../status');
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-mm-bc-test-'));
        try {
            const html = generateHtml(
                [],
                { commands: {}, gates: {}, sessions: 0, memoryBenchmark: null },
                { commitCount: 0, branch: 'main', lastCommitAt: null, activeDays: 0 },
                outputDir,
            );
            expect(html).not.toContain('Memory Health');
        } finally {
            try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });

    // ── F20: per-epic checklist parsing (## Story headers, not bold checkboxes) ──
    describe('parseTodoFile — per-epic checklist (F20)', () => {
        const writeTmp = (name, content) => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-f20-'));
            const file = path.join(dir, name);
            fs.writeFileSync(file, content, 'utf8');
            return { dir, file };
        };

        it('counts ## Story headers as stories and derives status from task checkboxes', () => {
            const { parseTodoFile } = require('../status');
            const content = [
                '# TODO: Epic 03',
                '',
                '## Story 3.1: First story',
                '**Tasks:**',
                '- [x] do a thing',
                '- [x] do another thing',
                '',
                '## Story 3.2: Second story',
                '**Tasks:**',
                '- [x] partly done',
                '- [ ] not yet',
                '',
                '## Story 3.3: Third story',
                '**Tasks:**',
                '- [ ] untouched',
                '- [ ] also untouched',
            ].join('\n');
            const { dir, file } = writeTmp('TODO_epic03_demo.md', content);
            try {
                const r = parseTodoFile(file);
                expect(r.type).toBe('checklist');
                expect(r.stories.total).toBe(3);       // three ## Story headers
                expect(r.stories.done).toBe(1);        // 3.1 all tasks checked
                expect(r.stories.inProgress).toBe(1);  // 3.2 partial
                expect(r.stories.pending).toBe(1);     // 3.3 none
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });

        it('C13: counts epic-story-ID headers (## Story E11-S1), not just dotted IDs', () => {
            // The brownfield backlog chain numbers stories `E11-S1`, `E0-S2` — the
            // old storyHeader regex `[\d.]+` only matched dotted `1.2`, so these
            // fell through to the legacy parser and counted 0.
            const { parseTodoFile } = require('../status');
            const content = [
                '# TODO: Epic 11 — Hardening',
                '',
                '## Story E11-S1: Add path tests',
                '**Tasks:**',
                '- [x] write tests',
                '- [x] verify',
                '',
                '## Story E11-S2: Next thing',
                '**Tasks:**',
                '- [ ] todo',
            ].join('\n');
            const { dir, file } = writeTmp('TODO_epic11_hardening.md', content);
            try {
                const r = parseTodoFile(file);
                expect(r.type).toBe('checklist');
                expect(r.stories.total).toBe(2);   // both E11-S* headers counted
                expect(r.stories.done).toBe(1);    // E11-S1 all tasks checked
                expect(r.stories.pending).toBe(1); // E11-S2 untouched
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });

        it('does NOT count bold prose annotations between stories as stories (F21 root)', () => {
            const { parseTodoFile } = require('../status');
            const content = [
                '# TODO: Epic 06',
                '',
                '## Story 6.1: Only real story',
                '**Tasks:**',
                '- [ ] task',
                '',
                '- [ ] **Optimization note: this is prose, not a story**',
                '- [ ] **Another note formatted as a bold checkbox**',
            ].join('\n');
            const { dir, file } = writeTmp('TODO_epic06_demo.md', content);
            try {
                const r = parseTodoFile(file);
                expect(r.stories.total).toBe(1); // only the ## Story header, not the bold prose
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    // ── F21: grand totals dedup master vs per-epic ──
    describe('computeGrandTotals (F21)', () => {
        it('uses the master index only when present (no double-count with per-epic)', () => {
            const { computeGrandTotals } = require('../status');
            const files = [
                { type: 'master',    stories: { total: 40, done: 5, inProgress: 0, blocked: 0, deferred: 0, pending: 35 } },
                { type: 'checklist', stories: { total: 7,  done: 1, inProgress: 0, blocked: 0, deferred: 0, pending: 6 } },
                { type: 'checklist', stories: { total: 4,  done: 0, inProgress: 0, blocked: 0, deferred: 0, pending: 4 } },
            ];
            const t = computeGrandTotals(files);
            expect(t.total).toBe(40); // master is canonical — per-epic NOT added (would be 51)
            expect(t.done).toBe(5);
        });

        it('falls back to summing checklists when no master index exists', () => {
            const { computeGrandTotals } = require('../status');
            const files = [
                { type: 'checklist', stories: { total: 7, done: 1, inProgress: 0, blocked: 0, deferred: 0, pending: 6 } },
                { type: 'checklist', stories: { total: 4, done: 2, inProgress: 0, blocked: 0, deferred: 0, pending: 2 } },
            ];
            const t = computeGrandTotals(files);
            expect(t.total).toBe(11);
            expect(t.done).toBe(3);
        });
    });

    // ── R7: story-header status marker + trailing-section checkbox leakage ──
    describe('parseTodoFile — header marker authority + section leakage (R7)', () => {
        const writeTmp = (name, content) => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-r7-'));
            const file = path.join(dir, name);
            fs.writeFileSync(file, content, 'utf8');
            return { dir, file };
        };

        it('honors the story HEADER [x] marker even when task checkboxes are unchecked', () => {
            // /run-todo marks the story done at its `## Story … [x]` header at wave
            // commit; status must count it done regardless of sub-task box state.
            const { parseTodoFile } = require('../status');
            const content = [
                '# TODO: Epic 03',
                '',
                '## Story 3.1 (Config): Shared Settings Schema `[x]` **[CP — critical path]**',
                '**Tasks:**',
                '- [ ] seed defaults',   // unchecked sub-tasks…
                '- [ ] wire helper',
                '',
                '## Story 3.5 (Backend): Per-Site Resolution `[ ]`',
                '**Tasks:**',
                '- [x] resolve order',   // …vs a header marked [ ] with a checked task
            ].join('\n');
            const { dir, file } = writeTmp('TODO_epic03_demo.md', content);
            try {
                const r = parseTodoFile(file);
                expect(r.stories.total).toBe(2);
                expect(r.stories.done).toBe(1);     // 3.1 — header [x] wins over unchecked tasks
                expect(r.stories.pending).toBe(1);  // 3.5 — header [ ] wins over a checked task
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });

        it('does NOT leak trailing ## Validation checkboxes into the last story', () => {
            // The `[CP]` annotation is multi-char and must NOT be read as a marker,
            // so 3.7 (header has no status bracket) derives from its own tasks only —
            // the ## Validation boxes below must not attach to it.
            const { parseTodoFile } = require('../status');
            const content = [
                '# TODO: Epic 03',
                '',
                '## Story 3.7 (Frontend): Options preset management',
                '**Tasks:**',
                '- [x] build UI',
                '- [x] persist',
                '',
                '## Validation',
                '- [ ] defaults identical across files',
                '- [ ] npm test green',
            ].join('\n');
            const { dir, file } = writeTmp('TODO_epic03_val.md', content);
            try {
                const r = parseTodoFile(file);
                expect(r.stories.total).toBe(1);   // only Story 3.7 — Validation is not a story
                expect(r.stories.done).toBe(1);    // 3.7's own tasks all [x]; Validation boxes excluded
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });
    });
});
