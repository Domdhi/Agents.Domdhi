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
 *   .githooks/
 *   └── pre-commit          (secret scanner)
 */

const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR ||
    path.resolve(__dirname, '..', '..');

const templatesDir = path.join(projectDir, '.claude', 'templates');
const docsDir = path.join(projectDir, 'docs');

/**
 * Recursively copy a source directory to a destination, skipping excludes.
 *
 * @param {string} srcDir     - Absolute path to source directory
 * @param {string} destDir    - Absolute path to destination directory
 * @param {string[]} [excludes] - Entry names to skip at the top level
 * @param {{ created: string[], skipped: string[], directories: string[] }} results - Accumulator
 * @param {boolean} [force]   - Overwrite existing files when true
 */
function scaffoldDir(srcDir, destDir, excludes, results, force) {
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        results.directories.push(path.relative(projectDir, destDir));
    }

    const entries = fs.readdirSync(srcDir, { withFileTypes: true });

    for (const entry of entries) {
        if (excludes && excludes.includes(entry.name)) continue;

        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);

        if (entry.isDirectory()) {
            // Recursive call: no top-level excludes, pass results + force through
            scaffoldDir(srcPath, destPath, [], results, force);
        } else {
            if (fs.existsSync(destPath) && !force) {
                results.skipped.push(path.relative(projectDir, destPath));
            } else {
                fs.copyFileSync(srcPath, destPath);
                results.created.push(path.relative(projectDir, destPath));
            }
        }
    }
}

/**
 * Main entry point: scaffold docs/ from templates and configure root files.
 */
function main() {
    const force = process.argv.includes('--force');

    if (!fs.existsSync(templatesDir)) {
        console.error('ERROR: Templates directory not found at .claude/templates/');
        console.error('Ensure the .claude/ directory was copied correctly.');
        process.exit(1);
    }

    const results = { created: [], skipped: [], directories: [] };

    // Scaffold docs/ from templates (exclude root/ — those go to project root)
    scaffoldDir(templatesDir, docsDir, ['root'], results, force);

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
        const fullPath = path.join(projectDir, dir);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
            results.directories.push(dir);
        }
    }

    // Copy root-level config files from .claude/templates/root/
    const rootTemplatesDir = path.join(templatesDir, 'root');
    if (fs.existsSync(rootTemplatesDir)) {
        scaffoldDir(rootTemplatesDir, projectDir, [], results, force);
    }

    // Configure git hooks path if .githooks/ was scaffolded
    const githooksDir = path.join(projectDir, '.githooks');
    if (fs.existsSync(githooksDir)) {
        try {
            const { execFileSync } = require('child_process');
            execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: projectDir });
            // Make pre-commit executable (no-op on Windows, needed on Unix)
            const precommit = path.join(githooksDir, 'pre-commit');
            if (fs.existsSync(precommit)) {
                try { fs.chmodSync(precommit, 0o755); } catch { /* Windows ignores chmod */ }
            }
            results.directories.push('.githooks (git hooks path configured)');
        } catch {
            // Not a git repo yet — hooks will work once git init runs
        }
    }

    // Report
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

if (require.main === module) {
    main();
}

module.exports = { scaffoldDir };
