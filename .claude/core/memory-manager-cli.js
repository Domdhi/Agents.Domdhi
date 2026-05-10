#!/usr/bin/env node

/**
 * Memory Manager CLI — subcommand dispatcher, extracted from memory-manager.js
 * as part of Task #11. Keeps the module pure (class export only); this file
 * carries the CLI surface.
 *
 * Existing callers that ran `node .claude/core/memory-manager.js <cmd>` still
 * work — memory-manager.js forwards to this file when invoked directly.
 *
 * Usage:
 *   node .claude/core/memory-manager-cli.js <command> [args]
 */

const MemoryManager = require('./memory-manager');
const { MEMORY_DECAY } = require('./constants');

async function main() {
    const manager = new MemoryManager();
    const [, , command, ...args] = process.argv;

    switch (command) {
        case 'create': {
            const [category, id] = args;
            const content = JSON.parse(args[2] || '{}');
            await manager.createMemory(category, id, content);
            break;
        }
        case 'read': {
            const memory = await manager.readMemory(args[0], args[1]);
            console.log(JSON.stringify(memory, null, 2));
            break;
        }
        case 'list': {
            const memories = await manager.listMemories(args[0]);
            console.log(JSON.stringify(memories, null, 2));
            break;
        }
        case 'search': {
            const results = await manager.searchMemories(args[0]);
            console.log(JSON.stringify(results, null, 2));
            break;
        }
        case 'report': {
            const report = await manager.generateReport();
            console.log(JSON.stringify(report, null, 2));
            break;
        }
        case 'rebuild-index': {
            await manager.rebuildIndex();
            break;
        }
        case 'lint': {
            const result = await manager.lintMemories();
            console.log(JSON.stringify(result, null, 2));
            break;
        }
        case 'decay-report': {
            // Collect all memories across all categories with decayed confidence
            const allEntries = [];
            for (const category of manager.categories) {
                const memories = await manager.listMemories(category);
                for (const m of memories) {
                    allEntries.push({
                        category,
                        id: m.id,
                        confidence: m.confidence,
                        decayed_confidence: m.decayed_confidence,
                        decay_rate: MEMORY_DECAY.RATES[category] || MEMORY_DECAY.DEFAULT_RATE,
                        usage_count: m.usage_count,
                        updated: m.updated,
                    });
                }
            }
            // Sort ascending by decayed_confidence (stalest first)
            allEntries.sort((a, b) => a.decayed_confidence - b.decayed_confidence);
            console.log(JSON.stringify(allEntries, null, 2));
            break;
        }
        case 'ingest': {
            const [sourcePath] = args;
            if (!sourcePath) {
                console.error('Error: ingest requires a source path (file or directory)');
                process.exit(1);
            }
            const dryRun = args.includes('--dry-run');
            const report = await manager.ingestAgentMemory(sourcePath, { dryRun });
            console.log(JSON.stringify(report, null, 2));
            console.log(
                `\nSummary: ${report.ingested} ingested, ${report.skipped} skipped, ${report.errors.length} errors` +
                (dryRun ? ' (DRY RUN — no writes)' : '')
            );
            break;
        }
        case 'delete': {
            const [category, id] = args;
            if (!category || !id) {
                console.error('Error: delete requires <category> <id>');
                process.exit(1);
            }
            const result = await manager.deleteMemory(category, id);
            if (result.deleted) {
                console.log(`🗑️  Deleted: ${category}/${id}`);
            } else {
                console.error(`❌ Delete failed: ${result.error}`);
                process.exit(1);
            }
            break;
        }
        case 'inbox-list': {
            const entries = await manager.inboxList();
            console.log(JSON.stringify(entries, null, 2));
            break;
        }
        case 'inbox-promote': {
            const [id] = args;
            if (!id) {
                console.error('Error: inbox-promote requires an inbox draft id');
                process.exit(1);
            }
            const opts = {};
            for (let i = 1; i < args.length; i++) {
                if (args[i] === '--category' && args[i + 1]) { opts.categoryOverride = args[++i]; }
                else if (args[i] === '--id' && args[i + 1]) { opts.idOverride = args[++i]; }
            }
            const result = await manager.inboxPromote(id, opts);
            if (result.promoted) {
                console.log(`✅ Promoted: ${result.category}/${result.id}`);
            } else {
                console.error(`❌ Promote failed: ${result.error}`);
                process.exit(1);
            }
            break;
        }
        case 'inbox-discard': {
            const [id] = args;
            if (!id) {
                console.error('Error: inbox-discard requires an inbox draft id');
                process.exit(1);
            }
            const result = await manager.inboxDiscard(id);
            if (result.discarded) {
                console.log(`🗑️  Discarded inbox draft: ${id}`);
            } else {
                console.error(`❌ Discard failed: ${result.error}`);
                process.exit(1);
            }
            break;
        }
        case 'boost-from-git': {
            const opts = {};
            for (let i = 0; i < args.length; i++) {
                if (args[i] === '--limit' && args[i + 1]) { opts.limit = parseInt(args[++i], 10); }
                else if (args[i] === '--dry-run') { opts.dryRun = true; }
            }
            const boostReport = await manager.boostFromGitLog(opts);
            console.log('category\tid\tkeywords\tcommits\told→new');
            for (const entry of boostReport.boosted) {
                console.log([
                    entry.category,
                    entry.id,
                    entry.keywords.join(','),
                    entry.commits.join(' | '),
                    `${entry.oldConf.toFixed(3)}→${entry.newConf.toFixed(3)}`,
                ].join('\t'));
            }
            console.log(`\nScanned: ${boostReport.scanned}, Boosted: ${boostReport.boosted.length}, Skipped: ${boostReport.skipped.length}${opts.dryRun ? ' (DRY RUN — no writes)' : ''}`);
            if (boostReport.error) console.error('Error:', boostReport.error);
            break;
        }
        default:
            console.log(`
Memory Manager (JSON + SQLite FTS5)
====================================

Usage:
  node memory-manager-cli.js create <category> <id> <content>
  node memory-manager-cli.js read <category> <id>
  node memory-manager-cli.js delete <category> <id>
  node memory-manager-cli.js list <category>
  node memory-manager-cli.js search <term>
  node memory-manager-cli.js report
  node memory-manager-cli.js rebuild-index
  node memory-manager-cli.js decay-report
  node memory-manager-cli.js boost-from-git [--limit N] [--dry-run]
  node memory-manager-cli.js lint
  node memory-manager-cli.js ingest <path> [--dry-run]
    Ingest auto-memory .md files (YAML frontmatter + body) into the
    JSON store. Path may be a single file or a directory (walked recursively).
    type → category: feedback/pattern → patterns, constraint → constraints,
    decision → decisions, workflow → workflows, rejected-approach → rejected-approaches.

Inbox (R-A — sub-agent draft memory pattern):
  node memory-manager-cli.js inbox-list
  node memory-manager-cli.js inbox-promote <id> [--category <cat>] [--id <id>]
  node memory-manager-cli.js inbox-discard <id>
    Sub-agents flag draft memories to docs/.output/memories/_inbox/ during
    their work. Main Agent reviews on dispatch return: promote keepers,
    discard noise. See docs/.output/plans/2026-05-11-do-r-a-inbox-pattern.md.

Categories: patterns, constraints, decisions, workflows, rejected-approaches
Storage: docs/.output/memories/ (JSON) + memories.db (SQLite FTS5)
            `);
    }
}

if (require.main === module) {
    main().catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { main };
