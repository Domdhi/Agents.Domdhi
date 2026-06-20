import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { resolveProjectRoot } = require('../project-root.js');

describe('resolveProjectRoot', () => {
    const saved = process.env.CLAUDE_PROJECT_DIR;
    afterEach(() => {
        if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
        else process.env.CLAUDE_PROJECT_DIR = saved;
    });
    beforeEach(() => { delete process.env.CLAUDE_PROJECT_DIR; });

    it('CLAUDE_PROJECT_DIR overrides everything', () => {
        process.env.CLAUDE_PROJECT_DIR = '/explicit/override';
        expect(resolveProjectRoot('/anything')).toBe('/explicit/override');
    });

    it('falls back to the given dir when not in a git repo', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
        try {
            expect(resolveProjectRoot(tmp)).toBe(tmp);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('resolves the MAIN worktree root from inside a linked worktree (the fix)', () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mainwt-')));
        const wt = path.join(root, '..', `${path.basename(root)}-linked`);
        const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
        try {
            git(['init', '-q'], root);
            git(['config', 'user.email', 't@t.t'], root);
            git(['config', 'user.name', 't'], root);
            fs.writeFileSync(path.join(root, 'f.txt'), 'x');
            git(['add', '.'], root);
            git(['commit', '-qm', 'init'], root);
            git(['worktree', 'add', '-q', wt, '-b', 'feat'], root);

            // Normalize both sides through realpathSync.native: on Windows,
            // os.tmpdir() can yield an 8.3 short path (e.g. DBACA~1.NMM) while
            // git's --git-common-dir returns the long form (dbaca.NMMFA). Same
            // directory, different strings — canonicalize before comparing.
            const norm = (p) => fs.realpathSync.native(p);
            // From the linked worktree, the resolved root is the MAIN worktree —
            // so a memory store anchored to it is shared, not worktree-local.
            expect(norm(resolveProjectRoot(wt))).toBe(norm(root));
            // And from the main worktree it stays the main worktree.
            expect(norm(resolveProjectRoot(root))).toBe(norm(root));
        } finally {
            try { git(['worktree', 'remove', '--force', wt], root); } catch { /* best effort */ }
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(wt, { recursive: true, force: true });
        }
    });
});
