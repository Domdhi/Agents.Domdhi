#!/usr/bin/env node

/**
 * Memory Extractor - Processes daily logs through Haiku for structured learning extraction
 *
 * Reads daily logs from docs/.output/memories/daily/{YYYY-MM-DD}.md
 * Invokes claude -p with Haiku model to extract structured learnings
 * Writes extracted learnings to docs/.output/memories/extracted/{date}/
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { parseDailyFile: parseDailyFileLib } = require('./_lib/daily-log-parser');
const {
    checkClaudeCli,
    invokeHaiku,
    tryParseInnerJson,
} = require('./_lib/haiku-runner');

const MAX_ENTRIES_PER_RUN = 10;

class MemoryExtractor {
    constructor() {
        this.projectRoot = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
        this.dailyDir = path.join(this.projectRoot, 'docs', '.output', 'memories', 'daily');
        this.extractedDir = path.join(this.projectRoot, 'docs', '.output', 'memories', 'extracted');
    }

    /**
     * Check if the claude CLI is available in PATH.
     * Thin adapter over _lib/haiku-runner.
     */
    checkClaudeCli() {
        return checkClaudeCli();
    }

    /**
     * Split a daily log file into individual compaction entries.
     * Thin adapter over _lib/daily-log-parser.js — preserves instance-method API.
     * Returns array of { date, time, heading, rawText }.
     */
    parseDailyFile(content, date) {
        return parseDailyFileLib(content, date);
    }

    /**
     * Check if an entry heading contains the [extracted] marker.
     */
    isProcessed(heading) {
        return heading.includes('[extracted]');
    }

    /**
     * Mark an entry as processed by appending [extracted] to its heading line.
     * Reads the file, replaces the exact heading, writes back.
     */
    async markProcessed(filePath, originalHeading) {
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const markedHeading = `${originalHeading} [extracted]`;
        const updated = content.replace(originalHeading, markedHeading);
        await fsPromises.writeFile(filePath, updated, 'utf-8');
    }

    /**
     * Invoke Haiku via claude -p to extract structured learnings from an entry.
     * Returns array of { category, title, content, confidence }.
     * Returns [] on failure (graceful degradation).
     */
    invokeHaiku(entryText) {
        const prompt = [
            'Read this daily log entry. Extract structured learnings.',
            'For each learning, output: category (pattern|constraint|decision|workflow),',
            'title (3-5 words), content (1-2 sentences), confidence (0.5-0.9).',
            'Output as JSON array only — no explanation, no markdown fences, just the JSON array.',
            '',
            '--- ENTRY START ---',
            entryText,
            '--- ENTRY END ---'
        ].join('\n');

        // Extractor differs from curator/benchmark in two ways:
        //   - Shorter timeout (30s — per-entry extraction is faster than full curation)
        //   - Raw-payload response (no { result, usage } envelope expected — tests mock
        //     with raw JSON arrays; production behavior matches per current fixtures)
        const raw = invokeHaiku(prompt, {
            cwd: this.projectRoot,
            timeout: 30000,
            // Extractor's original inline logger emitted to stderr with "Warning:" prefix
            // before the message. The shared runner prefixes with logTag — use 'extractor'
            // to keep telemetry grep-able, and accept the slight message-format shift.
            logTag: null, // handled by the outer try/catch at call site below
        });

        if (raw === null) {
            process.stderr.write('  Warning: Haiku invocation failed — subprocess returned null\n');
            return [];
        }

        // Extractor uses raw-payload parsing (no envelope unwrapping) — historical behavior.
        const parsed = tryParseInnerJson(raw);
        if (parsed === null) {
            process.stderr.write('  Warning: JSON parse failed for entry\n');
            return [];
        }

        if (Array.isArray(parsed)) {
            return parsed.filter(item =>
                item &&
                typeof item.category === 'string' &&
                typeof item.title === 'string' &&
                typeof item.content === 'string' &&
                typeof item.confidence === 'number'
            );
        }
        // If the model wrapped in an object, try to find the array
        if (parsed && Array.isArray(parsed.learnings)) return parsed.learnings;
        if (parsed && Array.isArray(parsed.results)) return parsed.results;
        return [];
    }

    /**
     * Write extracted learnings to docs/.output/memories/extracted/{date}/{timestamp}.json
     */
    async writeExtractedLearnings(date, learnings, timestamp) {
        const dateDir = path.join(this.extractedDir, date);
        fs.mkdirSync(dateDir, { recursive: true });

        const filename = `${timestamp}.json`;
        const filePath = path.join(dateDir, filename);

        const payload = {
            extractedAt: new Date().toISOString(),
            sourceDate: date,
            count: learnings.length,
            learnings
        };

        await fsPromises.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
        return filePath;
    }

    /**
     * Main extract command.
     * Iterates daily files, finds unprocessed entries, processes up to MAX_ENTRIES_PER_RUN.
     * In --dry-run mode: lists what would be processed without invoking Haiku or writing files.
     * Returns { processed, skipped, failed }.
     */
    async extract(options = {}) {
        const { dryRun = false } = options;

        if (dryRun) {
            console.log('Dry run mode — no files will be written, no Haiku invocations.\n');
        }

        // Read all daily log files
        let dailyFiles = [];
        try {
            const files = await fsPromises.readdir(this.dailyDir);
            dailyFiles = files
                .filter(f => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
                .sort();
        } catch {
            console.log('No daily log directory found at', this.dailyDir);
            return { processed: 0, skipped: 0, failed: 0 };
        }

        if (dailyFiles.length === 0) {
            console.log('No daily log files found.');
            return { processed: 0, skipped: 0, failed: 0 };
        }

        // Collect all unprocessed entries across all files
        const unprocessed = [];

        for (const file of dailyFiles) {
            const date = file.replace('.md', '');
            const filePath = path.join(this.dailyDir, file);

            let content;
            try {
                content = await fsPromises.readFile(filePath, 'utf-8');
            } catch {
                process.stderr.write(`  Warning: could not read ${file}, skipping.\n`);
                continue;
            }

            const entries = this.parseDailyFile(content, date);
            for (const entry of entries) {
                if (!this.isProcessed(entry.heading)) {
                    unprocessed.push({ ...entry, filePath });
                }
            }
        }

        if (unprocessed.length === 0) {
            console.log('All entries already extracted. Nothing to do.');
            return { processed: 0, skipped: 0, failed: 0 };
        }

        // Apply rate limit
        const toProcess = unprocessed.slice(0, MAX_ENTRIES_PER_RUN);
        const skippedByLimit = unprocessed.length - toProcess.length;

        if (dryRun) {
            console.log(`Found ${unprocessed.length} unprocessed entry/entries.`);
            if (skippedByLimit > 0) {
                console.log(`Rate limit: would process ${toProcess.length}, defer ${skippedByLimit} to next run.\n`);
            }
            console.log('Would process:');
            for (const entry of toProcess) {
                console.log(`  [${entry.date} ${entry.time}] ${entry.heading}`);
            }
            return { processed: 0, skipped: unprocessed.length, failed: 0 };
        }

        // Process entries
        let processed = 0;
        let failed = 0;
        const now = new Date();
        const timestamp = now.toISOString().slice(0, 19).replace(/[T:]/g, '-');
        const todayDate = now.toISOString().slice(0, 10);

        const allLearnings = [];

        console.log(`Processing ${toProcess.length} entry/entries (${skippedByLimit} deferred by rate limit)...\n`);

        for (const entry of toProcess) {
            process.stdout.write(`  Extracting [${entry.date} ${entry.time}]... `);

            const learnings = this.invokeHaiku(entry.rawText);

            if (learnings === null || learnings === undefined) {
                // invokeHaiku returns [] on failure — this branch is unreachable but kept for safety
                console.log('FAILED (null result)');
                failed++;
                continue;
            }

            if (learnings.length === 0) {
                console.log('done (0 learnings extracted)');
                // Still mark as processed so we don't retry endlessly on entries with no learnings
                try {
                    await this.markProcessed(entry.filePath, entry.heading);
                } catch (err) {
                    process.stderr.write(`  Warning: could not mark entry as processed — ${err.message}\n`);
                }
                processed++;
                continue;
            }

            // Attach source metadata to each learning
            for (const learning of learnings) {
                allLearnings.push({
                    ...learning,
                    sourceDate: entry.date,
                    sourceTime: entry.time
                });
            }

            // Mark the entry as processed
            try {
                await this.markProcessed(entry.filePath, entry.heading);
                console.log(`done (${learnings.length} learning(s))`);
                processed++;
            } catch (err) {
                process.stderr.write(`  Warning: could not mark entry as processed — ${err.message}\n`);
                // Still count as processed since the Haiku call succeeded
                processed++;
            }
        }

        // Write all learnings from this run to a single JSON file
        if (allLearnings.length > 0) {
            try {
                const outPath = await this.writeExtractedLearnings(todayDate, allLearnings, timestamp);
                console.log(`\nExtracted ${allLearnings.length} learning(s) → ${outPath}`);
            } catch (err) {
                process.stderr.write(`  Warning: could not write extracted learnings file — ${err.message}\n`);
                failed++;
            }
        } else {
            console.log('\nNo learnings extracted this run.');
        }

        if (skippedByLimit > 0) {
            console.log(`\nNote: ${skippedByLimit} entry/entries deferred (rate limit: ${MAX_ENTRIES_PER_RUN}/run). Run again to continue.`);
        }

        return { processed, skipped: skippedByLimit, failed };
    }

    /**
     * Status command.
     * Shows count of unprocessed entries, count of extracted entries, last extraction date.
     */
    async status() {
        console.log('Memory Extractor — status\n');

        // Count total and unprocessed entries across all daily files
        let totalEntries = 0;
        let unprocessedEntries = 0;
        let dailyFileCount = 0;

        try {
            const files = await fsPromises.readdir(this.dailyDir);
            const mdFiles = files.filter(f => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
            dailyFileCount = mdFiles.length;

            for (const file of mdFiles) {
                const date = file.replace('.md', '');
                try {
                    const content = await fsPromises.readFile(path.join(this.dailyDir, file), 'utf-8');
                    const entries = this.parseDailyFile(content, date);
                    totalEntries += entries.length;
                    for (const entry of entries) {
                        if (!this.isProcessed(entry.heading)) {
                            unprocessedEntries++;
                        }
                    }
                } catch {
                    // skip unreadable files
                }
            }
        } catch {
            // daily dir may not exist yet
        }

        const extractedEntries = totalEntries - unprocessedEntries;

        // Find last extraction date from extracted dir
        let lastExtractionDate = 'never';
        let totalExtractedLearnings = 0;

        try {
            const dateDirs = await fsPromises.readdir(this.extractedDir);
            const sortedDirs = dateDirs
                .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
                .sort();

            if (sortedDirs.length > 0) {
                lastExtractionDate = sortedDirs[sortedDirs.length - 1];
            }

            // Count total extracted learnings across all files
            for (const dateDir of sortedDirs) {
                const dateDirPath = path.join(this.extractedDir, dateDir);
                try {
                    const jsonFiles = await fsPromises.readdir(dateDirPath);
                    for (const jsonFile of jsonFiles.filter(f => f.endsWith('.json'))) {
                        try {
                            const content = await fsPromises.readFile(path.join(dateDirPath, jsonFile), 'utf-8');
                            const data = JSON.parse(content);
                            if (data && typeof data.count === 'number') {
                                totalExtractedLearnings += data.count;
                            }
                        } catch {
                            // skip unreadable JSON
                        }
                    }
                } catch {
                    // skip unreadable date dir
                }
            }
        } catch {
            // extracted dir may not exist yet
        }

        console.log(`Daily log files    : ${dailyFileCount}`);
        console.log(`Total entries      : ${totalEntries}`);
        console.log(`Extracted entries  : ${extractedEntries}`);
        console.log(`Unprocessed entries: ${unprocessedEntries}`);
        console.log(`Extracted learnings: ${totalExtractedLearnings}`);
        console.log(`Last extraction    : ${lastExtractionDate}`);
        console.log(`Daily dir          : ${this.dailyDir}`);
        console.log(`Extracted dir      : ${this.extractedDir}`);
    }
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

async function main() {
    const extractor = new MemoryExtractor();
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case 'extract': {
            const dryRun = args.includes('--dry-run');
            if (!dryRun && !extractor.checkClaudeCli()) {
                console.error('claude CLI required for extraction. Install from https://claude.ai/code');
                process.exit(1);
            }
            const result = await extractor.extract({ dryRun });
            if (!dryRun) {
                process.stderr.write(`Estimated cost: ~$0.02-0.05 per entry, ${result.processed} entries processed\n`);
            }
            break;
        }
        case 'status':
            await extractor.status();
            break;
        default:
            console.log('Usage:\n  node memory-extractor.js extract [--dry-run]\n  node memory-extractor.js status');
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err.message);
        process.exit(1);
    });
}

module.exports = MemoryExtractor;
