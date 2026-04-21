#!/usr/bin/env node

/**
 * Status — Parse TODO files and generate an HTML dashboard.
 *
 * Scans for TODO files in docs/, parses checkbox markers, and produces:
 *   - A compact text summary to stdout
 *   - An HTML dashboard at docs/.output/status.html
 *
 * Usage:
 *   node .claude/core/status.js              # Full scan + HTML
 *   node .claude/core/status.js --text-only  # Text summary only (no HTML)
 *
 * Supported TODO formats:
 *   - Master index (TODO_{Project}.md) — Phase Map + Epic Index tables
 *   - Per-epic checklists (TODO_epic*.md) — flat checkbox lists
 *   - /todo output — Story Index tables with Status column
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { globSync } = (() => {
  try { return require('glob'); } catch { return { globSync: null }; }
})();

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'docs', '.output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'status.html');
const TEXT_ONLY = process.argv.includes('--text-only');

// ── Find TODO files ──────────────────────────────────────────────

function findTodoFiles() {
  const patterns = [
    'docs/TODO_*.md',
    'docs/todo/TODO_*.md',
    'docs/todo/TODO*.md',
    'docs/app/**/TODO*.md',
  ];

  const found = new Set();

  // Use glob if available, else manual scan
  if (globSync) {
    for (const pattern of patterns) {
      for (const f of globSync(pattern, { cwd: PROJECT_ROOT })) {
        found.add(path.join(PROJECT_ROOT, f));
      }
    }
  } else {
    // Fallback: manual directory scan
    const SKIP_DIRS = new Set(['.archive', '.output', 'node_modules', '.git']);
    const scanDir = (dir, prefix) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') && SKIP_DIRS.has(entry.name)) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isFile() && /^TODO.*\.md$/i.test(entry.name)) {
          found.add(full);
        } else if (entry.isDirectory()) {
          scanDir(full, prefix + entry.name + '/');
        }
      }
    };
    scanDir(path.join(PROJECT_ROOT, 'docs'), 'docs/');
  }

  return [...found].sort();
}

// ── Parse a TODO file ────────────────────────────────────────────

function parseTodoFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const relativePath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');

  // Extract title from first heading
  const titleMatch = content.match(/^#\s+TODO:\s*(.+)/m);
  const title = titleMatch ? titleMatch[1].trim() : path.basename(filePath, '.md');

  // Detect type
  const isMasterIndex = /## Phase Map/i.test(content) || /## Epic Index/i.test(content);

  const result = {
    path: relativePath,
    title,
    type: isMasterIndex ? 'master' : 'checklist',
    stories: { total: 0, done: 0, inProgress: 0, blocked: 0, deferred: 0, pending: 0 },
    epics: [],
    phases: [],
  };

  if (isMasterIndex) {
    parseMasterIndex(lines, result);
  } else {
    parseChecklist(lines, result);
  }

  return result;
}

