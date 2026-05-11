#!/usr/bin/env node

/**
 * Memory Manager - Dual-storage: JSON files (source of truth) + SQLite FTS5 (search index)
 *
 * JSON files at docs/.output/memories/{category}/{id}.json — human-readable, git-trackable
 * SQLite at docs/.output/memories/memories.db — FTS5 full-text search (Node 25+ built-in)
 *
 * SQLite is optional — gracefully falls back to JSON scan if unavailable.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const CONSTANTS = require('./constants');
const {
    calculateDecayedConfidence: calcDecay,
    createActiveDaysResolver,
} = require('./_lib/memory-decay');
const { parseFrontmatter: parseFm } = require('./_lib/frontmatter');
const { lintMemories: lintMemoriesLib } = require('./_lib/memory-lint');
const {
    ingestAgentMemory: ingestAgentMemoryLib,
    typeToCategory: ingestTypeToCategory,
    idFromFilename: ingestIdFromFilename,
    findMarkdownFiles: ingestFindMarkdownFiles,
} = require('./_lib/memory-ingest');

// Memory guard constants
const MAX_MEMORIES_PER_CATEGORY = 50;
const PRUNE_THRESHOLD_PERCENT = 0.8;
const PRUNE_MIN_AGE_DAYS = 30;
const PRUNE_MIN_CONFIDENCE = 0.3;

/**
 * Convert a freeform search string into an FTS5 query.
 *
 * FTS5's default match mode is AND, which makes multi-word ad-hoc queries like
 * "publish tooling refactor" return [] unless one memory contains every term.
 * Callers (commands, agents) write multi-word topic queries expecting OR-style
 * fuzzy match, so split-and-OR-join is the right default. Power users can still
 * force phrase/AND/NEAR by writing FTS5 syntax explicitly.
 *
 * Pass-through cases (caller knows what they want):
 *   - Contains FTS5 operators (OR, AND, NOT, NEAR)
 *   - Contains quote/colon/caret/star/paren — explicit FTS5 syntax
 *
 * Otherwise: tokenize on non-word chars, drop tokens shorter than 2, OR-join.
 * If 0-1 tokens survive, return the original string unchanged.
 */
