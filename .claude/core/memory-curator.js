#!/usr/bin/env node

/**
 * Memory Curator — Haiku-powered concept dedup/contradiction/merge analyzer
 *
 * Reads concepts/index.md + today's daily log + top-N concept summaries.
 * Invokes Haiku to propose dedup/contradiction/merge candidates for human review.
 * Writes JSON to docs/.output/memories/pending-curation/{YYYY-MM-DD}/{HH-MM-SS}.json
 *
 * CLI:
 *   node memory-curator.js curate [--dry-run]   — run curation, write JSON (or print if --dry-run)
 *   node memory-curator.js status               — show latest curation file summary
 */

const { execSync } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { MEMORY_DECAY } = require('./constants');

const MAX_CONCEPTS_PER_RUN = 30;
const MAX_ACTIVITY_SCOPE_ARTICLES = 10;
const MAX_ARTICLE_CHARS = 2000;
const MAX_DAILY_LOG_CHARS = 10000;

// Haiku 4.5 pricing (per AC#11 — USD per token)
const HAIKU_INPUT_PRICE = 0.0000008;
const HAIKU_OUTPUT_PRICE = 0.000004;

const CATEGORIES = ['patterns', 'constraints', 'decisions', 'workflows', 'rejected-approaches'];

class MemoryCurator {
    constructor() {
        const projectRoot = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
        this.projectRoot = projectRoot;
        this.dailyDir = path.join(projectRoot, 'docs', '.output', 'memories', 'daily');
        this.conceptsDir = path.join(projectRoot, 'docs', '.output', 'memories', 'concepts');
        this.pendingDir = path.join(projectRoot, 'docs', '.output', 'memories', 'pending-curation');
    }

    // -------------------------------------------------------------------------
    // Guards
    // -------------------------------------------------------------------------

