// AC→source map (PA-3 / epic-overlap):
//   - extractEpicFiles(backlogPath) returns Map<epicId, Set<filePath>>
//       Parses `### Epic ...` headings; under each, finds `**Files:**` blocks per story
//       and extracts ` `path` ` entries. Aggregates across all stories in the epic.
//   - findOverlaps(epicFilesMap) returns Array<{epicA, epicB, sharedFiles}>
//       Empty array when no overlaps. Pairs are deduped: each pair appears once,
//       ordered so epicA < epicB by string compare. sharedFiles sorted alphabetically.
//   - Malformed input (missing file): extractEpicFiles throws descriptive Error
//       with backlogPath in the message.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);

const { extractEpicFiles, findOverlaps } = require('../epic-overlap');

// ─── Test helpers ─────────────────────────────────────────────────────────────

let tmpDir;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-overlap-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeBacklog(content) {
    const p = path.join(tmpDir, '_backlog.md');
    fs.writeFileSync(p, content, 'utf8');
    return p;
}

const cleanBacklog = `# Product Backlog

### Epic 1: Authentication

* **Story 1.1: Login**
  * **Files:**
    * \`src/auth/login.ts\` — new
    * \`src/auth/session.ts\` — new

### Epic 2: Dashboard

* **Story 2.1: Home page**
  * **Files:**
    * \`src/dashboard/home.tsx\` — new
    * \`src/dashboard/widgets.tsx\` — new
`;

const twoEpicOverlap = `# Product Backlog

### Epic 1: Authentication

* **Story 1.1: Login**
  * **Files:**
    * \`src/auth/login.ts\` — new
    * \`src/shared/api-client.ts\` — modify

### Epic 2: Dashboard

* **Story 2.1: Home page**
  * **Files:**
    * \`src/dashboard/home.tsx\` — new
    * \`src/shared/api-client.ts\` — modify
`;

const threeEpicTwoFileOverlap = `# Product Backlog

### Epic A: Auth

* **Story A.1: Login**
  * **Files:**
    * \`src/shared/util.ts\` — modify
    * \`src/shared/types.ts\` — modify

### Epic B: Dashboard

* **Story B.1: Home**
  * **Files:**
    * \`src/shared/util.ts\` — modify
    * \`src/shared/types.ts\` — modify

### Epic C: Settings

* **Story C.1: Form**
  * **Files:**
    * \`src/shared/util.ts\` — modify
    * \`src/shared/types.ts\` — modify
`;

// ─── extractEpicFiles ────────────────────────────────────────────────────────

describe('extractEpicFiles', () => {

    it('extractEpicFiles_cleanBacklog_returnsMapPerEpic', () => {
        const p = writeBacklog(cleanBacklog);
        const result = extractEpicFiles(p);

        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(2);

        const epic1Key = [...result.keys()].find(k => k.includes('1') && k.includes('Authentication'));
        const epic2Key = [...result.keys()].find(k => k.includes('2') && k.includes('Dashboard'));
        expect(epic1Key).toBeTruthy();
        expect(epic2Key).toBeTruthy();

        expect(result.get(epic1Key)).toBeInstanceOf(Set);
        expect(result.get(epic1Key).has('src/auth/login.ts')).toBe(true);
        expect(result.get(epic1Key).has('src/auth/session.ts')).toBe(true);
        expect(result.get(epic2Key).has('src/dashboard/home.tsx')).toBe(true);
        expect(result.get(epic2Key).has('src/dashboard/widgets.tsx')).toBe(true);
    });

    it('extractEpicFiles_aggregatesAcrossMultipleStoriesInOneEpic', () => {
        const content = `# Backlog

### Epic 1: Multi-story

* **Story 1.1: First**
  * **Files:**
    * \`a.ts\` — new

* **Story 1.2: Second**
  * **Files:**
    * \`b.ts\` — new
    * \`c.ts\` — new
`;
        const p = writeBacklog(content);
        const result = extractEpicFiles(p);

        const key = [...result.keys()][0];
        const files = result.get(key);
        expect(files.has('a.ts')).toBe(true);
        expect(files.has('b.ts')).toBe(true);
        expect(files.has('c.ts')).toBe(true);
        expect(files.size).toBe(3);
    });

    it('extractEpicFiles_epicWithNoFiles_returnsEmptySet', () => {
        const content = `# Backlog

### Epic 1: Empty

* **Story 1.1: Stub**
  * **AC:**
    * Just a placeholder
`;
        const p = writeBacklog(content);
        const result = extractEpicFiles(p);

        expect(result.size).toBe(1);
        const key = [...result.keys()][0];
        expect(result.get(key)).toBeInstanceOf(Set);
        expect(result.get(key).size).toBe(0);
    });

    it('extractEpicFiles_emptyBacklog_returnsEmptyMap', () => {
        const p = writeBacklog('# Empty\n\nNo epics here.\n');
        const result = extractEpicFiles(p);

        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(0);
    });

    it('extractEpicFiles_missingFile_throwsDescriptiveError', () => {
        const missing = path.join(tmpDir, 'does-not-exist.md');
        expect(() => extractEpicFiles(missing)).toThrow(/does-not-exist\.md/);
    });

    // Regression guard for the compound `Epic PA-N:` heading format used by
    // this project's own backlogs (e.g., TODO_platform-alignment-may-2026).
    // Closes m-1 from the PA epic code review — the regex already handles the
    // alphanumeric prefix; this fixture pins the behavior so a future
    // simplification doesn't silently drop it.
    it('extractEpicFiles_compoundEpicId_PADashN_isExtracted', () => {
        const content = `# Backlog

### Epic PA-1: Platform Alignment Audit

* **Story PA-1.1: Audit core scripts**
  * **Files:**
    * \`.claude/core/gate.js\` — modify
    * \`.claude/core/scaffold.js\` — modify

### Epic PA-2: Skill Updates

* **Story PA-2.1: Project analyst checklist**
  * **Files:**
    * \`.claude/skills/project-analyst/SKILL.md\` — modify
`;
        const p = writeBacklog(content);
        const result = extractEpicFiles(p);

        expect(result.size).toBe(2);
        const pa1Key = [...result.keys()].find(k => k.includes('PA-1'));
        const pa2Key = [...result.keys()].find(k => k.includes('PA-2'));
        expect(pa1Key).toBeTruthy();
        expect(pa2Key).toBeTruthy();
        expect(result.get(pa1Key).has('.claude/core/gate.js')).toBe(true);
        expect(result.get(pa1Key).has('.claude/core/scaffold.js')).toBe(true);
        expect(result.get(pa2Key).has('.claude/skills/project-analyst/SKILL.md')).toBe(true);
    });

});

