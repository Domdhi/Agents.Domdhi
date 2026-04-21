#!/usr/bin/env node

/**
 * Decision Viz — Parse decision data sources and generate an interactive HTML visualization.
 *
 * Reads concept articles, cross-references, git log, ADRs, memory records, and daily logs.
 * Produces a self-contained HTML file with vis.js Timeline + Network graph.
 *
 * Usage:
 *   node .claude/core/decision-viz.js              # Full scan + HTML
 *   node .claude/core/decision-viz.js --text-only  # JSON summary to stdout (no HTML)
 *   node .claude/core/decision-viz.js --days 30    # Limit to last 30 days (default: 90)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'docs', '.output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'decisions.html');
const TEXT_ONLY = process.argv.includes('--text-only');

// Parse --days N flag (default 90)
const daysIdx = process.argv.indexOf('--days');
const MAX_DAYS = daysIdx !== -1 && process.argv[daysIdx + 1]
  ? parseInt(process.argv[daysIdx + 1], 10)
  : 90;
const CUTOFF_DATE = new Date();
CUTOFF_DATE.setDate(CUTOFF_DATE.getDate() - MAX_DAYS);

const CATEGORIES = ['patterns', 'constraints', 'decisions', 'workflows', 'rejected-approaches'];
const CONCEPTS_DIR = path.join(PROJECT_ROOT, 'docs', '.output', 'memories', 'concepts');
const MEMORIES_DIR = path.join(PROJECT_ROOT, 'docs', '.output', 'memories');
const DAILY_DIR = path.join(MEMORIES_DIR, 'daily');

// ── Helpers ─────────────────────────────────────────���───────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function warn(msg) {
  process.stderr.write(`[decision-viz] WARN: ${msg}\n`);
}

function safeReadDir(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    warn(`Cannot read directory: ${dir}`);
    return [];
  }
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    warn(`Cannot read file: ${filePath}`);
    return null;
  }
}

// ── Frontmatter parser (from memory-compiler.js) ────────────────

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const raw = match[1];
  const result = {};
  const listFields = new Set(['sources', 'tags', 'aliases']);
  let currentList = null;
  const lists = {};

  for (const line of raw.split('\n')) {
    const listStart = line.match(/^(\w+):$/);
    if (listStart && listFields.has(listStart[1])) {
      currentList = listStart[1];
      lists[currentList] = [];
      continue;
    }

    if (currentList && line.trimStart().startsWith('- ')) {
      lists[currentList].push(line.replace(/^\s*-\s*/, '').trim());
      continue;
    }

    if (currentList && !line.trimStart().startsWith('- ')) {
      currentList = null;
    }

    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) result[kv[1]] = kv[2].trim();
  }

  for (const [key, values] of Object.entries(lists)) {
    if (values.length > 0) result[key] = values;
  }

  return result;
}

// ── Parser 1: Concept articles ──────────────────────────────────

function parseConcepts() {
  const concepts = [];

  for (const category of CATEGORIES) {
    const catDir = path.join(CONCEPTS_DIR, category);
    const entries = safeReadDir(catDir);

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const filePath = path.join(catDir, entry.name);
      const content = safeReadFile(filePath);
      if (!content) continue;

      const fm = parseFrontmatter(content);
      if (!fm) continue;

      const slug = entry.name.replace(/\.md$/, '');

      // Extract summary from ## Summary section
      const summaryMatch = content.match(/## Summary\r?\n\r?\n([\s\S]*?)(?=\r?\n## |\r?\n---|\Z)/);
      const summary = summaryMatch
        ? summaryMatch[1].trim().split('\n')[0].slice(0, 200)
        : '';

      concepts.push({
        slug,
        title: fm.title || slug,
        category: fm.category || category,
        confidence: parseFloat(fm.confidence) || 0.6,
        created: fm.created || null,
        updated: fm.updated || null,
        sources: fm.sources || [],
        tags: fm.tags || [],
        summary,
      });
    }
  }

  return concepts;
}

