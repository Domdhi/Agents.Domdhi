/**
 * Skill evolution intake — the autonomous driver behind /review:evolve-skills.
 *
 * Self-improving skills, our way: instead of waiting for a human to notice a
 * gap, this reads the failure/learning signals the toolkit already collects and
 * proposes skill work — honoring skill-authoring's revised rule that every edit
 * needs EVIDENCE OF A REAL GAP first (the empirical baseline), validated by a
 * differential eval after (see .claude/core/skill-eval.js).
 *
 * Two evolution paths, two signals:
 *   IMPROVE — agent-updates misalignments (docs/.output/agent-updates/*.md)
 *             attributed to the existing skill that owns that domain. The
 *             misalignment IS the "without_skill / old_skill failed" baseline.
 *   CREATE  — clusters of recurring `workflows` + `patterns` memories that no
 *             existing skill covers → a candidate NEW skill (the Voyager/Hermes
 *             "extract the reusable pattern from experience and write it down"
 *             move). The recurrence across N memories IS the baseline evidence.
 *
 * This script does the deterministic part (collect, attribute, cluster, gate a
 * candidate against the skill spec). The reflective "why did it fail / what
 * should the skill say" diagnosis and the actual SKILL.md authoring are the
 * LLM's job in the command + skill-creator skill.
 *
 * Usage:
 *   node .claude/core/skill-evolution.js intake [--since YYYY-MM-DD] [--date YYYY-MM-DD] [--json]
 *   node .claude/core/skill-evolution.js check <skill-name> <candidate-SKILL.md>
 *   node .claude/core/skill-evolution.js status
 */

const fs = require('fs');
const path = require('path');
const conformance = require('./skill-conformance');

const ATTRIBUTE_MIN_SCORE = 2; // shared meaningful tokens to bind a signal to a skill
const CLUSTER_MIN_SHARED = 2;  // shared tokens to put two memories in one cluster
const CLUSTER_MIN_SIZE = 2;    // a CREATE candidate needs at least this many memories
const NAME_WEIGHT = 2;         // a skill-NAME token match counts double

const STOPWORDS = new Set(
    ('the a an and or but for nor so yet of to in on at by with from into onto upon as is are was were be been being ' +
        'this that these those it its their there here when then than them they your you our we us not no do does did ' +
        'doc docs file files use used using via per each any all one two new old set get run runs ran make made via ' +
        'should must never always when what which while because before after during about above below over under').split(/\s+/),
);

// ── Tokenizing + attribution (pure) ─────────────────────────────────────────

