#!/usr/bin/env node

/**
 * Project Scaffold
 *
 * Copies templates from .claude/templates/ into the project's docs/ directory.
 * Creates the docs/ structure if it doesn't exist. Skips files that already
 * exist (safe to re-run).
 *
 * Usage: node .claude/core/scaffold.js [--force]
 *   --force  Overwrite existing files (default: skip)
 *
 * Output structure:
 *   docs/
 *   ├── _project-brief.md
 *   ├── _project-requirements.md
 *   ├── _project-architecture.md
 *   ├── _project-context.md
 *   ├── CLAUDE.md                  (doc structure guide)
 *   ├── app/                       (module docs — mirrors codebase)
 *   ├── design/
 *   │   ├── _project-design.md
 *   │   ├── _wireframes.md
 *   │   ├── _design.light.md
 *   │   ├── _design.dark.md
 *   │   └── _mock-layout.html
 *   ├── todo/
 *   └── .output/
 *       └── work/
 *   .playwright/
 *   └── cli.config.json
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ||
    path.resolve(__dirname, '..', '..');

// ── templates/root/ rename + merge map ──────────────────────────────────────
//
// Files inside .claude/templates/root/ are intended to land at the project
// root. Some target names (notably `.gitignore`) cannot be stored at the
// template path under the same name — git would interpret a file literally
// named `.gitignore` AT the template path as an active gitignore for the
// directory containing it, which then ignores sibling templates like
// .playwright/. We store such files under a safe name in templates/root/
// and rename them at scaffold time.
//
// `merge: true` enables managed-block merging — instead of skip-if-exists
// (the default), the template is appended into a fenced block at the end
// of any existing target file, and updated in place on subsequent runs.
// This preserves adopter-custom gitignore rules across re-scaffolds.

const TEMPLATE_RENAMES = {
    gitignore: { dest: '.gitignore', merge: true },
};

const MANAGED_START = '# === Domdhi.Agents managed block — do not edit between markers ===';
const MANAGED_END = '# === End Domdhi.Agents managed block ===';

/**
 * Apply a managed-block merge to a target file.
 *
 * Behavior:
 *   - target missing                       → write `${markers}\n${content}\n${end}\n`
 *   - target exists, no markers            → append a new managed block at end
 *   - target exists, markers found         → replace the block content in place
 *   - target exists, markers, no change    → no-op
 *
 * @param {string} targetPath
 * @param {string} templateContent — raw contents of the template source file
 * @returns {'created' | 'appended' | 'replaced' | 'unchanged'}
 */
function applyManagedBlock(targetPath, templateContent) {
    const trimmed = templateContent.replace(/\s+$/u, '');
    const block = `${MANAGED_START}\n${trimmed}\n${MANAGED_END}`;

    if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, block + '\n');
        return 'created';
    }

    const existing = fs.readFileSync(targetPath, 'utf8');
    const startIdx = existing.indexOf(MANAGED_START);
    const endIdx = existing.indexOf(MANAGED_END);

    if (startIdx === -1) {
        const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
        const gap = existing.length === 0 ? '' : (existing.endsWith('\n\n') ? '' : '\n');
        fs.writeFileSync(targetPath, existing + sep + gap + block + '\n');
        return 'appended';
    }

    if (endIdx === -1 || endIdx < startIdx) {
        throw new Error(
            `Corrupt managed block in ${targetPath}: start marker found but no valid end marker.`
        );
    }

    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + MANAGED_END.length);
    const newContent = before + block + after;

    if (newContent === existing) return 'unchanged';
    fs.writeFileSync(targetPath, newContent);
    return 'replaced';
}

/**
 * Recursively copy a source directory to a destination, skipping excludes.
 *
 * @param {string} srcDir     - Absolute path to source directory
 * @param {string} destDir    - Absolute path to destination directory
 * @param {string[]} [excludes] - Entry names to skip at the top level
 * @param {{ created: string[], skipped: string[], directories: string[] }} results - Accumulator
 * @param {boolean} [force]   - Overwrite existing files when true
 * @param {string} [projectDir] - Project root used to compute relative paths in results
 */
function scaffoldDir(srcDir, destDir, excludes, results, force, projectDir) {
    const reportRoot = projectDir || DEFAULT_PROJECT_DIR;

    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        results.directories.push(path.relative(reportRoot, destDir));
    }

    const entries = fs.readdirSync(srcDir, { withFileTypes: true });

    for (const entry of entries) {
        if (excludes && excludes.includes(entry.name)) continue;

        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);

        if (entry.isDirectory()) {
            // Recursive call: no top-level excludes, pass results + force through
            scaffoldDir(srcPath, destPath, [], results, force, reportRoot);
        } else {
            if (fs.existsSync(destPath) && !force) {
                results.skipped.push(path.relative(reportRoot, destPath));
            } else {
                fs.copyFileSync(srcPath, destPath);
                results.created.push(path.relative(reportRoot, destPath));
            }
        }
    }
}

