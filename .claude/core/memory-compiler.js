#!/usr/bin/env node

/**
 * Memory Compiler - Consolidates daily log files into concept articles
 *
 * Reads daily logs from docs/.output/memories/daily/{YYYY-MM-DD}.md
 * Writes concept articles to docs/.output/memories/concepts/{category}/{slug}.md
 * Generates docs/.output/memories/concepts/index.md
 *
 * Idempotent: re-running updates existing concepts, does not duplicate.
 * Daily logs are never deleted — they are the audit trail.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const CATEGORIES = ['patterns', 'constraints', 'decisions', 'workflows', 'rejected-approaches'];

// Jaccard similarity threshold for grouping entries under a concept
const SIMILARITY_THRESHOLD = 0.3;

// Jaccard similarity threshold for cross-reference (below merge threshold)
const CROSS_REF_THRESHOLD = 0.15;

// Default confidence for compiled concepts
const DEFAULT_CONFIDENCE = 0.6;

// Category detection signals (checked against lowercased entry text)
// ORDER MATTERS: first match wins in getCategoryForEntry. rejected-approaches is
// checked first so its stronger signals ("didn't work", "reverted") don't get
// swallowed by the looser "pattern" / "approach" keywords.
const CATEGORY_SIGNALS = {
    'rejected-approaches': ['rejected', "didn't work", 'did not work', 'failed approach', 'tried but', 'reverted', 'backed out', "doesn't solve", 'does not solve', 'abandoned', 'gave up on'],
    decisions:   ['decision', 'rationale', 'chose', 'choosing', 'decided', 'choose'],
    patterns:    ['pattern', 'approach', 'strategy', 'convention', 'practice'],
    constraints: ['constraint', 'limitation', 'cannot', 'blocked', 'blocker', 'must not', 'restriction']
    // workflows: default when no other signals match
};

class MemoryCompiler {
    constructor() {
        const projectRoot = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
        this.dailyDir    = path.join(projectRoot, 'docs', '.output', 'memories', 'daily');
        this.conceptsDir = path.join(projectRoot, 'docs', '.output', 'memories', 'concepts');
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Main compilation pipeline.
     * Reads all daily logs, groups entries into concept articles, writes output.
     */
    async compile() {
        console.log('Memory Compiler — starting compile...\n');

        // 1. Read all daily log files
        const dailyFiles = await this.readDailyFiles();
        if (dailyFiles.length === 0) {
            console.log('No daily log files found in', this.dailyDir);
            return;
        }
        console.log(`Found ${dailyFiles.length} daily log file(s).`);

        // 2. Parse each file into entries
        const allEntries = [];
        for (const { date, content } of dailyFiles) {
            const entries = this.parseDailyFile(content, date);
            allEntries.push(...entries);
        }
        console.log(`Parsed ${allEntries.length} log entry/entries.`);

        if (allEntries.length === 0) {
            console.log('No parseable entries found. Nothing to compile.');
            return;
        }

        // 3. Extract keywords from each entry
        for (const entry of allEntries) {
            entry.keywords = this.extractKeywords(entry);
        }

        // 4. Group entries by topic similarity
        const groups = this.groupEntries(allEntries);
        console.log(`Formed ${groups.length} concept group(s).`);

        // 5. Ensure concept category dirs exist
        fsSync.mkdirSync(this.conceptsDir, { recursive: true });
        for (const cat of CATEGORIES) {
            fsSync.mkdirSync(path.join(this.conceptsDir, cat), { recursive: true });
        }

        // 6. Write or update concept articles
        const writtenConcepts = [];
        for (const group of groups) {
            const concept = await this.writeConceptArticle(group);
            if (concept) writtenConcepts.push(concept);
        }

        // 7. Generate index
        await this.generateIndex(writtenConcepts);

        // 8. Generate cross-references
        const crossRefCount = await this.generateCrossReferences();
        console.log(`Cross-references: ${crossRefCount} pair(s) found.`);

        // 9. Inject Related Concepts sections with [[wiki-links]] (Obsidian compat)
        await this.injectRelatedConcepts(writtenConcepts);

        console.log(`\nDone. ${writtenConcepts.length} concept article(s) written.`);
        console.log(`Index: ${path.join(this.conceptsDir, 'index.md')}`);
    }

    /**
     * Print statistics about daily logs and compiled concepts.
     */
    async status() {
        console.log('Memory Compiler — status\n');

        // Daily log count
        let dailyCount = 0;
        try {
            const files = await fs.readdir(this.dailyDir);
            dailyCount = files.filter(f => f.endsWith('.md')).length;
        } catch {
            // dir may not exist yet
        }

        // Concept count (across all category subdirs)
        let conceptCount = 0;
        let lastCompile = null;
        for (const cat of CATEGORIES) {
            const catDir = path.join(this.conceptsDir, cat);
            try {
                const files = await fs.readdir(catDir);
                conceptCount += files.filter(f => f.endsWith('.md')).length;
            } catch {
                // category dir may not exist yet
            }
        }

        // Last compile date from index.md
        const indexPath = path.join(this.conceptsDir, 'index.md');
        try {
            const indexContent = await fs.readFile(indexPath, 'utf-8');
            const match = indexContent.match(/Last compiled: (.+)/);
            if (match) lastCompile = match[1].trim();
        } catch {
            // index may not exist
        }

        console.log(`Daily log files : ${dailyCount}`);
        console.log(`Concept articles: ${conceptCount}`);
        console.log(`Last compile    : ${lastCompile || 'never'}`);
        console.log(`Daily dir       : ${this.dailyDir}`);
        console.log(`Concepts dir    : ${this.conceptsDir}`);
    }

    /**
     * Slugify a title to a safe filename (without extension).
     * e.g. "JWT Token Strategy" → "jwt-token-strategy"
     */
    getConceptId(title) {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .slice(0, 80);
    }

    /**
     * Convert ISO timestamp to YYYY-MM-DD for Dataview compatibility.
     * Passes through already-short dates unchanged.
     */
    formatDateOnly(isoOrDate) {
        if (!isoOrDate) return new Date().toISOString().slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) return isoOrDate;
        return isoOrDate.slice(0, 10);
    }

    /**
     * Add [[wiki-links]] to daily log date headings in evidence text.
     * Transforms: ### 2026-01-13 00:00 → ### 2026-01-13 00:00 — [[2026-01-13]]
     * Idempotent: only matches headings without existing backlinks.
     */
    addDailyBacklinks(evidenceText) {
        return evidenceText.replace(
            /^### (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/gm,
            '### $1 $2 — [[$1]]'
        );
    }

    // -------------------------------------------------------------------------
    // File I/O helpers
    // -------------------------------------------------------------------------

    /**
     * Read all .md files from dailyDir, return array of { date, content }.
     * Gracefully returns [] if dir does not exist.
     */
    async readDailyFiles() {
        try {
            const files = await fs.readdir(this.dailyDir);
            const mdFiles = files
                .filter(f => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
                .sort(); // chronological order

            const results = [];
            for (const file of mdFiles) {
                const date = file.replace('.md', '');
                try {
                    const content = await fs.readFile(path.join(this.dailyDir, file), 'utf-8');
                    results.push({ date, content });
                } catch {
                    console.warn(`Warning: could not read ${file}, skipping.`);
                }
            }
            return results;
        } catch {
            return [];
        }
    }

    // -------------------------------------------------------------------------
    // Parsing
    // -------------------------------------------------------------------------

    /**
     * Split a daily log file into individual compaction entries.
     * Each entry starts at "## HH:MM — Pre-Compaction".
     * Returns array of { date, time, rawText }.
     */
    parseDailyFile(content, date) {
        const entries = [];
        // Split on compaction headings — keep the heading as part of each chunk
        const chunks = content.split(/(?=^## \d{2}:\d{2} — )/m).filter(s => s.trim());

        for (const chunk of chunks) {
            const timeMatch = chunk.match(/^## (\d{2}:\d{2}) — /);
            if (!timeMatch) continue;
            entries.push({
                date,
                time: timeMatch[1],
                rawText: chunk.trim()
            });
        }

        return entries;
    }

    // -------------------------------------------------------------------------
    // Keyword extraction
    // -------------------------------------------------------------------------

    /**
     * Extract meaningful keywords from an entry.
     * Pulls: branch name, commit subjects (first 4 words), story names, decision topics.
     * Returns a Set of lowercased keyword tokens.
     */
    extractKeywords(entry) {
        const keywords = new Set();
        const text = entry.rawText;

        // Branch name (skip generic "ingested" branch)
        const branchMatch = text.match(/\*\*Branch:\*\*\s*(.+)/);
        if (branchMatch) {
            const branchValue = branchMatch[1].trim();
            if (branchValue !== 'ingested') {
                const branchTokens = branchValue.split(/[-_/]/);
                for (const t of branchTokens) {
                    const clean = t.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (clean.length > 2) keywords.add(clean);
                }
            }
        }

        // Source title (from ingested recaps)
        const sourceMatch = text.match(/\*\*Source:\*\*\s*(.+)/);
        if (sourceMatch) {
            const words = sourceMatch[1].trim().toLowerCase().split(/[\s+&,—–-]+/);
            for (const w of words) {
                const clean = w.replace(/[^a-z0-9]/g, '');
                if (clean.length > 2) keywords.add(clean);
            }
        }

        // Commit subjects — take meaningful words (skip hash)
        const commitSection = text.match(/### Recent Commits\s*```([\s\S]*?)```/);
        if (commitSection) {
            const lines = commitSection[1].trim().split('\n').filter(l => l.trim());
            for (const line of lines) {
                // Line format: "abc1234 feat: add auth middleware" — skip hash prefix
                const subject = line.replace(/^[a-f0-9]+\s+/, '');
                const words = subject.toLowerCase().split(/\s+/);
                // Take first 4 meaningful words, skip type prefix (feat:, fix:, etc.)
                const meaningful = words
                    .map(w => w.replace(/^[a-z]+:\s*/, '').replace(/[^a-z0-9]/g, ''))
                    .filter(w => w.length > 2)
                    .slice(0, 4);
                for (const w of meaningful) keywords.add(w);
            }
        }

        // In-progress story names
        const inProgressSection = text.match(/### In-Progress Work\s*([\s\S]*?)(?=\n###|\n##|$)/);
        if (inProgressSection) {
            const lines = inProgressSection[1].split('\n').filter(l => l.includes('[>]') || l.includes('[!]'));
            for (const line of lines) {
                // Extract story name: "Story 3.2: OAuth integration (TODO_epic03.md)"
                const storyMatch = line.match(/(?:\[>\]|\[!\])\s*(.+?)(?:\s*\(|$)/);
                if (storyMatch) {
                    const words = storyMatch[1].toLowerCase().split(/\s+/);
                    for (const w of words) {
                        const clean = w.replace(/[^a-z0-9]/g, '');
                        if (clean.length > 2) keywords.add(clean);
                    }
                }
            }
        }

        // Key decisions table — extract decision text
        const decisionsSection = text.match(/### Key Decisions\s*([\s\S]*?)(?=\n##|$)/);
        if (decisionsSection) {
            const rows = decisionsSection[1].split('\n')
                .filter(r => r.startsWith('|') && !r.includes('---') && !r.match(/Decision.*Rationale.*Outcome/i));
            for (const row of rows) {
                const cells = row.split('|').map(c => c.trim()).filter(c => c);
                for (const cell of cells) {
                    const words = cell.toLowerCase().split(/\s+/);
                    for (const w of words) {
                        const clean = w.replace(/[^a-z0-9]/g, '');
                        if (clean.length > 2) keywords.add(clean);
                    }
                }
            }
        }

        return keywords;
    }

    // -------------------------------------------------------------------------
    // Grouping
    // -------------------------------------------------------------------------

    /**
     * Group entries by topic similarity using Jaccard index.
     * Two entries are grouped if their keyword overlap ≥ SIMILARITY_THRESHOLD.
     * Uses union-find (greedy single-link clustering) for transitivity.
     * Returns array of groups, each group = array of entries.
     */
    groupEntries(entries) {
        // Union-find parent array
        const parent = entries.map((_, i) => i);

        function find(i) {
            if (parent[i] !== i) parent[i] = find(parent[i]);
            return parent[i];
        }

        function union(i, j) {
            parent[find(i)] = find(j);
        }

        function jaccard(setA, setB) {
            if (setA.size === 0 && setB.size === 0) return 0;
            let intersection = 0;
            for (const k of setA) {
                if (setB.has(k)) intersection++;
            }
            const unionSize = setA.size + setB.size - intersection;
            return unionSize === 0 ? 0 : intersection / unionSize;
        }

        // Compare all pairs
        for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
                const sim = jaccard(entries[i].keywords, entries[j].keywords);
                if (sim >= SIMILARITY_THRESHOLD) {
                    union(i, j);
                }
            }
        }

        // Collect groups
        const groupMap = new Map();
        for (let i = 0; i < entries.length; i++) {
            const root = find(i);
            if (!groupMap.has(root)) groupMap.set(root, []);
            groupMap.get(root).push(entries[i]);
        }

        return Array.from(groupMap.values());
    }

    // -------------------------------------------------------------------------
    // Category detection
    // -------------------------------------------------------------------------

    /**
     * Determine the category for a group of entries based on content signals.
     */
    detectCategory(entries) {
        const combined = entries.map(e => e.rawText).join('\n').toLowerCase();

        for (const [category, signals] of Object.entries(CATEGORY_SIGNALS)) {
            for (const signal of signals) {
                if (combined.includes(signal)) return category;
            }
        }

        return 'workflows'; // default
    }

    // -------------------------------------------------------------------------
    // Title generation
    // -------------------------------------------------------------------------

    /**
     * Generate a descriptive title from the most common keywords in the group.
     * Takes the top 3 most-frequent keywords and formats them as a title.
     */
    generateTitle(entries) {
        const freq = new Map();
        for (const entry of entries) {
            for (const kw of entry.keywords) {
                freq.set(kw, (freq.get(kw) || 0) + 1);
            }
        }

        // Sort by frequency descending, take top 3
        const topKeywords = Array.from(freq.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([kw]) => kw);

        if (topKeywords.length === 0) return 'Unnamed Concept';

        // Capitalize each word
        return topKeywords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    // -------------------------------------------------------------------------
    // Summary generation
    // -------------------------------------------------------------------------

    /**
     * Generate a 1-2 sentence summary from the group.
     * Pulls branch name and key decision or in-progress item as anchors.
     */
    generateSummary(entries, category) {
        const branches = new Set();
        const storyNames = [];
        const decisionTexts = [];

        for (const entry of entries) {
            const branchMatch = entry.rawText.match(/\*\*Branch:\*\*\s*(.+)/);
            if (branchMatch) branches.add(branchMatch[1].trim());

            const inProgressSection = entry.rawText.match(/### In-Progress Work\s*([\s\S]*?)(?=\n###|\n##|$)/);
            if (inProgressSection) {
                const lines = inProgressSection[1].split('\n').filter(l => l.includes('[>]'));
                for (const line of lines) {
                    const m = line.match(/\[>\]\s*(.+?)(?:\s*\(|$)/);
                    if (m) storyNames.push(m[1].trim());
                }
            }

            const decisionsSection = entry.rawText.match(/### Key Decisions\s*([\s\S]*?)(?=\n##|$)/);
            if (decisionsSection) {
                const rows = decisionsSection[1].split('\n')
                    .filter(r => r.startsWith('|') && !r.includes('---') && !r.match(/Decision.*Rationale/i));
                for (const row of rows) {
                    const cells = row.split('|').map(c => c.trim()).filter(c => c);
                    if (cells[0]) decisionTexts.push(cells[0]);
                }
            }
        }

        const branchList = Array.from(branches).slice(0, 2).join(', ');
        let sentence1 = `Activity observed across ${entries.length} compaction snapshot(s)`;
        if (branchList) sentence1 += ` on branch(es): ${branchList}`;
        sentence1 += '.';

        let sentence2 = '';
        if (category === 'decisions' && decisionTexts.length > 0) {
            sentence2 = `Key decisions recorded: ${decisionTexts.slice(0, 2).join('; ')}.`;
        } else if (storyNames.length > 0) {
            sentence2 = `In-progress work included: ${storyNames.slice(0, 2).join('; ')}.`;
        }

        return sentence2 ? `${sentence1} ${sentence2}` : sentence1;
    }

    // -------------------------------------------------------------------------
    // Concept article writing
    // -------------------------------------------------------------------------

    /**
     * Write or update a concept article for a group of entries.
     * Returns { title, category, filename, slug, description } or null on failure.
     */
    async writeConceptArticle(group) {
        try {
            const category = this.detectCategory(group);
            const title = this.generateTitle(group);
            const slug = this.getConceptId(title);
            const filename = `${slug}.md`;
            const filePath = path.join(this.conceptsDir, category, filename);

            // Collect source dates from this group
            const newSources = Array.from(new Set(group.map(e => e.date))).sort();
            const now = new Date().toISOString();

            // Check for existing concept (idempotency)
            let existingFrontmatter = null;
            let existingSources = [];
            let createdDate = now;
            let existingContent = null;

            try {
                existingContent = await fs.readFile(filePath, 'utf-8');
                existingFrontmatter = this.parseFrontmatter(existingContent);
                if (existingFrontmatter) {
                    existingSources = existingFrontmatter.sources || [];
                    createdDate = existingFrontmatter.created || now;
                }
            } catch {
                // File doesn't exist yet — fresh write
            }

            // Merge sources (deduplicate, sort)
            const mergedSources = Array.from(new Set([...existingSources, ...newSources])).sort();

            const summary = this.generateSummary(group, category);

            // Build evidence section — each entry as a dated block
            const evidenceBlocks = group.map(entry => {
                return `### ${entry.date} ${entry.time}\n\n${entry.rawText}`;
            });

            // If updating existing, we may have prior evidence — preserve it
            let priorEvidence = '';
            if (existingFrontmatter && existingContent) {
                const evidenceMatch = existingContent.match(/## Evidence\s*\n([\s\S]*)$/);
                if (evidenceMatch) {
                    priorEvidence = evidenceMatch[1].trim();
                }
            }

            // Merge evidence: prior first, then new (deduplicated by date+time heading)
            const existingEvidenceHeadings = new Set();
            if (priorEvidence) {
                const headingMatches = priorEvidence.matchAll(/^### (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/gm);
                for (const m of headingMatches) existingEvidenceHeadings.add(m[1]);
            }

            const newEvidenceBlocks = evidenceBlocks.filter(block => {
                const headingMatch = block.match(/^### (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
                if (!headingMatch) return true;
                return !existingEvidenceHeadings.has(headingMatch[1]);
            });

            const allEvidence = [
                ...(priorEvidence ? [priorEvidence] : []),
                ...newEvidenceBlocks
            ].join('\n\n---\n\n');

            // Build tags from category + top keywords
            const keywordFreq = new Map();
            for (const entry of group) {
                for (const kw of entry.keywords) {
                    keywordFreq.set(kw, (keywordFreq.get(kw) || 0) + 1);
                }
            }
            const topKeywords = Array.from(keywordFreq.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([kw]) => kw);
            const tags = [category, ...topKeywords.filter(k => k !== category)];

            // Build aliases from keyword permutations (alternative titles)
            const aliasKeywords = topKeywords.slice(0, 3);
            const aliases = [];
            if (aliasKeywords.length >= 2) {
                // Reverse order as an alias
                aliases.push(aliasKeywords.slice().reverse().map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
            }
            if (aliasKeywords.length >= 3) {
                // Skip middle word
                aliases.push([aliasKeywords[0], aliasKeywords[2]].map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
            }

            // Compute Obsidian/Dataview metadata
            const sourceCount = mergedSources.length;
            const entryCount = existingEvidenceHeadings.size + newEvidenceBlocks.length;
            const dateRange = mergedSources.length === 1
                ? mergedSources[0]
                : `${mergedSources[0]} to ${mergedSources[mergedSources.length - 1]}`;

            // Build YAML frontmatter (Obsidian-compatible)
            const sourcesYaml = mergedSources.map(s => `  - ${s}`).join('\n');
            const tagsYaml = tags.map(t => `  - ${t}`).join('\n');
            const aliasesYaml = aliases.length > 0
                ? aliases.map(a => `  - ${a}`).join('\n')
                : '  - ' + title;
            const frontmatter = [
                '---',
                `title: ${title}`,
                `category: ${category}`,
                `cssclasses:`,
                `  - concept-${category}`,
                `tags:`,
                tagsYaml,
                `aliases:`,
                aliasesYaml,
                `sources:`,
                sourcesYaml,
                `created: ${this.formatDateOnly(createdDate)}`,
                `updated: ${this.formatDateOnly(now)}`,
                `confidence: ${DEFAULT_CONFIDENCE}`,
                `source_count: ${sourceCount}`,
                `entry_count: ${entryCount}`,
                `date_range: "${dateRange}"`,
                '---'
            ].join('\n');

            // Add daily log backlinks to evidence headings for Obsidian graph connectivity
            const evidenceWithBacklinks = this.addDailyBacklinks(allEvidence || '_No evidence blocks._');

            const articleContent = [
                frontmatter,
                '',
                '## Summary',
                '',
                `> [!abstract] Summary`,
                `> ${summary}`,
                '',
                '## Evidence',
                '',
                evidenceWithBacklinks
            ].join('\n');

            await fs.writeFile(filePath, articleContent, 'utf-8');

            const action = existingFrontmatter ? 'Updated' : 'Created';
            console.log(`  ${action}: ${category}/${filename}`);

            return {
                title,
                category,
                filename,
                slug,
                description: summary.slice(0, 120),
                confidence: DEFAULT_CONFIDENCE
            };
        } catch (err) {
            console.error(`  Error writing concept for group: ${err.message}`);
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Obsidian: Related Concepts injection
    // -------------------------------------------------------------------------

    /**
     * Post-pass: inject ## Related Concepts section with [[wiki-links]]
     * into each concept article based on cross-references.json.
     *
     * Inserts between ## Summary and ## Evidence. Idempotent — replaces
     * existing Related Concepts section on re-compile.
     */
    async injectRelatedConcepts(writtenConcepts) {
        // Load cross-references
        const crossRefPath = path.join(this.conceptsDir, 'cross-references.json');
        let crossRefMap;
        try {
            const raw = await fs.readFile(crossRefPath, 'utf-8');
            crossRefMap = JSON.parse(raw);
        } catch {
            return; // No cross-references to inject
        }

        // Build slug→{title, category} lookup from all concept files
        const conceptLookup = new Map();
        for (const cat of CATEGORIES) {
            const catDir = path.join(this.conceptsDir, cat);
            try {
                const files = await fs.readdir(catDir);
                for (const file of files) {
                    if (!file.endsWith('.md')) continue;
                    const slug = file.replace('.md', '');
                    try {
                        const content = await fs.readFile(path.join(catDir, file), 'utf-8');
                        const fm = this.parseFrontmatter(content);
                        if (fm) {
                            conceptLookup.set(slug, { title: fm.title || slug, category: cat });
                        }
                    } catch { /* skip */ }
                }
            } catch { /* skip */ }
        }

        // Inject into each concept article
        let injected = 0;
        for (const [slug, data] of Object.entries(crossRefMap)) {
            const related = data.related || [];
            if (related.length === 0) continue;

            const info = conceptLookup.get(slug);
            if (!info) continue;

            const filePath = path.join(this.conceptsDir, info.category, `${slug}.md`);
            let content;
            try {
                content = await fs.readFile(filePath, 'utf-8');
            } catch { continue; }

            // Build Related Concepts section with wiki-links
            const links = related
                .map(relSlug => {
                    const relInfo = conceptLookup.get(relSlug);
                    if (!relInfo) return null;
                    return `- [[${relSlug}|${relInfo.title}]]`;
                })
                .filter(Boolean);

            if (links.length === 0) continue;

            const relatedSection = `## Related Concepts\n\n${links.join('\n')}`;

            // Remove existing Related Concepts section if present
            const cleaned = content.replace(/## Related Concepts\s*\n[\s\S]*?(?=\n## Evidence|$)/, '');

            // Insert before ## Evidence
            const updated = cleaned.replace(
                /(\n## Evidence)/,
                `\n${relatedSection}\n$1`
            );

            if (updated !== content) {
                await fs.writeFile(filePath, updated, 'utf-8');
                injected++;
            }
        }

        if (injected > 0) {
            console.log(`  Related Concepts injected into ${injected} article(s).`);
        }
    }

    // -------------------------------------------------------------------------
    // Frontmatter parsing
    // -------------------------------------------------------------------------

    /**
     * Parse YAML frontmatter from a markdown file.
     * Returns plain object or null if no frontmatter found.
     * Handles simple key: value pairs and list fields (sources, tags, aliases).
     */
    parseFrontmatter(content) {
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;

        const raw = match[1];
        const result = {};
        const listFields = new Set(['sources', 'tags', 'aliases', 'cssclasses']);
        let currentList = null;
        const lists = {};

        for (const line of raw.split('\n')) {
            // Check for start of a list field
            const listStart = line.match(/^(\w+):$/);
            if (listStart && listFields.has(listStart[1])) {
                currentList = listStart[1];
                lists[currentList] = [];
                continue;
            }

            // Collect list items
            if (currentList && line.startsWith('  - ')) {
                lists[currentList].push(line.replace('  - ', '').trim());
                continue;
            }

            // End of list
            if (currentList && !line.startsWith('  - ')) {
                currentList = null;
            }

            const kv = line.match(/^(\w+):\s*(.+)$/);
            if (kv) result[kv[1]] = kv[2].trim();
        }

        // Merge lists into result
        for (const [key, values] of Object.entries(lists)) {
            if (values.length > 0) result[key] = values;
        }

        return result;
    }

    // -------------------------------------------------------------------------
    // Index generation
    // -------------------------------------------------------------------------

    /**
     * Generate docs/.output/memories/concepts/index.md as an Obsidian MOC (Map of Content).
     * Uses [[wiki-links]] for graph connectivity, Dataview queries for dynamic views.
     */
    async generateIndex(concepts) {
        const now = new Date().toISOString();
        const today = this.formatDateOnly(now);

        // Group by category
        const byCategory = {};
        for (const cat of CATEGORIES) byCategory[cat] = [];
        for (const concept of concepts) {
            if (concept && byCategory[concept.category]) {
                byCategory[concept.category].push(concept);
            }
        }

        // Also scan existing concept files not in this compile run
        // (idempotency: index should reflect ALL concepts, not just newly written ones)
        for (const cat of CATEGORIES) {
            const catDir = path.join(this.conceptsDir, cat);
            try {
                const files = await fs.readdir(catDir);
                const existingSlugs = new Set(byCategory[cat].map(c => c.filename));
                for (const file of files) {
                    if (!file.endsWith('.md') || existingSlugs.has(file)) continue;
                    try {
                        const content = await fs.readFile(path.join(catDir, file), 'utf-8');
                        const fm = this.parseFrontmatter(content);
                        if (fm) {
                            // Extract summary text (handle callout format)
                            const summaryMatch = content.match(/## Summary\s*\n+(?:> \[!abstract\][^\n]*\n)?> ?([^\n]+)/);
                            const plainMatch = content.match(/## Summary\s*\n+([^\n>]+)/);
                            const description = (summaryMatch ? summaryMatch[1].trim() : plainMatch ? plainMatch[1].trim() : fm.title || file.replace('.md', '')).slice(0, 120);
                            byCategory[cat].push({
                                title: fm.title || file.replace('.md', ''),
                                category: cat,
                                filename: file,
                                slug: file.replace('.md', ''),
                                description,
                                confidence: fm.confidence ? parseFloat(fm.confidence) : DEFAULT_CONFIDENCE
                            });
                        }
                    } catch {
                        // skip unreadable files
                    }
                }
            } catch {
                // category dir may not exist
            }
        }

        // Confidence level indicator helper
        function confidenceIndicator(conf) {
            const c = typeof conf === 'number' ? conf : parseFloat(conf) || DEFAULT_CONFIDENCE;
            if (c >= 0.7) return '[HIGH]';
            if (c >= 0.4) return '[MED]';
            return '[LOW]';
        }

        // Count total concepts
        let totalConcepts = 0;
        for (const cat of CATEGORIES) totalConcepts += byCategory[cat].length;

        // Build MOC content with frontmatter
        const lines = [
            '---',
            'title: Memory Concepts Index',
            'cssclasses:',
            '  - moc',
            `updated: ${today}`,
            'tags:',
            '  - MOC',
            '  - memory-system',
            '---',
            '',
            '# Memory Concepts Index',
            '',
            `Last compiled: ${now}`,
            '',
            '> [!info] Quick Stats',
            `> **${totalConcepts}** concepts across **${CATEGORIES.length}** categories`,
            '',
        ];

        for (const cat of CATEGORIES) {
            lines.push(`## ${cat}`);
            lines.push('');
            const entries = byCategory[cat];
            if (entries.length === 0) {
                lines.push('_No concepts compiled yet._');
            } else {
                for (const entry of entries) {
                    const indicator = confidenceIndicator(entry.confidence);
                    const slug = entry.slug || entry.filename.replace('.md', '');
                    lines.push(`- ${indicator} [[${slug}|${entry.title}]] — ${entry.description}`);
                }
            }
            lines.push('');
        }

        // Append Cross-References section with wiki-links
        const crossRefPath = path.join(this.conceptsDir, 'cross-references.json');
        try {
            const crossRefContent = await fs.readFile(crossRefPath, 'utf-8');
            const crossRefMap = JSON.parse(crossRefContent);

            // Collect unique pairs (A < B lexicographically to avoid duplicates)
            const pairs = new Set();
            for (const [slugA, data] of Object.entries(crossRefMap)) {
                for (const slugB of (data.related || [])) {
                    const pair = slugA < slugB ? `${slugA}|${slugB}` : `${slugB}|${slugA}`;
                    pairs.add(pair);
                }
            }

            lines.push('## Cross-References');
            lines.push('');
            if (pairs.size === 0) {
                lines.push('_No cross-references found._');
            } else {
                for (const pair of Array.from(pairs).sort()) {
                    const [a, b] = pair.split('|');
                    lines.push(`- [[${a}]] ↔ [[${b}]]`);
                }
            }
            lines.push('');
        } catch {
            // cross-references.json may not exist yet — omit the section
        }

        // Dataview dynamic query blocks
        lines.push('## Dynamic Views');
        lines.push('');
        lines.push('### Recently Updated');
        lines.push('```dataview');
        lines.push('TABLE confidence, date_range, source_count');
        lines.push('FROM ""');
        lines.push('WHERE confidence AND file.name != "index"');
        lines.push('SORT updated DESC');
        lines.push('LIMIT 10');
        lines.push('```');
        lines.push('');
        lines.push('### High Confidence');
        lines.push('```dataview');
        lines.push('TABLE category, date_range, source_count');
        lines.push('FROM ""');
        lines.push('WHERE confidence >= 0.7 AND file.name != "index"');
        lines.push('SORT confidence DESC');
        lines.push('```');
        lines.push('');

        const indexPath = path.join(this.conceptsDir, 'index.md');
        await fs.writeFile(indexPath, lines.join('\n'), 'utf-8');
        console.log(`  Index written: ${indexPath}`);
    }

    // -------------------------------------------------------------------------
    // Cross-reference generation
    // -------------------------------------------------------------------------

    /**
     * Compute pairwise Jaccard similarity between all concept articles.
     * Pairs with similarity >= CROSS_REF_THRESHOLD and < SIMILARITY_THRESHOLD
     * are recorded as "related" cross-references.
     *
     * Writes docs/.output/memories/concepts/cross-references.json.
     * Returns the number of unique pairs found.
     */
    async generateCrossReferences() {
        // Load ALL concept articles from disk (same pattern as generateIndex)
        const allConcepts = []; // { slug, category, title, keywords }

        for (const cat of CATEGORIES) {
            const catDir = path.join(this.conceptsDir, cat);
            try {
                const files = await fs.readdir(catDir);
                for (const file of files) {
                    if (!file.endsWith('.md')) continue;
                    try {
                        const content = await fs.readFile(path.join(catDir, file), 'utf-8');
                        const fm = this.parseFrontmatter(content);
                        if (!fm) continue;

                        const slug = file.replace('.md', '');
                        const title = fm.title || slug;

                        // Extract summary text for keyword computation
                        const summaryMatch = content.match(/## Summary\s*\n+([\s\S]*?)(?=\n##|$)/);
                        const summaryText = summaryMatch ? summaryMatch[1].trim() : '';

                        // Simple keyword tokenizer: title + summary, split on whitespace,
                        // lowercase, filter words > 2 chars
                        const rawText = `${title} ${summaryText}`;
                        const keywords = new Set(
                            rawText
                                .toLowerCase()
                                .split(/\s+/)
                                .map(w => w.replace(/[^a-z0-9]/g, ''))
                                .filter(w => w.length > 2)
                        );

                        allConcepts.push({ slug, category: cat, keywords });
                    } catch {
                        // skip unreadable files
                    }
                }
            } catch {
                // category dir may not exist
            }
        }

        // Jaccard similarity between two Sets
        function jaccard(setA, setB) {
            if (setA.size === 0 && setB.size === 0) return 0;
            let intersection = 0;
            for (const k of setA) {
                if (setB.has(k)) intersection++;
            }
            const unionSize = setA.size + setB.size - intersection;
            return unionSize === 0 ? 0 : intersection / unionSize;
        }

        // Build bidirectional cross-reference map
        // { slug: { related: [slugs], category: cat } }
        const crossRefMap = {};

        // Initialize all known concepts with empty related arrays
        for (const concept of allConcepts) {
            crossRefMap[concept.slug] = {
                related: [],
                category: concept.category
            };
        }

        let pairCount = 0;

        // Compare all pairs
        for (let i = 0; i < allConcepts.length; i++) {
            for (let j = i + 1; j < allConcepts.length; j++) {
                const sim = jaccard(allConcepts[i].keywords, allConcepts[j].keywords);
                if (sim >= CROSS_REF_THRESHOLD && sim < SIMILARITY_THRESHOLD) {
                    const slugA = allConcepts[i].slug;
                    const slugB = allConcepts[j].slug;
                    crossRefMap[slugA].related.push(slugB);
                    crossRefMap[slugB].related.push(slugA);
                    pairCount++;
                }
            }
        }

        // Remove concepts that have no related entries to keep the file clean,
        // but only if they have no related. Keep all in map per AC (bidirectional).
        // Actually: AC says structure is { slug: { related: [...], category } } —
        // keep all slugs so the file documents the full universe.

        // Write cross-references.json (empty object {} when no concepts exist)
        const outputMap = allConcepts.length === 0 ? {} : crossRefMap;
        const crossRefPath = path.join(this.conceptsDir, 'cross-references.json');
        await fs.writeFile(crossRefPath, JSON.stringify(outputMap, null, 2), 'utf-8');

        return pairCount;
    }
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

async function main() {
    const compiler = new MemoryCompiler();
    const [,, command] = process.argv;

    switch (command) {
        case 'compile':
            await compiler.compile();
            break;
        case 'status':
            await compiler.status();
            break;
        default:
            console.log('Usage:\n  node memory-compiler.js compile\n  node memory-compiler.js status');
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err.message);
        process.exit(1);
    });
}

module.exports = MemoryCompiler;
