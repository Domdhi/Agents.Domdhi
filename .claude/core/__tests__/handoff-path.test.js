import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const hp = require('../handoff-path');

let tmp;
function mkHandoffs(names) {
  const dir = path.join(tmp, hp.HANDOFF_DIR);
  fs.mkdirSync(dir, { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(dir, n), 'x');
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-test-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('handoff-path', () => {
  it('slugBranch_makesFilenameSafeLowercase', () => {
    expect(hp.slugBranch('feature/Login-Form')).toBe('feature-login-form');
    expect(hp.slugBranch('main')).toBe('main');
    expect(hp.slugBranch('')).toBe('nobranch');
    expect(hp.slugBranch('  spaces here ')).toBe('spaces-here');
  });

  it('stamp_isYYMMDD_HHMM', () => {
    // 2026-06-07 17:45 → 260607-1745
    const s = hp.stamp(new Date(2026, 5, 7, 17, 45));
    expect(s).toBe('260607-1745');
  });

  it('buildWritePath_composesStampCallerBranch', () => {
    const p = hp.buildWritePath('end', { runStamp: '260607-1745', branch: 'main' });
    expect(p).toBe('docs/.output/handoffs/260607-1745-end-main.md');
  });

  it('buildWritePath_rejectsUnknownCaller', () => {
    expect(() => hp.buildWritePath('bogus', { runStamp: '260607-1745', branch: 'main' })).toThrow(/unknown caller/);
  });

  it('resolveLatest_returnsNull_whenDirAbsent', () => {
    expect(hp.resolveLatest({ cwd: tmp, branch: 'main' })).toBeNull();
  });

  it('resolveLatest_picksNewestForBranch', () => {
    mkHandoffs([
      '260601-0900-end-main.md',
      '260607-1200-do-main.md', // newest for main
      '260607-1800-end-feature-x.md', // newer overall, different branch
    ]);
    expect(hp.resolveLatest({ cwd: tmp, branch: 'main' })).toBe(
      'docs/.output/handoffs/260607-1200-do-main.md'
    );
  });

  it('resolveLatest_fallsBackToNewestOverall_whenBranchHasNone', () => {
    mkHandoffs(['260601-0900-end-main.md', '260607-1800-end-feature-x.md']);
    expect(hp.resolveLatest({ cwd: tmp, branch: 'brand-new' })).toBe(
      'docs/.output/handoffs/260607-1800-end-feature-x.md'
    );
  });

  it('resolveLatest_disambiguatesRunTodoVsTodo_andHyphenatedBranches', () => {
    mkHandoffs([
      '260607-1000-todo-feature-login.md',
      '260607-1100-run-todo-feature-login.md', // newest for this branch
    ]);
    expect(hp.resolveLatest({ cwd: tmp, branch: 'feature-login' })).toBe(
      'docs/.output/handoffs/260607-1100-run-todo-feature-login.md'
    );
  });

  it('resolveLatest_ignoresNonHandoffFiles', () => {
    mkHandoffs(['260607-1200-do-main.md', 'README.md', 'notes.txt']);
    expect(hp.resolveLatest({ cwd: tmp, branch: 'main' })).toBe(
      'docs/.output/handoffs/260607-1200-do-main.md'
    );
  });
});
