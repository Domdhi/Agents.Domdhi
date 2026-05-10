#!/usr/bin/env node

/**
 * Template Updater — copies Template-zone files from this repo's .claude/ to a target project.
 *
 * Zone boundaries (docs/reference/customization.md):
 *   Template zone  — overwrite (commands, core, hooks, skills, templates, etc.)
 *   Project zone   — never touch (settings.json, settings.local.json, brand-guidelines)
 *   Mixed zone     — skip with warning, or merge with --merge (agents/*.md)
 *
 * Usage:
 *   node .claude/core/template-updater.js update <target-path>
 *   node .claude/core/template-updater.js update <target-path> --merge
 *   node .claude/core/template-updater.js update <target-path> --dry-run
 */

'use strict';

const fs = require('fs');
const path = require('path');

const zoneClassifier = require('./_lib/zone-classifier');
const { walkDir }    = require('./_lib/file-walker');
const agentMerger    = require('./_lib/agent-merger');
const { copyWithZoneEnforcement } = require('./_lib/zone-copy');

const { classifyClaudeFile } = zoneClassifier;
const { mergeAgentFile }     = agentMerger;

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');

// Source CLAUDE.md → target .claude/README.md (template docs, not project docs)
const ROOT_DOC_REDIRECT = { src: 'CLAUDE.md', dest: '.claude/README.md' };

// Root-level dirs that are Template zone (no entries today; .githooks/ was
// retired 2026-05-09 when the secret-scanner moved to a Claude Code hook).
const ROOT_TEMPLATE_FILES = [];
const ROOT_TEMPLATE_DIRS  = [];