function buildFtsQuery(searchTerm) {
    if (!searchTerm || typeof searchTerm !== 'string') return searchTerm;
    if (/[":^*()]/.test(searchTerm)) return searchTerm;
    if (/\b(OR|AND|NOT|NEAR)\b/.test(searchTerm)) return searchTerm;
    const tokens = searchTerm.split(/[^a-zA-Z0-9_-]+/).filter(t => t.length > 1);
    if (tokens.length <= 1) return searchTerm;
    return tokens.join(' OR ');
}

// SQLite backend resolution — preference order:
//   1. better-sqlite3 (npm, optionalDependency) — ships its own SQLite compiled
//      with FTS5. The only backend where full-text search actually works.
//   2. node:sqlite (built-in, Node 22+ flagged / 24+ stable) — convenient, but
//      Node's bundled SQLite ships WITHOUT FTS5 as of v24, so CREATE VIRTUAL
//      TABLE...USING fts5 throws "no such module: fts5". indexMemory()'s
//      try/catch survives this, but the FTS index is dead weight.
//   3. JSON-only — linear scan over per-category JSON files. Fine up to a few
//      thousand memories.
//
// All three paths satisfy the same minimal API: new DatabaseSync(path),
// db.exec(sql), db.prepare(sql).run/get/all, db.close().
let DatabaseSync = null;
let sqliteBackend = 'json-only';
let sqliteSupportsFts5 = false;

try {
    const BetterSqlite3 = require('better-sqlite3');
    // Adapter so callers keep using `new DatabaseSync(path)`.
    DatabaseSync = function(dbPath) { return new BetterSqlite3(dbPath); };
    sqliteBackend = 'better-sqlite3';
    sqliteSupportsFts5 = true;
} catch {
    try {
        DatabaseSync = require('node:sqlite').DatabaseSync;
        sqliteBackend = 'node:sqlite';
        // FTS5 absence detected lazily in initDb() — Node's bundle decision can
        // change between versions; don't assume.
    } catch {
        // Neither backend available — JSON-only mode.
    }
}

class MemoryManager {
    constructor() {
        const projectRoot = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
        this.projectRoot = projectRoot;
        this.memoriesDir = path.join(projectRoot, 'docs', '.output', 'memories');
        this.dbPath = path.join(this.memoriesDir, 'memories.db');
        this.categories = Object.values(CONSTANTS.MEMORY_CATEGORIES);
        this.db = null;
        this._activeDaysResolver = createActiveDaysResolver({ projectRoot });
    }

    /**
     * Initialize SQLite database (lazy — called on first write or search)
     */
    initDb() {
        if (this.db) return true;
        if (!DatabaseSync) return false;

        try {
            fsSync.mkdirSync(this.memoriesDir, { recursive: true });
            this.db = new DatabaseSync(this.dbPath);
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    category TEXT NOT NULL,
                    content TEXT NOT NULL,
                    metadata TEXT,
                    created TEXT NOT NULL,
                    updated TEXT NOT NULL,
                    usage_count INTEGER DEFAULT 0,
                    confidence REAL DEFAULT 1.0
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                    id, category, content, tokenize='porter'
                );
            `);
            return true;
        } catch (e) {
            // Close the handle if `new DatabaseSync()` succeeded but `exec()`
            // threw (e.g. FTS5 not compiled in). Otherwise the file lock leaks
            // and the db file is undeletable until process exit — surfaces on
            // Windows as EPERM on tmp-dir cleanup in tests.
            console.error('SQLite init failed (falling back to JSON-only):', e.message);
            if (this.db) {
                try { this.db.close(); } catch { /* non-fatal */ }
            }
            this.db = null;
            return false;
        }
    }

    /**
     * Upsert a memory into SQLite index
     */
    indexMemory(memory) {
        if (!this.initDb()) return;
        try {
            // Upsert main table
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO memories (id, category, content, metadata, created, updated, usage_count, confidence)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(
                memory.id, memory.category,
                JSON.stringify(memory.content), JSON.stringify(memory.metadata),
                memory.created, memory.updated,
                memory.usage_count || 0, memory.metadata?.confidence ?? 1.0
            );

            // Upsert FTS
            this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(memory.id);
            const ftsStmt = this.db.prepare(`
                INSERT INTO memories_fts (id, category, content) VALUES (?, ?, ?)
            `);
            ftsStmt.run(memory.id, memory.category, JSON.stringify(memory.content));
        } catch (e) {
            // Non-fatal — JSON is the source of truth
            console.error('SQLite index error:', e.message);
        }
    }

    /**
     * Remove a memory from SQLite index
     */
    deindexMemory(id) {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
            this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
        } catch {
            // Non-fatal
        }
    }

    static idToFilename(id) {
        return id.replace(/_/g, '-');
    }

    static filenameToId(filename) {
        return filename.replace(/-/g, '_').replace(/\.json$/, '');
    }

    /**
     * Get count of memories in a category
     */
    async getMemoryCount(category) {
        const dir = path.join(this.memoriesDir, category);
        try {
            const files = await fs.readdir(dir);
            return files.filter(f => f.endsWith('.json')).length;
        } catch {
            return 0;
        }
    }

    /**
     * Prune stale memories — removes memories older than maxAgeDays
     * with confidence below minConfidence
     */
    async pruneStaleMemories(category, maxAgeDays = PRUNE_MIN_AGE_DAYS, minConfidence = PRUNE_MIN_CONFIDENCE) {
        const dir = path.join(this.memoriesDir, category);
        let pruned = 0;
        try {
            const files = await fs.readdir(dir);
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                const filePath = path.join(dir, file);
                try {
                    const raw = await fs.readFile(filePath, 'utf-8');
                    const memory = JSON.parse(raw);
                    const activeDays = this.getActiveDaysSince(memory.updated);
                    const confidence = memory.metadata?.confidence ?? 1.0;
                    if (activeDays > maxAgeDays && confidence < minConfidence) {
                        await fs.unlink(filePath);
                        this.deindexMemory(memory.id);
                        pruned++;
                        console.log(`🗑️  Pruned stale memory: ${category}/${file} (${Math.round(activeDays)} active days, confidence ${confidence})`);
                    }
                } catch {
                    // Skip unreadable files
                }
            }
        } catch {
            // Category dir doesn't exist — nothing to prune
        }
        return pruned;
    }

    /**
     * Create a new memory (JSON + SQLite)
     */
    async createMemory(category, id, content) {
        if (!this.categories.includes(category)) {
            throw new Error(`Invalid category: ${category}`);
        }

        // Memory explosion guard
        const count = await this.getMemoryCount(category);
        if (count >= MAX_MEMORIES_PER_CATEGORY * PRUNE_THRESHOLD_PERCENT) {
            const pruned = await this.pruneStaleMemories(category);
            if (pruned > 0) {
                console.log(`⚠️  Memory guard: auto-pruned ${pruned} stale memories from ${category}`);
            }
        }
        const currentCount = await this.getMemoryCount(category);
        if (currentCount >= MAX_MEMORIES_PER_CATEGORY) {
            console.log(`⛔ Memory guard: ${category} has ${currentCount} entries (max ${MAX_MEMORIES_PER_CATEGORY}). Skipping write for ${id}. Run prune or increase limit.`);
            return null;
        }

        const TYPE_MAP = {
            patterns: 'pattern',
            constraints: 'constraint',
            decisions: 'decision',
            workflows: 'workflow',
            'rejected-approaches': 'rejected-approach',
        };
        const memory = {
            id,
            type: TYPE_MAP[category] || category.slice(0, -1),
            category,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            usage_count: 0,
            content,
            metadata: {
                sessions: [],
                agents: [],
                confidence: 1.0
            }
        };

        // Write JSON (source of truth)
        const filename = MemoryManager.idToFilename(id);
        const categoryDir = path.join(this.memoriesDir, category);
        await fs.mkdir(categoryDir, { recursive: true });
        const filePath = path.join(categoryDir, `${filename}.json`);
        await fs.writeFile(filePath, JSON.stringify(memory, null, 2));

        // Index in SQLite
        this.indexMemory(memory);

        console.log(`✅ Memory created: ${category}/${id}`);
        return memory;
    }

    /**
     * Read a memory from JSON (source of truth)
     */
    async readMemory(category, id) {
        const hyphenated = MemoryManager.idToFilename(id);
        let filePath = path.join(this.memoriesDir, category, `${hyphenated}.json`);

        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            if (error.code === 'ENOENT') {
                filePath = path.join(this.memoriesDir, category, `${id}.json`);
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    return JSON.parse(content);
                } catch {
                    return null;
                }
            }
            console.error(`❌ Error reading memory: ${category}/${id}`, error.message);
            return null;
        }
    }

    /**
     * Update a memory (JSON + SQLite)
     */
    async updateMemory(category, id, updates) {
        const memory = await this.readMemory(category, id);
        if (!memory) return null;

        if (updates.content) {
            memory.content = { ...memory.content, ...updates.content };
        }
        if (updates.metadata) {
            memory.metadata = { ...memory.metadata, ...updates.metadata };
        }

        memory.updated = new Date().toISOString();
        memory.usage_count = (memory.usage_count || 0) + 1;

        // Write JSON
        const filename = MemoryManager.idToFilename(id);
        const filePath = path.join(this.memoriesDir, category, `${filename}.json`);
        await fs.writeFile(filePath, JSON.stringify(memory, null, 2));

        // Re-index in SQLite
        this.indexMemory(memory);

        console.log(`✅ Memory updated: ${category}/${id}`);
        return memory;
    }

    /**
     * List all memories in a category
     */
    async listMemories(category) {
        const dir = path.join(this.memoriesDir, category);
        try {
            const files = await fs.readdir(dir);
            const memories = [];

            for (const file of files) {
                if (file.endsWith('.json')) {
                    const fileId = file.replace('.json', '');
                    const memory = await this.readMemory(category, fileId);
                    if (memory) {
                        memories.push({
                            id: memory.id,
                            created: memory.created,
                            updated: memory.updated,
                            usage_count: memory.usage_count,
                            confidence: memory.metadata?.confidence ?? 1.0,
                            decayed_confidence: this.calculateDecayedConfidence(memory)
                        });
                    }
                }
            }

            return memories;
        } catch {
            return [];
        }
    }

    /**
     * Search memories — uses SQLite FTS5 when available, falls back to JSON scan
     */
    async searchMemories(searchTerm) {
        // Try SQLite FTS5 first
        if (this.initDb()) {
            try {
                const stmt = this.db.prepare(`
                    SELECT m.id, m.category, m.content, m.metadata, m.confidence, m.usage_count, m.updated,
                           rank
                    FROM memories_fts fts
                    JOIN memories m ON fts.id = m.id
                    WHERE memories_fts MATCH ?
                    ORDER BY rank
                    LIMIT 20
                `);
                const rows = stmt.all(buildFtsQuery(searchTerm));
                if (rows.length > 0) {
                    return rows.map(row => {
                        // Reconstruct enough of the memory shape to compute decay
                        const mockMemory = {
                            updated: row.updated,
                            usage_count: row.usage_count || 0,
                            metadata: { confidence: row.confidence ?? 1.0 }
                        };
                        return {
                            category: row.category,
                            id: row.id,
                            relevance: Math.abs(row.rank) * 10 + (row.confidence || 0) * 10 + (row.usage_count || 0) * 5,
                            confidence: row.confidence ?? 1.0,
                            decayed_confidence: this.calculateDecayedConfidence(mockMemory)
                        };
                    });
                }
            } catch {
                // FTS query failed — fall through to JSON scan
            }
        }

        // Fallback: JSON scan
        const results = [];
        for (const category of this.categories) {
            const memories = await this.listMemories(category);
            for (const memSummary of memories) {
                const memory = await this.readMemory(category, memSummary.id);
                if (memory) {
                    const content = JSON.stringify(memory.content).toLowerCase();
                    if (content.includes(searchTerm.toLowerCase())) {
                        results.push({
                            category,
                            id: memory.id,
                            relevance: this.calculateRelevance(memory, searchTerm),
                            confidence: memory.metadata?.confidence ?? 1.0,
                            decayed_confidence: this.calculateDecayedConfidence(memory)
                        });
                    }
                }
            }
        }
        return results.sort((a, b) => b.relevance - a.relevance);
    }

    /**
     * Count active work days (days with git commits) between a date and now.
     * Delegates to the shared resolver; falls back to calendar days when git
     * is unavailable. Per-instance cache — one git log invocation per manager.
     */
    getActiveDaysSince(sinceDate) {
        return this._activeDaysResolver.getActiveDaysSince(sinceDate);
    }

    /**
     * Calculate decayed confidence for a memory — read-time only, not stored.
     * Thin adapter over _lib/memory-decay.js — extracts the memory's shape into
     * the shared function's parameter contract. Formula lives in the shared lib.
     */
    calculateDecayedConfidence(memory) {
        return calcDecay({
            confidence: memory.metadata?.confidence ?? 1.0,
            category: memory.category,
            usageCount: memory.usage_count || 0,
            updated: memory.updated,
            activeDays: this._activeDaysResolver.getActiveDaysSince(memory.updated),
        });
    }

    /**
     * Boost confidence of memories whose keywords appear in recent commit subjects.
     * Concepts echoed by ongoing work gain confidence, counterbalancing monotonic decay.
     * Idempotent: stores `metadata.lastEchoBoostCommit` so re-running against unchanged
     * git head is a no-op.
     *
     * @param {Object} opts
     * @param {number} [opts.limit=50] - how many recent commits to scan
     * @param {number} [opts.boostAmount] - defaults to MEMORY_DECAY.ECHO_BOOST (0.05)
     * @param {boolean} [opts.dryRun=false] - when true, returns report without writing
     * @returns {Promise<{scanned: number, boosted: Array, skipped: Array}>}
     */
    async boostFromGitLog({ limit = 50, boostAmount, dryRun = false } = {}) {
        const { MEMORY_DECAY } = require('./constants');
        if (boostAmount === undefined) boostAmount = MEMORY_DECAY.ECHO_BOOST;

        // 1. Read commit log — %H (full hash) + %s (subject), most-recent first
        let commits = [];
        try {
            const raw = execSync(`git log --format=%H%x09%s -${limit}`, {
                cwd: this.projectRoot,
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
            });
            commits = raw.trim().split('\n').filter(Boolean).map(line => {
                const tab = line.indexOf('\t');
                if (tab === -1) return null;
                return { hash: line.slice(0, tab), subject: line.slice(tab + 1).toLowerCase() };
            }).filter(Boolean);
        } catch (e) {
            return { scanned: 0, boosted: [], skipped: [], error: 'git log failed: ' + e.message };
        }

        if (commits.length === 0) {
            return { scanned: 0, boosted: [], skipped: [] };
        }

        const latestHash = commits[0].hash;
        const report = { scanned: 0, boosted: [], skipped: [] };

        const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'but', 'not', 'have', 'has', 'was', 'were', 'will', 'can', 'its', 'their', 'them', 'they', 'you', 'your', 'our', 'one', 'two', 'all', 'any', 'been', 'into', 'than', 'then', 'what', 'when', 'which', 'who', 'how', 'why', 'also', 'just', 'some', 'more', 'very']);

        // 2. Iterate all categories + memories
        for (const category of this.categories) {
            const summaries = await this.listMemories(category);
            for (const summary of summaries) {
                report.scanned++;
                const memory = await this.readMemory(category, summary.id);
                if (!memory) continue;

                const lastBoost = memory.metadata?.lastEchoBoostCommit;

                // 3. Idempotence: if stored marker equals newest hash, no new commits
                if (lastBoost === latestHash) {
                    report.skipped.push({ category, id: memory.id, reason: 'no-new-commits' });
                    continue;
                }

                // 4. Extract keywords from concept content (mirror extractKeywords rules)
                const contentText = JSON.stringify(memory.content || {}).toLowerCase();
                const keywords = new Set();
                for (const token of contentText.split(/\W+/)) {
                    if (token.length > 2 && !STOPWORDS.has(token)) keywords.add(token);
                }

                // 5. Only consider commits newer than the stored marker (inclusive newest; exclusive of marker)
                // commits[] is most-recent first — everything UP TO (but not including) lastBoost is "new"
                let relevantCommits = commits;
                if (lastBoost) {
                    const cutoff = commits.findIndex(c => c.hash === lastBoost);
                    if (cutoff !== -1) relevantCommits = commits.slice(0, cutoff);
                }
                if (relevantCommits.length === 0) {
                    report.skipped.push({ category, id: memory.id, reason: 'no-new-commits' });
                    continue;
                }

                // 6. Match: any keyword in any commit subject (word-boundary, case-insensitive)
                const matchedKeywords = [];
                const matchedCommits = [];
                for (const kw of keywords) {
                    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const re = new RegExp('\\b' + escaped + '\\b', 'i');
                    let matchedAny = false;
                    for (const c of relevantCommits) {
                        if (re.test(c.subject)) {
                            matchedAny = true;
                            if (!matchedCommits.some(m => m.hash === c.hash)) {
                                matchedCommits.push(c);
                            }
                        }
                    }
                    if (matchedAny) matchedKeywords.push(kw);
                }

                if (matchedKeywords.length === 0) {
                    report.skipped.push({ category, id: memory.id, reason: 'no-match' });
                    continue;
                }

                // 7. Boost
                const oldConf = memory.metadata?.confidence ?? 1.0;
                const newConf = Math.min(1.0, oldConf + boostAmount);

                if (!dryRun && newConf > oldConf) {
                    await this.updateMemory(category, memory.id, {
                        metadata: { confidence: newConf, lastEchoBoostCommit: latestHash }
                    });
                } else if (!dryRun && newConf === oldConf) {
                    // Already at cap — still update marker to prevent re-scanning same commits
                    await this.updateMemory(category, memory.id, {
                        metadata: { lastEchoBoostCommit: latestHash }
                    });
                }

                report.boosted.push({
                    category,
                    id: memory.id,
                    keywords: matchedKeywords.slice(0, 5),
                    commits: matchedCommits.slice(0, 3).map(c => c.subject.slice(0, 50)),
                    oldConf,
                    newConf
                });
            }
        }

        return report;
    }

    /**
     * Ingest auto-memory markdown files (`.claude/agent-memory/{agent}/*.md`)
     * into the structured JSON memory store. Parses YAML frontmatter for
     * `name`, `description`, `type`; stores the full markdown body as a
     * `body` field in the created memory's content object.
     *
     * Accepts either a single `.md` file path OR a directory (walked recursively).
     * Skips `MEMORY.md` index files. Skips memories whose id already exists
     * (no overwrite). Dedup is by (category, id).
     *
     * @param {string} sourcePath - file or directory
     * @param {{dryRun?: boolean}} [options]
     * @returns {Promise<{ingested: number, skipped: number, errors: Array<{file: string, reason: string}>}>}
     */
    async ingestAgentMemory(sourcePath, options = {}) {
        return ingestAgentMemoryLib(sourcePath, {
            dryRun: options.dryRun ?? false,
            readMemory:   (cat, id) => this.readMemory(cat, id),
            createMemory: (cat, id, content) => this.createMemory(cat, id, content),
        });
    }

    // Legacy alias — tests or external callers may reach into this private helper
    async _findMarkdownFiles(sourcePath) {
        return ingestFindMarkdownFiles(sourcePath);
    }

    /**
     * Parse YAML frontmatter from a markdown string. Returns
     * `{ frontmatter: {...}, body: string }` or `null` if no frontmatter.
     * Thin adapter over _lib/frontmatter.js with `returnBody: true`.
     */
    static _parseFrontmatter(raw) {
        return parseFm(raw, { returnBody: true });
    }

    // Legacy static aliases — delegate to _lib/memory-ingest for backward compat
    static _typeToCategory(type) {
        return ingestTypeToCategory(type);
    }

    static _idFromFilename(filename) {
        return ingestIdFromFilename(filename);
    }

    /**
     * Calculate relevance score (for JSON fallback search)
     */
    calculateRelevance(memory, searchTerm) {
        let score = 0;
        const content = JSON.stringify(memory.content).toLowerCase();
        const term = searchTerm.toLowerCase();

        const matches = (content.match(new RegExp(term, 'g')) || []).length;
        score += matches * 10;

        const daysSinceUpdate = (Date.now() - new Date(memory.updated)) / (1000 * 60 * 60 * 24);
        if (daysSinceUpdate < 7) score += 20;
        else if (daysSinceUpdate < 30) score += 10;

        score += memory.usage_count * 5;
        score += memory.metadata.confidence * 10;

        return score;
    }

    /**
     * Rebuild SQLite index from JSON files (repair command)
     */
    async rebuildIndex() {
        if (!this.initDb()) {
            console.log('SQLite not available — nothing to rebuild.');
            return;
        }

        this.db.exec('DELETE FROM memories');
        this.db.exec('DELETE FROM memories_fts');

        let count = 0;
        for (const category of this.categories) {
            const memories = await this.listMemories(category);
            for (const memSummary of memories) {
                const memory = await this.readMemory(category, memSummary.id);
                if (memory) {
                    this.indexMemory(memory);
                    count++;
                }
            }
        }
        console.log(`✅ Rebuilt SQLite index: ${count} memories indexed.`);
    }

    /**
     * Run all 7 memory lint checks and return a structured health report.
     */
    /**
     * Run all 7 memory lint checks and return a structured health report.
     * Thin wrapper: assembles {category, summary, full} tuples then delegates
     * to _lib/memory-lint.js. Keeps per-instance decay resolver wired in.
     */
    async lintMemories() {
        const allMemories = [];
        for (const category of this.categories) {
            const summaries = await this.listMemories(category);
            for (const summary of summaries) {
                const full = await this.readMemory(category, summary.id);
                if (full) {
                    allMemories.push({ category, summary, full });
                }
            }
        }

        return lintMemoriesLib(allMemories, {
            calculateDecayedConfidence: (memory) => this.calculateDecayedConfidence(memory),
            categories: this.categories,
            maxPerCategory: MAX_MEMORIES_PER_CATEGORY,
        });
    }

    async generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            storage: {
                json: this.memoriesDir,
                sqlite: DatabaseSync ? this.dbPath : 'not available',
                sqliteBackend,
                sqliteSupportsFts5,
            },
            categories: {}
        };

        for (const category of this.categories) {
            const memories = await this.listMemories(category);
            const { MEMORY_DECAY } = require('./constants');
            const staleCount = memories.filter(m => m.decayed_confidence < MEMORY_DECAY.STALE_THRESHOLD).length;
            const archiveCandidates = memories.filter(m => m.decayed_confidence < MEMORY_DECAY.ARCHIVE_THRESHOLD).length;
            report.categories[category] = {
                count: memories.length,
                total_usage: memories.reduce((sum, m) => sum + m.usage_count, 0),
                avg_confidence: memories.reduce((sum, m) => sum + m.confidence, 0) / memories.length || 0,
                stale_count: staleCount,
                archive_candidates: archiveCandidates,
                memories: memories
            };
        }

        const allCategoryStats = Object.values(report.categories);
        report.summary = {
            total_memories: allCategoryStats.reduce((sum, c) => sum + c.count, 0),
            most_used_category: Object.entries(report.categories)
                .sort((a, b) => b[1].total_usage - a[1].total_usage)[0]?.[0],
            total_stale: allCategoryStats.reduce((sum, c) => sum + c.stale_count, 0),
            total_archive_candidates: allCategoryStats.reduce((sum, c) => sum + c.archive_candidates, 0)
        };

        return report;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Inbox pattern (R-A) — sub-agents flag draft memories to _inbox/, Main
    // Agent promotes/discards on dispatch return. Plan:
    // docs/.output/plans/2026-05-11-do-r-a-inbox-pattern.md
    // ────────────────────────────────────────────────────────────────────────

    _inboxDir() {
        return path.join(this.memoriesDir, '_inbox');
    }

    /**
     * List all draft memories in the inbox.
     * @returns {Promise<Array<{id, file, mtime, content_preview, category, suggested_id, flagged_by, flagged_at}>>}
     */
    async inboxList() {
        const dir = this._inboxDir();
        let files;
        try {
            files = await fs.readdir(dir);
        } catch (e) {
            if (e.code === 'ENOENT') return [];
            throw e;
        }

        const entries = [];
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const filePath = path.join(dir, file);
            try {
                const stat = await fs.stat(filePath);
                const raw = await fs.readFile(filePath, 'utf-8');
                const draft = JSON.parse(raw);
                const id = file.replace(/\.json$/, '');
                const description = draft.content?.description || '';
                entries.push({
                    id,
                    file: filePath,
                    mtime: stat.mtime.toISOString(),
                    content_preview: description.slice(0, 120),
                    category: draft.category,
                    suggested_id: draft.suggested_id,
                    flagged_by: draft.flagged_by,
                    flagged_at: draft.flagged_at,
                });
            } catch {
                // Skip unreadable / malformed entries — surface in promote step
            }
        }
        // Lex-sort = chronological for {YYYY-MM-DD}-{HHMM}-{slug} naming
        entries.sort((a, b) => a.id.localeCompare(b.id));
        return entries;
    }

    /**
     * Promote an inbox draft to a real memory: read draft, validate category,
     * call createMemory, delete the inbox file. Errors return {promoted:false,error}
     * rather than throw — matches existing pruneStaleMemories return shape.
     *
     * @param {string} id - inbox filename stem (without .json)
     * @param {{categoryOverride?: string, idOverride?: string}} [opts]
     * @returns {Promise<{promoted: true, category, id} | {promoted: false, error}>}
     */
    async inboxPromote(id, opts = {}) {
        const filePath = path.join(this._inboxDir(), `${id}.json`);
        let raw;
        try {
            raw = await fs.readFile(filePath, 'utf-8');
        } catch (e) {
            if (e.code === 'ENOENT') {
                return { promoted: false, error: `Inbox draft not found: ${id}` };
            }
            return { promoted: false, error: `Failed to read inbox draft: ${e.message}` };
        }

        let draft;
        try {
            draft = JSON.parse(raw);
        } catch (e) {
            return { promoted: false, error: `Inbox draft has malformed JSON: ${e.message}` };
        }

        const category = opts.categoryOverride || draft.category;
        const memoryId = opts.idOverride || draft.suggested_id;

        if (!this.categories.includes(category)) {
            return { promoted: false, error: `Invalid category: ${category}. Allowed: ${this.categories.join(', ')}` };
        }
        if (!memoryId || typeof memoryId !== 'string') {
            return { promoted: false, error: 'Missing or invalid suggested_id (no idOverride supplied)' };
        }

        const created = await this.createMemory(category, memoryId, draft.content || {});
        if (!created) {
            return { promoted: false, error: `createMemory returned null (category limit reached?)` };
        }

        try {
            await fs.unlink(filePath);
        } catch {
            // Memory was created; failure to unlink is non-fatal but worth a warning
            console.error(`⚠ Promoted ${category}/${memoryId} but failed to unlink ${filePath}`);
        }

        return { promoted: true, category, id: memoryId };
    }

    /**
     * Delete a memory: unlink JSON file + remove from SQLite + FTS5.
     * Returns {deleted, error?} matching pruneStaleMemories' internal primitive
     * but exposed as a top-level method (R-B — required for /review:memory-defrag
     * merge operations).
     *
     * @param {string} category
     * @param {string} id
     * @returns {Promise<{deleted: boolean, error?: string}>}
     */
    async deleteMemory(category, id) {
        if (!this.categories.includes(category)) {
            return { deleted: false, error: `Invalid category: ${category}. Allowed: ${this.categories.join(', ')}` };
        }

        // Locate the JSON file — try both hyphenated and underscore IDs (createMemory
        // converts underscores to hyphens at write time but accepts both at read time)
        const hyphenated = MemoryManager.idToFilename(id);
        const candidates = [
            path.join(this.memoriesDir, category, `${hyphenated}.json`),
            path.join(this.memoriesDir, category, `${id}.json`),
        ];
        let filePath = null;
        for (const candidate of candidates) {
            try {
                await fs.access(candidate);
                filePath = candidate;
                break;
            } catch { /* try next */ }
        }
        if (!filePath) {
            return { deleted: false, error: `Memory not found: ${category}/${id}` };
        }

        try {
            await fs.unlink(filePath);
        } catch (e) {
            return { deleted: false, error: `Failed to unlink ${filePath}: ${e.message}` };
        }

        // Deindex from SQLite (non-fatal if it fails; JSON file is already gone)
        this.deindexMemory(id);

        return { deleted: true };
    }

    /**
     * Discard an inbox draft without promoting it.
     *
     * @param {string} id - inbox filename stem (without .json)
     * @returns {Promise<{discarded: boolean, error?: string}>}
     */
    async inboxDiscard(id) {
        const filePath = path.join(this._inboxDir(), `${id}.json`);
        try {
            await fs.unlink(filePath);
            return { discarded: true };
        } catch (e) {
            if (e.code === 'ENOENT') {
                return { discarded: false, error: `Inbox draft not found: ${id}` };
            }
            return { discarded: false, error: e.message };
        }
    }
}

module.exports = MemoryManager;
module.exports.buildFtsQuery = buildFtsQuery;

// Direct invocation forwards to the CLI module (Task #11 split).
// Existing callers running `node .claude/core/memory-manager.js <cmd>` still work.
// Export MUST be above this block — the CLI requires ./memory-manager back, and
// circular-require sees {} if module.exports is assigned after the CLI kicks off.
if (require.main === module) {
    require('./memory-manager-cli').main().catch(err => {
        console.error(err.message);
        process.exit(1);
    });
}
