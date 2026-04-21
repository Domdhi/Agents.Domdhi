#!/usr/bin/env node

/**
 * Template Updater — copies Template-zone files from this repo's .claude/ to a target project.
 *
 * Respects zone boundaries defined in docs/reference/customization.md:
 *   Template zone  — overwrite in target (commands, core, hooks, skills, templates, etc.)
 *   Project zone   — never touch (settings.json, settings.local.json, brand-guidelines)
 *   Mixed zone     — skip with warning, or merge with --merge (agents/*.md, root CLAUDE.md)
 *
 * Usage:
 *   node .claude/core/template-updater.js update <target-path>
 *   node .claude/core/template-updater.js update <target-path> --merge
 *   node .claude/core/template-updater.js --help
 *
 * Flags:
 *   --merge      Handle Mixed-zone files with section-aware merge
 *   --dry-run    Preview what would be copied/merged without writing any files
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');

// ── Zone Definitions ────────────────────────────────────────────────────────
//
// Each zone entry has: a test function (relative path inside .claude/ → bool)
// Evaluation order matters: PROJECT_EXCEPTIONS and PROJECT_FILES are checked
// before TEMPLATE_GLOBS so that exceptions win.

/**
 * Convert a simple glob pattern (supporting ** and *) to a RegExp.
 * Only the subset of glob syntax used in the zone map is needed:
 *   **  → match any path segments (including none)
 *   *   → match any single path segment component (no slashes)
 */
function globToRegex(pattern) {
    // Normalize slashes
    const normalized = pattern.replace(/\\/g, '/');
    // Split on ** first to avoid ** fragments being re-processed by * replacement.
    // Then process each segment independently.
    const parts = normalized.split('**');
    const regParts = parts.map((part, i) => {
        // Escape regex special chars in this literal part
        let escaped = part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        // Replace * (single-star) within this part with [^/]*
        escaped = escaped.replace(/\*/g, '[^/]*');
        return escaped;
    });

    // Rejoin with the appropriate regex for **
    // /**/ => (/.*)?/   (zero or more path segments including none)
    // /**$ => (/.*)?    (trailing — match nothing or a subtree)
    // ^**/ => (.*/)?    (leading — match at any depth)
    // else  => .*       (remaining bare **)
    let regStr = '';
    for (let i = 0; i < regParts.length; i++) {
        regStr += regParts[i];
        if (i < regParts.length - 1) {
            // This is a ** junction. Determine context from surrounding parts.
            const prev = regParts[i];
            const next = regParts[i + 1];
            const prevEndsSlash = prev.endsWith('/');
            const nextStartsSlash = next.startsWith('/');
            const isFirst = i === 0 && prev === '';
            const isLast = i === regParts.length - 2 && next === '';

            if (isFirst && nextStartsSlash) {
                // ^**/ pattern
                regStr += '(.*/)?';
                // consume the leading slash from next
                regParts[i + 1] = regParts[i + 1].slice(1);
            } else if (isLast && prevEndsSlash) {
                // /**$ pattern — remove trailing slash already added from prev
                regStr = regStr.slice(0, -1); // remove the trailing /
                regStr += '(/.*)?';
            } else if (prevEndsSlash && nextStartsSlash) {
                // /**/ pattern — remove trailing slash already added from prev
                regStr = regStr.slice(0, -1); // remove the trailing /
                regStr += '(/.*)?';
                // consume the leading slash from next
                regParts[i + 1] = regParts[i + 1].slice(1);
            } else {
                regStr += '.*';
            }
        }
    }

    return new RegExp('^' + regStr + '$');
}

function matchesAnyGlob(relPath, globs) {
    const normalized = relPath.replace(/\\/g, '/');
    return globs.some(g => globToRegex(g).test(normalized));
}

// Template zone — overwrite in target
const TEMPLATE_GLOBS = [
    'commands/**/*.md',
    'core/*.js',
    'hooks/*.cjs',
    'skills/*/SKILL.md',
    'skills-optional/**/*',
    'templates/**/*',
    'version.json',
    'guardrail-rules.yaml',
];

