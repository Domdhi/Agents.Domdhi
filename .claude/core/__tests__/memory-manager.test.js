// AC→source map (TDD-3.2):
//   - No deleteMemory() exists — test CRU only
//   - MEMORY_DECAY.RATES[category] (nested), not MEMORY_DECAY[category]
//   - Decay formula: base*rate^activeDays + usage*USAGE_BOOST + (recent?RECENT_UPDATE_BOOST:0), cap 1.0
//   - lintMemories deductions: error=3, warning=2, info=1 (not 10)
//   - pruneStaleMemories deletes files (no archive tier)
//   - Category limit → createMemory returns null at 51st

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

const MemoryManager = require('../memory-manager');
const { createTmpDir } = require('./_helpers/tmp-dir');
const { createGitRepo } = require('./_helpers/git-fixture');

const hasSqlite = parseInt(process.versions.node.split('.')[0], 10) >= 25;

// ─── Per-test sandbox ────────────────────────────────────────────────────────

let tmp;
let originalEnv;
// Track all MemoryManager instances created per test so we can close their
// SQLite db before tmp.cleanup() — otherwise Windows EPERM on locked .db file.
let managersThisTest = [];

function makeManager() {
  const m = new MemoryManager();
  managersThisTest.push(m);
  return m;
}

function closeManagers() {
  for (const m of managersThisTest) {
    if (m.db) {
      try { m.db.close(); } catch { /* non-fatal */ }
      m.db = null;
    }
  }
  managersThisTest = [];
}

beforeEach(() => {
  managersThisTest = [];
  tmp = createTmpDir();
  originalEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmp.root;
});

afterEach(() => {
  closeManagers();
  if (originalEnv === undefined) {
    delete process.env.CLAUDE_PROJECT_DIR;
  } else {
    process.env.CLAUDE_PROJECT_DIR = originalEnv;
  }
  tmp.cleanup();
});

// ─── describe('memory-manager') ──────────────────────────────────────────────