    checkClaudeCli() {
        try {
            execSync('claude --version', { stdio: 'ignore', timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    // -------------------------------------------------------------------------
    // Concept loading (mirrors memory-promoter.loadConcepts, adds 5th category)
    // -------------------------------------------------------------------------

    async loadConcepts() {
        const concepts = [];

        for (const category of CATEGORIES) {
            const catDir = path.join(this.conceptsDir, category);
            let files;
            try {
                files = await fs.readdir(catDir);
            } catch {
                continue;
            }

            for (const file of files) {
                if (!file.endsWith('.md')) continue;
                try {
                    const filePath = path.join(catDir, file);
                    const content = await fs.readFile(filePath, 'utf-8');
                    const fm = this.parseFrontmatter(content);
                    if (!fm) continue;

                    const slug = file.replace('.md', '');
                    const confidence = parseFloat(fm.confidence) || 0.6;
                    const updated = fm.updated || new Date().toISOString();

                    const daysSinceUpdate = (Date.now() - new Date(updated)) / (1000 * 60 * 60 * 24);
                    const rate = MEMORY_DECAY.RATES[category] || MEMORY_DECAY.DEFAULT_RATE;
                    let decayed = confidence * Math.pow(rate, daysSinceUpdate);
                    decayed += MEMORY_DECAY.USAGE_BOOST * (parseInt(fm.usage_count) || 0);
                    if (daysSinceUpdate < MEMORY_DECAY.RECENT_UPDATE_DAYS) {
                        decayed += MEMORY_DECAY.RECENT_UPDATE_BOOST;
                    }
                    decayed = Math.min(decayed, 1.0);

                    concepts.push({
                        slug,
                        title: fm.title || slug,
                        category,
                        content,
                        confidence,
                        decayedConfidence: decayed,
                        sources: fm.sources || []
                    });
                } catch {
                    // skip unreadable files
                }
            }
        }

        return concepts;
    }

    /**
     * Parse YAML frontmatter from a markdown file.
     * Mirrors memory-promoter.js parseFrontmatter.
     */
    parseFrontmatter(content) {
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;

        const raw = match[1];
        const result = {};
        let inSources = false;
        const sourcesList = [];

        for (const line of raw.split('\n')) {
            if (line.startsWith('sources:')) {
                inSources = true;
                continue;
            }
            if (inSources && line.startsWith('  - ')) {
                sourcesList.push(line.replace('  - ', '').trim());
                continue;
            }
            inSources = false;

            const kv = line.match(/^([\w_]+):\s*(.+)$/);
            if (kv) result[kv[1]] = kv[2].trim();
        }

        if (sourcesList.length > 0) result.sources = sourcesList;
        return result;
    }

    // -------------------------------------------------------------------------
    // Input gathering
    // -------------------------------------------------------------------------

    getTodayDailyLog() {
        const today = new Date().toISOString().slice(0, 10);
        const filePath = path.join(this.dailyDir, `${today}.md`);
        if (!fsSync.existsSync(filePath)) return null;
        return {
            path: filePath,
            date: today,
            content: fsSync.readFileSync(filePath, 'utf-8')
        };
    }

    getIndexMd() {
        const p = path.join(this.conceptsDir, 'index.md');
        if (!fsSync.existsSync(p)) return '';
        return fsSync.readFileSync(p, 'utf-8');
    }

    /**
     * Activity-scope articles: concepts whose slug appears in today's daily log.
     * Capped at MAX_ACTIVITY_SCOPE_ARTICLES to keep prompt size bounded.
     */
    getActivityScope(concepts, dailyLogContent) {
        if (!dailyLogContent) return [];
        const lc = dailyLogContent.toLowerCase();
        return concepts
            .filter(c => lc.includes(c.slug.toLowerCase()))
            .slice(0, MAX_ACTIVITY_SCOPE_ARTICLES);
    }

    // -------------------------------------------------------------------------
    // Prompt construction (per design review Addendum C — explicit rubric)
    // -------------------------------------------------------------------------

    buildPrompt(indexContent, activityArticles, dailyLogContent, concepts) {
        // Sample top 30 by decayed_confidence (AC#8)
        const topConcepts = concepts
            .slice()
            .sort((a, b) => b.decayedConfidence - a.decayedConfidence)
            .slice(0, MAX_CONCEPTS_PER_RUN);

        const conceptsList = topConcepts
            .map(c => `- [${c.category}] ${c.slug} — ${c.title} (conf: ${c.decayedConfidence.toFixed(2)})`)
            .join('\n');

        const articlesBlock = activityArticles.length === 0
            ? '(none — no concept slugs referenced in today\'s daily log)'
            : activityArticles
                .map(c => `### ${c.slug} (${c.category})\n${c.content.slice(0, MAX_ARTICLE_CHARS)}`)
                .join('\n\n---\n\n');

        const dailyLogBlock = dailyLogContent
            ? dailyLogContent.slice(0, MAX_DAILY_LOG_CHARS)
            : '(no daily log for today)';

        // Rubric (Addendum C from design review)
        const rubric = `
DEFINITIONS — be literal with these, and include both positive and counter-examples:

DEDUP_CANDIDATE: two concepts covering the same topic with >60% keyword overlap,
  where one could replace the other without losing information.
  Qualifies: two concepts about the same architectural decision with overlapping rationale.
  Does NOT qualify: two concepts that are related but cover distinct topics (e.g., "haiku browser testing" + "playwright specs" — related workflow, different scope).

CONTRADICTION: two concepts whose guidance is incompatible; following one means violating the other.
  Qualifies: "mock the database in tests" vs. "integration tests must hit a real database".
  Does NOT qualify: two concepts with different-but-additive guidance that both apply in different contexts.

MERGE_PROPOSAL: three or more concepts that would collapse cleanly into one broader concept.
  Qualifies: three concepts all describing git worktree patterns that share most content.
  Does NOT qualify: a pair (that's a DEDUP_CANDIDATE, not a merge).

Report EVERY candidate, including low-confidence ones. Filtering happens downstream.
For each dedup candidate, compute fingerprint_overlap = the count of shared normalized keywords
(title tokens + topic words from the summary, intersection size).`;

        return `You are a memory-system curator. Analyze a memory concept set and propose dedup/contradiction/merge candidates for human review.
${rubric}

<concept_index>
${conceptsList}
</concept_index>

<activity_scope_articles>
${articlesBlock}
</activity_scope_articles>

<todays_daily_log>
${dailyLogBlock}
</todays_daily_log>

Output JSON only. No markdown code fences. No prose. Exact shape:

{
  "generated_at": "<ISO 8601 timestamp>",
  "source_daily_log": "<YYYY-MM-DD or null>",
  "dedup_candidates": [
    {"slug_a": "<slug>", "slug_b": "<slug>", "similarity": <number 0-1>, "rationale": "<1 sentence>", "fingerprint_overlap": <integer>}
  ],
  "contradiction_pairs": [
    {"slug_a": "<slug>", "slug_b": "<slug>", "reason": "<1 sentence>"}
  ],
  "merge_proposals": [
    {"source_slugs": ["<slug>", "<slug>", "<slug>"], "proposed_title": "<title>", "rationale": "<1 sentence>"}
  ]
}

If there are no candidates in a category, return an empty array for it. Emit only the JSON object.`;
    }

    // -------------------------------------------------------------------------
    // Haiku invocation (mirrors memory-extractor.js:104-111 exactly)
    // -------------------------------------------------------------------------

    invokeHaiku(prompt) {
        const escapedPrompt = prompt.replace(/'/g, "'\\''");
        try {
            const result = execSync(
                `claude -p '${escapedPrompt}' --model claude-haiku-4-5 --allowedTools Read --output-format json --bare`,
                {
                    encoding: 'utf8',
                    timeout: 90000,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    maxBuffer: 10 * 1024 * 1024,
                    windowsHide: true,
                }
            );
            return result;
        } catch (e) {
            process.stderr.write(`[memory-curator] Haiku invocation failed: ${e.message}\n`);
            return null;
        }
    }

    /**
     * Parse the --output-format json envelope, then parse the inner JSON payload.
     * The envelope varies by claude CLI version — try common shapes.
     */
    parseHaikuResult(raw) {
        if (!raw) return null;
        let envelope;
        try {
            envelope = JSON.parse(raw);
        } catch {
            // Not JSON at the envelope level — try parsing raw as the payload
            return this.tryParseInnerJson(raw);
        }

        // Common envelope shapes: { result, usage } | { text } | { content: [...] }
        let text = null;
        if (typeof envelope === 'string') text = envelope;
        else if (envelope && typeof envelope === 'object') {
            text = envelope.result || envelope.text || envelope.output || null;
            if (!text && Array.isArray(envelope.content)) {
                text = envelope.content.map(c => c.text || '').join('');
            }
        }

        if (text) return this.tryParseInnerJson(text);
        // Fallback: envelope itself may be the payload
        return envelope && envelope.dedup_candidates !== undefined ? envelope : null;
    }

    tryParseInnerJson(text) {
        if (typeof text !== 'string') return null;
        const stripped = text.trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, '')
            .trim();
        try {
            return JSON.parse(stripped);
        } catch {
            return null;
        }
    }

    /**
     * Extract input/output token counts from the Haiku response envelope.
     * Used for per-invocation cost logging (AC#11).
     */
    extractTokenCounts(raw) {
        try {
            const envelope = JSON.parse(raw);
            if (envelope && envelope.usage) {
                return {
                    input: envelope.usage.input_tokens || 0,
                    output: envelope.usage.output_tokens || 0
                };
            }
        } catch {}
        return { input: 0, output: 0 };
    }

    // -------------------------------------------------------------------------
    // Main flow
    // -------------------------------------------------------------------------

    async curate({ dryRun = false } = {}) {
        if (!this.checkClaudeCli()) {
            process.stderr.write('[memory-curator] claude CLI not available — skipping\n');
            return null;
        }

        const concepts = await this.loadConcepts();
        if (concepts.length === 0) {
            process.stderr.write('[memory-curator] No concepts found — run memory-compiler first\n');
            return null;
        }

        const dailyLog = this.getTodayDailyLog();
        const indexContent = this.getIndexMd();
        const activityScope = this.getActivityScope(concepts, dailyLog && dailyLog.content);

        const prompt = this.buildPrompt(indexContent, activityScope, dailyLog && dailyLog.content, concepts);
        const raw = this.invokeHaiku(prompt);
        if (!raw) return null;

        const parsed = this.parseHaikuResult(raw);
        if (!parsed) {
            process.stderr.write('[memory-curator] Failed to parse Haiku output as JSON\n');
            return null;
        }

        // Cost accounting (AC#11)
        const { input, output } = this.extractTokenCounts(raw);
        const cost = (input * HAIKU_INPUT_PRICE) + (output * HAIKU_OUTPUT_PRICE);
        process.stderr.write(
            `[memory-curator] estimated_cost_usd=${cost.toFixed(4)} input_tokens=${input} output_tokens=${output}\n`
        );

        // Normalize the payload shape (AC#4)
        const now = new Date();
        const payload = {
            generated_at: parsed.generated_at || now.toISOString(),
            source_daily_log: parsed.source_daily_log !== undefined
                ? parsed.source_daily_log
                : (dailyLog ? dailyLog.date : null),
            dedup_candidates: Array.isArray(parsed.dedup_candidates) ? parsed.dedup_candidates : [],
            contradiction_pairs: Array.isArray(parsed.contradiction_pairs) ? parsed.contradiction_pairs : [],
            merge_proposals: Array.isArray(parsed.merge_proposals) ? parsed.merge_proposals : [],
            meta: {
                concepts_scanned: concepts.length,
                concepts_in_prompt: Math.min(concepts.length, MAX_CONCEPTS_PER_RUN),
                activity_scope_articles: activityScope.length,
                cost_usd: Number(cost.toFixed(6)),
                input_tokens: input,
                output_tokens: output
            }
        };

        if (dryRun) {
            process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
            return payload;
        }

        // Write to pending-curation/{YYYY-MM-DD}/{HH-MM-SS}.json (AC#5)
        const date = now.toISOString().slice(0, 10);
        const time = now.toISOString().slice(11, 19).replace(/:/g, '-');
        const outDir = path.join(this.pendingDir, date);
        fsSync.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, `${time}.json`);
        fsSync.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
        process.stdout.write(`[memory-curator] wrote ${outPath}\n`);
        return payload;
    }

    async status() {
        if (!fsSync.existsSync(this.pendingDir)) {
            console.log('No curation runs yet.');
            console.log(`Pending curation dir: ${this.pendingDir} (does not exist)`);
            return;
        }
        const dates = fsSync.readdirSync(this.pendingDir)
            .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
            .sort();
        if (dates.length === 0) {
            console.log('No curation runs yet.');
            return;
        }
        const latestDate = dates[dates.length - 1];
        const dateDir = path.join(this.pendingDir, latestDate);
        const files = fsSync.readdirSync(dateDir).filter(f => f.endsWith('.json')).sort();
        if (files.length === 0) {
            console.log(`No curation files in ${latestDate}`);
            return;
        }
        const latestFile = files[files.length - 1];
        const fullPath = path.join(dateDir, latestFile);
        let content;
        try {
            content = JSON.parse(fsSync.readFileSync(fullPath, 'utf-8'));
        } catch (e) {
            console.log(`Failed to parse ${fullPath}: ${e.message}`);
            return;
        }
        const { mtime } = fsSync.statSync(fullPath);

        console.log(`Latest curation file: ${fullPath}`);
        console.log(`Run timestamp:        ${mtime.toISOString()}`);
        console.log(`Dedup candidates:     ${(content.dedup_candidates || []).length}`);
        console.log(`Contradiction pairs:  ${(content.contradiction_pairs || []).length}`);
        console.log(`Merge proposals:      ${(content.merge_proposals || []).length}`);
        if (content.meta) {
            const cost = typeof content.meta.cost_usd === 'number'
                ? '$' + content.meta.cost_usd.toFixed(4) : 'n/a';
            console.log(`Concepts scanned:     ${content.meta.concepts_scanned ?? 'n/a'}`);
            console.log(`Activity-scope reads: ${content.meta.activity_scope_articles ?? 'n/a'}`);
            console.log(`Cost (USD):           ${cost}`);
        }
    }
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

async function main() {
    const curator = new MemoryCurator();
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case 'curate': {
            const dryRun = args.includes('--dry-run');
            await curator.curate({ dryRun });
            break;
        }
        case 'status':
            await curator.status();
            break;
        default:
            console.log(`Memory Curator — propose dedup/contradiction/merge candidates for review

Usage:
  node memory-curator.js curate [--dry-run]   Run curation (writes JSON unless --dry-run)
  node memory-curator.js status               Show latest curation file summary

Cost control:
  MAX_CONCEPTS_PER_RUN = ${MAX_CONCEPTS_PER_RUN} (samples top-N by decayed_confidence)
  MAX_ACTIVITY_SCOPE_ARTICLES = ${MAX_ACTIVITY_SCOPE_ARTICLES}

Output:
  docs/.output/memories/pending-curation/{YYYY-MM-DD}/{HH-MM-SS}.json
`);
            process.exit(command ? 1 : 0);
    }
}

if (require.main === module) {
    main().catch(e => {
        process.stderr.write(`[memory-curator] error: ${e.message}\n`);
        process.exit(1);
    });
}

module.exports = { MemoryCurator };