// ── Parser 2: Cross-references ──────────────────────────────────

function parseCrossRefs() {
  const crossRefPath = path.join(CONCEPTS_DIR, 'cross-references.json');
  const content = safeReadFile(crossRefPath);
  if (!content) return {};

  try {
    return JSON.parse(content);
  } catch {
    warn('Invalid JSON in cross-references.json');
    return {};
  }
}

// ── Parser 3: Git log ───────────────────────────────────────────

function parseGitLog() {
  const commits = [];
  const since = CUTOFF_DATE.toISOString().slice(0, 10);

  try {
    const raw = execSync(
      `git log --format="%H|%ad|%s" --date=iso --since="${since}" -500`,
      { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );

    for (const line of raw.split('\n').filter(Boolean)) {
      const parts = line.split('|');
      if (parts.length < 3) continue;
      const hash = parts[0];
      const date = parts[1].trim();
      const message = parts.slice(2).join('|').trim();

      commits.push({ hash, date, message });
    }
  } catch {
    warn('Cannot read git log (not a git repo or no commits)');
  }

  return commits;
}

// ── Parser 4: ADRs from architecture doc ────────���───────────────

function parseADRs() {
  const adrs = [];
  const archPaths = [
    path.join(PROJECT_ROOT, 'docs', '_project-architecture.md'),
  ];

  let content = null;
  for (const p of archPaths) {
    content = safeReadFile(p);
    if (content) break;
  }

  if (!content) return adrs;

  // Match ### ADR-N: Title sections
  const adrRegex = /### ADR-(\d+)[:\s]+(.+?)(?:\r?\n)([\s\S]*?)(?=\r?\n### |\r?\n## |\Z)/g;
  let match;

  while ((match = adrRegex.exec(content)) !== null) {
    const number = parseInt(match[1], 10);
    const title = match[2].trim();
    const body = match[3].trim();

    // Try to extract status
    const statusMatch = body.match(/\*?\*?Status\*?\*?[:\s]+(\w+)/i);
    const status = statusMatch ? statusMatch[1] : 'unknown';

    // Try to extract date
    const dateMatch = body.match(/\*?\*?Date\*?\*?[:\s]+([\d-]+)/i)
      || body.match(/(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : null;

    // First non-metadata paragraph as summary
    const lines = body.split('\n').filter(l => l.trim() && !l.match(/^\*?\*?(Status|Date|Context|Decision|Consequences)\*?\*?/i));
    const summary = lines[0] ? lines[0].trim().slice(0, 200) : '';

    adrs.push({ number, title, status, date, summary });
  }

  return adrs;
}

// ── Parser 5: Daily logs ────────────────────────────────────────

function parseDailyLogs() {
  const logs = [];
  const entries = safeReadDir(DAILY_DIR);

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    // Extract date from filename
    const dateMatch = entry.name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    if (!dateMatch) continue;

    const fileDate = new Date(dateMatch[1]);
    if (fileDate < CUTOFF_DATE) continue;

    const filePath = path.join(DAILY_DIR, entry.name);
    const content = safeReadFile(filePath);
    if (!content) continue;

    // Extract entries: ## HH:MM — {trigger}
    const entryRegex = /## (\d{2}:\d{2}) — (.+?)(?:\r?\n)([\s\S]*?)(?=\r?\n## |\Z)/g;
    let m;

    while ((m = entryRegex.exec(content)) !== null) {
      const time = m[1];
      const trigger = m[2].trim();
      const body = m[3].trim();

      // Extract branch info
      const branchMatch = body.match(/\*?\*?Branch:\*?\*?\s*(.+)/);
      const branch = branchMatch ? branchMatch[1].trim() : null;

      logs.push({
        date: dateMatch[1],
        time,
        trigger,
        branch,
        hasCommits: body.includes('### Recent Commits'),
        hasDecisions: body.includes('### Key Decisions'),
      });
    }
  }

  return logs;
}

// ── Parser 6: Memory JSON records ───────────────────────────────

function parseMemoryRecords() {
  const records = [];

  for (const category of CATEGORIES) {
    const catDir = path.join(MEMORIES_DIR, category);
    const entries = safeReadDir(catDir);

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = path.join(catDir, entry.name);
      const content = safeReadFile(filePath);
      if (!content) continue;

      try {
        const record = JSON.parse(content);
        records.push({
          id: record.id || entry.name.replace(/\.json$/, ''),
          category: record.category || category,
          confidence: record.metadata?.confidence ?? 1.0,
          created: record.created || null,
          updated: record.updated || null,
          usageCount: record.usage_count || 0,
          description: record.content?.description || record.content?.name || '',
        });
      } catch {
        warn(`Invalid JSON in memory record: ${filePath}`);
      }
    }
  }

  return records;
}

// ── Aggregate all data ──────────────────────────────────────────

function collectData() {
  return {
    concepts: parseConcepts(),
    crossRefs: parseCrossRefs(),
    commits: parseGitLog(),
    adrs: parseADRs(),
    dailyLogs: parseDailyLogs(),
    memories: parseMemoryRecords(),
  };
}

// ── Text summary ────────────────────────────────────���───────────

function printTextSummary(data) {
  console.log('');
  console.log('  Decision Log Visualization — Data Summary');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Concept articles:  ${data.concepts.length}`);
  console.log(`  Cross-ref pairs:   ${Object.keys(data.crossRefs).length} slugs`);
  console.log(`  Git commits:       ${data.commits.length} (last ${MAX_DAYS} days)`);
  console.log(`  ADRs:              ${data.adrs.length}`);
  console.log(`  Daily log entries: ${data.dailyLogs.length} (last ${MAX_DAYS} days)`);
  console.log(`  Memory records:    ${data.memories.length}`);
  console.log('');

  // Category breakdown for concepts
  const catCounts = {};
  for (const c of data.concepts) {
    catCounts[c.category] = (catCounts[c.category] || 0) + 1;
  }
  if (data.concepts.length > 0) {
    console.log('  Concepts by category:');
    for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${cat}: ${count}`);
    }
    console.log('');
  }

  // Stale/archived counts
  const stale = data.concepts.filter(c => c.confidence < 0.3 && c.confidence >= 0.1).length;
  const archived = data.concepts.filter(c => c.confidence < 0.1).length;
  if (stale || archived) {
    console.log(`  Stale (< 0.3): ${stale}  |  Archived (< 0.1): ${archived}`);
    console.log('');
  }
}

