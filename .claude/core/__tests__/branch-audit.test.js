// AC→source: branch-audit.js — safe pre-prune audit of branches + worktrees.
// Covers the pure classification/verdict core (path classification, code-file
// signature, branch + worktree verdict derivation). The git-shelling layer is
// integration-only and exercised by running the tool.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classifyPath, branchVerdictFromCode, worktreeVerdictFromDirty, codeFileSignature } = require('../branch-audit');

describe('classifyPath', () => {
  it('flags src/tests/tools as code (scrutinize)', () => {
    expect(classifyPath('src/app/main.js')).toBe('code');
    expect(classifyPath('tests/foo.test.js')).toBe('code');
    expect(classifyPath('tools/build.js')).toBe('code');
  });
  it('flags regenerable working state as disposable', () => {
    expect(classifyPath('docs/.output/plans/x.md')).toBe('disposable');
    expect(classifyPath('.claude/commands/do.md')).toBe('disposable');
    expect(classifyPath('docs/.output/.commit-msg')).toBe('disposable');
    expect(classifyPath('docs/.output/.pr-body')).toBe('disposable');
    expect(classifyPath('node_modules/x/index.js')).toBe('disposable');
  });
  it('treats unknown paths as other (review)', () => {
    expect(classifyPath('design-export/logo.svg')).toBe('other');
    expect(classifyPath('README.md')).toBe('other');
  });
});

describe('branchVerdictFromCode', () => {
  it('REVIEW when a genuinely-new code file is present', () => {
    expect(branchVerdictFromCode(['modified', 'NEW'])).toBe('REVIEW');
  });
  it('MERGED~ when only superseded/renamed code remains', () => {
    expect(branchVerdictFromCode(['modified', 'renamed'])).toBe('MERGED~');
    expect(branchVerdictFromCode([])).toBe('MERGED~');
  });
});

describe('codeFileSignature', () => {
  it('present in base → modified (merge-noise)', () => {
    expect(codeFileSignature(true, false)).toBe('modified');
  });
  it('absent but basename elsewhere → renamed', () => {
    expect(codeFileSignature(false, true)).toBe('renamed');
  });
  it('genuinely absent → NEW (unmerged signal)', () => {
    expect(codeFileSignature(false, false)).toBe('NEW');
  });
});

describe('worktreeVerdictFromDirty', () => {
  it('DIRTY-CODE when any code path is dirty', () => {
    expect(worktreeVerdictFromDirty(['disposable', 'code'])).toBe('DIRTY-CODE');
  });
  it('DIRTY-OTHER when non-code, non-disposable dirt exists', () => {
    expect(worktreeVerdictFromDirty(['disposable', 'other'])).toBe('DIRTY-OTHER');
  });
  it('DIRTY-DOCS when only disposable dirt', () => {
    expect(worktreeVerdictFromDirty(['disposable', 'disposable'])).toBe('DIRTY-DOCS');
  });
});