describe('memory-manager', () => {

  // ── CRUD ───────────────────────────────────────────────────────────────────

  describe('CRUD', () => {

    it('createMemory_writesJsonFile_atCategoryPath', async () => {
      // Arrange
      const manager = makeManager();

      // Act
      const result = await manager.createMemory('patterns', 'test_pattern_one', { description: 'hello' });

      // Assert — returned object
      expect(result).not.toBeNull();
      expect(result.id).toBe('test_pattern_one');
      expect(result.type).toBe('pattern');
      expect(result.category).toBe('patterns');
      expect(result.usage_count).toBe(0);
      expect(result.content.description).toBe('hello');
      expect(result.metadata.confidence).toBe(1.0);
      expect(new Date(result.created).getTime()).not.toBeNaN();
      expect(new Date(result.updated).getTime()).not.toBeNaN();

      // Assert — file on disk (underscores → hyphens)
      const filePath = path.join(tmp.root, 'docs', '.output', 'memories', 'patterns', 'test-pattern-one.json');
      expect(fs.existsSync(filePath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(parsed.id).toBe('test_pattern_one');
      expect(parsed.content.description).toBe('hello');
    });

    it('createMemory_invalidCategory_throws', async () => {
      // Arrange
      const manager = makeManager();

      // Act / Assert
      await expect(manager.createMemory('bogus', 'x', {})).rejects.toThrow(/Invalid category/);
    });

    it('readMemory_existingId_roundTripsContent', async () => {
      // Arrange
      const manager = makeManager();
      await manager.createMemory('patterns', 'round_trip', { value: 42 });

      // Act
      const read = await manager.readMemory('patterns', 'round_trip');

      // Assert
      expect(read).not.toBeNull();
      expect(read.content.value).toBe(42);
    });

    it('readMemory_missingId_returnsNull', async () => {
      // Arrange
      const manager = makeManager();

      // Act
      const result = await manager.readMemory('patterns', 'nonexistent');

      // Assert
      expect(result).toBeNull();
    });

    it('readMemory_underscoreId_findsHyphenatedFile', async () => {
      // Arrange
      const manager = makeManager();
      await manager.createMemory('patterns', 'under_score_id', { tag: 'test' });

      // Act — read with same underscore id
      const result = await manager.readMemory('patterns', 'under_score_id');

      // Assert
      expect(result).not.toBeNull();
      expect(result.id).toBe('under_score_id');
    });

    it('updateMemory_mergesContent_incrementsUsageCount', async () => {
      // Arrange
      const manager = makeManager();
      const created = await manager.createMemory('patterns', 'update_me', { a: 1 });
      const originalUpdated = created.updated;

      // Ensure a small time gap so updated timestamp differs
      await new Promise(r => setTimeout(r, 10));

      // Act
      const updated = await manager.updateMemory('patterns', 'update_me', { content: { b: 2 } });

      // Assert
      expect(updated).not.toBeNull();
      expect(updated.content.a).toBe(1);
      expect(updated.content.b).toBe(2);
      expect(updated.usage_count).toBe(1);
      expect(updated.updated).not.toBe(originalUpdated);
    });

    it('updateMemory_missingMemory_returnsNull', async () => {
      // Arrange
      const manager = makeManager();

      // Act
      const result = await manager.updateMemory('patterns', 'does_not_exist', { content: { x: 1 } });

      // Assert
      expect(result).toBeNull();
    });

    it('listMemories_populatedCategory_returnsSummaries', async () => {
      // Arrange
      const manager = makeManager();
      await manager.createMemory('patterns', 'mem_a', { x: 1 });
      await manager.createMemory('patterns', 'mem_b', { x: 2 });
      await manager.createMemory('patterns', 'mem_c', { x: 3 });

      // Act
      const list = await manager.listMemories('patterns');

      // Assert
      expect(list.length).toBe(3);
      for (const summary of list) {
        expect(summary).toHaveProperty('id');
        expect(summary).toHaveProperty('created');
        expect(summary).toHaveProperty('updated');
        expect(summary).toHaveProperty('usage_count');
        expect(summary).toHaveProperty('confidence');
        expect(summary).toHaveProperty('decayed_confidence');
      }
    });

    it('listMemories_emptyCategory_returnsEmptyArray', async () => {
      // Arrange
      const manager = makeManager();

      // Act
      const list = await manager.listMemories('patterns');

      // Assert
      expect(list).toEqual([]);
    });

  }); // CRUD

  // ── searchMemories ─────────────────────────────────────────────────────────

  describe('searchMemories', () => {

    it.skipIf(!hasSqlite)('searchMemories_sqlitePath_findsByTerm', async () => {
      // Arrange
      const manager = makeManager();
      await manager.createMemory('patterns', 'zebra_mem', { description: 'uniquezebra' });

      // Act
      const results = await manager.searchMemories('uniquezebra');

      // Assert
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].category).toBe('patterns');
    });

    it('searchMemories_jsonFallback_matchesSubstring', async () => {
      // Arrange
      const manager = makeManager();
      await manager.createMemory('patterns', 'fallback_mem', { description: 'uniquepineapple42' });
      // Force JSON fallback by overriding initDb so it always returns false
      manager.initDb = () => false;

      // Act
      const results = await manager.searchMemories('uniquepineapple42');

      // Assert
      expect(results.length).toBeGreaterThanOrEqual(1);
      const r = results[0];
      expect(r).toHaveProperty('category');
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('relevance');
      expect(r).toHaveProperty('confidence');
      expect(r).toHaveProperty('decayed_confidence');
    });

  }); // searchMemories

  // ── calculateDecayedConfidence ─────────────────────────────────────────────

  describe('calculateDecayedConfidence', () => {

    it('calculateDecayedConfidence_todayMemory_returnsCappedAt1', async () => {
      // Arrange
      const manager = makeManager();
      const memory = {
        category: 'decisions',
        updated: new Date().toISOString(),
        usage_count: 0,
        metadata: { confidence: 1.0 }
      };

      // Act
      const result = manager.calculateDecayedConfidence(memory);

      // Assert — fresh memory with no active days beyond now caps at 1.0
      expect(result).toBeLessThanOrEqual(1.0);
      expect(result).toBeGreaterThan(0.9);
    });

    it('calculateDecayedConfidence_30DaysOldDecisions_appliesRate', () => {
      // Arrange — git-fixture with 30 commits at tmp.root so it aligns with
      // CLAUDE_PROJECT_DIR (already set to tmp.root in beforeEach), and the
      // manager's internal `git log` execSync runs inside this fixture repo.
      const repo = createGitRepo({ root: tmp.root });
      for (let i = 1; i <= 30; i++) {
        const isoDate = new Date(2024, 0, i).toISOString();
        repo.addCommitOnDate(`commit day ${i}`, isoDate);
      }

      const manager = makeManager();
      // Controlled memory: updated at 2024-01-01, no usage, no recent boost (30 cal days)
      const memory = {
        category: 'decisions',
        updated: '2024-01-01T12:00:00.000Z',
        usage_count: 0,
        metadata: { confidence: 1.0 }
      };

      // Act
      const result = manager.calculateDecayedConfidence(memory);

      // Assert — formula: 1.0 * 0.98^activeDays; 30 work days → ≈ 0.545
      // We allow generous tolerance since activeDays includes the initial empty commit "today"
      const expected = Math.pow(0.98, 30);
      expect(Math.abs(result - expected)).toBeLessThan(0.05);
    });

  }); // calculateDecayedConfidence

  // ── getActiveDaysSince ─────────────────────────────────────────────────────

  describe('getActiveDaysSince', () => {

    it('getActiveDaysSince_gitFixture3Commits_returns3', () => {
      // Arrange — git repo at tmp.root aligns with CLAUDE_PROJECT_DIR.
      const repo = createGitRepo({ root: tmp.root });
      repo.addCommitOnDate('day 1', '2024-01-01T12:00:00');
      repo.addCommitOnDate('day 2', '2024-01-02T12:00:00');
      repo.addCommitOnDate('day 3', '2024-01-03T12:00:00');

      const manager = makeManager();

      // Act — query from earliest date; initial empty commit at "today" adds 1 more
      const count = manager.getActiveDaysSince('2024-01-01T00:00:00Z');

      // Assert — 3 fixture commits + possibly today's initial commit
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(4);
    });

    it('getActiveDaysSince_calledTwice_returnsSameResult', () => {
      // Arrange — git repo at tmp.root aligns with CLAUDE_PROJECT_DIR.
      // Behavioral test: repeated calls must return the same count regardless
      // of whether the underlying cache is a Set, Map, or closure variable.
      // (Cache-identity assertions belong to _lib/__tests__/memory-decay.test.js;
      // here we just prove the public API is idempotent.)
      const repo = createGitRepo({ root: tmp.root });
      repo.addCommitOnDate('commit a', '2024-03-01T12:00:00');
      repo.addCommitOnDate('commit b', '2024-03-02T12:00:00');

      const manager = makeManager();

      // Act
      const first = manager.getActiveDaysSince('2024-03-01T00:00:00Z');
      const second = manager.getActiveDaysSince('2024-03-01T00:00:00Z');

      // Assert — consistent result across calls (proves caching works AND
      // that it returns a stable value for the same input)
      expect(first).toBe(second);
      expect(first).toBeGreaterThanOrEqual(2);
    });

    it('getActiveDaysSince_gitUnavailable_fallsBackToCalendar', () => {
      // Arrange — tmp.root (set as CLAUDE_PROJECT_DIR in beforeEach) is not a
      // git repo, so the resolver's `git log` execSync throws → permanent
      // calendar-day fallback for the lifetime of the manager instance.
      const manager = makeManager();
      const past = new Date(Date.now() - 7 * 86400000).toISOString();

      // Act
      const result = manager.getActiveDaysSince(past);

      // Assert — calendar fallback: ~7 days with ±0.1 tolerance
      expect(result).toBeGreaterThan(6.9);
      expect(result).toBeLessThan(7.1);
    });

  }); // getActiveDaysSince

  // ── lintMemories ───────────────────────────────────────────────────────────

  describe('lintMemories', () => {

    // Helper: write fixture JSON directly into the tmp memory tree
    function writeFixtureMemory(category, id, overrides = {}) {
      const base = {
        id,
        type: category.slice(0, -1),
        category,
        created: '2020-01-01T00:00:00.000Z',
        updated: '2020-01-01T00:00:00.000Z',
        usage_count: 0,
        content: { description: 'default' },
        metadata: { confidence: 1.0 }
      };
      if (overrides.content !== undefined) base.content = overrides.content;
      if (overrides.metadata !== undefined) base.metadata = { ...base.metadata, ...overrides.metadata };
      // Apply remaining scalar overrides
      for (const [k, v] of Object.entries(overrides)) {
        if (k !== 'content' && k !== 'metadata') base[k] = v;
      }
      const filename = id.replace(/_/g, '-');
      tmp.write(`docs/.output/memories/${category}/${filename}.json`, JSON.stringify(base, null, 2));
      return base;
    }

    it('lintMemories_emptyRepo_returns70', async () => {
      // Arrange
      const manager = makeManager();

      // Act
      const result = await manager.lintMemories();

      // Assert
      expect(result.score).toBe(70);
      expect(result.total_memories).toBe(0);
      for (const check of Object.values(result.checks)) {
        expect(check.count).toBe(0);
      }
    });

    it('lintMemories_brokenRef_flagsError', async () => {
      // Arrange — memory references a non-existent id.
      // Give it a fresh updated date + usage_count > 0 so it does NOT trigger
      // orphaned, stale, or decay_validation checks. Only broken_refs fires.
      writeFixtureMemory('patterns', 'has_broken_ref', {
        updated: new Date().toISOString(),
        usage_count: 1,
        content: { note: 'related: ghost-concept' },
        metadata: { confidence: 1.0 }
      });
      const manager = makeManager();

      // Act
      const result = await manager.lintMemories();

      // Assert — broken_refs is an error (deduction 3), score = 70 - 3 = 67
      expect(result.checks.broken_refs.count).toBe(1);
      expect(result.score).toBe(67);
      const finding = result.checks.broken_refs.findings[0];
      // finding.memory is `${category}/${full.id}` — id preserves underscores as stored
      expect(finding.memory).toContain('has_broken_ref');
    });

    it('lintMemories_orphanedMemory_flagsWarning', async () => {
      // Arrange — zero usage_count, updated far in the past (> 30 days)
      writeFixtureMemory('patterns', 'orphan_mem', {
        usage_count: 0,
        updated: '2020-01-01T00:00:00.000Z'
      });
      const manager = makeManager();

      // Act
      const result = await manager.lintMemories();

      // Assert
      expect(result.checks.orphaned.count).toBeGreaterThanOrEqual(1);
    });

    it('lintMemories_duplicateMemories_flagsWarning', async () => {
      // Arrange — two memories with identical content (Jaccard = 1.0)
      const content = { rule: 'always use the fast path when available in the system' };
      writeFixtureMemory('patterns', 'dup_alpha', { content });
      writeFixtureMemory('patterns', 'dup_beta', { content });
      const manager = makeManager();

      // Act
      const result = await manager.lintMemories();

      // Assert
      expect(result.checks.duplicates.count).toBeGreaterThanOrEqual(1);
    });

    it('lintMemories_contradictions_flagsWarning', async () => {
      // Arrange — two patterns with high overlap (shared filler) + conflicting signals
      const filler = 'cache system layer application request response service data store';
      writeFixtureMemory('patterns', 'contra_positive', {
        content: { rule: `always use cache here ${filler} always use cache here ${filler}` }
      });
      writeFixtureMemory('patterns', 'contra_negative', {
        content: { rule: `never use cache here ${filler} never use cache here ${filler}` }
      });
      const manager = makeManager();

      // Act
      const result = await manager.lintMemories();

      // Assert
      expect(result.checks.contradictions.count).toBeGreaterThanOrEqual(1);
    });

    it('lintMemories_staleMemory_flagsWarning', async () => {
      // Arrange — old updated date + low confidence → decayed well below 0.3
      writeFixtureMemory('patterns', 'stale_mem', {
        updated: '2020-01-01T00:00:00.000Z',
        metadata: { confidence: 0.2 }
      });
      const manager = makeManager();

      // Act
      const result = await manager.lintMemories();

      // Assert
      expect(result.checks.stale.count).toBeGreaterThanOrEqual(1);
    });

    it('lintMemories_decayValidation_flagsInfo', async () => {
      // Arrange — high raw confidence (≥ 0.7) but old enough to decay below 0.3.
      // Need activeDays > 23 for patterns (rate=0.95): 0.95^24 ≈ 0.29.
      // Use a git-fixture with 30 commits so getActiveDaysSince returns 30+ active days.
      // Git repo at tmp.root so the manager's git log sees these commits AND
      // writeFixtureMemory writes under the same project root the manager reads.
      const repo = createGitRepo({ root: tmp.root });
      for (let i = 1; i <= 30; i++) {
        repo.addCommitOnDate(`commit ${i}`, new Date(2020, 0, i).toISOString());
      }

      writeFixtureMemory('patterns', 'decay_val_mem', {
        updated: '2020-01-01T00:00:00.000Z',
        metadata: { confidence: 0.9 }
      });
      const manager = makeManager();

      // Act
      const result = await manager.lintMemories();

      // Assert — decay_validation is info (deduction 1)
      expect(result.checks.decay_validation.count).toBeGreaterThanOrEqual(1);
      expect(result.checks.decay_validation.severity).toBe('info');
    });

    it('lintMemories_categoryBalance_flagsAt80Percent', async () => {
      // Arrange — 40 patterns = 80% of 50
      for (let i = 0; i < 40; i++) {
        writeFixtureMemory('patterns', `pat_${i}`, { content: { x: i } });
      }
      const manager = makeManager();

      // Act
      const result = await manager.lintMemories();

      // Assert
      expect(result.checks.category_balance.count).toBe(1);
      const finding = result.checks.category_balance.findings[0];
      expect(finding.count).toBe(40);
      expect(finding.threshold).toBe(40);
      expect(finding.limit).toBe(50);
    });

  }); // lintMemories

  // ── pruneStaleMemories ─────────────────────────────────────────────────────

  describe('pruneStaleMemories', () => {

    it('pruneStaleMemories_oldLowConfidence_deletes', async () => {
      // Arrange — git-fixture with 40 commits on 40 distinct dates (well past 30 active days)
      // Git repo at tmp.root so the manager's git log sees these commits AND
      // writeFixtureMemory writes under the same project root the manager reads.
      const repo = createGitRepo({ root: tmp.root });
      for (let i = 1; i <= 40; i++) {
        const isoDate = new Date(2020, 0, i).toISOString();
        repo.addCommitOnDate(`commit ${i}`, isoDate);
      }

      const manager = makeManager();
      // Write fixture memory directly (old date, low confidence)
      const memContent = {
        id: 'stale_target',
        type: 'pattern',
        category: 'patterns',
        created: '2020-01-01T00:00:00.000Z',
        updated: '2020-01-01T00:00:00.000Z',
        usage_count: 0,
        content: { description: 'old low conf' },
        metadata: { confidence: 0.05 }
      };
      const memDir = path.join(manager.memoriesDir, 'patterns');
      fs.mkdirSync(memDir, { recursive: true });
      const filePath = path.join(memDir, 'stale-target.json');
      fs.writeFileSync(filePath, JSON.stringify(memContent, null, 2));

      // Act
      const pruned = await manager.pruneStaleMemories('patterns');

      // Assert
      expect(pruned).toBe(1);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('pruneStaleMemories_freshLowConfidence_keeps', async () => {
      // Arrange — fresh updated date, so activeDays will be small (< 30)
      const manager = makeManager();
      const memContent = {
        id: 'fresh_low',
        type: 'pattern',
        category: 'patterns',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        usage_count: 0,
        content: { description: 'fresh but low' },
        metadata: { confidence: 0.05 }
      };
      const memDir = path.join(manager.memoriesDir, 'patterns');
      fs.mkdirSync(memDir, { recursive: true });
      const filePath = path.join(memDir, 'fresh-low.json');
      fs.writeFileSync(filePath, JSON.stringify(memContent, null, 2));

      // Act
      const pruned = await manager.pruneStaleMemories('patterns');

      // Assert — activeDays is tiny (near 0), not > 30
      expect(pruned).toBe(0);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('pruneStaleMemories_oldHighConfidence_keeps', async () => {
      // Arrange — old date but high confidence → confidence guard blocks deletion
      const manager = makeManager();
      const memContent = {
        id: 'old_high_conf',
        type: 'pattern',
        category: 'patterns',
        created: '2020-01-01T00:00:00.000Z',
        updated: '2020-01-01T00:00:00.000Z',
        usage_count: 0,
        content: { description: 'old but trusted' },
        metadata: { confidence: 0.9 }
      };
      const memDir = path.join(manager.memoriesDir, 'patterns');
      fs.mkdirSync(memDir, { recursive: true });
      const filePath = path.join(memDir, 'old-high-conf.json');
      fs.writeFileSync(filePath, JSON.stringify(memContent, null, 2));

      // Act
      const pruned = await manager.pruneStaleMemories('patterns');

      // Assert — confidence 0.9 >= 0.3 threshold, not pruned
      expect(pruned).toBe(0);
      expect(fs.existsSync(filePath)).toBe(true);
    });

  }); // pruneStaleMemories

  // ── rebuildIndex ────────────────────────────────────────────────────────────

  describe('rebuildIndex', () => {

    it.skipIf(!hasSqlite)('rebuildIndex_afterCreates_searchFindsByTerm', async () => {
      // Arrange
      const manager = makeManager();
      await manager.createMemory('patterns', 'zeta_mem', { tag: 'zeta_marker_one' });
      await manager.createMemory('patterns', 'omega_mem', { tag: 'omega_marker_two' });

      // Act
      await manager.rebuildIndex();
      const results = await manager.searchMemories('zeta_marker_one');

      // Assert
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

  }); // rebuildIndex

  // ── category limits ─────────────────────────────────────────────────────────

  describe('category limits', () => {

    it('createMemory_at51st_returnsNullAndKeepsCountAt50', async () => {
      // Arrange — suppress console noise
      const origLog = console.log;
      console.log = () => {};

      try {
        const manager = makeManager();

        // Fill exactly 50 slots with fresh memories (so pruneStale won't remove any)
        for (let i = 0; i < 50; i++) {
          const result = await manager.createMemory('patterns', `pat_fresh_${i}`, { n: i });
          expect(result).not.toBeNull();
        }

        // Act — 51st write
        const overflow = await manager.createMemory('patterns', 'pat_overflow', { n: 50 });

        // Assert
        expect(overflow).toBeNull();
        const count = await manager.getMemoryCount('patterns');
        expect(count).toBe(50);
      } finally {
        console.log = origLog;
      }
    });

  }); // category limits

  // ── ingestAgentMemory ───────────────────────────────────────────────────────

  describe('ingestAgentMemory', () => {

    function writeMd(relPath, frontmatter, body) {
      const fm = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n');
      const content = `---\n${fm}\n---\n\n${body}`;
      return tmp.write(relPath, content);
    }

    it('ingest_singleMarkdownFile_createsJsonMemory', async () => {
      // Arrange
      const manager = makeManager();
      const mdPath = writeMd(
        'agent-memory/general-purpose/feedback_sample_rule.md',
        { name: 'Sample rule', description: 'one-line summary', type: 'feedback' },
        'Body paragraph with a useful rule.\n\nSecond paragraph.'
      );

      // Act
      const report = await manager.ingestAgentMemory(mdPath);

      // Assert — report shape
      expect(report.ingested).toBe(1);
      expect(report.skipped).toBe(0);
      expect(report.errors).toEqual([]);

      // Assert — JSON on disk
      const memory = await manager.readMemory('patterns', 'feedback-sample-rule');
      expect(memory).not.toBeNull();
      expect(memory.content.description).toBe('one-line summary');
      expect(memory.content.body).toContain('Body paragraph');
      expect(memory.content.body).toContain('Second paragraph');
      expect(memory.content.source).toBe('agent-memory');
    });

    it('ingest_directory_walksRecursively', async () => {
      // Arrange — two files in sibling agent subdirs
      const manager = makeManager();
      const dirRoot = tmp.mkdir('agent-memory');
      writeMd(
        'agent-memory/general-purpose/feedback_alpha.md',
        { name: 'Alpha', description: 'alpha desc', type: 'feedback' },
        'Alpha body'
      );
      writeMd(
        'agent-memory/architect/pattern_beta.md',
        { name: 'Beta', description: 'beta desc', type: 'pattern' },
        'Beta body'
      );

      // Act
      const report = await manager.ingestAgentMemory(dirRoot);

      // Assert
      expect(report.ingested).toBe(2);
      const alpha = await manager.readMemory('patterns', 'feedback-alpha');
      const beta = await manager.readMemory('patterns', 'pattern-beta');
      expect(alpha).not.toBeNull();
      expect(beta).not.toBeNull();
    });

    it('ingest_mapsTypeToCategoryCorrectly', async () => {
      // Arrange — one file per category mapping
      const manager = makeManager();
      writeMd('m/constraint_one.md',         { name: 'C', description: 'c', type: 'constraint' },         'body');
      writeMd('m/decision_one.md',           { name: 'D', description: 'd', type: 'decision' },           'body');
      writeMd('m/workflow_one.md',           { name: 'W', description: 'w', type: 'workflow' },           'body');
      writeMd('m/rejected-approach_one.md',  { name: 'R', description: 'r', type: 'rejected-approach' },  'body');

      // Act
      await manager.ingestAgentMemory(tmp.mkdir('m'));

      // Assert
      expect(await manager.readMemory('constraints', 'constraint-one')).not.toBeNull();
      expect(await manager.readMemory('decisions', 'decision-one')).not.toBeNull();
      expect(await manager.readMemory('workflows', 'workflow-one')).not.toBeNull();
      expect(await manager.readMemory('rejected-approaches', 'rejected-approach-one')).not.toBeNull();
    });

    it('ingest_existingMemory_skipsWithoutOverwriting', async () => {
      // Arrange
      const manager = makeManager();
      await manager.createMemory('patterns', 'feedback-dup', { description: 'original' });
      writeMd(
        'agent-memory/feedback_dup.md',
        { name: 'Dup', description: 'would-be-ingested', type: 'feedback' },
        'new body'
      );

      // Act
      const report = await manager.ingestAgentMemory(path.join(tmp.root, 'agent-memory'));

      // Assert
      expect(report.ingested).toBe(0);
      expect(report.skipped).toBe(1);
      const still = await manager.readMemory('patterns', 'feedback-dup');
      expect(still.content.description).toBe('original'); // not overwritten
    });

    it('ingest_unknownTypeIsError_notThrow', async () => {
      // Arrange
      const manager = makeManager();
      writeMd(
        'agent-memory/bad.md',
        { name: 'Bad', description: 'x', type: 'gibberish' },
        'body'
      );

      // Act
      const report = await manager.ingestAgentMemory(path.join(tmp.root, 'agent-memory'));

      // Assert
      expect(report.ingested).toBe(0);
      expect(report.errors.length).toBe(1);
      expect(report.errors[0].reason).toMatch(/unknown type/i);
    });

    it('ingest_missingFrontmatter_isError', async () => {
      // Arrange
      const manager = makeManager();
      tmp.write('agent-memory/no-fm.md', 'Just a body with no frontmatter.\n');

      // Act
      const report = await manager.ingestAgentMemory(path.join(tmp.root, 'agent-memory'));

      // Assert
      expect(report.errors.length).toBe(1);
      expect(report.errors[0].reason).toMatch(/frontmatter/i);
    });

    it('ingest_skipsMemoryMdIndexFiles', async () => {
      // Arrange — MEMORY.md index files have no frontmatter; must be filtered, not errored
      const manager = makeManager();
      tmp.write('agent-memory/general-purpose/MEMORY.md', '# Index\n- [foo](foo.md)\n');
      writeMd(
        'agent-memory/general-purpose/feedback_real.md',
        { name: 'Real', description: 'r', type: 'feedback' },
        'real body'
      );

      // Act
      const report = await manager.ingestAgentMemory(path.join(tmp.root, 'agent-memory'));

      // Assert
      expect(report.ingested).toBe(1);
      expect(report.errors).toEqual([]);
      expect(report.skipped).toBe(0);
    });

    it('ingest_dryRun_writesNothing', async () => {
      // Arrange
      const manager = makeManager();
      writeMd(
        'agent-memory/feedback_preview.md',
        { name: 'Preview', description: 'p', type: 'feedback' },
        'body'
      );

      // Act
      const report = await manager.ingestAgentMemory(
        path.join(tmp.root, 'agent-memory'),
        { dryRun: true }
      );

      // Assert
      expect(report.ingested).toBe(1); // reports as "would ingest"
      const actual = await manager.readMemory('patterns', 'feedback-preview');
      expect(actual).toBeNull(); // nothing on disk
    });

    it('ingest_preservesMarkdownCodeBlocks', async () => {
      // Arrange — real-world-ish markdown with code fences
      const manager = makeManager();
      const body = [
        'Use the wrapper pattern:',
        '',
        '```js',
        "const wrapper = function() { return 'x'; };",
        '```',
        '',
        'Why: destructured imports capture the reference at load time.',
      ].join('\n');
      writeMd(
        'agent-memory/feedback_with_code.md',
        { name: 'Code-bearing', description: 'short desc', type: 'feedback' },
        body
      );

      // Act
      await manager.ingestAgentMemory(path.join(tmp.root, 'agent-memory'));

      // Assert
      const memory = await manager.readMemory('patterns', 'feedback-with-code');
      expect(memory.content.body).toContain('```js');
      expect(memory.content.body).toContain("return 'x'");
      expect(memory.content.body).toContain('```');
    });

    it('ingest_windowsLineEndings_parsedCorrectly', async () => {
      // Arrange — CRLF line endings (Windows git checkout default)
      const manager = makeManager();
      const crlfContent =
        '---\r\nname: CRLF\r\ndescription: win\r\ntype: feedback\r\n---\r\n\r\nBody line.\r\n';
      tmp.write('agent-memory/feedback_crlf.md', crlfContent);

      // Act
      const report = await manager.ingestAgentMemory(path.join(tmp.root, 'agent-memory'));

      // Assert
      expect(report.ingested).toBe(1);
      expect(report.errors).toEqual([]);
      const memory = await manager.readMemory('patterns', 'feedback-crlf');
      expect(memory.content.description).toBe('win');
    });

  }); // ingestAgentMemory

}); // memory-manager
