// AC→source: memory-backup.js — out-of-repo backup of the gitignored memory store.
// Covers the pure arg/stamp/prune/integrity-classification helpers. The fs mirror
// + rotation IO is integration-only.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseArgs, dateStamp, fullStamp, snapshotsToPrune, isCorrupt, SNAPSHOT_RE, DEFAULT_DEST } = require('../memory-backup');

describe('parseArgs', () => {
  it('defaults: dest, keep=14, rotate=true', () => {
    const o = parseArgs([]);
    expect(o.to).toBe(DEFAULT_DEST);
    expect(o.keep).toBe(14);
    expect(o.rotate).toBe(true);
  });
  it('honors --to, --keep, --no-rotate', () => {
    const o = parseArgs(['--to', '/tmp/bk', '--keep', '5', '--no-rotate']);
    expect(o.to).toBe('/tmp/bk');
    expect(o.keep).toBe(5);
    expect(o.rotate).toBe(false);
  });
  it('clamps a bad --keep to a sane floor of 1', () => {
    expect(parseArgs(['--keep', '0']).keep).toBe(1);
    expect(parseArgs(['--keep', 'abc']).keep).toBe(14);
  });
});

describe('DEFAULT_DEST', () => {
  it('is a repo-derived sibling path, not a machine-specific literal', () => {
    expect(DEFAULT_DEST).toMatch(/_[^/\\]+-memory-backup$/);
    expect(DEFAULT_DEST).not.toMatch(/_hub-backup/);
  });
});

describe('date stamps', () => {
  const d = new Date(2026, 5, 21, 9, 7, 3); // local 2026-06-21 09:07:03
  it('dateStamp is zero-padded YYYY-MM-DD', () => {
    expect(dateStamp(d)).toBe('2026-06-21');
    expect(SNAPSHOT_RE.test(`memories-${dateStamp(d)}`)).toBe(true);
  });
  it('fullStamp appends HHMMSS', () => {
    expect(fullStamp(d)).toBe('2026-06-21_090703');
  });
});

describe('snapshotsToPrune', () => {
  it('keeps the newest N, returns the oldest excess (chronological by name)', () => {
    const names = [
      'memories-2026-06-18', 'memories-2026-06-19', 'memories-2026-06-20', 'memories-2026-06-21',
      'memories-latest', 'memories-SUSPECT-2026-06-20_010101', 'random',
    ];
    expect(snapshotsToPrune(names, 2)).toEqual(['memories-2026-06-18', 'memories-2026-06-19']);
  });
  it('never touches non-snapshot dirs (latest / SUSPECT / junk)', () => {
    expect(snapshotsToPrune(['memories-latest', 'memories-SUSPECT-x', 'foo'], 1)).toEqual([]);
  });
  it('returns nothing when under the keep limit', () => {
    expect(snapshotsToPrune(['memories-2026-06-21'], 14)).toEqual([]);
  });
});

describe('isCorrupt', () => {
  it('treats ok / unavailable / missing as NOT corrupt (still backs up)', () => {
    expect(isCorrupt('ok')).toBe(false);
    expect(isCorrupt('unavailable')).toBe(false);
    expect(isCorrupt('missing')).toBe(false);
  });
  it('treats any real verdict as corrupt', () => {
    expect(isCorrupt('error: malformed')).toBe(true);
    expect(isCorrupt('*** in database main ***')).toBe(true);
  });
});