// ─── findOverlaps ────────────────────────────────────────────────────────────

describe('findOverlaps', () => {

    it('findOverlaps_disjointEpics_returnsEmptyArray', () => {
        const p = writeBacklog(cleanBacklog);
        const map = extractEpicFiles(p);
        const overlaps = findOverlaps(map);

        expect(overlaps).toEqual([]);
    });

    it('findOverlaps_twoEpicsShareOneFile_flagsThePair', () => {
        const p = writeBacklog(twoEpicOverlap);
        const map = extractEpicFiles(p);
        const overlaps = findOverlaps(map);

        expect(overlaps).toHaveLength(1);
        const pair = overlaps[0];
        expect(pair).toHaveProperty('epicA');
        expect(pair).toHaveProperty('epicB');
        expect(pair).toHaveProperty('sharedFiles');
        expect(pair.sharedFiles).toEqual(['src/shared/api-client.ts']);
        // epicA < epicB by string compare
        expect(pair.epicA < pair.epicB).toBe(true);
    });

    it('findOverlaps_threeEpicsShareTwoFiles_reportsAllThreePairs', () => {
        const p = writeBacklog(threeEpicTwoFileOverlap);
        const map = extractEpicFiles(p);
        const overlaps = findOverlaps(map);

        // 3 epics → C(3,2) = 3 pairs, each sharing 2 files
        expect(overlaps).toHaveLength(3);

        // Every pair has both shared files, alphabetically sorted
        for (const pair of overlaps) {
            expect(pair.sharedFiles).toEqual(['src/shared/types.ts', 'src/shared/util.ts']);
            expect(pair.epicA < pair.epicB).toBe(true);
        }

        // No duplicate pairs
        const pairKeys = overlaps.map(p => `${p.epicA}|${p.epicB}`);
        expect(new Set(pairKeys).size).toBe(3);
    });

    it('findOverlaps_emptyMap_returnsEmptyArray', () => {
        const overlaps = findOverlaps(new Map());
        expect(overlaps).toEqual([]);
    });

    it('findOverlaps_singleEpicNoComparison_returnsEmptyArray', () => {
        const map = new Map([['Epic 1', new Set(['a.ts', 'b.ts'])]]);
        const overlaps = findOverlaps(map);
        expect(overlaps).toEqual([]);
    });

    it('findOverlaps_sharedFilesSortedAlphabetically', () => {
        const map = new Map([
            ['Epic 1: One', new Set(['z.ts', 'a.ts', 'm.ts'])],
            ['Epic 2: Two', new Set(['m.ts', 'a.ts', 'z.ts'])],
        ]);
        const overlaps = findOverlaps(map);
        expect(overlaps).toHaveLength(1);
        expect(overlaps[0].sharedFiles).toEqual(['a.ts', 'm.ts', 'z.ts']);
    });

});

// ─── CLI ─────────────────────────────────────────────────────────────────────

describe('epic-overlap CLI', () => {

    const cliPath = path.resolve(__dirname, '..', 'epic-overlap.js');

    it('CLI_cleanBacklog_exits0AndPrintsCleanMessage', () => {
        const p = writeBacklog(cleanBacklog);
        // Use { stdio: 'pipe' } so we capture output rather than streaming
        const stdout = execFileSync('node', [cliPath, p], { encoding: 'utf8' });
        expect(stdout).toMatch(/no.*overlap/i);
    });

    it('CLI_overlapDetected_exits1AndPrintsOverlapReport', () => {
        const p = writeBacklog(twoEpicOverlap);
        let exitCode = 0;
        let stdout = '';
        try {
            stdout = execFileSync('node', [cliPath, p], { encoding: 'utf8' });
        } catch (err) {
            exitCode = err.status;
            stdout = err.stdout?.toString() || '';
        }
        expect(exitCode).toBe(1);
        expect(stdout).toMatch(/overlap/i);
        expect(stdout).toContain('src/shared/api-client.ts');
    });

    it('CLI_missingFile_exitsNonZeroWithError', () => {
        const missing = path.join(tmpDir, 'nope.md');
        let exitCode = 0;
        try {
            execFileSync('node', [cliPath, missing], { encoding: 'utf8' });
        } catch (err) {
            exitCode = err.status;
        }
        expect(exitCode).not.toBe(0);
    });

});