function tokenize(text) {
    return new Set(
        String(text || '')
            .toLowerCase()
            .replace(/[`*_>#|\[\]()]/g, ' ')
            .split(/[^a-z0-9]+/)
            .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
    );
}

function buildSkillIndex(skillsRoot) {
    const index = [];
    if (!fs.existsSync(skillsRoot)) return index;
    const dirs = fs
        .readdirSync(skillsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    for (const dir of dirs) {
        const skillPath = path.join(skillsRoot, dir, 'SKILL.md');
        if (!fs.existsSync(skillPath)) continue;
        const content = fs.readFileSync(skillPath, 'utf8');
        const fm = conformance.extractFrontmatter(content);
        const description = conformance.parseField(fm, 'description') || '';
        index.push({
            dir,
            description,
            nameTokens: tokenize(dir.replace(/-/g, ' ')),
            descTokens: tokenize(description),
        });
    }
    return index;
}

/** Overlap score of a token set against one skill (name matches weighted). */
function scoreOverlap(tokens, skillEntry) {
    let score = 0;
    for (const t of tokens) {
        if (skillEntry.nameTokens.has(t)) score += NAME_WEIGHT;
        else if (skillEntry.descTokens.has(t)) score += 1;
    }
    return score;
}

/** Best-matching skill for a signal, or null when nothing clears the threshold. */
function attributeSignal(tokens, skillIndex, minScore = ATTRIBUTE_MIN_SCORE) {
    let best = null;
    for (const s of skillIndex) {
        const score = scoreOverlap(tokens, s);
        if (score >= minScore && (!best || score > best.score)) best = { skill: s.dir, score };
    }
    return best;
}

// ── Memory clustering for CREATE (pure) ─────────────────────────────────────

/** Shared-token count between two token sets. */
function sharedCount(a, b) {
    let n = 0;
    for (const t of a) if (b.has(t)) n++;
    return n;
}

/**
 * Greedy single-link clustering of memories by token overlap.
 * memories: [{ id, tokens:Set, ... }] → [[memberIndices...]] (size ≥ minSize).
 */
function clusterMemories(memories, { minShared = CLUSTER_MIN_SHARED, minSize = CLUSTER_MIN_SIZE } = {}) {
    const clusters = [];
    for (let i = 0; i < memories.length; i++) {
        let placed = false;
        for (const cluster of clusters) {
            if (cluster.some((j) => sharedCount(memories[i].tokens, memories[j].tokens) >= minShared)) {
                cluster.push(i);
                placed = true;
                break;
            }
        }
        if (!placed) clusters.push([i]);
    }
    return clusters.filter((c) => c.length >= minSize);
}

// ── Disk collectors ─────────────────────────────────────────────────────────

function collectAgentUpdates(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    const files = fs
        .readdirSync(dir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)) // day-rotated only; skip README/archive
        .sort()
        .reverse();
    for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        const date = file.replace(/\.md$/, '');
        // Split on top-level `## ` section headers; each section is one signal.
        const sections = content.split(/\n(?=## )/).filter((s) => /^## /.test(s.trim()));
        for (const sec of sections) {
            const firstLine = sec.split('\n')[0].replace(/^##\s*/, '').trim();
            out.push({ source: file, date, context: firstLine, text: sec });
        }
    }
    return out;
}

function collectMemories(memRoot, categories = ['workflows', 'patterns']) {
    const out = [];
    for (const cat of categories) {
        const catDir = path.join(memRoot, cat);
        if (!fs.existsSync(catDir)) continue;
        for (const file of fs.readdirSync(catDir).filter((f) => f.endsWith('.json'))) {
            try {
                const m = JSON.parse(fs.readFileSync(path.join(catDir, file), 'utf8'));
                const desc = (m.content && m.content.description) || '';
                const evidence = (m.content && m.content.evidence) || '';
                out.push({
                    id: m.id || file.replace(/\.json$/, ''),
                    category: cat,
                    description: desc,
                    evidence,
                    confidence: (m.content && m.content.confidence) ?? 0.5,
                    usage_count: m.usage_count ?? 0,
                    importance: m.importance ?? 3,
                    tokens: tokenize(`${desc} ${evidence}`),
                });
            } catch {
                /* skip malformed memory */
            }
        }
    }
    return out;
}

// ── Intake ──────────────────────────────────────────────────────────────────

function intake({ projectDir, since = null } = {}) {
    const root = projectDir || process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
    const skillsRoot = path.join(root, '.claude', 'skills');
    const memRoot = path.join(root, 'docs', '.output', 'memories');
    const auDir = path.join(root, 'docs', '.output', 'agent-updates');

    const skillIndex = buildSkillIndex(skillsRoot);

    // IMPROVE: attribute each agent-update section to a skill.
    let agentUpdates = collectAgentUpdates(auDir);
    if (since) agentUpdates = agentUpdates.filter((u) => u.date >= since);
    const improveBySkill = {};
    const unattributed = [];
    for (const u of agentUpdates) {
        const hit = attributeSignal(tokenize(u.text), skillIndex);
        if (hit) {
            (improveBySkill[hit.skill] ||= { skill: hit.skill, score: 0, evidence: [] });
            improveBySkill[hit.skill].score += hit.score;
            improveBySkill[hit.skill].evidence.push({ source: u.source, date: u.date, context: u.context });
        } else {
            unattributed.push({ type: 'agent-update', date: u.date, context: u.context });
        }
    }
    const improve = Object.values(improveBySkill).sort((a, b) => b.score - a.score);

    // CREATE: cluster recurring memories that no existing skill covers.
    const memories = collectMemories(memRoot);
    const clusters = clusterMemories(memories);
    const create = [];
    for (const cluster of clusters) {
        const members = cluster.map((i) => memories[i]);
        const merged = new Set();
        for (const m of members) for (const t of m.tokens) merged.add(t);
        const coverage = attributeSignal(merged, skillIndex);
        // Already covered by a strong existing-skill match ⇒ this is IMPROVE turf, not CREATE.
        if (coverage && coverage.score >= ATTRIBUTE_MIN_SCORE * 2) continue;
        const topTokens = [...merged].slice(0, 6);
        create.push({
            proposedName: topTokens.slice(0, 3).join('-') || 'new-skill',
            memberIds: members.map((m) => m.id),
            size: members.length,
            avgConfidence: round(members.reduce((s, m) => s + m.confidence, 0) / members.length),
            keywords: topTokens,
            coveredBy: coverage ? coverage.skill : null,
            evidence: members.map((m) => ({ id: m.id, category: m.category, description: truncate(m.description, 140) })),
        });
    }
    create.sort((a, b) => b.size - a.size || b.avgConfidence - a.avgConfidence);

    return {
        generated: null, // stamped by caller / CLI
        signals: { agentUpdates: agentUpdates.length, memories: memories.length, clusters: clusters.length },
        improve,
        create,
        unattributed,
    };
}

function round(x, dp = 2) {
    const f = 10 ** dp;
    return Math.round(x * f) / f;
}
function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function renderIntakeMd(report, date) {
    const L = [];
    L.push(`# Skill Evolution Intake — ${date || ''}`.trim());
    L.push('');
    L.push(`**Signals:** ${report.signals.agentUpdates} agent-update sections · ${report.signals.memories} memories · ${report.signals.clusters} clusters`);
    L.push('');
    L.push('## IMPROVE candidates (failure-trace → skill fix)');
    L.push('');
    if (!report.improve.length) L.push('_None — no agent-update misalignments attributed to a skill._');
    for (const c of report.improve) {
        L.push(`### \`${c.skill}\` (signal score ${c.score})`);
        for (const e of c.evidence) L.push(`- ${e.date} — ${e.context}`);
        L.push('');
    }
    L.push('## CREATE candidates (clustered memories → new skill)');
    L.push('');
    if (!report.create.length) L.push('_None — no uncovered recurring memory cluster._');
    for (const c of report.create) {
        L.push(`### proposed: \`${c.proposedName}\` (${c.size} memories, conf ${c.avgConfidence}${c.coveredBy ? `, weakly near \`${c.coveredBy}\`` : ''})`);
        L.push(`keywords: ${c.keywords.map((k) => `\`${k}\``).join(', ')}`);
        for (const e of c.evidence) L.push(`- [${e.category}] ${e.id} — ${e.description}`);
        L.push('');
    }
    if (report.unattributed.length) {
        L.push('## Unattributed signals (possible missing skill / too vague)');
        for (const u of report.unattributed) L.push(`- ${u.date} — ${u.context}`);
        L.push('');
    }
    return L.join('\n') + '\n';
}

// ── check: gate a candidate body against the skill spec ─────────────────────

function check(skillName, candidateFile) {
    if (!fs.existsSync(candidateFile)) {
        return { ok: false, error: `candidate not found: ${candidateFile}`, findings: [] };
    }
    const content = fs.readFileSync(candidateFile, 'utf8');
    const fm = conformance.extractFrontmatter(content);
    const findings = conformance.evaluateSkill({
        dir: skillName,
        name: conformance.parseField(fm, 'name'),
        description: conformance.parseField(fm, 'description'),
        lineCount: conformance.countLines(content),
    });
    const errors = findings.filter((f) => f.severity === 'ERROR');
    return { ok: errors.length === 0, findings };
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(argv) {
    const args = require('./skill-eval').parseArgs(argv);
    const cmd = args._[0];
    const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');

    if (cmd === 'intake') {
        const report = intake({ projectDir: root, since: args.since || null });
        const date = args.date || null;
        report.generated = date;
        if (args.json) {
            console.log(JSON.stringify(report, null, 2));
            return;
        }
        const outDir = path.join(root, 'docs', '.output', 'skill-evolution', date || 'latest');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'intake.json'), JSON.stringify(report, null, 2));
        fs.writeFileSync(path.join(outDir, 'intake.md'), renderIntakeMd(report, date));
        console.log(`[SKILL-EVOLUTION] ${report.improve.length} IMPROVE · ${report.create.length} CREATE → ${path.join(outDir, 'intake.md')}`);
        return;
    }

    if (cmd === 'check') {
        const result = check(args._[1], args._[2]);
        if (result.error) {
            console.error(`[SKILL-EVOLUTION] ${result.error}`);
            process.exit(1);
        }
        for (const f of result.findings) console.log(`${f.severity} ${f.message}`);
        console.log(`[SKILL-EVOLUTION] candidate ${result.ok ? 'PASSES' : 'FAILS'} the skill spec.`);
        process.exit(result.ok ? 0 : 1);
    }

    if (cmd === 'status') {
        const base = path.join(root, 'docs', '.output', 'skill-evolution');
        if (!fs.existsSync(base)) {
            console.log('[SKILL-EVOLUTION] no runs yet.');
            return;
        }
        for (const d of fs.readdirSync(base).sort().reverse()) {
            const intakeMd = path.join(base, d, 'intake.md');
            if (fs.existsSync(intakeMd)) console.log(`- ${d}/intake.md`);
        }
        return;
    }

    console.error('Usage: node .claude/core/skill-evolution.js intake|check|status [...]');
    process.exit(2);
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}

module.exports = {
    ATTRIBUTE_MIN_SCORE,
    CLUSTER_MIN_SHARED,
    CLUSTER_MIN_SIZE,
    tokenize,
    buildSkillIndex,
    scoreOverlap,
    attributeSignal,
    sharedCount,
    clusterMemories,
    collectAgentUpdates,
    collectMemories,
    intake,
    renderIntakeMd,
    check,
    main,
};