// Dirs never propagated (keep test scaffolding local)
const ALWAYS_SKIP_DIRS = ['__tests__', '_helpers', 'node_modules'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function copyFile(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

function tryAction(label, fn, stats) {
    try { fn(); } catch (err) {
        console.error(`  ERROR    ${label} — ${err.message}`);
        stats.errors++;
    }
}

// ── Main Command: update ──────────────────────────────────────────────────────

function runUpdate(targetPath, options) {
    options = options || {};
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || PROJECT_ROOT;

    if (!fs.existsSync(targetPath)) {
        console.error(`Error: target path does not exist: ${targetPath}`);
        process.exit(1);
    }
    const targetClaudeDir = path.join(targetPath, '.claude');
    if (!fs.existsSync(targetClaudeDir)) {
        console.error(`Error: target path does not contain a .claude/ directory: ${targetPath}`);
        console.error('  This tool only updates existing .claude/ installations.');
        process.exit(1);
    }

    console.log(`Template Updater${options.dryRun ? ' (DRY RUN)' : ''}`);
    console.log(`  Source : ${projectRoot}`);
    console.log(`  Target : ${targetPath}`);
    console.log('');

    const stats    = { copied: 0, merged: 0, skipped: 0, warned: 0, errors: 0 };
    const warnings = [];

    // ── .claude/ files ────────────────────────────────────────────────────────

    const sourceClaudeDir = path.join(projectRoot, '.claude');
    for (const srcAbs of walkDir(sourceClaudeDir, ALWAYS_SKIP_DIRS)) {
        const relToClause = path.relative(sourceClaudeDir, srcAbs);
        const zone        = classifyClaudeFile(relToClause);
        const destAbs     = path.join(targetClaudeDir, relToClause);
        const rel         = relToClause.replace(/\\/g, '/');

        if (zone === 'template') {
            if (rel === 'version.json') continue; // deferred — copy last
            if (options.dryRun) {
                console.log(`  COPY     .claude/${rel} → .claude/${rel}`);
                stats.copied++;
            } else {
                tryAction(`.claude/${rel}`, () => {
                    copyWithZoneEnforcement(srcAbs, destAbs, 'template', options);
                    console.log(`  COPY     .claude/${rel}`);
                    stats.copied++;
                }, stats);
            }

        } else if (zone === 'project') {
            console.log(`  SKIP     .claude/${rel} (project zone)`);
            stats.skipped++;

        } else if (zone === 'project-exception') {
            const msg = `.claude/${rel} — Project zone exception`;
            console.log(`  WARN     ${msg}`);
            warnings.push(msg);
            stats.warned++;

        } else if (zone === 'mixed') {
            if (options.merge) {
                if (options.dryRun) {
                    const destExists = fs.existsSync(destAbs);
                    console.log(`  MERGE    .claude/${rel} — ${destExists ? 'would merge (section-aware)' : 'would copy (fresh install)'}`);
                    stats.merged++;
                } else {
                    tryAction(`.claude/${rel}`, () => {
                        const r = mergeAgentFile(srcAbs, destAbs);
                        console.log(`  MERGE    .claude/${rel} — ${r.detail}`);
                        stats.merged++;
                    }, stats);
                }
            } else {
                const msg = `.claude/${rel} — Mixed zone — use --merge to handle these`;
                console.log(`  WARN     ${msg}`);
                warnings.push(msg);
                stats.warned++;
            }

        } else {
            console.log(`  SKIP     .claude/${rel} (not in zone map)`);
            stats.skipped++;
        }
    }

    // ── CLAUDE.md → .claude/README.md ────────────────────────────────────────

    const claudeMdSrc = path.join(projectRoot, ROOT_DOC_REDIRECT.src);
    if (fs.existsSync(claudeMdSrc)) {
        const claudeMdDest = path.join(targetPath, ROOT_DOC_REDIRECT.dest);
        const label = `${ROOT_DOC_REDIRECT.src} → ${ROOT_DOC_REDIRECT.dest} (template docs)`;
        if (options.dryRun) {
            console.log(`  COPY     ${label}`);
            stats.copied++;
        } else {
            tryAction(label, () => {
                copyFile(claudeMdSrc, claudeMdDest);
                console.log(`  COPY     ${label}`);
                stats.copied++;
            }, stats);
        }
    }

    // ── Root-level template files ─────────────────────────────────────────────

    for (const filename of ROOT_TEMPLATE_FILES) {
        const srcAbs = path.join(projectRoot, filename);
        if (!fs.existsSync(srcAbs)) continue;
        tryAction(filename, () => {
            copyFile(srcAbs, path.join(targetPath, filename));
            console.log(`  COPY     ${filename}`);
            stats.copied++;
        }, stats);
    }

    // ── .githooks/ (Template zone at repo root) ───────────────────────────────

    for (const dirName of ROOT_TEMPLATE_DIRS) {
        const srcDir = path.join(projectRoot, dirName);
        if (!fs.existsSync(srcDir)) continue;
        for (const srcAbs of walkDir(srcDir, ALWAYS_SKIP_DIRS)) {
            const relToDir = path.relative(srcDir, srcAbs);
            const relNorm  = relToDir.replace(/\\/g, '/');
            const destAbs  = path.join(targetPath, dirName, relToDir);
            if (options.dryRun) {
                console.log(`  COPY     ${dirName}/${relNorm} → ${dirName}/${relNorm}`);
                stats.copied++;
            } else {
                tryAction(`${dirName}/${relNorm}`, () => {
                    copyFile(srcAbs, destAbs);
                    console.log(`  COPY     ${dirName}/${relNorm}`);
                    stats.copied++;
                }, stats);
            }
        }
    }

    // ── version.json — last (sync-complete marker) ────────────────────────────

    const versionSrc  = path.join(sourceClaudeDir, 'version.json');
    const versionDest = path.join(targetClaudeDir, 'version.json');
    if (fs.existsSync(versionSrc)) {
        if (stats.errors > 0) {
            console.log('  SKIP     .claude/version.json (errors occurred — incomplete sync)');
            stats.skipped++;
        } else if (options.dryRun) {
            console.log('  COPY     .claude/version.json → .claude/version.json (last — sync marker)');
            stats.copied++;
        } else {
            tryAction('.claude/version.json', () => {
                copyFile(versionSrc, versionDest);
                console.log('  COPY     .claude/version.json (last — sync marker)');
                stats.copied++;
            }, stats);
        }
    }

    // ── Report ────────────────────────────────────────────────────────────────

    console.log('');
    console.log('─────────────────────────────────────────────');
    console.log(options.dryRun ? 'Dry run complete (no files written)' : 'Update complete');
    console.log(`  Copied  : ${stats.copied}`);
    console.log(`  Merged  : ${stats.merged}`);
    console.log(`  Skipped : ${stats.skipped}`);
    console.log(`  Warned  : ${stats.warned}`);
    if (stats.errors > 0) console.log(`  Errors  : ${stats.errors}  ← check output above`);
    if (warnings.length > 0) {
        console.log('\nWarnings:');
        warnings.forEach(w => console.log(`  ! ${w}`));
    }
    if (stats.errors > 0) process.exit(1);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function printHelp() {
    console.log(`Template Updater — copies Template-zone files from this repo to a target project.

Usage:
  node .claude/core/template-updater.js update <target-path> [--merge] [--dry-run]

Zone behavior:
  Template zone   — Overwritten: commands/, core/, hooks/, skills/**/*,
                    skills-optional/, templates/, version.json, guardrail-rules.yaml
  Project zone    — Skipped: settings.json, settings.local.json
  Mixed zone      — Skipped with warning (default): agents/*.md
                    With --merge: section-aware merge preserving customizations
  Exceptions      — Skipped with warning: skills/brand-guidelines/**
  Doc redirect    — Source CLAUDE.md → target .claude/README.md

Flags:
  --merge         Section-aware merge for agents/*.md (preserves Soul Zone + Project Context)
  --dry-run       Preview all actions without writing any files.

Notes:
  - Additive only: files in target not present in source are never deleted.
  - Directories in target are created as needed.`);
}

function main() {
    const [,, command, ...args] = process.argv;
    if (!command || command === '--help' || command === '-h') { printHelp(); process.exit(0); }

    const allArgs  = process.argv.slice(2);
    const options  = { merge: allArgs.includes('--merge'), dryRun: allArgs.includes('--dry-run') };

    if (command === 'update') {
        const targetPath = args.find(a => !a.startsWith('--'));
        if (!targetPath) {
            console.error('Error: update requires a target path');
            console.error('  Usage: node template-updater.js update <target-path> [--merge] [--dry-run]');
            process.exit(1);
        }
        runUpdate(path.resolve(targetPath), options);
    } else {
        console.error(`Unknown command: ${command}`);
        console.error('Run with --help to see available commands.');
        process.exit(1);
    }
}

if (require.main === module) { main(); }

// Re-export _lib symbols so existing consumers (template-updater.test.js) import
// from this file without change. walkDir shim keeps the old array-returning API.
const _libFW = require('./_lib/file-walker');
module.exports = Object.assign(
    { copyFile, runUpdate },
    zoneClassifier,
    agentMerger,
    { walkDir: (dirPath) => [..._libFW.walkDir(dirPath, ALWAYS_SKIP_DIRS)] }
);
