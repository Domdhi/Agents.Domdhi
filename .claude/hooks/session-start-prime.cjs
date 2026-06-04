#!/usr/bin/env node

/**
 * SessionStart Context Prime Hook
 *
 * Injects a bulleted list of the top-N structured memories as a
 * system-reminder at the opening of every Claude Code session. These are
 * the JSON memories produced by the Haiku extractor (or hand-created via
 * memory-manager.js) — the substantive, curated lessons — not the
 * compaction-snapshot concept articles at memories/concepts/ (which tend
 * to be branch-activity meta-noise).
 *
 * Source: docs/.output/memories/{category}/*.json
 *   where category in {patterns, constraints, decisions, workflows, rejected-approaches}
 *
 * Ranking: decayed_confidence × recency_factor × log(1 + usage_count)
 *   - decayed_confidence: via MemoryManager.calculateDecayedConfidence()
 *   - recency_factor:     1 / (1 + daysSinceLastUpdated); 1.0 if missing
 *   - usage_count:        floored at 1 so unused memories still rank
 *
 * Output: XML-tagged markdown block written to stdout. Claude Code injects
 * hook stdout as a session system-reminder — no JSON envelope required.
 *
 * Gating:
 *   - MEMORY_PROFILE=minimal       → exits 0 with empty output
 *   - MEMORY_PRIME_COUNT env var   → overrides default N=8 (clamped 1..20)
 *
 * Safety: wraps everything in try/catch + 2s hard timeout. On any failure
 * exits 0 silently so a bug here can never block session start.
 *
 * Exit codes: always 0
 */

const fs = require('fs');
const path = require('path');
const { isAtLeast } = require('../core/profile');
const CONSTANTS = require('../core/constants');
const { appendJsonl } = require('../core/_lib/jsonl-writer');

const HARD_TIMEOUT_MS = 2000;
const SOFT_BUDGET_MS = 500;
const DEFAULT_N = 8;
const MAX_N = 20;
const SUMMARY_MAX = 160;
const MEMORY_CATEGORIES = Object.values(CONSTANTS.MEMORY_CATEGORIES);

function parseMemory(content, category, filename) {
    let json;
    try {
        json = JSON.parse(content);
    } catch {
        return null;
    }

    const slug = filename.replace(/\.json$/, '');
    const id = typeof json.id === 'string' && json.id ? json.id : slug;

    let summary = '';
    if (json.content && typeof json.content === 'object') {
        if (typeof json.content.description === 'string') {
            summary = json.content.description;
        } else if (typeof json.content.summary === 'string') {
            summary = json.content.summary;
        }
    } else if (typeof json.content === 'string') {
        summary = json.content;
    }
    summary = summary.trim();
    if (summary.length > SUMMARY_MAX) summary = summary.slice(0, SUMMARY_MAX - 3) + '...';

    let confidence = 0.6;
    if (json.metadata && Number.isFinite(json.metadata.confidence)) {
        confidence = json.metadata.confidence;
    } else if (Number.isFinite(json.confidence)) {
        confidence = json.confidence;
    }

    const rawUsage = Number.isFinite(json.usage_count) ? json.usage_count : 0;
    const usage_count = Math.max(1, rawUsage);

    const updated = typeof json.updated === 'string' ? json.updated : null;

    return {
        slug: id,
        title: id,
        category,
        confidence,
        updated,
        usage_count,
        summary: summary || '(no summary)'
    };
}

function rankConcepts(concepts, manager) {
    const now = Date.now();

    for (const c of concepts) {
        let decayed = 0.6;
        try {
            decayed = manager.calculateDecayedConfidence({
                metadata: { confidence: c.confidence },
                category: c.category,
                updated: c.updated || new Date().toISOString(),
                usage_count: c.usage_count
            });
        } catch {
            decayed = c.confidence;
        }

        let recency = 1.0;
        if (c.updated) {
            const days = (now - new Date(c.updated).getTime()) / (1000 * 60 * 60 * 24);
            if (Number.isFinite(days) && days >= 0) recency = 1 / (1 + days);
        }

        const usageTerm = Math.log(1 + c.usage_count);

        c.score = decayed * recency * usageTerm;
        c.decayed = decayed;
    }

    concepts.sort((a, b) => b.score - a.score);
    return concepts;
}