// Project zone — never touch (paths relative to .claude/)
const PROJECT_FILES = [
    'settings.json',
    'settings.local.json',
];

// Project zone exceptions — files that match TEMPLATE_GLOBS but are project-owned
const PROJECT_EXCEPTIONS = [
    'skills/brand-guidelines/SKILL.md',
];

// Mixed zone — skip with warning unless --merge
const MIXED_GLOBS = [
    'agents/*.md',
];

/**
 * Determine the zone for a file given its path relative to .claude/.
 *
 * Returns one of: 'template' | 'project' | 'project-exception' | 'mixed' | 'unknown'
 */
function classifyClaudeFile(relPath) {
    const normalized = relPath.replace(/\\/g, '/');

    if (PROJECT_FILES.includes(normalized)) return 'project';
    if (PROJECT_EXCEPTIONS.includes(normalized)) return 'project-exception';
    if (matchesAnyGlob(normalized, MIXED_GLOBS)) return 'mixed';
    if (matchesAnyGlob(normalized, TEMPLATE_GLOBS)) return 'template';
    return 'unknown';
}

// Source CLAUDE.md (template self-documentation) is copied to target as
// .claude/README.md so downstream projects keep their own root CLAUDE.md
// for project-specific Claude Code instructions.
const ROOT_DOC_REDIRECT = { src: 'CLAUDE.md', dest: '.claude/README.md' };

// Files at the repo root that are Template zone
const ROOT_TEMPLATE_FILES = [];

// .githooks/ directory at repo root is Template zone
const ROOT_TEMPLATE_DIRS = ['.githooks'];

// Directories that are never propagated to downstream projects regardless of
// glob matches. Keeps test scaffolding local to this repo.
const ALWAYS_SKIP_DIRS = new Set(['__tests__', '_helpers', 'node_modules']);

// ── File Walker ─────────────────────────────────────────────────────────────

/**
 * Recursively walk a directory and yield all file paths (absolute).
 * Skips directories listed in ALWAYS_SKIP_DIRS.
 * Returns an array of absolute file paths.
 */
function walkDir(dirPath) {
    const results = [];
    if (!fs.existsSync(dirPath)) return results;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
            results.push(...walkDir(fullPath));
        } else if (entry.isFile()) {
            results.push(fullPath);
        }
    }
    return results;
}

// ── Copy Helper ──────────────────────────────────────────────────────────────

function copyFile(src, dest) {
    const destDir = path.dirname(dest);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
}

// ── Agent File Merge ─────────────────────────────────────────────────────────

/**
 * Parse an agent .md file into its four zones.
 *
 * Returns an object with string fields:
 *   frontmatter  — content between opening and closing ---  (no delimiters)
 *   soulZone     — from first `# ` heading to `## Skills` heading (exclusive)
 *   skillsZone   — from `## Skills` heading to `## Project Context` or end (inclusive heading)
 *   projectCtx   — from `## Project Context` to end (inclusive heading), or '' if absent
 *
 * If the file has no frontmatter delimiters, the entire content is treated as soulZone.
 */