// ── Build timeline items from all data sources ────────────��─────

const CATEGORY_COLORS = {
  decisions: '#3fb950',
  patterns: '#1f6feb',
  constraints: '#da3633',
  workflows: '#d29922',
  commits: '#8b949e',
  adrs: '#a371f7',
};

function buildTimelineItems(data) {
  const items = [];
  let id = 0;

  // Concepts — use earliest source date, or created date
  for (const c of data.concepts) {
    const date = (c.sources && c.sources[0]) || (c.created ? c.created.slice(0, 10) : null);
    if (!date) continue;
    items.push({
      id: id++,
      content: esc(c.title),
      start: date,
      group: c.category,
      className: `cat-${c.category}`,
      slug: c.slug,
      type: 'concept',
      title: `${c.title}\nCategory: ${c.category}\nConfidence: ${c.confidence.toFixed(2)}\nSources: ${(c.sources || []).length}\n${c.summary || ''}`,
      confidence: c.confidence,
    });
  }

  // Git commits
  for (const commit of data.commits) {
    const date = commit.date ? commit.date.slice(0, 10) : null;
    if (!date) continue;
    items.push({
      id: id++,
      content: esc(commit.message.slice(0, 60)),
      start: date,
      group: 'commits',
      className: 'cat-commits',
      type: 'commit',
      title: `${commit.message}\nHash: ${commit.hash.slice(0, 8)}\nDate: ${commit.date}`,
      confidence: 1.0,
    });
  }

  // ADRs
  for (const adr of data.adrs) {
    if (!adr.date) continue;
    items.push({
      id: id++,
      content: esc(`ADR-${adr.number}: ${adr.title}`),
      start: adr.date,
      group: 'decisions',
      className: 'cat-adrs',
      type: 'adr',
      title: `ADR-${adr.number}: ${adr.title}\nStatus: ${adr.status}\n${adr.summary || ''}`,
      confidence: 1.0,
    });
  }

  // Daily log entries
  for (const log of data.dailyLogs) {
    items.push({
      id: id++,
      content: esc(`${log.trigger}${log.branch ? ` (${log.branch})` : ''}`),
      start: log.date,
      group: 'workflows',
      className: 'cat-workflows',
      type: 'daily-log',
      title: `Daily log: ${log.trigger}\nDate: ${log.date} ${log.time}\nBranch: ${log.branch || 'unknown'}`,
      confidence: 1.0,
    });
  }

  return items;
}

