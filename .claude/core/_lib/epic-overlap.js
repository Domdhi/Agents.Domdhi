/**
 * epic-overlap — Detect file ownership overlaps between epics in a _backlog.md.
 *
 * Wave-based execution in /run-todo dispatches parallel agents per wave. When two
 * epics claim the same file, concurrent agents produce silent merge conflicts.
 * This module makes that problem visible before /run-todo fires.
 *
 * Exports:
 *   extractEpicFiles(backlogPath)  → Map<epicId, Set<filePath>>
 *   findOverlaps(epicFilesMap)     → Array<{epicA, epicB, sharedFiles}>
 *
 * CLI:
 *   node epic-overlap.js <backlog-path>
 *   Exit 0 — no overlaps found
 *   Exit 1 — overlaps found (report printed to stdout)
 *   Exit non-zero (via throw) — backlog file not readable
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Parse a _backlog.md file and return a map of epic identifiers to the set of
 * file paths claimed by that epic across all of its stories.
 *
 * Epic headings are recognised by the pattern:
 *   ### Epic <something>: <name>
 * e.g. "### Epic 1: Authentication" or "### Epic A: Auth"
 *
 * File paths are extracted from lines matching:
 *   * `some/path/file.ext` — description
 * inside a `* **Files:**` block under a story. Only the path between the first
 * pair of backticks is kept; everything after (` — description`) is discarded.
 *
 * @param {string} backlogPath  Absolute or relative path to the _backlog.md file.
 * @returns {Map<string, Set<string>>} Keys are epic headings (e.g. "Epic 1: Authentication").
 * @throws {Error} If the file cannot be read — message contains the path.
 */
function extractEpicFiles(backlogPath) {
    let content;
    try {
        content = fs.readFileSync(backlogPath, 'utf8');
    } catch (err) {
        throw new Error(
            `epic-overlap: could not read backlog file at "${backlogPath}": ${err.message}`
        );
    }

    const result = new Map();
    const lines = content.split(/\r?\n/);

    // Regex for an epic heading: ### Epic <id>: <name>
    // Captures the full "Epic 1: Authentication" portion as the key.
    const epicHeadingRe = /^###\s+(Epic\s+\S+:\s+.+)$/;

    // A `* **Files:**` marker — zero-or-more leading whitespace so we accept
    // both nested-under-story and flat-under-epic formatting.
    const filesBlockRe = /^\s*\*\s+\*\*Files:\*\*\s*$/;

    // A file entry: optional leading whitespace, `* `, then a backtick-delimited path
    // e.g.:   `    * \`src/auth/login.ts\` — new`
    const fileEntryRe = /^\s*\*\s+`([^`]+)`/;

    let currentEpic = null;   // string key for the current epic
    let inFilesBlock = false;  // are we inside a `**Files:**` list?

    for (const line of lines) {
        // Check for a new epic heading
        const epicMatch = line.match(epicHeadingRe);
        if (epicMatch) {
            const epicKey = epicMatch[1].trim();
            currentEpic = epicKey;
            if (!result.has(currentEpic)) {
                result.set(currentEpic, new Set());
            }
            inFilesBlock = false;
            continue;
        }

        if (currentEpic === null) continue;

        // Check for a **Files:** block marker
        if (filesBlockRe.test(line)) {
            inFilesBlock = true;
            continue;
        }

        if (inFilesBlock) {
            const fileMatch = line.match(fileEntryRe);
            if (fileMatch) {
                result.get(currentEpic).add(fileMatch[1]);
            } else {
                // Any non-file-entry line ends the files block
                // (but only if it isn't blank — blank lines between bullets are ok)
                const trimmed = line.trim();
                if (trimmed !== '') {
                    inFilesBlock = false;
                }
            }
        }
    }

    return result;
}

/**
 * Given a Map of epic → Set<filePath>, return all pairs of epics that share at
 * least one file.
 *
 * Each pair appears exactly once. The pair is ordered so that epicA < epicB by
 * string comparison. sharedFiles is sorted alphabetically.
 *
 * @param {Map<string, Set<string>>} epicFilesMap
 * @returns {Array<{epicA: string, epicB: string, sharedFiles: string[]}>}
 */
function findOverlaps(epicFilesMap) {
    const epics = [...epicFilesMap.keys()];
    const overlaps = [];

    for (let i = 0; i < epics.length; i++) {
        for (let j = i + 1; j < epics.length; j++) {
            const keyA = epics[i];
            const keyB = epics[j];
            const setA = epicFilesMap.get(keyA);
            const setB = epicFilesMap.get(keyB);

            const shared = [];
            for (const file of setA) {
                if (setB.has(file)) {
                    shared.push(file);
                }
            }

            if (shared.length === 0) continue;

            shared.sort();

            // Ensure epicA < epicB by string compare
            const [epicA, epicB] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];
            overlaps.push({ epicA, epicB, sharedFiles: shared });
        }
    }

    return overlaps;
}

/**
 * CLI entry point.
 *
 * Usage: node epic-overlap.js <backlog-path>
 *   Exit 0 — no overlaps
 *   Exit 1 — overlaps found (report printed to stdout)
 *   Exit 2 — error (printed to stderr)
 */
function main() {
    const backlogPath = process.argv[2];

    if (!backlogPath) {
        process.stderr.write('Usage: node epic-overlap.js <backlog-path>\n');
        process.exit(2);
    }

    let epicFilesMap;
    try {
        epicFilesMap = extractEpicFiles(backlogPath);
    } catch (err) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(2);
    }

    const overlaps = findOverlaps(epicFilesMap);

    if (overlaps.length === 0) {
        process.stdout.write(`No epic file overlaps found in ${backlogPath}\n`);
        process.exit(0);
    }

    // Print overlap report
    const lines = [
        `Epic file overlap report — ${backlogPath}`,
        `${overlaps.length} overlap${overlaps.length === 1 ? '' : 's'} found:`,
        '',
    ];

    for (const { epicA, epicB, sharedFiles } of overlaps) {
        lines.push(`  ${epicA}  ↔  ${epicB}`);
        for (const f of sharedFiles) {
            lines.push(`    • ${f}`);
        }
        lines.push('');
    }

    lines.push(
        'These epics share files. Parallel agent dispatch (via /run-todo) will produce',
        'merge conflicts unless the overlap is intentional. If intentional, add a',
        '## Acknowledged Overlaps section to _backlog.md listing each pair and rationale.',
        '/review:check-readiness will then accept the overlap as documented.'
    );

    process.stdout.write(lines.join('\n') + '\n');
    process.exit(1);
}

module.exports = { extractEpicFiles, findOverlaps };

if (require.main === module) {
    main();
}
