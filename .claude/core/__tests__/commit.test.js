// Tests for commit.js — the file-based commit helper.
//
// Strategy: exercise the message-sanitization + trailer logic via `--dry-run
// --file <path>`, which reads the message file, rewrites it with the trailer,
// prints the result, and exits WITHOUT invoking git. No git repo needed.
//
// Coverage:
//   - appends the Co-Authored-By trailer exactly once
//   - idempotent when the trailer is already present
//   - honors CLAUDE_COMMIT_TRAILER override (and model-agnostic default)
//   - trims trailing junk lines (stray @, quote, backtick, blanks)
//   - exits non-zero on an empty message or a missing file

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createTmpDir } = require('./_helpers/tmp-dir');

const COMMIT_JS = path.resolve(__dirname, '../commit.js');

/** Run commit.js --dry-run against a message file. Returns {status, stdout}. */
function runDryRun(msgFile, env = {}) {
  try {
    const stdout = execFileSync(
      'node',
      [COMMIT_JS, '--dry-run', '--file', msgFile],
      { encoding: 'utf8', env: { ...process.env, ...env } },
    );
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status ?? 1, stdout: (e.stdout || '') + (e.stderr || '') };
  }
}

describe('commit.js trailer handling', () => {
  let tmp;
  beforeEach(() => { tmp = createTmpDir({ prefix: 'commit-test-' }); });
  afterEach(() => tmp.cleanup());

  it('appends the model-agnostic trailer by default, exactly once', () => {
    const f = tmp.write('MSG', 'feat: thing\n\nbody\n');
    const { status, stdout } = runDryRun(f);
    expect(status).toBe(0);
    const matches = stdout.match(/Co-Authored-By: Claude <noreply@anthropic\.com>/g) || [];
    expect(matches).toHaveLength(1);
  });

  it('is idempotent when the trailer already exists', () => {
    const f = tmp.write('MSG', 'feat: thing\n\nbody\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n');
    const { stdout } = runDryRun(f);
    const matches = stdout.match(/Co-Authored-By: Claude <noreply@anthropic\.com>/g) || [];
    expect(matches).toHaveLength(1);
  });

  it('honors CLAUDE_COMMIT_TRAILER override', () => {
    const f = tmp.write('MSG', 'feat: thing\n');
    const { stdout } = runDryRun(f, {
      CLAUDE_COMMIT_TRAILER: 'Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>',
    });
    expect(stdout).toContain('Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>');
  });

  it('trims trailing stray-token / blank lines before the trailer', () => {
    const f = tmp.write('MSG', 'feat: thing\n\nbody\n@\n`\n\n');
    const { stdout } = runDryRun(f);
    // The stray @ / backtick lines must not survive into the message.
    const between = stdout.split('feat: thing')[1] || '';
    expect(between).not.toMatch(/^@$/m);
    expect(between).not.toMatch(/^`$/m);
  });
});

describe('commit.js error handling', () => {
  let tmp;
  beforeEach(() => { tmp = createTmpDir({ prefix: 'commit-test-' }); });
  afterEach(() => tmp.cleanup());

  it('exits non-zero on an empty message', () => {
    const f = tmp.write('MSG', '\n\n  \n');
    const { status } = runDryRun(f);
    expect(status).not.toBe(0);
  });

  it('exits non-zero when the message file is missing', () => {
    const { status } = runDryRun(path.join(tmp.root, 'does-not-exist'));
    expect(status).not.toBe(0);
  });
});
