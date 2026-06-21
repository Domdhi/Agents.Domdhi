// AC→source: adr-lint.js — ADR registry consistency linter for the
// docs/architecture/decisions/NNNN-*.md convention. Covers the pure lint core:
// status parsing, supersedes-ref extraction, and each verdict (NO_STATUS,
// DUP_NUMBER, SUPERSEDE_STALE, BAD_FILENAME, ORPHAN_ADR).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readStatus, supersedesRefs, saysSuperseded, lint } = require('../adr-lint');

const adr = (num, status, extra = '') =>
  `# ADR: thing ${num}\n\n| Field | Value |\n|-------|-------|\n| **Status** | ${status} |\n${extra}\n## Context\n...\n`;

describe('readStatus', () => {
  it('reads the canonical table row', () => {
    expect(readStatus(adr(1, 'Accepted')).value).toBe('Accepted');
    expect(readStatus(adr(1, 'Accepted')).form).toBe('table');
  });
  it('reads the legacy bullet form', () => {
    expect(readStatus('- **Status:** Proposed\n').form).toBe('bullet');
  });
  it('returns null when no Status field', () => {
    expect(readStatus('# ADR: nope\n\nbody\n').value).toBe(null);
  });
});

describe('supersedesRefs', () => {
  it('extracts ADR numbers from a Supersedes row (NNNN and ADR-NNN forms)', () => {
    expect(supersedesRefs('| **Supersedes** | 0003 and ADR-7 |')).toEqual([3, 7]);
  });
  it('returns [] for prose supersession (no numbers)', () => {
    expect(supersedesRefs('| **Supersedes** | the flat docs layout |')).toEqual([]);
  });
  it('returns [] when there is no Supersedes row', () => {
    expect(supersedesRefs(adr(1, 'Accepted'))).toEqual([]);
  });
});

describe('saysSuperseded', () => {
  it('matches superseded status text', () => {
    expect(saysSuperseded('Superseded by 0009')).toBe(true);
    expect(saysSuperseded('Accepted')).toBe(false);
    expect(saysSuperseded(null)).toBe(false);
  });
});

describe('lint', () => {
  it('passes a clean corpus', () => {
    const r = lint([
      { num: 1, name: '0001-a.md', text: adr(1, 'Accepted') },
      { num: 2, name: '0002-b.md', text: adr(2, 'Proposed') },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.warns).toEqual([]);
  });

  it('ERRORs on a missing Status field', () => {
    const r = lint([{ num: 1, name: '0001-a.md', text: '# ADR: a\n\nbody only\n' }]);
    expect(r.errors.some((e) => e.code === 'NO_STATUS')).toBe(true);
  });

  it('ERRORs on duplicate ADR numbers', () => {
    const r = lint([
      { num: 3, name: '0003-a.md', text: adr(3, 'Accepted') },
      { num: 3, name: '0003-b.md', text: adr(3, 'Accepted') },
    ]);
    expect(r.errors.some((e) => e.code === 'DUP_NUMBER')).toBe(true);
  });

  it('WARNs when a superseding record points at a target still marked Accepted', () => {
    const r = lint([
      { num: 9, name: '0009-new.md', text: adr(9, 'Accepted', '| **Supersedes** | 0003 |') },
      { num: 3, name: '0003-old.md', text: adr(3, 'Accepted') }, // should be Superseded
    ]);
    expect(r.warns.some((w) => w.code === 'SUPERSEDE_STALE')).toBe(true);
  });

  it('does NOT warn when the superseded target is correctly marked', () => {
    const r = lint([
      { num: 9, name: '0009-new.md', text: adr(9, 'Accepted', '| **Supersedes** | 0003 |') },
      { num: 3, name: '0003-old.md', text: adr(3, 'Superseded by 0009') },
    ]);
    expect(r.warns.some((w) => w.code === 'SUPERSEDE_STALE')).toBe(false);
  });

  it('WARNs on bad filenames and orphans', () => {
    const r = lint([], ['ADR-5.md'], ['docs/product/ADR-99-stray.md']);
    expect(r.warns.some((w) => w.code === 'BAD_FILENAME')).toBe(true);
    expect(r.warns.some((w) => w.code === 'ORPHAN_ADR')).toBe(true);
  });
});
