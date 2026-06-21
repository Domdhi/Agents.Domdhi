/**
 * System-wide constants to avoid magic numbers and strings
 * All configurable values should be defined here
 */

module.exports = {
    // Memory relevance scoring weights — points each signal contributes to a
    // search result's relevance score. SINGLE SOURCE for both search paths in
    // memory-manager.js: the SQLite FTS query mapper and the JSON-fallback
    // calculateRelevance(). The shared weights (usage/confidence/importance) are
    // identical across both paths so a memory scores comparably whichever backend
    // runs; never re-hardcode these multipliers.
    MEMORY_SCORING: {
        // Shared across both paths
        USAGE_MULTIPLIER: 5,              // points per usage_count
        CONFIDENCE_MULTIPLIER: 10,        // points per 1.0 confidence
        IMPORTANCE_MULTIPLIER: 4,         // points per importance step (1–5 → +4..+20)
        // FTS path only — weight on the |bm25 rank| the engine returns
        FTS_RANK_MULTIPLIER: 10,
        // JSON-fallback path only — literal term match + recency tiers (the FTS
        // engine folds recency/frequency into its own rank, so these apply only
        // to the linear-scan fallback)
        MATCH_MULTIPLIER: 10,             // points per literal term occurrence
        RECENCY_RECENT_POINTS: 20,        // bonus when updated within RECENCY_RECENT_DAYS
        RECENCY_RECENT_DAYS: 7,
        RECENCY_MID_POINTS: 10,           // bonus when updated within RECENCY_MID_DAYS
        RECENCY_MID_DAYS: 30,
    },

    // Memory filtering thresholds
    MEMORY_FILTERS: {
        RECENT_DAYS: 7,                   // Days for "recent" filter
        DEFAULT_LIMIT: 10,                // Default maximum memories to load
        HIGH_USAGE_THRESHOLD: 5,          // Threshold for "frequently used"
        HIGH_CONFIDENCE_THRESHOLD: 0.8,   // Threshold for "high confidence"
        // Per-category memory cap. Static here (no process.env read — keeps
        // require('./constants') deterministic). The env override
        // (MEMORY_MAX_PER_CATEGORY) is applied at the two call sites
        // (memory-manager.js, memory-guard.cjs) with an identical expression.
        MEMORY_MAX_PER_CATEGORY: 100,
        // Fraction of the cap at which a category counts as "near limit" — the
        // single source for the prune trigger, the guard warning, the analytics
        // near_limit flag, and the lint category-balance check (memory-manager,
        // memory-guard, memory-lint all read this; never re-hardcode 0.8).
        MEMORY_NEAR_LIMIT_PCT: 0.8,
        // Min active-work-days since `created` for a never-recalled memory to
        // appear in the dead-weight review queue (decay-independent flagger).
        // Static here; env override (MEMORY_EXPOSURE_MIN_DAYS) applied at the
        // memory-manager.js call site with an identical expression.
        EXPOSURE_MIN_ACTIVE_DAYS: 30,
        // Write-time importance score (1–5) assigned to a memory when authored;
        // the retention floor. Default 3 (mid-scale) when the author omits it and
        // for legacy memories with no importance field (backfill-on-read). Static
        // here; env override (MEMORY_IMPORTANCE_DEFAULT) applied at the call site.
        IMPORTANCE_DEFAULT: 3,
    },

    // Agent limits
    AGENT_LIMITS: {
        MAX_CONCURRENT_SUBAGENTS: 5,      // Maximum concurrent sub-agents
        TOOLS_PER_AGENT_MIN: 2,           // Minimum tools per agent
        TOOLS_PER_AGENT_MAX: 5,           // Maximum tools per traditional agent
    },

    // Context management
    CONTEXT_LIMITS: {
        PER_AGENT_PERCENT: 10,            // Maximum context % per agent
        TOTAL_SESSION_PERCENT: 50,        // Total session context before compact
        COMPACT_TARGET_PERCENT: 30,       // Target after compacting
    },

    // Performance targets (milliseconds)
    PERFORMANCE: {
        SIMPLE_QUERY_MS: 2000,            // 2 seconds
        CODE_GENERATION_MS: 30000,        // 30 seconds
        COMPLEX_REFACTOR_MS: 120000,      // 2 minutes
        FULL_FEATURE_MS: 300000,          // 5 minutes
        CACHE_HIT_MS: 5,                  // 5ms for cached responses
    },

    // Quality metrics
    QUALITY_TARGETS: {
        FIRST_ATTEMPT_SUCCESS: 0.8,       // 80% success rate
        BUILD_SUCCESS_RATE: 0.95,          // 95% build success
        TEST_PASS_RATE: 0.9,               // 90% test pass rate
        ERROR_CLASSIFICATION_ACCURACY: 0.95, // 95% accuracy
        PATTERN_RECOGNITION_RATE: 0.9,     // 90% pattern match rate
        MIN_TEST_COVERAGE: 0.8,            // 80% test coverage target
    },

    // Time constants (milliseconds)
    TIME: {
        MS_PER_SECOND: 1000,
        MS_PER_MINUTE: 60000,
        MS_PER_HOUR: 3600000,
        MS_PER_DAY: 86400000,
        SECONDS_PER_MINUTE: 60,
        MINUTES_PER_HOUR: 60,
        HOURS_PER_DAY: 24,
        DAYS_PER_WEEK: 7,
    },

    // Memory categories
    // Key insertion order is load-bearing: `Object.values(MEMORY_CATEGORIES)` is
    // the canonical iteration order consumed by memory-manager, memory-curator,
    // memory-promoter, decision-viz, session-start-prime hook,
    // and test fixtures. Changing this order changes the section order of the
    // compiled concept index (docs/.output/memories/concepts/index.md).
    MEMORY_CATEGORIES: {
        PATTERNS: 'patterns',
        CONSTRAINTS: 'constraints',
        DECISIONS: 'decisions',
        WORKFLOWS: 'workflows',
        REJECTED_APPROACHES: 'rejected-approaches',  // AMEM-5.1: approaches that were tried and abandoned
    },

    // Memory profile — controls how much of the memory pipeline runs
    // Read at hook-run time via .claude/core/profile.js (getProfile, isAtLeast)
    // - minimal:  pre-compaction baseline only
    // - standard: + Stop pipeline (capture + compile), commit capture, guard warnings (DEFAULT)
    // - strict:   + Haiku extraction, edit capture, curator, benchmark
    MEMORY_PROFILE: {
        MINIMAL: 'minimal',
        STANDARD: 'standard',
        STRICT: 'strict',
        DEFAULT: 'standard',
        ORDER: ['minimal', 'standard', 'strict']
    },

    // Memory confidence decay — category-specific rates and thresholds
    MEMORY_DECAY: {
        // Decay is based on active work days (days with git commits), not calendar days.
        // A project untouched for months has zero decay — memories stay valid until
        // active development produces changes that could invalidate them.
        RATES: {
            decisions: 0.98,              // half-life ~35 active work days
            constraints: 0.97,            // half-life ~23 active work days
            patterns: 0.95,               // half-life ~14 active work days
            workflows: 0.93,              // half-life ~10 active work days
            'rejected-approaches': 0.90   // half-life ~7 active work days (fade fast — codebase changes invalidate old rejections)
        },
        DEFAULT_RATE: 0.95,
        USAGE_BOOST: 0.01,
        RECENT_UPDATE_BOOST: 0.1,
        RECENT_UPDATE_DAYS: 7,
        ECHO_BOOST: 0.05,        // confidence bump per commit-echo match (AMEM-4.1)
        STALE_THRESHOLD: 0.3,
        ARCHIVE_THRESHOLD: 0.1,
        // Usage-counter halving period in active-work-days (ME-4.1). The honest
        // usage signal halves after this many silent active days so a once-popular
        // memory's count stops being a permanent ratchet (TinyLFU-style aging).
        USAGE_HALVE_EVERY_DAYS: 14
    },

    // Session phases
    SESSION_PHASES: {
        INITIALIZATION: 'initialization',
        RESEARCH: 'research',
        IMPLEMENTATION: 'implementation',
        BUILD_TEST: 'build-test',
        VALIDATION: 'validation',
        COMPLETED: 'completed',
        FAILED: 'failed',
    },

    // Error severity levels
    ERROR_SEVERITY: {
        SEVERE: 'SEVERE',
        OOPSIE: 'OOPSIE',
        WARNING: 'WARNING',
        INFO: 'INFO',
        SUCCESS: 'SUCCESS',
    },

    // Agent roles
    AGENT_ROLES: {
        RESEARCH: 'research',
        IMPLEMENTATION: 'implementation',
        BUILD_TEST: 'build-test',
        DOCUMENTATION: 'documentation',
        ORCHESTRATOR: 'orchestrator',
    },

    // File patterns
    FILE_PATTERNS: {
        JSON_EXTENSION: '.json',
        MARKDOWN_EXTENSION: '.md',
        JAVASCRIPT_EXTENSION: '.js',
        JSONL_EXTENSION: '.jsonl',
    },

    // Project lifecycle phases
    PROJECT_PHASES: {
        UNINITIALIZED: 0,
        ANALYSIS: 1,
        PLANNING: 2,
        SOLUTIONING: 3,
        IMPLEMENTATION: 4,
    },

    // ── Canonical docs/ paths — the single runtime source of truth ──────────────
    //
    // Domain-taxonomy layout (ADR 2026-06-20 "docs/ Domain Taxonomy"): docs/ is
    // organized by CONCERN, not artifact type. Every value here is docs/-relative
    // (no leading `docs/`), so callers compose `path.join(docsDir, DOC_PATHS.x)`.
    // Code/tests import these instead of hardcoding string literals, so a future
    // layout change touches one map, not N call sites. The one-shot migration of
    // the EXISTING literals is `migrate-docs-domains.js` (REF_REWRITES); this map
    // is the GOING-FORWARD source the chain/phase tables below now reference.
    //
    // NOTE: `work/todo/feature-ideas.md` (the living idea inbox) rides the `todo/` →
    // `work/todo/` dir move to `work/todo/feature-ideas.md`; brainstorm/research
    // seeds are assigned to product/ below (the discovery inputs that feed brief).
    DOC_PATHS: {
        // product/ — why does this exist & what must it do?
        brief:        'product/brief.md',
        requirements: 'product/requirements.md',
        context:      'product/context.md',
        brainstorm:   'product/brainstorm.md',           // /brainstorm seed
        research:     'product/research.md',             // /research validated assumptions
        // architecture/ — how is it built & why these choices?
        architecture: 'architecture/overview.md',
        api:          'architecture/api.md',
        dataModel:    'architecture/data-model.md',
        decisions:    'architecture/decisions',          // dir — ADRs (NNNN-*.md)
        // design/ — how is it experienced?
        design:       'design/spec.md',
        wireframes:   'design/wireframes.md',
        themeLight:   'design/theme.light.md',
        themeDark:    'design/theme.dark.md',
        mock:         'design/mock.html',
        // engineering/ — how do we work on it?
        setup:        'engineering/setup.md',
        conventions:  'engineering/conventions.md',
        testing:      'engineering/testing.md',
        // operations/ — how do we ship & run it?
        deploy:       'operations/deploy.md',
        observability:'operations/observability.md',
        security:     'operations/security.md',
        runbooks:     'operations/runbooks',             // dir
        // work/ — what now & next? (the living plan)
        backlog:      'work/backlog.md',
        roadmap:      'work/roadmap.md',
        timeline:     'work/timeline.md',
        todo:         'work/todo',                        // dir (+ _archive/)
        // task working files live in the generated zone, NOT work/ (gitignored)
        scratch:      '.output/work',                     // dir — {date}/{task}/
        // reference/ — how do I find my way?
        onboarding:   'reference/onboarding.md',
        glossary:     'reference/glossary.md',
        links:        'reference/links.md',
        // fractal axis (not a domain) — per-feature zoom
        modules:      'modules',                          // dir — {name}/brief.md
    },

    // Artifacts produced by each phase
    PHASE_ARTIFACTS: {
        1: ['product/brainstorm.md', 'product/research.md', 'product/brief.md'],
        2: ['product/requirements.md', 'design/spec.md'],
        3: ['architecture/overview.md', 'work/backlog.md'],
        4: ['source code', 'tests'],
    },

    // Document dependency chain (upstream → downstream)
    DOC_CHAIN: {
        'product/brainstorm.md': { feeds: ['product/brief.md'] },
        'product/research.md': { feeds: ['product/brief.md', 'product/requirements.md'] },
        'product/brief.md': { feeds: ['product/requirements.md'] },
        'product/requirements.md': { feeds: ['architecture/overview.md', 'design/spec.md', 'work/backlog.md'] },
        'design/spec.md': { feeds: ['architecture/overview.md'] },
        'architecture/overview.md': { feeds: ['work/backlog.md'] },
        'work/backlog.md': { feeds: ['implementation'] },
    },

    // Agent system (official Claude Code subagent format)
    AGENTS: {
        DIRECTORY: '.claude/agents',             // Agent definition directory
        FILE_PATTERN: '*.md',                    // Flat .md files (official format)
    },

    // Command line defaults
    CLI_DEFAULTS: {
        LIST_SESSIONS_LIMIT: 10,
        MEMORY_SEARCH_LIMIT: 10,
        DEFAULT_COMPLETION_STATUS: 'completed',
    }
};