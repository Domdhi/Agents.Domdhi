'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Resolve the project root that anchors per-project working state — above all
 * the memory store at docs/.output/memories/ (JSON + memories.db).
 *
 * WHY THIS EXISTS — the git-worktree memory-loss bug. A worktree only checks out
 * TRACKED files, and docs/.output/memories/ is gitignored, so a fresh worktree
 * starts with an EMPTY store: recall finds nothing, and any memory written
 * during worktree work lands in the worktree-local dir, which is deleted with
 * the worktree. The store must instead be SHARED across the main repo and every
 * linked worktree.
 *
 * Resolution order:
 *   1. CLAUDE_PROJECT_DIR — explicit override, always wins.
 *   2. The MAIN worktree root, via `git rev-parse --git-common-dir`. The common
 *      dir ("<mainRoot>/.git") is shared by the main repo and every linked
 *      worktree, so this returns the same path everywhere → one shared store,
 *      no copy, nothing lost on worktree removal.
 *   3. `fallbackDir` — the caller's own location (non-git / standalone template).
 *
 * `fallbackDir` is the caller's `path.resolve(__dirname, '..', '..')`; it is
 * used both as the git-query cwd and as the last-resort root.
 */
function resolveProjectRoot(fallbackDir) {
    if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
    try {
        const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
            cwd: fallbackDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (common) {
            // `--git-common-dir` is relative ("​.git") from the main worktree and
            // absolute ("/main/.git") from a linked one; resolving against the
            // cwd normalizes both to the same absolute "<mainRoot>/.git".
            const abs = path.resolve(fallbackDir, common);
            // Standard layout only: trust the parent of the common dir solely
            // when it is named ".git". A relocation (--separate-git-dir / GIT_DIR)
            // would otherwise anchor the store somewhere surprising — fall through
            // to fallbackDir and let CLAUDE_PROJECT_DIR be the escape hatch.
            if (path.basename(abs) === '.git') return path.dirname(abs);
        }
    } catch {
        // not a git repo, or git unavailable — use the fallback
    }
    return fallbackDir;
}

module.exports = { resolveProjectRoot };
