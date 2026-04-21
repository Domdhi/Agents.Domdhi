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

// Memory guard constants
const MAX_MEMORIES_PER_CATEGORY = 50;
const PRUNE_THRESHOLD_PERCENT = 0.8;
const PRUNE_MIN_AGE_DAYS = 30;
const PRUNE_MIN_CONFIDENCE = 0.3;

// Try to load built-in SQLite (Node 25+)
let DatabaseSync = null;
try {
    DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
    // SQLite not available — JSON-only mode
}

class MemoryManager {
    constructor() {
        const projectRoot = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
        this.memoriesDir = path.join(projectRoot, 'docs', '.output', 'memories');
        this.dbPath = path.join(this.memoriesDir, 'memories.db');
        this.categories = ['patterns', 'constraints', 'decisions', 'workflows', 'rejected-approaches'];
        this.db = null;
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
            console.error('SQLite init failed (falling back to JSON-only):', e.message);
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
                const rows = stmt.all(searchTerm);
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
     * Cached per session — git log is only queried once.
     */
    getActiveDaysSince(sinceDate) {
        if (!this._activeDaysCache) {
            try {
                const output = execSync('git log --format="%ad" --date=short', {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                    timeout: 5000,
                    windowsHide: true,
                });
                this._activeDaysCache = new Set(output.trim().split('\n').filter(Boolean));
            } catch {
                this._activeDaysCache = null; // Not a git repo or git unavailable
            }
        }
        // Fallback to calendar days if git is unavailable
        if (!this._activeDaysCache) {
            return (Date.now() - new Date(sinceDate)) / (1000 * 60 * 60 * 24);
        }
        const since = new Date(sinceDate);
        since.setHours(0, 0, 0, 0);
        let count = 0;
        for (const dateStr of this._activeDaysCache) {
            const d = new Date(dateStr + 'T00:00:00');
            if (d >= since) count++;
        }
        return count;
    }

    /**
     * Calculate decayed confidence for a memory — read-time only, not stored.
     * Formula: base * rate^active_work_days + usage_boost + recent_update_boost, capped at 1.0
     * Rate is category-specific from MEMORY_DECAY.RATES; falls back to MEMORY_DECAY.DEFAULT_RATE (0.95).
     * Uses active work days (days with git commits) instead of calendar days — a project
     * untouched for months has zero decay because nothing changed to invalidate memories.
     */
    calculateDecayedConfidence(memory) {
        const { MEMORY_DECAY } = require('./constants');
        const baseConfidence = memory.metadata?.confidence ?? 1.0;
        const activeDays = this.getActiveDaysSince(memory.updated);
        const calendarDays = (Date.now() - new Date(memory.updated)) / (1000 * 60 * 60 * 24);
        const rate = MEMORY_DECAY.RATES[memory.category] || MEMORY_DECAY.DEFAULT_RATE;
        let decayed = baseConfidence * Math.pow(rate, activeDays);
        decayed += (memory.usage_count || 0) * MEMORY_DECAY.USAGE_BOOST;
        if (calendarDays < MEMORY_DECAY.RECENT_UPDATE_DAYS) decayed += MEMORY_DECAY.RECENT_UPDATE_BOOST;
        return Math.min(decayed, 1.0);
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

        const STOPWORDS = new Set(['the','and','for','with','from','that','this','are','but','not','have','has','was','were','will','can','its','their','them','they','you','your','our','one','two','all','any','been','into','than','then','what','when','which','who','how','why','also','just','some','more','very']);

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
        const { dryRun = false } = options;
        const report = { ingested: 0, skipped: 0, errors: [] };

        const files = await this._findMarkdownFiles(sourcePath);
        if (files.length === 0) {
            return report;
        }

        for (const file of files) {
            let raw;
            try {
                raw = await fs.readFile(file, 'utf8');
            } catch (err) {
                report.errors.push({ file, reason: `read failed: ${err.message}` });
                continue;
            }

            const parsed = MemoryManager._parseFrontmatter(raw);
            if (!parsed) {
                report.errors.push({ file, reason: 'missing or malformed frontmatter' });
                continue;
            }

            const { frontmatter, body } = parsed;
            const type = (frontmatter.type || '').trim();
            const category = MemoryManager._typeToCategory(type);
            if (!category) {
                report.errors.push({ file, reason: `unknown type: "${type}"` });
                continue;
            }

            const id = MemoryManager._idFromFilename(path.basename(file));
            const existing = await this.readMemory(category, id);
            if (existing) {
                report.skipped++;
                continue;
            }

            if (dryRun) {
                report.ingested++;
                continue;
            }

            const content = {
                description: (frontmatter.description || '').trim(),
                body: body.trim(),
                source: 'agent-memory',
                originalName: (frontmatter.name || '').trim(),
            };

            const created = await this.createMemory(category, id, content);
            if (created === null) {
                report.errors.push({ file, reason: 'category full (50-cap)' });
            } else {
                report.ingested++;
            }
        }

        return report;
    }

    /**
     * Recursively find `.md` files under a path, skipping `MEMORY.md` index
     * files. If `sourcePath` points to a single file, returns just that file.
     */
    async _findMarkdownFiles(sourcePath) {
        const results = [];
        let stat;
        try {
            stat = await fs.stat(sourcePath);
        } catch {
            return results;
        }

        if (stat.isFile()) {
            if (sourcePath.toLowerCase().endsWith('.md') &&
                path.basename(sourcePath).toLowerCase() !== 'memory.md') {
                results.push(sourcePath);
            }
            return results;
        }

        if (!stat.isDirectory()) return results;

        const entries = await fs.readdir(sourcePath, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(sourcePath, entry.name);
            if (entry.isDirectory()) {
                const nested = await this._findMarkdownFiles(full);
                results.push(...nested);
            } else if (entry.isFile()) {
                if (entry.name.toLowerCase().endsWith('.md') &&
                    entry.name.toLowerCase() !== 'memory.md') {
                    results.push(full);
                }
            }
        }
        return results;
    }

    /**
     * Parse YAML frontmatter from a markdown string. Returns
     * `{ frontmatter: {...}, body: string }` or `null` if no frontmatter.
     * Narrow schema: flat `key: value` lines only. Handles CRLF.
     */
    static _parseFrontmatter(raw) {
        const normalized = raw.replace(/\r\n/g, '\n');
        const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        if (!match) return null;

        const frontmatter = {};
        for (const line of match[1].split('\n')) {
            const kv = line.match(/^([\w-]+):\s*(.*)$/);
            if (kv) frontmatter[kv[1]] = kv[2];
        }
        if (Object.keys(frontmatter).length === 0) return null;
        return { frontmatter, body: match[2] };
    }

    /**
     * Map an auto-memory `type` value to a JSON-store category. Returns null
     * for unknown types so the caller can report an error.
     */
    static _typeToCategory(type) {
        const map = {
            feedback: 'patterns',
            pattern: 'patterns',
            constraint: 'constraints',
            decision: 'decisions',
            workflow: 'workflows',
            'rejected-approach': 'rejected-approaches',
        };
        return map[type] || null;
    }

    /**
     * Derive a memory id from a markdown filename:
     * `feedback_execsync_spy_destructured.md` → `feedback-execsync-spy-destructured`
     */
    static _idFromFilename(filename) {
        return filename
            .replace(/\.md$/i, '')
            .replace(/_/g, '-');
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
    async lintMemories() {
        // Build master list: { category, summary, full } for all memories
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

        const findings = {
            broken_refs:      { count: 0, severity: 'error',   findings: [] },
            orphaned:         { count: 0, severity: 'warning',  findings: [] },
            contradictions:   { count: 0, severity: 'warning',  findings: [] },
            stale:            { count: 0, severity: 'warning',  findings: [] },
            duplicates:       { count: 0, severity: 'warning',  findings: [] },
            decay_validation: { count: 0, severity: 'info',     findings: [] },
            category_balance: { count: 0, severity: 'warning',  findings: [] }
        };

        // Build a set of all known IDs for reference checking
        const knownIds = new Set(allMemories.map(m => m.full.id));

        // Check 1 — Broken cross-references
        const refPattern = /(?:related:|see:|ref:)\s*([\w-]+)/gi;
        for (const { category, full } of allMemories) {
            const contentStr = JSON.stringify(full.content);
            let match;
            while ((match = refPattern.exec(contentStr)) !== null) {
                const referencedId = match[1];
                if (!knownIds.has(referencedId)) {
                    findings.broken_refs.findings.push({
                        memory: `${category}/${full.id}`,
                        referenced_id: referencedId,
                        detail: `References ID "${referencedId}" which does not exist`
                    });
                }
            }
        }
        findings.broken_refs.count = findings.broken_refs.findings.length;

        // Check 2 — Orphaned concepts
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        for (const { category, full } of allMemories) {
            if ((full.usage_count || 0) === 0 && new Date(full.updated).getTime() < thirtyDaysAgo) {
                findings.orphaned.findings.push({
                    memory: `${category}/${full.id}`,
                    usage_count: full.usage_count || 0,
                    days_since_update: Math.round((Date.now() - new Date(full.updated)) / (1000 * 60 * 60 * 24)),
                    detail: 'Zero usage and not updated in 30+ days'
                });
            }
        }
        findings.orphaned.count = findings.orphaned.findings.length;

        // Check 3 — Contradictions (same category, high overlap but conflicting signals)
        const POSITIVE_SIGNALS = ['always', 'must', 'should', 'require', 'use', 'do'];
        const NEGATIVE_SIGNALS = ["don't", "never", "avoid", 'skip', 'stop', 'remove'];
        const byCategory = {};
        for (const m of allMemories) {
            if (!byCategory[m.category]) byCategory[m.category] = [];
            byCategory[m.category].push(m);
        }
        for (const [category, members] of Object.entries(byCategory)) {
            for (let i = 0; i < members.length; i++) {
                for (let j = i + 1; j < members.length; j++) {
                    const textA = JSON.stringify(members[i].full.content).toLowerCase();
                    const textB = JSON.stringify(members[j].full.content).toLowerCase();
                    const similarity = jaccardSimilarity(textA, textB);
                    if (similarity > 0.5 && textA !== textB) {
                        const aHasPositive = POSITIVE_SIGNALS.some(s => textA.includes(s));
                        const aHasNegative = NEGATIVE_SIGNALS.some(s => textA.includes(s));
                        const bHasPositive = POSITIVE_SIGNALS.some(s => textB.includes(s));
                        const bHasNegative = NEGATIVE_SIGNALS.some(s => textB.includes(s));
                        const conflict = (aHasPositive && bHasNegative) || (aHasNegative && bHasPositive);
                        if (conflict) {
                            findings.contradictions.findings.push({
                                memory_a: `${category}/${members[i].full.id}`,
                                memory_b: `${category}/${members[j].full.id}`,
                                overlap: Math.round(similarity * 100),
                                detail: 'High keyword overlap with conflicting positive/negative signals — flag for manual review'
                            });
                        }
                    }
                }
            }
        }
        findings.contradictions.count = findings.contradictions.findings.length;

        // Check 4 — Staleness (decayed confidence < 0.3)
        for (const { category, full } of allMemories) {
            const decayed = this.calculateDecayedConfidence(full);
            if (decayed < 0.3) {
                findings.stale.findings.push({
                    memory: `${category}/${full.id}`,
                    decayed_confidence: Math.round(decayed * 1000) / 1000,
                    detail: 'Decayed confidence below 0.3 threshold'
                });
            }
        }
        findings.stale.count = findings.stale.findings.length;

        // Check 5 — Duplicates (same category, Jaccard > 0.8)
        for (const [category, members] of Object.entries(byCategory)) {
            for (let i = 0; i < members.length; i++) {
                for (let j = i + 1; j < members.length; j++) {
                    const textA = JSON.stringify(members[i].full.content).toLowerCase();
                    const textB = JSON.stringify(members[j].full.content).toLowerCase();
                    const similarity = jaccardSimilarity(textA, textB);
                    if (similarity > 0.8) {
                        findings.duplicates.findings.push({
                            memory_a: `${category}/${members[i].full.id}`,
                            memory_b: `${category}/${members[j].full.id}`,
                            overlap: Math.round(similarity * 100),
                            detail: `Content is ${Math.round(similarity * 100)}% similar — likely duplicate`
                        });
                    }
                }
            }
        }
        findings.duplicates.count = findings.duplicates.findings.length;

        // Check 6 — Decay curve validation (raw confidence >= 0.7 but decayed < 0.3)
        for (const { category, full } of allMemories) {
            const rawConfidence = full.metadata?.confidence ?? 1.0;
            const decayed = this.calculateDecayedConfidence(full);
            if (rawConfidence >= 0.7 && decayed < 0.3) {
                findings.decay_validation.findings.push({
                    memory: `${category}/${full.id}`,
                    raw_confidence: rawConfidence,
                    decayed_confidence: Math.round(decayed * 1000) / 1000,
                    days_since_update: Math.round((Date.now() - new Date(full.updated)) / (1000 * 60 * 60 * 24)),
                    detail: 'High raw confidence but heavily decayed — not updated in a long time'
                });
            }
        }
        findings.decay_validation.count = findings.decay_validation.findings.length;

        // Check 7 — Category balance (any category >= 80% of MAX_MEMORIES_PER_CATEGORY)
        const balanceThreshold = Math.floor(MAX_MEMORIES_PER_CATEGORY * 0.8);
        for (const category of this.categories) {
            const count = (byCategory[category] || []).length;
            if (count >= balanceThreshold) {
                findings.category_balance.findings.push({
                    category,
                    count,
                    limit: MAX_MEMORIES_PER_CATEGORY,
                    threshold: balanceThreshold,
                    detail: `${count} memories in "${category}" is >= ${balanceThreshold} (80% of ${MAX_MEMORIES_PER_CATEGORY} limit)`
                });
            }
        }
        findings.category_balance.count = findings.category_balance.findings.length;

        // Calculate health score: start at 70, deduct per finding
        const DEDUCTIONS = { error: 3, warning: 2, info: 1 };
        let score = 70;
        for (const check of Object.values(findings)) {
            score -= check.count * DEDUCTIONS[check.severity];
        }
        score = Math.max(0, score);

        return {
            score,
            checks: findings,
            total_memories: allMemories.length,
            categories_checked: this.categories.length
        };
    }

    async generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            storage: {
                json: this.memoriesDir,
                sqlite: DatabaseSync ? this.dbPath : 'not available (Node 25+ required)'
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
}

/**
 * Jaccard similarity between two text strings, computed over word sets (words > 2 chars).
 */
function jaccardSimilarity(text1, text2) {
    const words1 = new Set(text1.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const words2 = new Set(text2.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    return union.size === 0 ? 0 : intersection.size / union.size;
}

// CLI interface
async function main() {
    const manager = new MemoryManager();
    const [,, command, ...args] = process.argv;

    switch(command) {
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
                    const { MEMORY_DECAY } = require('./constants');
                    allEntries.push({
                        category,
                        id: m.id,
                        confidence: m.confidence,
                        decayed_confidence: m.decayed_confidence,
                        decay_rate: MEMORY_DECAY.RATES[category] || MEMORY_DECAY.DEFAULT_RATE,
                        usage_count: m.usage_count,
                        updated: m.updated
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
        case 'boost-from-git': {
            const opts = {};
            for (let i = 0; i < args.length; i++) {
                if (args[i] === '--limit' && args[i+1]) { opts.limit = parseInt(args[++i], 10); }
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
                    `${entry.oldConf.toFixed(3)}→${entry.newConf.toFixed(3)}`
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
  node memory-manager.js create <category> <id> <content>
  node memory-manager.js read <category> <id>
  node memory-manager.js list <category>
  node memory-manager.js search <term>
  node memory-manager.js report
  node memory-manager.js rebuild-index
  node memory-manager.js decay-report
  node memory-manager.js boost-from-git [--limit N] [--dry-run]
  node memory-manager.js lint
  node memory-manager.js ingest <path> [--dry-run]
    Ingest auto-memory .md files (YAML frontmatter + body) into the
    JSON store. Path may be a single file or a directory (walked recursively).
    type → category: feedback/pattern → patterns, constraint → constraints,
    decision → decisions, workflow → workflows, rejected-approach → rejected-approaches.

Categories: patterns, constraints, decisions, workflows, rejected-approaches
Storage: docs/.output/memories/ (JSON) + memories.db (SQLite FTS5)
            `);
    }
}

if (require.main === module) {
    main().catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = MemoryManager;