function parseAgentSections(content) {
    // Normalize CRLF to LF so line comparisons work on Windows-edited files
    const lines = content.replace(/\r\n/g, '\n').split('\n');

    let frontmatterEnd = -1; // index of closing ---
    let skillsStart = -1;    // index of ## Skills line
    let projectCtxStart = -1; // index of ## Project Context line

    // Find frontmatter block (must start at line 0)
    if (lines[0] === '---') {
        for (let i = 1; i < lines.length; i++) {
            if (lines[i] === '---') {
                frontmatterEnd = i;
                break;
            }
        }
    }

    // Search for section headings after frontmatter
    const searchStart = frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0;
    for (let i = searchStart; i < lines.length; i++) {
        if (skillsStart === -1 && lines[i].match(/^## Skills\s*$/)) {
            skillsStart = i;
        } else if (skillsStart !== -1 && projectCtxStart === -1 && lines[i].match(/^## Project Context\s*$/)) {
            projectCtxStart = i;
            break;
        }
    }

    // Extract frontmatter (lines between the two --- markers, no delimiters)
    const frontmatter = frontmatterEnd >= 0
        ? lines.slice(1, frontmatterEnd).join('\n')
        : '';

    // Soul zone: from line after closing --- to line before ## Skills (or end)
    const soulStart = frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0;
    const soulEnd = skillsStart >= 0 ? skillsStart : lines.length;
    // Trim leading blank line after frontmatter closing ---
    let soulLines = lines.slice(soulStart, soulEnd);
    // Remove leading blank lines
    while (soulLines.length > 0 && soulLines[0].trim() === '') {
        soulLines.shift();
    }
    // Reassembly spacing: two leading newlines so the merged file has a blank line
    // between the closing `---` and the soul zone's first line (standard markdown
    // convention; was a one-newline bug that ran headings flush against frontmatter).
    const soulZone = soulLines.length > 0 ? '\n\n' + soulLines.join('\n') : '';

    // Skills zone: from ## Skills to ## Project Context or end
    const skillsEnd = projectCtxStart >= 0 ? projectCtxStart : lines.length;
    const skillsZone = skillsStart >= 0
        ? lines.slice(skillsStart, skillsEnd).join('\n')
        : '';

    // Project Context: from ## Project Context to end
    const projectCtx = projectCtxStart >= 0
        ? lines.slice(projectCtxStart).join('\n')
        : '';

    return { frontmatter, soulZone, skillsZone, projectCtx };
}

/**
 * Detect whether an agent file has been personalized.
 * Personalization is indicated by a `nickname:` field in frontmatter.
 */
function isPersonalized(frontmatter) {
    return /^nickname\s*:/m.test(frontmatter);
}

/**
 * Merge frontmatter: take source lines, but preserve `nickname:` and `aliases:` from dest.
 */
function mergeFrontmatter(srcFm, destFm) {
    const srcLines = srcFm.split('\n');
    const destLines = destFm.split('\n');

    // Extract preserved lines from dest
    const nicknameMatch = destLines.find(l => /^nickname\s*:/.test(l));
    const aliasesMatch = destLines.find(l => /^aliases\s*:/.test(l));

    // Build result from src, replacing nickname/aliases lines if dest has them
    const result = srcLines.map(line => {
        if (nicknameMatch && /^nickname\s*:/.test(line)) return nicknameMatch;
        if (aliasesMatch && /^aliases\s*:/.test(line)) return aliasesMatch;
        return line;
    });

    // If src had no nickname line but dest does, insert after `name:` line
    const srcHasNickname = srcLines.some(l => /^nickname\s*:/.test(l));
    if (!srcHasNickname && nicknameMatch) {
        const nameIdx = result.findIndex(l => /^name\s*:/.test(l));
        if (nameIdx >= 0) {
            result.splice(nameIdx + 1, 0, nicknameMatch);
        }
    }

    // If src had no aliases line but dest does, insert after nickname or name
    const srcHasAliases = srcLines.some(l => /^aliases\s*:/.test(l));
    if (!srcHasAliases && aliasesMatch) {
        const afterIdx = result.findIndex(l => /^nickname\s*:/.test(l));
        const insertAfter = afterIdx >= 0 ? afterIdx : result.findIndex(l => /^name\s*:/.test(l));
        if (insertAfter >= 0) {
            result.splice(insertAfter + 1, 0, aliasesMatch);
        }
    }

    return result.join('\n');
}

/**
 * Merge an agent .md file from srcPath into destPath.
 *
 * If destPath doesn't exist: simple copy.
 * If destPath exists:
 *   - Overwrite frontmatter (preserving nickname/aliases if personalized)
 *   - Overwrite Skills Zone with source
 *   - Preserve Soul Zone if personalized; otherwise take source
 *   - Preserve Project Context if it exists in dest; otherwise omit
 *
 * Returns a string describing what was done (used in the merge report).
 */
function mergeAgentFile(srcPath, destPath) {
    if (!fs.existsSync(destPath)) {
        copyFile(srcPath, destPath);
        return 'copied (fresh install)';
    }

    const srcContent = fs.readFileSync(srcPath, 'utf8');
    const destContent = fs.readFileSync(destPath, 'utf8');

    const src = parseAgentSections(srcContent);
    const dest = parseAgentSections(destContent);

    const personalized = isPersonalized(dest.frontmatter);
    const hasProjectCtx = dest.projectCtx.length > 0;

    // Merge frontmatter
    const mergedFrontmatter = personalized
        ? mergeFrontmatter(src.frontmatter, dest.frontmatter)
        : src.frontmatter;

    // Choose soul zone
    const mergedSoulZone = personalized ? dest.soulZone : src.soulZone;

    // Skills zone always from source
    const mergedSkillsZone = src.skillsZone;

    // Project context from dest if it exists
    const mergedProjectCtx = hasProjectCtx ? dest.projectCtx : '';

    // Reassemble
    let result = '---\n' + mergedFrontmatter + '\n---';
    result += mergedSoulZone;
    if (mergedSkillsZone) {
        // Ensure blank line before ## Skills if soul zone doesn't end with one
        if (!result.endsWith('\n\n') && !result.endsWith('\n')) result += '\n';
        if (!result.endsWith('\n\n')) result += '\n';
        result += mergedSkillsZone;
    }
    if (mergedProjectCtx) {
        if (!result.endsWith('\n\n') && !result.endsWith('\n')) result += '\n';
        if (!result.endsWith('\n\n')) result += '\n';
        result += mergedProjectCtx;
    }
    // Ensure trailing newline
    if (!result.endsWith('\n')) result += '\n';

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, result, 'utf8');

    const details = [];
    if (personalized) details.push('preserved Soul Zone');
    if (hasProjectCtx) details.push('preserved Project Context');
    if (!personalized && !hasProjectCtx) return 'merged (no personalization)';
    return `merged (${details.join(', ')})`;
}

// ── Main Command: update ─────────────────────────────────────────────────────

function runUpdate(targetPath, options) {
    options = options || {};
    // Re-read CLAUDE_PROJECT_DIR at call time so tests can redirect the source
    // root by setting the env var. Falls back to the module-level constant for
    // production CLI usage.
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || PROJECT_ROOT;
    // ── Validate target ──────────────────────────────────────────────────────

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

    const stats = { copied: 0, merged: 0, skipped: 0, warned: 0, errors: 0 };
    const warnings = [];

    // ── Process .claude/ directory ──────────────────────────────────────────

    const sourceClaudeDir = path.join(projectRoot, '.claude');
    const claudeFiles = walkDir(sourceClaudeDir);

    for (const srcAbs of claudeFiles) {
        const relToClause = path.relative(sourceClaudeDir, srcAbs);
        const zone = classifyClaudeFile(relToClause);
        const destAbs = path.join(targetClaudeDir, relToClause);

        switch (zone) {
            case 'template': {
                const relNorm = relToClause.replace(/\\/g, '/');
                // Defer version.json — copy it last as sync-complete marker
                if (relNorm === 'version.json') {
                    break;
                }
                if (options.dryRun) {
                    console.log(`  COPY     .claude/${relNorm} → .claude/${relNorm}`);
                    stats.copied++;
                } else {
                    try {
                        copyFile(srcAbs, destAbs);
                        console.log(`  COPY     .claude/${relNorm}`);
                        stats.copied++;
                    } catch (err) {
                        console.error(`  ERROR    .claude/${relNorm} — ${err.message}`);
                        stats.errors++;
                    }
                }
                break;
            }

            case 'project': {
                console.log(`  SKIP     .claude/${relToClause.replace(/\\/g, '/')} (project zone)`);
                stats.skipped++;
                break;
            }

            case 'project-exception': {
                const msg = `.claude/${relToClause.replace(/\\/g, '/')} — Project zone exception`;
                console.log(`  WARN     ${msg}`);
                warnings.push(msg);
                stats.warned++;
                break;
            }

            case 'mixed': {
                if (options.merge) {
                    if (options.dryRun) {
                        const destExists = fs.existsSync(destAbs);
                        console.log(`  MERGE    .claude/${relToClause.replace(/\\/g, '/')} — ${destExists ? 'would merge (section-aware)' : 'would copy (fresh install)'}`);
                        stats.merged++;
                    } else {
                        try {
                            const detail = mergeAgentFile(srcAbs, destAbs);
                            console.log(`  MERGE    .claude/${relToClause.replace(/\\/g, '/')} — ${detail}`);
                            stats.merged++;
                        } catch (err) {
                            console.error(`  ERROR    .claude/${relToClause.replace(/\\/g, '/')} — ${err.message}`);
                            stats.errors++;
                        }
                    }
                } else {
                    const msg = `.claude/${relToClause.replace(/\\/g, '/')} — Mixed zone — use --merge to handle these`;
                    console.log(`  WARN     ${msg}`);
                    warnings.push(msg);
                    stats.warned++;
                }
                break;
            }

            case 'unknown': {
                // Files not matching any zone — skip silently (could be new additions not yet mapped)
                console.log(`  SKIP     .claude/${relToClause.replace(/\\/g, '/')} (not in zone map)`);
                stats.skipped++;
                break;
            }
        }
    }

    // ── Redirect source CLAUDE.md → target .claude/README.md ────────────────
    // The source CLAUDE.md describes the template itself (commands, agents,
    // skills, hooks). Downstream projects keep their own root CLAUDE.md for
    // project-specific Claude Code instructions. Writing as README.md inside
    // .claude/ keeps the template's reference doc co-located with the files
    // it documents.

    {
        const srcAbs = path.join(projectRoot, ROOT_DOC_REDIRECT.src);
        if (fs.existsSync(srcAbs)) {
            const destAbs = path.join(targetPath, ROOT_DOC_REDIRECT.dest);
            if (options.dryRun) {
                console.log(`  COPY     ${ROOT_DOC_REDIRECT.src} → ${ROOT_DOC_REDIRECT.dest} (template docs)`);
                stats.copied++;
            } else {
                try {
                    copyFile(srcAbs, destAbs);
                    console.log(`  COPY     ${ROOT_DOC_REDIRECT.src} → ${ROOT_DOC_REDIRECT.dest} (template docs)`);
                    stats.copied++;
                } catch (err) {
                    console.error(`  ERROR    ${ROOT_DOC_REDIRECT.src} → ${ROOT_DOC_REDIRECT.dest} — ${err.message}`);
                    stats.errors++;
                }
            }
        }
    }

    // ── Process root-level Template files ───────────────────────────────────

    for (const filename of ROOT_TEMPLATE_FILES) {
        const srcAbs = path.join(projectRoot, filename);
        if (!fs.existsSync(srcAbs)) continue;
        const destAbs = path.join(targetPath, filename);
        try {
            copyFile(srcAbs, destAbs);
            console.log(`  COPY     ${filename}`);
            stats.copied++;
        } catch (err) {
            console.error(`  ERROR    ${filename} — ${err.message}`);
            stats.errors++;
        }
    }

    // ── Process .githooks/ (Template zone at repo root) ──────────────────────

    for (const dirName of ROOT_TEMPLATE_DIRS) {
        const srcDir = path.join(projectRoot, dirName);
        if (!fs.existsSync(srcDir)) continue;
        const dirFiles = walkDir(srcDir);
        for (const srcAbs of dirFiles) {
            const relToDir = path.relative(srcDir, srcAbs);
            const destAbs = path.join(targetPath, dirName, relToDir);
            if (options.dryRun) {
                console.log(`  COPY     ${dirName}/${relToDir.replace(/\\/g, '/')} → ${dirName}/${relToDir.replace(/\\/g, '/')}`);
                stats.copied++;
            } else {
                try {
                    copyFile(srcAbs, destAbs);
                    console.log(`  COPY     ${dirName}/${relToDir.replace(/\\/g, '/')}`);
                    stats.copied++;
                } catch (err) {
                    console.error(`  ERROR    ${dirName}/${relToDir.replace(/\\/g, '/')} — ${err.message}`);
                    stats.errors++;
                }
            }
        }
    }

    // ── Copy version.json LAST (sync-complete marker) ───────────────────────

    const versionSrc = path.join(sourceClaudeDir, 'version.json');
    const versionDest = path.join(targetClaudeDir, 'version.json');
    if (fs.existsSync(versionSrc)) {
        if (stats.errors > 0) {
            console.log(`  SKIP     .claude/version.json (errors occurred — incomplete sync)`);
            stats.skipped++;
        } else if (options.dryRun) {
            console.log(`  COPY     .claude/version.json → .claude/version.json (last — sync marker)`);
            stats.copied++;
        } else {
            try {
                copyFile(versionSrc, versionDest);
                console.log(`  COPY     .claude/version.json (last — sync marker)`);
                stats.copied++;
            } catch (err) {
                console.error(`  ERROR    .claude/version.json — ${err.message}`);
                stats.errors++;
            }
        }
    }

    // ── Report ───────────────────────────────────────────────────────────────

    console.log('');
    console.log('─────────────────────────────────────────────');
    console.log(`${options.dryRun ? 'Dry run complete (no files written)' : 'Update complete'}`);
    console.log(`  Copied  : ${stats.copied}`);
    console.log(`  Merged  : ${stats.merged}`);
    console.log(`  Skipped : ${stats.skipped}`);
    console.log(`  Warned  : ${stats.warned}`);
    if (stats.errors > 0) {
        console.log(`  Errors  : ${stats.errors}  ← check output above`);
    }

    if (warnings.length > 0) {
        console.log('');
        console.log('Warnings:');
        for (const w of warnings) {
            console.log(`  ! ${w}`);
        }
    }

    if (stats.errors > 0) process.exit(1);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
    console.log(`
Template Updater — copies Template-zone files from this repo to a target project.

Usage:
  node .claude/core/template-updater.js update <target-path>
  node .claude/core/template-updater.js update <target-path> --merge
  node .claude/core/template-updater.js update <target-path> --dry-run

Commands:
  update <path>   Copy all Template-zone files from source .claude/ to <path>/.claude/
                  Target must exist and contain a .claude/ directory.

Zone behavior:
  Template zone   — Overwritten: commands/, core/, hooks/, skills/*/SKILL.md,
                    skills-optional/, templates/, version.json, guardrail-rules.yaml,
                    .githooks/
  Project zone    — Skipped: settings.json, settings.local.json
  Mixed zone      — Skipped with warning (default): agents/*.md
                    With --merge: section-aware merge that preserves customizations
  Exceptions      — Skipped with warning: skills/brand-guidelines/SKILL.md
  Doc redirect    — Source CLAUDE.md is copied to target's .claude/README.md
                    (template self-documentation). Target's root CLAUDE.md is
                    never touched — projects own their own root Claude Code
                    instructions.

Flags:
  --merge         Handle Mixed-zone files with section-aware merge:
                    agents/*.md  — overwrites frontmatter + Skills section,
                                   preserves Soul Zone (if personalized) and
                                   Project Context (if specialized)

  --dry-run       Preview all actions without writing any files.
                    Shows what would be copied, merged, skipped, or warned.

Notes:
  - Additive only: files in target not present in source are never deleted.
  - Directories in target are created as needed.
`.trim());
}

function main() {
    const [,, command, ...args] = process.argv;

    if (!command || command === '--help' || command === '-h') {
        printHelp();
        process.exit(0);
    }

    const allArgs = process.argv.slice(2);

    const merge = allArgs.includes('--merge');
    const dryRun = allArgs.includes('--dry-run');
    const options = { merge, dryRun };

    switch (command) {
        case 'update': {
            // target path is the first non-flag argument after 'update'
            const targetPath = args.find(a => !a.startsWith('--'));
            if (!targetPath) {
                console.error('Error: update requires a target path');
                console.error('  Usage: node template-updater.js update <target-path> [--merge] [--dry-run]');
                process.exit(1);
            }
            runUpdate(path.resolve(targetPath), options);
            break;
        }

        default:
            console.error(`Unknown command: ${command}`);
            console.error('Run with --help to see available commands.');
            process.exit(1);
    }
}

if (require.main === module) { main(); }

module.exports = {
    globToRegex,
    matchesAnyGlob,
    classifyClaudeFile,
    parseAgentSections,
    isPersonalized,
    mergeFrontmatter,
    mergeAgentFile,
    walkDir,
    copyFile,
    runUpdate,
};
