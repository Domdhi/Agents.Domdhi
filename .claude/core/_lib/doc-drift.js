/**
 * doc-drift — detect legacy / duplicate planning docs that the canonical
 * `_project-*` naming has superseded (F2).
 *
 * Brownfield repos (and repos that predate a naming change) accumulate planning
 * docs under OLD names — `_architecture.md`, `_prd.md`, a root `_backlog.md`
 * beside `todo/_backlog.md`, two `_feature-ideas.md`. The create-chain only ever
 * touches its canonical paths, so these legacy/duplicate files are invisible to
 * it and silently drift (two PRDs, two backlogs). This module makes them visible
 * so `/onboard` can reconcile them and `/review:check-sync` can flag them.
 *
 * Exports:
 *   detectDocDrift(projectRoot) → { legacy: [...], duplicates: [...], hasDrift }
 *
 * CLI:
 *   node doc-drift.js [projectRoot]
 *   Exit 0 — no drift
 *   Exit 1 — drift found (report on stdout)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Legacy doc name → canonical `_project-*` name it was superseded by.
const LEGACY_TO_CANONICAL = {
    '_architecture.md': '_project-architecture.md',
    '_prd.md': '_project-requirements.md',
    '_requirements.md': '_project-requirements.md',
    '_brief.md': '_project-brief.md',
    '_design.md': '_project-design.md',
    '_context.md': '_project-context.md',
};

// Basenames that have ONE canonical home; if the same name also exists at the
// docs/ root (the non-canonical spot), that's a duplicate. [name, canonicalRel].
const CANONICAL_LOCATIONS = [
    ['_backlog.md', 'todo/_backlog.md'],
    ['_feature-ideas.md', 'todo/_feature-ideas.md'],
];

const TEMPLATE_MARKER = '<!-- @@template -->';

/** True if a file exists and is NOT just an unfilled scaffold stub. */
function isRealDoc(absPath) {
    try {
        const content = fs.readFileSync(absPath, 'utf8');
        return !content.startsWith(TEMPLATE_MARKER);
    } catch {
        return false;
    }
}

/**
 * Detect legacy and duplicate planning docs under `<projectRoot>/docs`.
 *
 * @param {string} projectRoot
 * @returns {{ legacy: Array, duplicates: Array, hasDrift: boolean }}
 *   legacy:     { file, canonical, canonicalExists } — a legacy-named real doc
 *   duplicates: { name, root, canonical } — same basename at root AND canonical path
 */
function detectDocDrift(projectRoot) {
    const docsDir = path.join(projectRoot, 'docs');
    const legacy = [];
    const duplicates = [];

    for (const [legacyName, canonicalName] of Object.entries(LEGACY_TO_CANONICAL)) {
        const legacyPath = path.join(docsDir, legacyName);
        if (isRealDoc(legacyPath)) {
            legacy.push({
                file: `docs/${legacyName}`,
                canonical: `docs/${canonicalName}`,
                canonicalExists: isRealDoc(path.join(docsDir, canonicalName)),
            });
        }
    }

    for (const [name, canonicalRel] of CANONICAL_LOCATIONS) {
        const rootPath = path.join(docsDir, name);
        const canonicalPath = path.join(docsDir, canonicalRel);
        if (isRealDoc(rootPath) && isRealDoc(canonicalPath)) {
            duplicates.push({ name, root: `docs/${name}`, canonical: `docs/${canonicalRel}` });
        }
    }

    return { legacy, duplicates, hasDrift: legacy.length > 0 || duplicates.length > 0 };
}

function main() {
    const projectRoot = process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const { legacy, duplicates, hasDrift } = detectDocDrift(projectRoot);

    if (!hasDrift) {
        process.stdout.write('No legacy/duplicate planning docs detected.\n');
        process.exit(0);
    }

    const lines = ['Document drift detected:', ''];
    if (legacy.length) {
        lines.push('Legacy-named docs (superseded by canonical `_project-*` names):');
        for (const l of legacy) {
            lines.push(`  • ${l.file}  →  ${l.canonical}` +
                (l.canonicalExists ? '  (BOTH exist — reconcile & remove the legacy one)' : '  (rename/migrate to canonical)'));
        }
        lines.push('');
    }
    if (duplicates.length) {
        lines.push('Duplicate docs (same name at root AND canonical location):');
        for (const d of duplicates) lines.push(`  • ${d.root}  vs  ${d.canonical}  (keep canonical, remove the root copy)`);
        lines.push('');
    }
    lines.push('Reconcile via /onboard (archives/removes legacy docs) or clean up manually.');
    process.stdout.write(lines.join('\n') + '\n');
    process.exit(1);
}

module.exports = { detectDocDrift, isRealDoc, LEGACY_TO_CANONICAL, CANONICAL_LOCATIONS };

if (require.main === module) main();