function parseMasterIndex(lines, result) {
  let section = null;

  for (const line of lines) {
    if (/## Phase Map/i.test(line)) { section = 'phases'; continue; }
    if (/## Epic Index/i.test(line)) { section = 'epics'; continue; }
    if (/^## /.test(line) && section) { section = null; continue; }

    if (section === 'phases' && line.startsWith('|') && !line.includes('---') && !line.includes('Phase')) {
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 7) {
        const stories = parseInt(cols[4]) || 0;
        const done = parseInt(cols[5]) || 0;
        result.phases.push({
          id: cols[0],
          name: cols[1],
          goal: cols[2],
          epics: parseInt(cols[3]) || 0,
          stories,
          done,
          status: cols[6],
        });
        result.stories.total += stories;
        result.stories.done += done;
      }
    }

    if (section === 'epics' && line.startsWith('|') && !line.includes('---') && !line.includes('Epic')) {
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 7) {
        const statusRaw = cols[5].trim();
        const status = /\[x\]/i.test(statusRaw) ? 'done'
          : /\[>\]/.test(statusRaw) ? 'in_progress'
            : /\[!\]/.test(statusRaw) ? 'blocked'
              : /\[~\]/.test(statusRaw) ? 'deferred'
                : 'pending';
        result.epics.push({
          id: cols[0],
          title: cols[1],
          phase: cols[2],
          stories: parseInt(cols[3]) || 0,
          estHours: parseFloat(cols[4]) || 0,
          status,
        });
      }
    }
  }

  // If phases had story counts, those are the totals
  // If not, sum from epics
  if (result.stories.total === 0 && result.epics.length > 0) {
    result.stories.total = result.epics.reduce((s, e) => s + e.stories, 0);
    result.stories.done = result.epics.filter(e => e.status === 'done').reduce((s, e) => s + e.stories, 0);
  }
  result.stories.pending = result.stories.total - result.stories.done - result.stories.inProgress - result.stories.blocked - result.stories.deferred;
}

function parseChecklist(lines, result) {
  for (const line of lines) {
    // Match story-level checkboxes: - [ ] **4.1 ... or - [x] **4.1 ...
    // Also match table rows with status: | ... | [ ] | ...
    const checkboxMatch = line.match(/- \[([ x>!~])\]/);
    const tableStatusMatch = line.match(/\|\s*\[([ x>!~])\]\s*\|/);
    const marker = checkboxMatch ? checkboxMatch[1] : tableStatusMatch ? tableStatusMatch[1] : null;

    if (marker === null) continue;

    // Only count story-level checkboxes, not AC sub-items or gate checks.
    // Story lines use bold: - [ ] **4.1 (M) — Title**
    if (checkboxMatch) {
      const isBoldStory = /^- \[.\] \*\*/.test(line.trim());
      if (!isBoldStory) continue;
    }

    result.stories.total++;
    switch (marker) {
      case 'x': result.stories.done++; break;
      case '>': result.stories.inProgress++; break;
      case '!': result.stories.blocked++; break;
      case '~': result.stories.deferred++; break;
      default: result.stories.pending++; break;
    }
  }
}

// ── Inline metrics computation ───────────────────────────────────

function computeInlineMetrics() {
  const telemetryFile = path.join(PROJECT_ROOT, 'docs', '.output', 'telemetry', 'command-usage.jsonl');

  if (!fs.existsSync(telemetryFile)) return null;

  let raw;
  try {
    raw = fs.readFileSync(telemetryFile, 'utf8');
  } catch {
    return null;
  }

  // Parse JSONL
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length === 0) return null;

  const commands = {};
  const gates = {};

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.type === 'command_invocation' && entry.command) {
      commands[entry.command] = (commands[entry.command] || 0) + 1;
    }

    if (entry.type === 'gate_run' && entry.command) {
      if (!gates[entry.command]) gates[entry.command] = { pass: 0, fail: 0, rate: 0 };
      if (entry.outcome === 'pass') {
        gates[entry.command].pass++;
      } else {
        gates[entry.command].fail++;
      }
    }
  }

  // Compute gate pass rates
  for (const name of Object.keys(gates)) {
    const g = gates[name];
    const total = g.pass + g.fail;
    g.rate = total > 0 ? Math.round((g.pass / total) * 100) : 0;
  }

  // Count commits in last 7 days
  let commitVelocity = 0;
  try {
    const gitOut = execSync('git log --oneline --date=short --format="%ad" -100', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString().slice(0, 10);
    for (const dateLine of gitOut.split('\n').filter(Boolean)) {
      const d = dateLine.replace(/"/g, '').trim();
      if (d >= cutoff) commitVelocity++;
    }
  } catch {
    // git unavailable or no commits — leave at 0
  }

  // Count session directories
  let sessions = 0;
  const sessionsDir = path.join(PROJECT_ROOT, 'docs', '.output', 'sessions');
  try {
    if (fs.existsSync(sessionsDir)) {
      sessions = fs.readdirSync(sessionsDir, { withFileTypes: true })
        .filter(e => e.isDirectory()).length;
    }
  } catch {
    // non-fatal
  }

  // Memory benchmark — last 30 days hit rate (AMEM-8.1)
  const memoryBenchmark = parseMemoryBenchmark();

  return { commands, gates, commitVelocity, sessions, memoryBenchmark };
}

// Parse memory-benchmark.jsonl and aggregate last-30-days hit rate.
// Mirrors the gates-parsing pattern at lines 219-226. Returns null if no data.
function parseMemoryBenchmark() {
  const file = path.join(PROJECT_ROOT, 'docs', '.output', 'telemetry', 'memory-benchmark.jsonl');
  if (!fs.existsSync(file)) return null;

  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }

  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length === 0) return null;

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const cutoffISO = cutoff.toISOString();

  let total = 0;
  let hits = 0;
  const ranks = [];
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'memory_benchmark') continue;
    if (typeof entry.timestamp !== 'string' || entry.timestamp < cutoffISO) continue;
    total++;
    if (entry.hit) hits++;
    if (typeof entry.retrieval_rank === 'number') ranks.push(entry.retrieval_rank);
  }

  if (total === 0) return null;

  const rate = Math.round((hits / total) * 100);
  const meanRank = ranks.length > 0
    ? Number((ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(2))
    : null;

  return { total, hits, rate, meanRank };
}