/**
 * Run the scaffold against an arbitrary project directory.
 *
 * @param {string} [projectDir] - Target project root (defaults to CLAUDE_PROJECT_DIR or this repo)
 * @param {{ force?: boolean, silent?: boolean }} [opts]
 * @returns {{ created: string[], skipped: string[], directories: string[] }}
 */
function runScaffold(projectDir, opts) {
    const target = projectDir || DEFAULT_PROJECT_DIR;
    const options = opts || {};
    const force = !!options.force;
    const silent = !!options.silent;

    const templatesDir = path.join(target, '.claude', 'templates');
    const docsDir = path.join(target, 'docs');

    if (!fs.existsSync(templatesDir)) {
        if (!silent) {
            console.error('ERROR: Templates directory not found at .claude/templates/');
            console.error('Ensure the .claude/ directory was copied correctly.');
        }
        const err = new Error(`Templates directory not found: ${templatesDir}`);
        err.code = 'TEMPLATES_MISSING';
        throw err;
    }

    const results = { created: [], skipped: [], directories: [] };

    // Scaffold docs/ from templates (exclude root/ — those go to project root)
    scaffoldDir(templatesDir, docsDir, ['root'], results, force, target);

    // Create additional directories that don't have templates
    const extraDirs = [
        'docs/app',
        'docs/.output',
        'docs/.output/work',
        'docs/.output/reviews',
        'docs/.output/research',
        'docs/.output/investigations',
        'docs/.output/telemetry',
    ];
    for (const dir of extraDirs) {
        const fullPath = path.join(target, dir);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
            results.directories.push(dir);
        }
    }

    // Copy root-level config files from .claude/templates/root/.
    // Files in TEMPLATE_RENAMES get renamed at copy time and (if merge:true)
    // are merged into the target via a fenced managed block instead of being
    // skipped when the target already has user content.
    const rootTemplatesDir = path.join(templatesDir, 'root');
    if (fs.existsSync(rootTemplatesDir)) {
        const renameKeys = Object.keys(TEMPLATE_RENAMES);
        // Standard recursive copy first, but skip the renamed entries — those
        // are handled below with merge-aware logic.
        scaffoldDir(rootTemplatesDir, target, renameKeys, results, force, target);

        for (const [srcName, rule] of Object.entries(TEMPLATE_RENAMES)) {
            const srcPath = path.join(rootTemplatesDir, srcName);
            if (!fs.existsSync(srcPath)) continue;

            const destPath = path.join(target, rule.dest);
            const relDest = path.relative(target, destPath);

            if (rule.merge) {
                const content = fs.readFileSync(srcPath, 'utf8');
                const action = applyManagedBlock(destPath, content);
                if (action === 'unchanged') results.skipped.push(relDest);
                else results.created.push(`${relDest} (${action})`);
            } else if (fs.existsSync(destPath) && !force) {
                results.skipped.push(relDest);
            } else {
                fs.copyFileSync(srcPath, destPath);
                results.created.push(relDest);
            }
        }
    }

    if (!silent) {
        console.log('========================================');
        console.log('  Project Scaffold');
        console.log('========================================');

        if (results.directories.length > 0) {
            console.log(`\nDirectories created (${results.directories.length}):`);
            results.directories.forEach(d => console.log(`  + ${d}/`));
        }

        if (results.created.length > 0) {
            console.log(`\nFiles created (${results.created.length}):`);
            results.created.forEach(f => console.log(`  + ${f}`));
        }

        if (results.skipped.length > 0) {
            console.log(`\nFiles skipped — already exist (${results.skipped.length}):`);
            results.skipped.forEach(f => console.log(`  ~ ${f}`));
        }

        if (results.created.length === 0 && results.directories.length === 0) {
            console.log('\nAll files already exist. Nothing to do.');
            console.log('Use --force to overwrite existing files.');
        }

        console.log('\n========================================');
        console.log(`Done. ${results.created.length} created, ${results.skipped.length} skipped.`);
        console.log('========================================');
    }

    return results;
}

/**
 * CLI entry point: scaffold docs/ from templates and configure root files
 * for the default project (CLAUDE_PROJECT_DIR or this repo root).
 */
function main() {
    const force = process.argv.includes('--force');
    runScaffold(DEFAULT_PROJECT_DIR, { force });
}

if (require.main === module) {
    main();
}

module.exports = {
    scaffoldDir,
    runScaffold,
    applyManagedBlock,
    TEMPLATE_RENAMES,
    MANAGED_START,
    MANAGED_END,
};