// ── HTML generation ─────────────────────────────────────────────

function generateHtml(data) {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Detect project name
  let projectName;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    projectName = pkg.name;
  } catch {
    projectName = path.basename(PROJECT_ROOT);
  }

  const items = buildTimelineItems(data);
  const itemsJson = serializeSafe(items);
  const dataJson = serializeSafe(data);

  // Compute initial zoom window: last 30 days
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Decision Log — ${esc(projectName)}</title>
<script src="https://unpkg.com/vis-timeline/standalone/umd/vis-timeline-graph2d.min.js"><\/script>
<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"><\/script>
<link href="https://unpkg.com/vis-timeline/styles/vis-timeline-graph2d.min.css" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; max-width: 1200px; margin: 0 auto; }
  h1 { color: #f0f6fc; margin-bottom: 0.25rem; font-size: 1.5rem; display: inline-block; }
  .header { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.25rem; }
  .meta { color: #8b949e; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .nav-link { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; border-radius: 6px; padding: 4px 12px; font-size: 0.8rem; text-decoration: none; }
  .nav-link:hover { background: #30363d; }
  .stats { display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
  .stat-box { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 0.75rem 1.25rem; text-align: center; min-width: 100px; }
  .stat-box .number { font-size: 1.75rem; font-weight: 700; color: #f0f6fc; }
  .stat-box .label { font-size: 0.75rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; }
  .stat-box.highlight .number { color: #3fb950; }
  .section-label { font-size: 0.9rem; color: #f0f6fc; margin-bottom: 0.5rem; font-weight: 600; }
  .controls { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; align-items: center; flex-wrap: wrap; }
  .toggle-btn { padding: 4px 12px; border-radius: 12px; border: 1px solid #30363d; background: #21262d; color: #c9d1d9; font-size: 0.78rem; cursor: pointer; user-select: none; }
  .toggle-btn:hover { background: #30363d; }
  .toggle-btn.active { border-color: var(--cat-color); color: #fff; }
  .toggle-btn.active.cat-decisions { background: #238636; --cat-color: #3fb950; }
  .toggle-btn.active.cat-patterns { background: #1a4fa0; --cat-color: #1f6feb; }
  .toggle-btn.active.cat-constraints { background: #a12828; --cat-color: #da3633; }
  .toggle-btn.active.cat-workflows { background: #9a7b1a; --cat-color: #d29922; }
  .toggle-btn.active.cat-commits { background: #484f58; --cat-color: #8b949e; }
  #timeline-container { background: #161b22; border: 1px solid #30363d; border-radius: 8px; margin-bottom: 1rem; overflow: hidden; }
  #network-container { background: #161b22; border: 1px solid #30363d; border-radius: 8px; margin-bottom: 1rem; }

  /* vis.js Timeline dark theme overrides */
  .vis-timeline { border: none; font-family: inherit; }
  .vis-panel.vis-background, .vis-panel.vis-center { background: #161b22; }
  .vis-time-axis .vis-text { color: #8b949e; font-size: 0.75rem; }
  .vis-time-axis .vis-grid.vis-minor { border-color: #21262d; }
  .vis-time-axis .vis-grid.vis-major { border-color: #30363d; }
  .vis-labelset .vis-label { color: #c9d1d9; background: #161b22; border-bottom: 1px solid #21262d; }
  .vis-foreground .vis-group { border-bottom: 1px solid #21262d; }
  .vis-item { border-radius: 4px; font-size: 0.78rem; border: none; padding: 2px 6px; }
  .vis-item.vis-selected { border: 2px solid #f0f6fc; }
  .vis-item.cat-decisions { background: #3fb950; color: #0d1117; }
  .vis-item.cat-patterns { background: #1f6feb; color: #fff; }
  .vis-item.cat-constraints { background: #da3633; color: #fff; }
  .vis-item.cat-workflows { background: #d29922; color: #0d1117; }
  .vis-item.cat-commits { background: #484f58; color: #c9d1d9; font-size: 0.7rem; }
  .vis-item.cat-adrs { background: #a371f7; color: #0d1117; font-weight: 600; }
  .vis-item.stale { opacity: 0.4; border: 1px dashed #8b949e; }
  .vis-item.archived { opacity: 0.2; border: 1px dotted #484f58; }
  .vis-cluster { background: #30363d !important; color: #c9d1d9 !important; border-radius: 12px !important; font-weight: 600; }
  .vis-tooltip { background: #161b22; border: 1px solid #30363d; color: #c9d1d9; padding: 8px 12px; border-radius: 6px; font-size: 0.8rem; white-space: pre-line; max-width: 400px; }
</style>
</head>
<body>
<div class="header">
  <h1>Decision Log &mdash; ${esc(projectName)}</h1>
  <a href="status.html" class="nav-link">View Status</a>
</div>
<p class="meta">Generated ${esc(timestamp)} &mdash; last ${MAX_DAYS} days &mdash; ${data.concepts.length} concepts, ${data.commits.length} commits</p>

<div class="stats">
  <div class="stat-box highlight"><div class="number">${data.concepts.length}</div><div class="label">Concepts</div></div>
  <div class="stat-box"><div class="number">${data.commits.length}</div><div class="label">Commits</div></div>
  <div class="stat-box"><div class="number">${data.adrs.length}</div><div class="label">ADRs</div></div>
  <div class="stat-box"><div class="number">${data.memories.length}</div><div class="label">Memories</div></div>
  <div class="stat-box"><div class="number">${data.concepts.filter(c => c.confidence < 0.3).length}</div><div class="label">Stale</div></div>
</div>

<div class="controls" id="filter-bar">
  <button class="toggle-btn active cat-decisions" data-cat="decisions" onclick="toggleCategory(this)">Decisions</button>
  <button class="toggle-btn active cat-patterns" data-cat="patterns" onclick="toggleCategory(this)">Patterns</button>
  <button class="toggle-btn active cat-constraints" data-cat="constraints" onclick="toggleCategory(this)">Constraints</button>
  <button class="toggle-btn active cat-workflows" data-cat="workflows" onclick="toggleCategory(this)">Workflows</button>
  <button class="toggle-btn active cat-commits" data-cat="commits" onclick="toggleCategory(this)">Commits</button>
  <span style="color:#30363d;margin:0 0.25rem;">|</span>
  <button class="toggle-btn" id="archived-toggle" onclick="toggleArchived(this)">Show Archived</button>
</div>

<p class="section-label">Timeline</p>
<div id="timeline-container" style="height: 45vh; min-height: 300px;"></div>

<p class="section-label">Network Graph</p>
<div id="network-container" style="height: 45vh; min-height: 300px;"></div>

<script>
// ── Data ──
const DATA = ${dataJson};
const ITEMS_RAW = ${itemsJson};
const SHOW_ARCHIVED = { value: false };

// ── Category colors ──
const CAT_COLORS = {
  decisions: '#3fb950', patterns: '#1f6feb',
  constraints: '#da3633', workflows: '#d29922',
  commits: '#8b949e', adrs: '#a371f7'
};

// ── Confidence tiers ──
function confidenceTier(c) {
  if (c < 0.1) return 'archived';
  if (c < 0.3) return 'stale';
  return 'active';
}

// ── Build vis.js items with confidence classes ──
function buildVisItems(items, showArchived) {
  return items
    .filter(function(item) {
      var tier = confidenceTier(item.confidence);
      if (tier === 'archived' && !showArchived) return false;
      return true;
    })
    .map(function(item) {
      var tier = confidenceTier(item.confidence);
      var cls = item.className;
      if (tier === 'stale') cls += ' stale';
      if (tier === 'archived') cls += ' archived';
      return {
        id: item.id,
        content: item.content,
        start: item.start,
        group: item.group,
        className: cls,
        title: item.title
      };
    });
}

// ── Groups ──
var groups = new vis.DataSet([
  { id: 'decisions', content: 'Decisions', style: 'color: #3fb950' },
  { id: 'patterns', content: 'Patterns', style: 'color: #1f6feb' },
  { id: 'constraints', content: 'Constraints', style: 'color: #da3633' },
  { id: 'workflows', content: 'Workflows', style: 'color: #d29922' },
  { id: 'commits', content: 'Commits', style: 'color: #8b949e' }
]);

// ── Timeline init ──
var container = document.getElementById('timeline-container');
var visItems = new vis.DataSet(buildVisItems(ITEMS_RAW, false));

var options = {
  stack: true,
  showTooltips: true,
  tooltip: { followMouse: true, overflowMethod: 'cap' },
  start: '${thirtyDaysAgo.toISOString().slice(0, 10)}',
  end: '${now.toISOString().slice(0, 10)}',
  zoomMin: 1000 * 60 * 60 * 24,       // 1 day
  zoomMax: 1000 * 60 * 60 * 24 * 365,  // 1 year
  cluster: {
    titleTemplate: '{count} events',
    maxItems: 3,
    clusterCriteria: function(a, b) {
      // Cluster items on the same day in the same group
      if (a.group !== b.group) return false;
      var dA = new Date(a.start).toISOString().slice(0, 10);
      var dB = new Date(b.start).toISOString().slice(0, 10);
      return dA === dB;
    }
  },
  margin: { item: { horizontal: 3, vertical: 3 } },
  orientation: { axis: 'top' }
};

var timeline = new vis.Timeline(container, visItems, groups, options);

// ── Detail on click ──
timeline.on('select', function(properties) {
  if (properties.items.length === 0) return;
  var itemId = properties.items[0];
  var item = ITEMS_RAW.find(function(i) { return i.id === itemId; });
  if (item) {
    window.dispatchEvent(new CustomEvent('timeline-select', { detail: item }));
  }
});

// ── Network Graph ──
var networkNodes = [];
var networkEdges = [];
var neighborMap = {};

// Build nodes from concepts
DATA.concepts.forEach(function(c) {
  var tier = confidenceTier(c.confidence);
  if (tier === 'archived' && !SHOW_ARCHIVED.value) return;
  var label = c.title.length > 30 ? c.title.slice(0, 27) + '...' : c.title;
  var size = 10 + (c.confidence * 20); // 10-30px range
  var opacity = tier === 'stale' ? 0.4 : tier === 'archived' ? 0.2 : 1.0;
  var color = CAT_COLORS[c.category] || '#8b949e';
  networkNodes.push({
    id: c.slug,
    label: label,
    title: c.title + '\\nCategory: ' + c.category + '\\nConfidence: ' + c.confidence.toFixed(2) + '\\nSources: ' + (c.sources || []).length + '\\nRelated: ' + ((DATA.crossRefs[c.slug] || {}).related || []).length,
    size: size,
    color: { background: color, border: color, highlight: { background: color, border: '#f0f6fc' }, hover: { background: color, border: '#f0f6fc' } },
    opacity: opacity,
    font: { color: '#c9d1d9', size: 11 },
    shape: 'dot',
    category: c.category
  });
  neighborMap[c.slug] = new Set();
});

// Build nodes from ADRs (diamond shape)
DATA.adrs.forEach(function(adr) {
  var adrId = 'adr-' + adr.number;
  networkNodes.push({
    id: adrId,
    label: 'ADR-' + adr.number + ': ' + (adr.title.length > 20 ? adr.title.slice(0, 17) + '...' : adr.title),
    title: 'ADR-' + adr.number + ': ' + adr.title + '\\nStatus: ' + adr.status + '\\n' + (adr.summary || ''),
    size: 20,
    color: { background: '#a371f7', border: '#a371f7', highlight: { background: '#a371f7', border: '#f0f6fc' }, hover: { background: '#a371f7', border: '#f0f6fc' } },
    opacity: 1.0,
    font: { color: '#c9d1d9', size: 11, bold: true },
    shape: 'diamond',
    category: 'decisions'
  });
  neighborMap[adrId] = new Set();
});

// Build edges from cross-references
var edgeSet = new Set();
Object.keys(DATA.crossRefs).forEach(function(slug) {
  var entry = DATA.crossRefs[slug];
  if (!entry || !entry.related) return;
  entry.related.forEach(function(relSlug) {
    var key = [slug, relSlug].sort().join('|');
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    networkEdges.push({
      from: slug,
      to: relSlug,
      color: { color: '#30363d', highlight: '#8b949e', hover: '#8b949e' },
      width: 1
    });
    if (neighborMap[slug]) neighborMap[slug].add(relSlug);
    if (neighborMap[relSlug]) neighborMap[relSlug].add(slug);
  });
});

var nodesDataSet = new vis.DataSet(networkNodes);
var edgesDataSet = new vis.DataSet(networkEdges);

var networkContainer = document.getElementById('network-container');
var network = new vis.Network(networkContainer, { nodes: nodesDataSet, edges: edgesDataSet }, {
  physics: {
    barnesHut: { gravitationalConstant: -2000, springLength: 120, springConstant: 0.02 },
    stabilization: { iterations: 150, fit: true }
  },
  interaction: {
    hover: true,
    tooltipDelay: 200,
    dragNodes: true,
    zoomView: true
  },
  layout: { improvedLayout: true },
  nodes: { borderWidth: 2, borderWidthSelected: 3 },
  edges: { smooth: { type: 'continuous' } }
});

// ── Focus mode: double-click to show only neighbors ──
var focusActive = false;
var allNodeIds = networkNodes.map(function(n) { return n.id; });

network.on('doubleClick', function(params) {
  if (params.nodes.length === 0) {
    // Double-click on empty space: restore all nodes
    if (focusActive) {
      nodesDataSet.forEach(function(node) {
        nodesDataSet.update({ id: node.id, hidden: false });
      });
      focusActive = false;
    }
    return;
  }

  var nodeId = params.nodes[0];
  var neighbors = neighborMap[nodeId] || new Set();

  nodesDataSet.forEach(function(node) {
    var show = node.id === nodeId || neighbors.has(node.id);
    nodesDataSet.update({ id: node.id, hidden: !show });
  });

  focusActive = true;
  network.focus(nodeId, { scale: 1.2, animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
});

// ── Linked Interaction: Timeline ↔ Network ──

// Timeline click → highlight in Network
window.addEventListener('timeline-select', function(e) {
  var item = e.detail;
  if (!item || !item.slug) return;
  // Select the matching node in the network
  var nodeIds = nodesDataSet.getIds();
  if (nodeIds.indexOf(item.slug) !== -1) {
    network.selectNodes([item.slug]);
    network.focus(item.slug, { scale: 1.0, animation: { duration: 300 } });
    // Highlight connected edges
    var connEdges = network.getConnectedEdges(item.slug);
    network.selectEdges(connEdges);
  }
});

// Network click → scroll Timeline
network.on('selectNode', function(params) {
  if (params.nodes.length === 0) return;
  var slug = params.nodes[0];
  // Find matching timeline item
  var timelineItem = ITEMS_RAW.find(function(i) { return i.slug === slug; });
  if (timelineItem) {
    timeline.setSelection([timelineItem.id]);
    timeline.moveTo(timelineItem.start, { animation: { duration: 300, easingFunction: 'easeInOutQuad' } });
  }
});

// ── Category Filters ──
var visibleCategories = new Set(['decisions', 'patterns', 'constraints', 'workflows', 'commits']);

function toggleCategory(btn) {
  var cat = btn.getAttribute('data-cat');
  if (visibleCategories.has(cat)) {
    visibleCategories.delete(cat);
    btn.classList.remove('active');
  } else {
    visibleCategories.add(cat);
    btn.classList.add('active');
  }
  applyFilters();
}

function toggleArchived(btn) {
  SHOW_ARCHIVED.value = !SHOW_ARCHIVED.value;
  if (SHOW_ARCHIVED.value) {
    btn.classList.add('active');
    btn.textContent = 'Hide Archived';
  } else {
    btn.classList.remove('active');
    btn.textContent = 'Show Archived';
  }
  applyFilters();
}

function applyFilters() {
  // Update timeline
  var filtered = buildVisItems(ITEMS_RAW, SHOW_ARCHIVED.value)
    .filter(function(item) {
      // Map className back to category
      for (var cat of visibleCategories) {
        if (item.className.indexOf('cat-' + cat) !== -1) return true;
      }
      // Check for ADRs (shown when decisions visible)
      if (item.className.indexOf('cat-adrs') !== -1 && visibleCategories.has('decisions')) return true;
      return false;
    });
  visItems.clear();
  visItems.add(filtered);

  // Update network nodes visibility
  nodesDataSet.forEach(function(node) {
    var show = visibleCategories.has(node.category);
    if (!show) { nodesDataSet.update({ id: node.id, hidden: true }); return; }
    var concept = DATA.concepts.find(function(c) { return c.slug === node.id; });
    if (concept) {
      var tier = confidenceTier(concept.confidence);
      if (tier === 'archived' && !SHOW_ARCHIVED.value) { nodesDataSet.update({ id: node.id, hidden: true }); return; }
    }
    nodesDataSet.update({ id: node.id, hidden: false });
  });
}

// Expose toggleCategory and toggleArchived to onclick handlers
window.toggleCategory = toggleCategory;
window.toggleArchived = toggleArchived;
<\/script>
</body>
</html>`;
}

// ── Inline-script serialization ─────────────────────────────────
// Prevents a value containing </script> from breaking out of the inline script tag.
function serializeSafe(value) {
  return JSON.stringify(value).replace(/<\/(script)/gi, '<\\/$1');
}

// ── Main ────────────────────────────────────────────────────────

function main() {
  const data = collectData();

  printTextSummary(data);

  if (!TEXT_ONLY) {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    const html = generateHtml(data);
    fs.writeFileSync(OUTPUT_FILE, html, 'utf8');
    console.log(`  Dashboard: ${path.relative(PROJECT_ROOT, OUTPUT_FILE)}`);
    console.log('');
  }
}

/**
 * Integration entry point: generate decisions.html and write it to a given path.
 * Called by status.js after it writes status.html. Wrapped in try/catch by caller.
 *
 * @param {object} opts
 * @param {string} [opts.outputPath] - Absolute path for decisions.html (defaults to OUTPUT_FILE)
 * @returns {{ html: string, outputPath: string }}
 */
function generateDecisionsHtml({ outputPath } = {}) {
  const dest = outputPath || OUTPUT_FILE;
  const data = collectData();
  const html = generateHtml(data);
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  fs.writeFileSync(dest, html, 'utf8');
  return { html, outputPath: dest };
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { collectData, generateHtml, printTextSummary, esc, generateDecisionsHtml };