function renderOutput(topConcepts, totalCount) {
    const lines = topConcepts.map(c => {
        const confStr = c.decayed.toFixed(2);
        const cat = c.category ? ` [${c.category}]` : '';
        return `- **${c.slug}**${cat} (conf: ${confStr}) — ${c.summary}`;
    });

    return `<project_memory>
# Project Memory

Top ${topConcepts.length} of ${totalCount} structured memories (ranked by decayed confidence × recency × usage).

${lines.join('\n')}
</project_memory>
`;
}

function processEvent(_parsedJson) {
    if (!isAtLeast('standard')) {
        return { output: null };
    }

    const projectDir = process.env.CLAUDE_PROJECT_DIR
        || path.resolve(__dirname, '..', '..');
    const memoriesDir = path.join(projectDir, 'docs', '.output', 'memories');

    if (!fs.existsSync(memoriesDir)) return { output: null };

    const rawN = parseInt(process.env.MEMORY_PRIME_COUNT, 10);
    const N = Number.isFinite(rawN)
        ? Math.min(MAX_N, Math.max(1, rawN))
        : DEFAULT_N;

    const memories = [];
    for (const category of MEMORY_CATEGORIES) {
        const catDir = path.join(memoriesDir, category);
        if (!fs.existsSync(catDir)) continue;
        let files;
        try {
            files = fs.readdirSync(catDir).filter(f => f.endsWith('.json'));
        } catch {
            continue;
        }
        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(catDir, file), 'utf8');
                const parsed = parseMemory(content, category, file);
                if (parsed) memories.push(parsed);
            } catch {
                // skip unreadable memory
            }
        }
    }

    if (memories.length === 0) return { output: null };

    const MemoryManager = require('../core/memory-manager');
    const manager = new MemoryManager();
    rankConcepts(memories, manager);

    const top = memories.slice(0, N);
    const output = renderOutput(top, memories.length);

    // MP-1.2: record which memories were surfaced this session start, so hit-rate
    // analysis has a denominator. Best-effort — a telemetry failure here must
    // never break injection, so the whole write is wrapped and swallowed.
    // When 0 memories are injected the function returns earlier (line ~179), so
    // this only logs real injections (injected_count >= 1).
    try {
        const ts = new Date().toISOString();
        const jsonlPath = path.join(projectDir, 'docs', '.output', 'telemetry', 'memory-injection.jsonl');
        appendJsonl(jsonlPath, {
            timestamp: ts,
            type: 'memory_injection',
            injected_count: top.length,
            total_available: memories.length,
            injected_ids: top.map(c => c.slug),
            session_proxy: ts.slice(0, 16),   // ISO-8601 truncated to the minute — session join key
        });
    } catch {
        // best-effort — injection output still prints
    }

    return { output };
}

if (require.main === module) {
    const hardExit = setTimeout(() => process.exit(0), HARD_TIMEOUT_MS);
    hardExit.unref();

    process.on('uncaughtException', () => process.exit(0));
    process.on('unhandledRejection', () => process.exit(0));

    (async () => {
        const start = process.hrtime.bigint();

        try {
            const result = processEvent({});

            if (result.output !== null) {
                process.stdout.write(result.output);

                const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
                if (elapsedMs > SOFT_BUDGET_MS) {
                    process.stderr.write(
                        `[session-start-prime] ${elapsedMs.toFixed(0)}ms (budget ${SOFT_BUDGET_MS}ms)\n`
                    );
                }
            }
        } catch {
            // Never break session start
        }

        process.exit(0);
    })();
}

module.exports = { processEvent, rankConcepts, renderOutput, parseMemory };
