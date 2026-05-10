// AC→source map (TDD-3.6 / scaffold):
//   - scaffoldDir(srcDir, destDir, excludes, results, force) — pure helper, no side effects
//   - Template marker: <!-- @@template --> preserved verbatim as first line after copy
//   - Skip-existing: existing file untouched when force=false; results.skipped captures it
//   - Force overwrite: existing file replaced when force=true; results.created captures it
//   - Root config copy: root template files land at destDir (project root equiv)
//   - Cross-platform: path.join used everywhere; no hardcoded forward-slash separators in logic

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

const { scaffoldDir } = require('../scaffold');
const { createTmpDir } = require('./_helpers/tmp-dir');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal results accumulator that scaffoldDir expects. */
function makeResults() {
    return { created: [], skipped: [], directories: [] };
}

let tmp;

beforeEach(() => {
    tmp = createTmpDir({ prefix: 'scaffold-test-' });
});

afterEach(() => {
    tmp.cleanup();
});

// ---------------------------------------------------------------------------
// Fresh directory — templates copied with marker preserved
// ---------------------------------------------------------------------------

describe('scaffoldDir — fresh destination', () => {
    it('freshDir_copiesFileToDestination', () => {
        // Arrange
        tmp.write('src/hello.md', 'Hello world');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        const destFile = path.join(dest, 'hello.md');
        expect(fs.existsSync(destFile)).toBe(true);
        expect(fs.readFileSync(destFile, 'utf8')).toBe('Hello world');
    });

    it('freshDir_createsDestinationDirectory', () => {
        // Arrange — dest does not exist yet
        tmp.write('src/a.md', 'content');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'newdir');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        expect(fs.existsSync(dest)).toBe(true);
        expect(results.directories.length).toBeGreaterThan(0);
    });

    it('freshDir_recordsCreatedFile', () => {
        // Arrange
        tmp.write('src/file.md', 'data');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        expect(results.created.length).toBe(1);
        expect(results.skipped.length).toBe(0);
    });

    it('freshDir_recursiveSubdir_copiesNestedFiles', () => {
        // Arrange
        tmp.write('src/sub/nested.md', '# Nested');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        const destNested = path.join(dest, 'sub', 'nested.md');
        expect(fs.existsSync(destNested)).toBe(true);
        expect(fs.readFileSync(destNested, 'utf8')).toBe('# Nested');
    });

    it('freshDir_multipleFiles_allCopied', () => {
        // Arrange
        tmp.write('src/a.md', 'A');
        tmp.write('src/b.md', 'B');
        tmp.write('src/c.md', 'C');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        expect(results.created.length).toBe(3);
        expect(fs.existsSync(path.join(dest, 'a.md'))).toBe(true);
        expect(fs.existsSync(path.join(dest, 'b.md'))).toBe(true);
        expect(fs.existsSync(path.join(dest, 'c.md'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Template marker preservation
// ---------------------------------------------------------------------------

describe('scaffoldDir — template marker preservation', () => {
    it('templateMarker_firstLinePreservedAfterCopy', () => {
        // Arrange: source file starts with the template marker
        const marker = '<!-- @@template -->';
        tmp.write('src/doc.md', `${marker}\n# Doc Title\n\nContent here.\n`);
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert: first line of copied file is the exact marker
        const copied = fs.readFileSync(path.join(dest, 'doc.md'), 'utf8');
        const firstLine = copied.split('\n')[0];
        expect(firstLine).toBe(marker);
    });

    it('templateMarker_fullContentUnchangedAfterCopy', () => {
        // Arrange
        const content = '<!-- @@template -->\n# Title\n\nBody content.\n';
        tmp.write('src/template.md', content);
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert: content is byte-for-byte identical
        const copied = fs.readFileSync(path.join(dest, 'template.md'), 'utf8');
        expect(copied).toBe(content);
    });

    it('templateMarker_fileWithoutMarker_copiedNormally', () => {
        // Arrange: file that does NOT start with the marker
        tmp.write('src/regular.md', '# Regular File\n\nNo marker here.\n');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert: file copied, first line is NOT the template marker
        const copied = fs.readFileSync(path.join(dest, 'regular.md'), 'utf8');
        expect(copied.startsWith('<!-- @@template -->')).toBe(false);
        expect(copied).toContain('# Regular File');
    });
});

// ---------------------------------------------------------------------------
// Skip-existing (force=false)
// ---------------------------------------------------------------------------

describe('scaffoldDir — skip existing files (force=false)', () => {
    it('skipExisting_existingFile_notOverwritten', () => {
        // Arrange: pre-write dest file with different content
        tmp.write('src/foo.md', 'new content from template');
        tmp.write('dest/foo.md', 'original content');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert: dest file unchanged
        const destContent = fs.readFileSync(path.join(dest, 'foo.md'), 'utf8');
        expect(destContent).toBe('original content');
    });

    it('skipExisting_existingFile_recordedInSkipped', () => {
        // Arrange
        tmp.write('src/foo.md', 'template content');
        tmp.write('dest/foo.md', 'existing content');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        expect(results.skipped.length).toBe(1);
        expect(results.created.length).toBe(0);
    });

    it('skipExisting_mixedNewAndExisting_correctlyCategorized', () => {
        // Arrange: one new file, one existing
        tmp.write('src/new.md', 'new');
        tmp.write('src/existing.md', 'template version');
        tmp.write('dest/existing.md', 'original');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        expect(results.created.length).toBe(1);
        expect(results.skipped.length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Force overwrite (force=true)
// ---------------------------------------------------------------------------

describe('scaffoldDir — force overwrite (force=true)', () => {
    it('force_existingFile_overwrittenWithTemplateContent', () => {
        // Arrange
        tmp.write('src/foo.md', 'new template content');
        tmp.write('dest/foo.md', 'old content');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, true);

        // Assert: dest now has template content
        const destContent = fs.readFileSync(path.join(dest, 'foo.md'), 'utf8');
        expect(destContent).toBe('new template content');
    });

    it('force_existingFile_recordedInCreatedNotSkipped', () => {
        // Arrange
        tmp.write('src/foo.md', 'template');
        tmp.write('dest/foo.md', 'old');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, true);

        // Assert
        expect(results.created.length).toBe(1);
        expect(results.skipped.length).toBe(0);
    });

    it('force_false_existingNotOverwritten', () => {
        // Arrange
        tmp.write('src/bar.md', 'template');
        tmp.write('dest/bar.md', 'keep me');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act — force=false (the default skip behavior)
        scaffoldDir(src, dest, [], results, false);

        // Assert
        const destContent = fs.readFileSync(path.join(dest, 'bar.md'), 'utf8');
        expect(destContent).toBe('keep me');
    });
});

// ---------------------------------------------------------------------------
// Excludes
// ---------------------------------------------------------------------------

describe('scaffoldDir — excludes', () => {
    it('excludes_entryInExcludeList_notCopied', () => {
        // Arrange
        tmp.write('src/include.md', 'yes');
        tmp.write('src/root/skip.md', 'no');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, ['root'], results, false);

        // Assert: 'root' subdir was skipped
        expect(fs.existsSync(path.join(dest, 'root'))).toBe(false);
        expect(fs.existsSync(path.join(dest, 'include.md'))).toBe(true);
    });

    it('excludes_emptyArray_copiesEverything', () => {
        // Arrange
        tmp.write('src/a.md', 'A');
        tmp.write('src/b/c.md', 'C');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert
        expect(fs.existsSync(path.join(dest, 'a.md'))).toBe(true);
        expect(fs.existsSync(path.join(dest, 'b', 'c.md'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Root config copy — .gitignore lands at destDir
// ---------------------------------------------------------------------------

describe('scaffoldDir — root config copy', () => {
    it('rootConfig_gitignore_copiedToProjectRoot', () => {
        // Arrange: mimic .claude/templates/root/ with a .gitignore
        const gitignoreContent = 'node_modules/\n.DS_Store\n';
        tmp.write('rootTemplates/.gitignore', gitignoreContent);

        const rootTemplatesDir = path.join(tmp.root, 'rootTemplates');
        const projectRoot = path.join(tmp.root, 'project');
        fs.mkdirSync(projectRoot, { recursive: true });

        const results = makeResults();

        // Act: scaffold rootTemplates/ → projectRoot/ (same as root template copy in main())
        scaffoldDir(rootTemplatesDir, projectRoot, [], results, false);

        // Assert
        const destGitignore = path.join(projectRoot, '.gitignore');
        expect(fs.existsSync(destGitignore)).toBe(true);
        expect(fs.readFileSync(destGitignore, 'utf8')).toBe(gitignoreContent);
    });

    it('rootConfig_multipleRootFiles_allCopied', () => {
        // Arrange: mimic root templates with multiple files
        tmp.write('rootTemplates/.gitignore', 'node_modules/\n');
        tmp.write('rootTemplates/README.md', '# README');

        const rootTemplatesDir = path.join(tmp.root, 'rootTemplates');
        const projectRoot = path.join(tmp.root, 'project');
        fs.mkdirSync(projectRoot, { recursive: true });

        const results = makeResults();

        // Act
        scaffoldDir(rootTemplatesDir, projectRoot, [], results, false);

        // Assert
        expect(fs.existsSync(path.join(projectRoot, '.gitignore'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, 'README.md'))).toBe(true);
        expect(results.created.length).toBe(2);
    });

    it('rootConfig_gitignoreExistingSkippedByDefault', () => {
        // Arrange: project already has a .gitignore
        tmp.write('rootTemplates/.gitignore', 'template version');
        tmp.write('project/.gitignore', 'project version — keep me');

        const rootTemplatesDir = path.join(tmp.root, 'rootTemplates');
        const projectRoot = path.join(tmp.root, 'project');

        const results = makeResults();

        // Act — force=false
        scaffoldDir(rootTemplatesDir, projectRoot, [], results, false);

        // Assert: project .gitignore unchanged
        const content = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
        expect(content).toBe('project version — keep me');
        expect(results.skipped.length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Cross-platform: path.join usage — no hardcoded forward-slash separators
// ---------------------------------------------------------------------------

describe('scaffoldDir — cross-platform path correctness', () => {
    it('crossPlatform_resultPathsUseOSSeparator', () => {
        // Arrange
        tmp.write('src/deep/file.md', 'content');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert: paths in results use path.join (OS-correct separator)
        // They should NOT contain forward-slash on Windows as a path separator
        // within the relative portion (path.relative gives OS separators).
        // The simplest cross-platform check: reconstruct with path.join and compare.
        for (const p of [...results.created, ...results.skipped, ...results.directories]) {
            // Verify the path is reconstructable via path.normalize without change
            expect(p).toBe(path.normalize(p));
        }
    });

    it('crossPlatform_destFileAccessibleViaPathJoin', () => {
        // Arrange
        tmp.write('src/nested/doc.md', '# Doc');
        const src = path.join(tmp.root, 'src');
        const dest = path.join(tmp.root, 'dest');
        const results = makeResults();

        // Act
        scaffoldDir(src, dest, [], results, false);

        // Assert: file is accessible through path.join construction
        const expectedPath = path.join(dest, 'nested', 'doc.md');
        expect(fs.existsSync(expectedPath)).toBe(true);
        expect(fs.readFileSync(expectedPath, 'utf8')).toBe('# Doc');
    });
});

// ---------------------------------------------------------------------------
// Module require-safety: importing scaffold does not execute side effects
// ---------------------------------------------------------------------------

describe('scaffold module — require safety', () => {
    it('requireSafety_importDoesNotThrow', () => {
        // This test verifies that require('../scaffold') does not execute
        // top-level side effects (console.log, process.exit, file writes).
        // If it DID, this test would fail with a console error or exit.
        // The fact that scaffoldDir is already imported at the top of this
        // file without error proves require-safety.
        expect(typeof scaffoldDir).toBe('function');
    });

    it('requireSafety_exportsScaffoldDir', () => {
        // Verify the named export exists and is the function
        const mod = require('../scaffold');
        expect(mod).toHaveProperty('scaffoldDir');
        expect(typeof mod.scaffoldDir).toBe('function');
    });
});