// ── Text output ──────────────────────────────────────────────────

function printTextSummary(files, metrics) {
  if (files.length === 0) {
    console.log('No TODO files found.');
    return;
  }

  console.log('');
  for (const f of files) {
    const s = f.stories;
    const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
    const bar = progressBar(pct, 20);

    console.log(`  ${f.title}`);
    console.log(`  ${f.path}`);
    console.log(`  ${bar} ${pct}%  (${s.done}/${s.total} done`
      + (s.inProgress ? `, ${s.inProgress} active` : '')
      + (s.blocked ? `, ${s.blocked} blocked` : '')
      + (s.deferred ? `, ${s.deferred} deferred` : '')
      + ')');

    if (f.epics.length > 0) {
      for (const e of f.epics) {
        const icon = e.status === 'done' ? '[x]'
          : e.status === 'in_progress' ? '[>]'
            : e.status === 'blocked' ? '[!]'
              : e.status === 'deferred' ? '[~]'
                : '[ ]';
        console.log(`    ${icon} Epic ${e.id}: ${e.title} (${e.stories} stories, ~${e.estHours}h)`);
      }
    }
    console.log('');
  }

  // Grand total
  const totals = files.reduce((acc, f) => {
    acc.total += f.stories.total;
    acc.done += f.stories.done;
    acc.inProgress += f.stories.inProgress;
    acc.blocked += f.stories.blocked;
    acc.deferred += f.stories.deferred;
    return acc;
  }, { total: 0, done: 0, inProgress: 0, blocked: 0, deferred: 0 });

  if (files.length > 1) {
    const pct = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;
    console.log(`  TOTAL: ${totals.done}/${totals.total} stories (${pct}%)`);
    console.log('');
  }

  // Metrics section
  if (!metrics) {
    console.log('  Metrics: No telemetry data available');
  } else {
    console.log('  Metrics');

    // Top 3 commands
    const topCmds = Object.entries(metrics.commands)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => `${name} (${count})`)
      .join(', ');
    console.log(`    Commands: ${topCmds || 'none'}`);

    // Gate pass rates
    const gateEntries = Object.entries(metrics.gates);
    if (gateEntries.length > 0) {
      const gateSummary = gateEntries
        .map(([name, g]) => `${name.replace('gate:', '')} ${g.rate}% pass`)
        .join(', ');
      console.log(`    Gates: ${gateSummary}`);
    } else {
      console.log('    Gates: no gate data');
    }

    console.log(`    Commits (7d): ${metrics.commitVelocity}  |  Sessions: ${metrics.sessions}`);

    // Memory hit rate (AMEM-8.1)
    if (metrics.memoryBenchmark) {
      const mb = metrics.memoryBenchmark;
      const tag = mb.rate >= 70 ? 'Green' : mb.rate >= 50 ? 'Yellow' : 'Red';
      console.log(`    Memory Hit Rate (30d): ${mb.rate}% [${tag}]  (${mb.hits}/${mb.total}${mb.meanRank !== null ? `, mean rank ${mb.meanRank}` : ''})`);
    }
  }
  console.log('');
}

