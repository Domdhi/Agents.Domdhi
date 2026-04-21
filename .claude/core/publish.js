#!/usr/bin/env node

/**
 * Publish — copy the public-release subset of this template to a target repo.
 *
 * Two-repo workflow: the private workshop (this repo, Domdhi.Agents) publishes
 * a curated subset to a public storefront (Agents.Domdhi) via an explicit
 * allowlist manifest at `.claude/publish-manifest.json`.
 *
 * Differences from template-updater.js:
 *   - Bootstrap mode: target repo may not have a `.claude/` yet (first publish).
 *     template-updater errors on missing target/.claude; publish creates it.
 *   - Explicit manifest: instead of the Template/Project/Mixed zone model,
 *     publish honors `.claude/publish-manifest.json` as an allowlist.
 *     Not on the manifest → doesn't ship.
 *   - Default excludes: a hardcoded DEFAULT_EXCLUDES list strips working docs
 *     (handoff, .output, todo, research, app, design, timeline) even if a
 *     broad manifest include would otherwise match them. Safety belt.
 *
 * When to use which:
 *   - First publish to an empty/new public repo  → publish.js
 *   - Incremental template sync to an existing  → template-updater.js update
 *     `.claude/`-bearing project
 *
 * Usage:
 *   node .claude/core/publish.js <target-path>
 *   node .claude/core/publish.js <target-path> --dry-run
 *   node .claude/core/publish.js --help
 */

'use strict';

const fs = require('fs');
const path = require('path');

// One-way dependency: publish.js uses template-updater's glob + copy utilities.
// template-updater does NOT import from publish.js. Do not reverse this.
const { globToRegex, matchesAnyGlob, copyFile } = require('./template-updater');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');

// ── Default excludes ────────────────────────────────────────────────────────
//
// Safety net. Even if the manifest's `include` globs would match these paths,
// they never ship. These are the "working" parts of the repo — session state,
// ephemeral output, in-progress TODOs, and per-feature scratch work.

const DEFAULT_EXCLUDES = [
    // Session + working artifacts
    'docs/__handoff.md',
    'docs/.output/**',
    'docs/todo/**',
    'docs/research/**',
    'docs/app/**',
    'docs/design/**',
    'docs/_project-timeline.md',

    // Never publish project-local settings overrides
    '.claude/settings.local.json',

    // Agent memory stores — runtime artifacts generated per-project by
    // memory-manager.js. Every adopter generates their own; the template
    // must never ship one project's agent learnings to another.
    '.claude/agent-memory/**',

    // Version control + deps — publisher shouldn't walk these anyway
    '.git/**',
    'node_modules/**',

    // Test scaffolding is local-only per template-updater's ALWAYS_SKIP_DIRS
    '.claude/core/__tests__/**',
    '.claude/hooks/__tests__/**',
    '**/_helpers/**',
];

// Directory names skipped at walk-time (perf — avoids touching thousands of
// files inside .git/ and node_modules/ just to filter them later).
const WALK_SKIP_DIRS = new Set(['.git', 'node_modules']);

// Paths skipped at walk-time, relative to projectRoot (normalized forward-slash).
// docs/.output/ can be huge; short-circuit rather than filter file-by-file.
const WALK_SKIP_PATHS = new Set(['docs/.output']);

// ── Manifest ────────────────────────────────────────────────────────────────

/**
 * Load the publish manifest from `<projectRoot>/.claude/publish-manifest.json`.
 *
 * Manifest shape:
 *   {
 *     "version": "1",
 *     "include": ["glob", ...],       // required
 *     "exclude": ["glob", ...]        // optional — augments DEFAULT_EXCLUDES
 *   }
 *
 * Throws an actionable error if the manifest is missing or malformed.
 */
function loadManifest(projectRoot) {
    const manifestPath = path.join(projectRoot, '.claude', 'publish-manifest.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(
            `publish-manifest.json not found at ${manifestPath}\n` +
            `  The publish manifest is the explicit allowlist of files that ship to the public repo.\n` +
            `  Create it per PR-3.2 (see docs/todo/TODO_public-release.md "Locked Docs Structure")\n` +
            `  or supply one manually with shape: { version, include: [], exclude?: [] }.`
        );
    }
    const raw = fs.readFileSync(manifestPath, 'utf8');
    try {
        return JSON.parse(raw);
    } catch (err) {
        throw new Error(`publish-manifest.json at ${manifestPath} is malformed JSON: ${err.message}`);
    }
}

/**
 * Check if a relative path (from projectRoot) is allowed to ship.
 *
 * Rules:
 *   1. Must match at least one glob in manifest.include
 *   2. Must NOT match any glob in DEFAULT_EXCLUDES or manifest.exclude
 */
function isAllowed(relPath, manifest) {
    const normalized = relPath.replace(/\\/g, '/');

    const include = Array.isArray(manifest && manifest.include) ? manifest.include : [];
    if (!matchesAnyGlob(normalized, include)) return false;

    const manifestExclude = Array.isArray(manifest && manifest.exclude) ? manifest.exclude : [];
    const allExcludes = DEFAULT_EXCLUDES.concat(manifestExclude);
    if (matchesAnyGlob(normalized, allExcludes)) return false;

    return true;
}

// ── File walker ─────────────────────────────────────────────────────────────

/**
 * Recursively walk projectRoot, returning absolute file paths.
 * Skips WALK_SKIP_DIRS by directory name and WALK_SKIP_PATHS by relative path
 * for walk-time perf.
 */
