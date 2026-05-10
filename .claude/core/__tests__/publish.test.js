// AC→source map (PR-3.1 / publish.js):
//   - loadManifest reads .claude/publish-manifest.json, throws actionable error if missing
//   - isAllowed returns true iff path matches include AND does not match default+manifest exclude
//   - DEFAULT_EXCLUDES baseline keeps working docs (handoff, .output, todo, research, app, design, timeline) out
//   - walkPublishableFiles skips .git and node_modules at walk-time (perf)
//   - runPublish creates target .claude/ in bootstrap mode (unlike template-updater which errors)
//   - --dry-run writes no files

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const publish = require('../publish');
const { createTmpDir } = require('./_helpers/tmp-dir');

const {
  runPublish,
  loadManifest,
  isAllowed,
  walkPublishableFiles,
  DEFAULT_EXCLUDES,
} = publish;

let tmp;

beforeEach(() => {
  tmp = createTmpDir();
});

afterEach(() => {
  tmp.cleanup();
});

// Helpers to silence + capture console output
function silentConsole() {
  const logs = [];
  const errs = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.join(' ')); });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => { errs.push(a.join(' ')); });
  return {
    logs,
    errs,
    restore() { logSpy.mockRestore(); errSpy.mockRestore(); },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT_EXCLUDES — baseline safety list
// ─────────────────────────────────────────────────────────────────────────────

describe('DEFAULT_EXCLUDES', () => {
  it('defaultExcludes_isArray', () => {
    expect(Array.isArray(DEFAULT_EXCLUDES)).toBe(true);
    expect(DEFAULT_EXCLUDES.length).toBeGreaterThan(0);
  });

  it('defaultExcludes_containsHandoff', () => {
    expect(DEFAULT_EXCLUDES).toContain('docs/__handoff.md');
  });

  it('defaultExcludes_containsOutputGlob', () => {
    expect(DEFAULT_EXCLUDES).toContain('docs/.output/**');
  });

  it('defaultExcludes_containsTodoGlob', () => {
    expect(DEFAULT_EXCLUDES).toContain('docs/todo/**');
  });

  it('defaultExcludes_containsSettingsLocal', () => {
    expect(DEFAULT_EXCLUDES).toContain('.claude/settings.local.json');
  });

  it('defaultExcludes_containsAgentMemoryGlob', () => {
    // agent-memory/ is per-project runtime data — never ships across projects
    expect(DEFAULT_EXCLUDES).toContain('.claude/agent-memory/**');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadManifest
// ─────────────────────────────────────────────────────────────────────────────

describe('loadManifest', () => {
  it('loadManifest_returnsParsedJson_whenPresent', () => {
    const root = tmp.mkdir('repo');
    tmp.write('repo/.claude/publish-manifest.json', JSON.stringify({
      version: '1',
      include: ['README.md', 'docs/**'],
    }));

    const result = loadManifest(root);
    expect(result.version).toBe('1');
    expect(result.include).toEqual(['README.md', 'docs/**']);
  });

  it('loadManifest_throwsActionableError_whenMissing', () => {
    const root = tmp.mkdir('repo');
    tmp.mkdir('repo/.claude');

    expect(() => loadManifest(root)).toThrow(/publish-manifest\.json/);
    // Should mention PR-3.2 or the manifest's purpose to be actionable
    expect(() => loadManifest(root)).toThrow(/PR-3\.2|allowlist|manifest/i);
  });

  it('loadManifest_throwsOnMalformedJson', () => {
    const root = tmp.mkdir('repo');
    tmp.write('repo/.claude/publish-manifest.json', '{ not valid json');

    expect(() => loadManifest(root)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isAllowed
// ─────────────────────────────────────────────────────────────────────────────

describe('isAllowed', () => {
  const manifest = {
    version: '1',
    include: ['README.md', 'docs/**', '.claude/**'],
    exclude: ['docs/private.md'],
  };

  it('isAllowed_returnsTrue_whenInIncludeAndNoExclude', () => {
    expect(isAllowed('README.md', manifest)).toBe(true);
    expect(isAllowed('docs/getting-started.md', manifest)).toBe(true);
    expect(isAllowed('.claude/core/gate.js', manifest)).toBe(true);
  });

  it('isAllowed_returnsFalse_whenNotInInclude', () => {
    expect(isAllowed('random-file.txt', manifest)).toBe(false);
    expect(isAllowed('scripts/deploy.sh', manifest)).toBe(false);
  });

  it('isAllowed_returnsFalse_whenInManifestExclude', () => {
    expect(isAllowed('docs/private.md', manifest)).toBe(false);
  });

  it('isAllowed_returnsFalse_whenInDefaultExcludes_handoff', () => {
    // docs/** include matches, but DEFAULT_EXCLUDES has docs/__handoff.md
    expect(isAllowed('docs/__handoff.md', manifest)).toBe(false);
  });

  it('isAllowed_returnsFalse_whenInDefaultExcludes_outputGlob', () => {
    expect(isAllowed('docs/.output/plans/foo.md', manifest)).toBe(false);
    expect(isAllowed('docs/.output/memories/bar.json', manifest)).toBe(false);
  });

  it('isAllowed_returnsFalse_whenInDefaultExcludes_todoGlob', () => {
    expect(isAllowed('docs/todo/_backlog.md', manifest)).toBe(false);
    expect(isAllowed('docs/todo/TODO_epic01.md', manifest)).toBe(false);
  });

  it('isAllowed_returnsFalse_whenInDefaultExcludes_settingsLocal', () => {
    expect(isAllowed('.claude/settings.local.json', manifest)).toBe(false);
  });

  it('isAllowed_returnsFalse_whenInDefaultExcludes_agentMemory', () => {
    // .claude/** include matches, but agent-memory is a hardcoded DEFAULT_EXCLUDE
    expect(isAllowed('.claude/agent-memory/general-purpose/MEMORY.md', manifest)).toBe(false);
    expect(isAllowed('.claude/agent-memory/doc-writer/feedback-X.md', manifest)).toBe(false);
  });

  it('isAllowed_normalizesBackslashPaths', () => {
    // Windows paths with backslashes should classify correctly
    expect(isAllowed('docs\\getting-started.md', manifest)).toBe(true);
    expect(isAllowed('docs\\__handoff.md', manifest)).toBe(false);
  });

  it('isAllowed_handlesManifestWithoutExcludeField', () => {
    const minimal = { version: '1', include: ['**/*'] };
    expect(isAllowed('README.md', minimal)).toBe(true);
    // DEFAULT_EXCLUDES still applies
    expect(isAllowed('docs/__handoff.md', minimal)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// walkPublishableFiles — perf-optimized walker
// ─────────────────────────────────────────────────────────────────────────────

describe('walkPublishableFiles', () => {
  it('walkPublishableFiles_skipsGitDir', () => {
    const root = tmp.mkdir('repo');
    tmp.write('repo/.git/HEAD', 'ref: refs/heads/main');
    tmp.write('repo/.git/config', '[core]');
    tmp.write('repo/README.md', '# hi');

    const files = walkPublishableFiles(root);
    const rels = files.map(f => path.relative(root, f).replace(/\\/g, '/'));

    expect(rels).toContain('README.md');
    expect(rels.some(r => r.startsWith('.git/'))).toBe(false);
  });

  it('walkPublishableFiles_skipsNodeModules', () => {
    const root = tmp.mkdir('repo');
    tmp.write('repo/node_modules/foo/index.js', '// dep');
    tmp.write('repo/package.json', '{}');

    const files = walkPublishableFiles(root);
    const rels = files.map(f => path.relative(root, f).replace(/\\/g, '/'));

    expect(rels).toContain('package.json');
    expect(rels.some(r => r.startsWith('node_modules/'))).toBe(false);
  });

  it('walkPublishableFiles_skipsDocsOutput', () => {
    // perf: docs/.output/ is always excluded; don't waste walk time on it
    const root = tmp.mkdir('repo');
    tmp.write('repo/docs/.output/plans/foo.md', '# plan');
    tmp.write('repo/docs/getting-started.md', '# start');

    const files = walkPublishableFiles(root);
    const rels = files.map(f => path.relative(root, f).replace(/\\/g, '/'));

    expect(rels).toContain('docs/getting-started.md');
    expect(rels.some(r => r.startsWith('docs/.output/'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runPublish — end-to-end
// ─────────────────────────────────────────────────────────────────────────────

describe('runPublish', () => {
  let originalProjectDir;

  beforeEach(() => {
    originalProjectDir = process.env.CLAUDE_PROJECT_DIR;
  });

  afterEach(() => {
    if (originalProjectDir === undefined) {
      delete process.env.CLAUDE_PROJECT_DIR;
    } else {
      process.env.CLAUDE_PROJECT_DIR = originalProjectDir;
    }
  });

  function seedMinimalSource() {
    tmp.mkdir('src');
    tmp.write('src/.claude/publish-manifest.json', JSON.stringify({
      version: '1',
      include: ['README.md', 'CLAUDE.md', 'docs/**', '.claude/core/**'],
    }));
    tmp.write('src/README.md', '# Template');
    tmp.write('src/CLAUDE.md', '# project instructions');
    tmp.write('src/docs/getting-started.md', '# Getting Started');
    tmp.write('src/docs/__handoff.md', '# SHOULD NOT SHIP');
    tmp.write('src/docs/todo/_backlog.md', '# SHOULD NOT SHIP');
    tmp.write('src/docs/.output/plans/x.md', '# SHOULD NOT SHIP');
    tmp.write('src/.claude/core/gate.js', '// gate');
    tmp.write('src/.claude/settings.local.json', '{}'); // SHOULD NOT SHIP (default exclude)
    process.env.CLAUDE_PROJECT_DIR = path.join(tmp.root, 'src');
    return path.join(tmp.root, 'src');
  }

  it('runPublish_bootstrap_createsTargetClaudeDir', () => {
    seedMinimalSource();
    const targetPath = path.join(tmp.root, 'target');
    // NOTE: target does NOT exist — bootstrap mode

    const spy = silentConsole();
    try {
      runPublish(targetPath, {});
    } finally { spy.restore(); }

    expect(fs.existsSync(path.join(targetPath, '.claude'))).toBe(true);
  });

  it('runPublish_copiesAllowedFiles', () => {
    seedMinimalSource();
    const targetPath = path.join(tmp.root, 'target');

    const spy = silentConsole();
    try {
      runPublish(targetPath, {});
    } finally { spy.restore(); }

    expect(fs.existsSync(path.join(targetPath, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetPath, 'CLAUDE.md'))).toBe(true);
    // PATH_REMAPS rewrites docs/getting-started.md → .claude/.agents.docs/getting-started.md
    expect(fs.existsSync(path.join(targetPath, '.claude', '.agents.docs', 'getting-started.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetPath, 'docs', 'getting-started.md'))).toBe(false);
    expect(fs.existsSync(path.join(targetPath, '.claude', 'core', 'gate.js'))).toBe(true);
  });

  it('runPublish_skipsExcludedFiles', () => {
    seedMinimalSource();
    const targetPath = path.join(tmp.root, 'target');

    const spy = silentConsole();
    try {
      runPublish(targetPath, {});
    } finally { spy.restore(); }

    // Default-excluded files must NOT ship even though include patterns match
    expect(fs.existsSync(path.join(targetPath, 'docs', '__handoff.md'))).toBe(false);
    expect(fs.existsSync(path.join(targetPath, 'docs', 'todo', '_backlog.md'))).toBe(false);
    expect(fs.existsSync(path.join(targetPath, 'docs', '.output', 'plans', 'x.md'))).toBe(false);
    expect(fs.existsSync(path.join(targetPath, '.claude', 'settings.local.json'))).toBe(false);
  });

  it('defaultExcludes_blocksCoverageAndTestResults', () => {
    // Per-machine artifacts should never ship to adopters.
    expect(DEFAULT_EXCLUDES).toContain('**/coverage/**');
    expect(DEFAULT_EXCLUDES).toContain('**/test-results/**');
  });

  it('defaultExcludes_doesNotBlockTestSources', () => {
    // Test sources DO ship — adopters need them to run `npm test`.
    expect(DEFAULT_EXCLUDES).not.toContain('.claude/core/__tests__/**');
    expect(DEFAULT_EXCLUDES).not.toContain('.claude/hooks/__tests__/**');
    expect(DEFAULT_EXCLUDES).not.toContain('**/_helpers/**');
  });

  it('runPublish_dryRun_writesNoFiles', () => {
    seedMinimalSource();
    const targetPath = path.join(tmp.root, 'target');

    const spy = silentConsole();
    try {
      runPublish(targetPath, { dryRun: true });
    } finally { spy.restore(); }

    // Not even README should be written
    expect(fs.existsSync(path.join(targetPath, 'README.md'))).toBe(false);
  });

  it('runPublish_dryRun_logsDryRunHeader', () => {
    seedMinimalSource();
    const targetPath = path.join(tmp.root, 'target');

    const spy = silentConsole();
    try {
      runPublish(targetPath, { dryRun: true });
    } finally { spy.restore(); }

    const all = spy.logs.join('\n');
    expect(all).toMatch(/dry run/i);
  });

  it('runPublish_throwsWhenManifestMissing', () => {
    // No manifest written to src/
    tmp.mkdir('src');
    tmp.mkdir('src/.claude');
    tmp.write('src/README.md', '# T');
    process.env.CLAUDE_PROJECT_DIR = path.join(tmp.root, 'src');

    const targetPath = path.join(tmp.root, 'target');

    const spy = silentConsole();
    try {
      expect(() => runPublish(targetPath, {})).toThrow(/publish-manifest\.json/);
    } finally { spy.restore(); }
  });

  it('runPublish_returnsStatsObject', () => {
    seedMinimalSource();
    const targetPath = path.join(tmp.root, 'target');

    const spy = silentConsole();
    let stats;
    try {
      stats = runPublish(targetPath, {});
    } finally { spy.restore(); }

    expect(stats).toBeDefined();
    expect(typeof stats.copied).toBe('number');
    expect(typeof stats.skipped).toBe('number');
    expect(stats.copied).toBeGreaterThan(0);
    expect(stats.skipped).toBeGreaterThan(0);
  });
});