function progressBar(pct, width) {
  const filled = Math.round((pct / 100) * width);
  return '[' + '#'.repeat(filled) + '-'.repeat(width - filled) + ']';
}

// ── HTML output ──────────────────────────────────────────────────

function generateHtml(files, metrics) {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const totals = files.reduce((acc, f) => {
    acc.total += f.stories.total;
    acc.done += f.stories.done;
    acc.inProgress += f.stories.inProgress;
    acc.blocked += f.stories.blocked;
    acc.deferred += f.stories.deferred;
    acc.pending += f.stories.pending;
    return acc;
  }, { total: 0, done: 0, inProgress: 0, blocked: 0, deferred: 0, pending: 0 });

  const overallPct = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;

  let fileCards = '';
  for (const f of files) {
    const s = f.stories;
    const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;

    let epicRows = '';
    if (f.epics.length > 0) {
      epicRows = `<table class="epic-table">
        <tr><th>Epic</th><th>Title</th><th>Stories</th><th>Est.</th><th>Status</th></tr>
        ${f.epics.map(e => `<tr>
          <td>${e.id}</td>
          <td>${esc(e.title)}</td>
          <td>${e.stories}</td>
          <td>${e.estHours}h</td>
          <td><span class="badge badge-${e.status}">${e.status.replace('_', ' ')}</span></td>
        </tr>`).join('\n')}
      </table>`;
    }

    fileCards += `
    <div class="card">
      <h2>${esc(f.title)}</h2>
      <p class="filepath">${esc(f.path)}</p>
      <div class="progress-container">
        <div class="progress-bar" style="width: ${pct}%"></div>
        <span class="progress-label">${pct}%</span>
      </div>
      <div class="stats">
        <span class="stat stat-done">${s.done} done</span>
        <span class="stat stat-active">${s.inProgress} active</span>
        <span class="stat stat-blocked">${s.blocked} blocked</span>
        <span class="stat stat-deferred">${s.deferred} deferred</span>
        <span class="stat stat-pending">${s.pending} pending</span>
        <span class="stat stat-total">${s.total} total</span>
      </div>
      ${epicRows}
    </div>`;
  }

  // Build metrics card
  let metricsCard;
  if (!metrics) {
    metricsCard = `
    <div class="card">
      <h2>Workflow Metrics</h2>
      <p class="no-data" style="padding: 1.5rem 0;">No telemetry data available</p>
    </div>`;
  } else {
    // Top 5 commands as horizontal bars
    const topCmds = Object.entries(metrics.commands)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const maxCount = topCmds.length > 0 ? topCmds[0][1] : 1;

    const cmdBars = topCmds.length === 0
      ? '<p style="color:#8b949e;font-size:0.85rem;">No command data</p>'
      : topCmds.map(([name, count]) => {
        const barPct = Math.round((count / maxCount) * 100);
        return `<div class="cmd-row">
            <span class="cmd-label">${esc(name)}</span>
            <div class="cmd-bar-container">
              <div class="cmd-bar" style="width:${barPct}%"></div>
            </div>
            <span class="cmd-count">${count}</span>
          </div>`;
      }).join('\n');

    // Gate badges
    const gateEntries = Object.entries(metrics.gates);
    const gateBadges = gateEntries.length === 0
      ? '<span style="color:#8b949e;font-size:0.85rem;">No gate data</span>'
      : gateEntries.map(([name, g]) => {
        const cls = g.rate >= 80 ? 'badge-gate-green' : g.rate >= 50 ? 'badge-gate-yellow' : 'badge-gate-red';
        const label = esc(name.replace('gate:', ''));
        return `<span class="badge-gate ${cls}">${label} ${g.rate}%</span>`;
      }).join(' ');

    metricsCard = `
    <div class="card">
      <h2>Workflow Metrics</h2>
      <div class="metrics-grid">
        <div class="metrics-section">
          <h3 class="metrics-section-title">Command Frequency</h3>
          <div class="cmd-chart">${cmdBars}</div>
        </div>
        <div class="metrics-section">
          <h3 class="metrics-section-title">Gate Pass Rate</h3>
          <div class="gate-badges">${gateBadges}</div>
        </div>
      </div>
      <div class="metrics-summary">
        <div class="summary-box">
          <div class="number">${metrics.commitVelocity}</div>
          <div class="label">Commits (7d)</div>
        </div>
        <div class="summary-box">
          <div class="number">${metrics.sessions}</div>
          <div class="label">Sessions</div>
        </div>
        ${renderMemoryHitRateBox(metrics.memoryBenchmark)}
      </div>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Project Status</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; max-width: 960px; margin: 0 auto; }
  h1 { color: #f0f6fc; margin-bottom: 0.25rem; font-size: 1.5rem; }
  .meta { color: #8b949e; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .summary { display: flex; gap: 1.5rem; margin-bottom: 2rem; flex-wrap: wrap; }
  .summary-box { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem 1.5rem; text-align: center; min-width: 120px; }
  .summary-box .number { font-size: 2rem; font-weight: 700; color: #f0f6fc; }
  .summary-box .label { font-size: 0.8rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; }
  .summary-box.highlight .number { color: #3fb950; }
  .progress-container { background: #21262d; border-radius: 4px; height: 24px; position: relative; margin: 0.75rem 0; overflow: hidden; }
  .progress-bar { background: linear-gradient(90deg, #238636, #3fb950); height: 100%; border-radius: 4px; transition: width 0.3s; min-width: 2px; }
  .progress-label { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 0.75rem; font-weight: 600; color: #f0f6fc; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; }
  .card h2 { font-size: 1.1rem; color: #f0f6fc; margin-bottom: 0.25rem; }
  .filepath { font-size: 0.75rem; color: #8b949e; font-family: monospace; margin-bottom: 0.5rem; }
  .stats { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.5rem; font-size: 0.8rem; }
  .stat { padding: 2px 8px; border-radius: 12px; }
  .stat-done { background: #238636; color: #fff; }
  .stat-active { background: #1f6feb; color: #fff; }
  .stat-blocked { background: #da3633; color: #fff; }
  .stat-deferred { background: #d29922; color: #fff; }
  .stat-pending { background: #30363d; color: #8b949e; }
  .stat-total { background: transparent; color: #8b949e; border: 1px solid #30363d; }
  .epic-table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.85rem; }
  .epic-table th { text-align: left; color: #8b949e; border-bottom: 1px solid #30363d; padding: 0.4rem 0.5rem; font-weight: 500; }
  .epic-table td { padding: 0.4rem 0.5rem; border-bottom: 1px solid #21262d; }
  .badge { padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 500; }
  .badge-done { background: #238636; color: #fff; }
  .badge-in_progress { background: #1f6feb; color: #fff; }
  .badge-blocked { background: #da3633; color: #fff; }
  .badge-deferred { background: #d29922; color: #fff; }
  .badge-pending { background: #30363d; color: #8b949e; }
  .no-data { text-align: center; color: #8b949e; padding: 3rem; }
  .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin: 1rem 0; }
  .metrics-section h3.metrics-section-title { font-size: 0.8rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; font-weight: 500; }
  .cmd-chart { display: flex; flex-direction: column; gap: 0.5rem; }
  .cmd-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; }
  .cmd-label { width: 140px; color: #c9d1d9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0; }
  .cmd-bar-container { flex: 1; background: #21262d; border-radius: 3px; height: 14px; overflow: hidden; }
  .cmd-bar { background: linear-gradient(90deg, #238636, #3fb950); height: 100%; border-radius: 3px; min-width: 2px; }
  .cmd-count { width: 28px; text-align: right; color: #8b949e; font-size: 0.78rem; flex-shrink: 0; }
  .gate-badges { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .badge-gate { padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: 600; }
  .badge-gate-green { background: #238636; color: #fff; }
  .badge-gate-yellow { background: #d29922; color: #fff; }
  .badge-gate-red { background: #da3633; color: #fff; }
  .metrics-summary { display: flex; gap: 1rem; margin-top: 1rem; flex-wrap: wrap; }
  .metrics-summary .summary-box { background: #21262d; border: 1px solid #30363d; border-radius: 8px; padding: 0.75rem 1.25rem; text-align: center; min-width: 110px; }
  .metrics-summary .summary-box .number { font-size: 1.75rem; font-weight: 700; color: #f0f6fc; }
  .metrics-summary .summary-box .label { font-size: 0.75rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; }
  @media (max-width: 600px) { .metrics-grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.25rem;">
<h1>Project Status</h1>
${fs.existsSync(path.join(OUTPUT_DIR, 'decisions.html')) ? '<a href="decisions.html" style="background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;padding:4px 12px;font-size:0.8rem;text-decoration:none;">View Decisions</a>' : ''}
</div>
<p class="meta">Generated ${esc(timestamp)} &mdash; ${files.length} TODO file${files.length !== 1 ? 's' : ''} found</p>

<div class="summary">
  <div class="summary-box highlight"><div class="number">${overallPct}%</div><div class="label">Complete</div></div>
  <div class="summary-box"><div class="number">${totals.done}</div><div class="label">Done</div></div>
  <div class="summary-box"><div class="number">${totals.inProgress}</div><div class="label">Active</div></div>
  <div class="summary-box"><div class="number">${totals.blocked}</div><div class="label">Blocked</div></div>
  <div class="summary-box"><div class="number">${totals.total}</div><div class="label">Total</div></div>
</div>

<div class="progress-container" style="height: 32px; margin-bottom: 2rem;">
  <div class="progress-bar" style="width: ${overallPct}%"></div>
  <span class="progress-label">${totals.done} / ${totals.total}</span>
</div>

${files.length > 0 ? fileCards : '<div class="no-data">No TODO files found in docs/</div>'}

${metricsCard}

</body>
</html>`;
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Memory Hit Rate (30d) summary box with traffic-light color (AMEM-8.1).
// Green >=70%, Yellow 50-69%, Red <50% per design review Addendum A.
function renderMemoryHitRateBox(mb) {
  if (!mb) return '';
  const color = mb.rate >= 70 ? '#3fb950' : mb.rate >= 50 ? '#d29922' : '#da3633';
  return `<div class="summary-box" title="${mb.hits} hits / ${mb.total} runs (last 30d)${mb.meanRank !== null ? `, mean rank ${mb.meanRank}` : ''}">
          <div class="number" style="color:${color}">${mb.rate}%</div>
          <div class="label">Memory Hit Rate (30d)</div>
        </div>`;
}

// ── Main ─────────────────────────────────────────────────────────

function main() {
  const todoFiles = findTodoFiles();
  const parsed = todoFiles.map(parseTodoFile);
  const metrics = computeInlineMetrics();

  printTextSummary(parsed, metrics);

  if (!TEXT_ONLY) {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    const html = generateHtml(parsed, metrics);
    fs.writeFileSync(OUTPUT_FILE, html, 'utf8');
    console.log(`  Dashboard: ${path.relative(PROJECT_ROOT, OUTPUT_FILE)}`);

    // Also generate decisions.html — folded into /status per PR-1.5 Q2 decision.
    // Wrapped in try/catch so a decision-viz bug never breaks /status.
    try {
      const { generateDecisionsHtml } = require('./decision-viz');
      const decisionsFile = path.join(OUTPUT_DIR, 'decisions.html');
      generateDecisionsHtml({ outputPath: decisionsFile });
      console.log(`  Decisions:  ${path.relative(PROJECT_ROOT, decisionsFile)}`);
    } catch (err) {
      // Non-fatal — status.html was already written successfully
      process.stderr.write(`  [status] decisions.html skipped: ${err.message}\n`);
    }

    console.log('');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { findTodoFiles, parseTodoFile, computeInlineMetrics, generateHtml, printTextSummary, esc };