function walkPublishableFiles(projectRoot) {
    const results = [];
    if (!fs.existsSync(projectRoot)) return results;

    function walk(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (WALK_SKIP_DIRS.has(entry.name)) continue;
                const rel = path.relative(projectRoot, full).replace(/\\/g, '/');
                if (WALK_SKIP_PATHS.has(rel)) continue;
                walk(full);
            } else if (entry.isFile()) {
                results.push(full);
            }
        }
    }

    walk(projectRoot);
    return results;
}

// ── Main: runPublish ────────────────────────────────────────────────────────

/**
 * Publish the manifest-approved subset of `projectRoot` to `targetPath`.
 *
 * @param {string} targetPath — destination repo root. Created if missing (bootstrap mode).
 * @param {{ dryRun?: boolean }} [options]
 * @returns {{ copied: number, skipped: number, errors: number }}
 */
function runPublish(targetPath, options) {
    options = options || {};
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || PROJECT_ROOT;

    const manifest = loadManifest(projectRoot);

    // Bootstrap mode: create target root and target/.claude if missing.
    // template-updater errors here; publish creates the scaffold instead.
    if (!options.dryRun) {
        fs.mkdirSync(targetPath, { recursive: true });
        fs.mkdirSync(path.join(targetPath, '.claude'), { recursive: true });
    }

    console.log(`Publish${options.dryRun ? ' (DRY RUN)' : ''}`);
    console.log(`  Source : ${projectRoot}`);
    console.log(`  Target : ${targetPath}`);
    console.log(`  Manifest include patterns: ${(manifest.include || []).length}`);
    console.log(`  Manifest exclude patterns: ${(manifest.exclude || []).length} (+ ${DEFAULT_EXCLUDES.length} default)`);
    console.log('');

    const stats = { copied: 0, skipped: 0, errors: 0 };
    const allFiles = walkPublishableFiles(projectRoot);

    for (const srcAbs of allFiles) {
        const rel = path.relative(projectRoot, srcAbs).replace(/\\/g, '/');
        if (!isAllowed(rel, manifest)) {
            stats.skipped++;
            continue;
        }
        const destAbs = path.join(targetPath, rel);
        if (options.dryRun) {
            console.log(`  COPY     ${rel}`);
            stats.copied++;
        } else {
            try {
                copyFile(srcAbs, destAbs);
                console.log(`  COPY     ${rel}`);
                stats.copied++;
            } catch (err) {
                console.error(`  ERROR    ${rel} — ${err.message}`);
                stats.errors++;
            }
        }
    }

    console.log('');
    console.log('─────────────────────────────────────────────');
    console.log(`${options.dryRun ? 'Dry run complete (no files written)' : 'Publish complete'}`);
    console.log(`  Copied  : ${stats.copied}`);
    console.log(`  Skipped : ${stats.skipped}  (filtered by manifest or default excludes)`);
    if (stats.errors > 0) {
        console.log(`  Errors  : ${stats.errors}  ← check output above`);
    }

    return stats;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
    console.log(`
Publish — copy the public-release subset of this template to a target repo.

Usage:
  node .claude/core/publish.js <target-path>
  node .claude/core/publish.js <target-path> --dry-run
  node .claude/core/publish.js --help

Arguments:
  <target-path>   Destination repo root. Created if missing (first-publish
                  bootstrap mode). Target's .claude/ is created as well.

Flags:
  --dry-run       Walk + classify every file and log what WOULD be copied,
                  but write nothing.
  --help, -h      Print this message.

Manifest:
  The file .claude/publish-manifest.json is required. Shape:
    {
      "version": "1",
      "include": ["glob", ...],     // required — allowlist of globs that CAN ship
      "exclude": ["glob", ...]      // optional — augments DEFAULT_EXCLUDES
    }

  If .claude/publish-manifest.json is missing, this command errors. Create
  one per PR-3.2 (see docs/todo/TODO_public-release.md "Locked Docs Structure").

Default excludes (always applied, even if manifest.include would match):
  docs/__handoff.md, docs/.output/**, docs/todo/**, docs/research/**,
  docs/app/**, docs/design/**, docs/_project-timeline.md,
  .claude/settings.local.json, .git/**, node_modules/**,
  .claude/core/__tests__/**, .claude/hooks/__tests__/**, **/_helpers/**

Notes:
  - Use this for FIRST publish to an empty public repo.
  - For incremental sync to an existing .claude/-bearing project, use:
      node .claude/core/template-updater.js update <target-path>
  - Additive only: files in target not present in source are never deleted.
`.trim());
}

function main() {
    const allArgs = process.argv.slice(2);

    if (allArgs.length === 0 || allArgs.includes('--help') || allArgs.includes('-h')) {
        printHelp();
        process.exit(0);
    }

    const dryRun = allArgs.includes('--dry-run');
    const targetPath = allArgs.find(a => !a.startsWith('--'));

    if (!targetPath) {
        console.error('Error: publish requires a target path');
        console.error('  Usage: node .claude/core/publish.js <target-path> [--dry-run]');
        process.exit(1);
    }

    try {
        const stats = runPublish(path.resolve(targetPath), { dryRun });
        if (stats.errors > 0) process.exit(1);
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}

if (require.main === module) { main(); }

module.exports = {
    runPublish,
    loadManifest,
    isAllowed,
    walkPublishableFiles,
    DEFAULT_EXCLUDES,
};
