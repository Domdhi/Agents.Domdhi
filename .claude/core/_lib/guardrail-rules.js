/**
 * Guardrail Rules — rule loading, pattern matching, and command evaluation.
 *
 * Extracted from .claude/hooks/guardrail.cjs as part of the P2.3 guardrail
 * split and extended by P2.5 with a four-tier YAML schema (A3), Zod load-time
 * validation with fail-safe = block (D1), and a path-access checker the hook
 * uses to enforce file-path tiers on applicable operations.
 *
 * Competitor-pattern provenance:
 *   A3 — four-tier path schema from PI Agent damage-control.
 *   D1 — Zod schema validation is a blind-spot opportunity; no competitor
 *        does this (see `docs/research/competitive/_hooks-and-core-scripts-comparison.md` §D1).
 *
 * Four-tier schema semantics:
 *   dangerousPatterns : bash command regex — hard block (alongside block_patterns)
 *   zeroAccessPaths   : path glob — read AND write blocked
 *   readOnlyPaths     : path glob — write AND delete blocked; read allowed
 *   noDeletePaths     : path glob — delete blocked; read/write allowed
 *
 * Fail-safe posture: when Zod validation fails, the tier-specific list falls
 * back to []. Block-level fail-safes kept intact (see loadRules below).
 *
 * PATH_RULES LEGACY NOTE
 * ──────────────────────
 * The older `path_rules` top-level key from before P2.5 is still loaded and
 * returned as pass-through (for backward compat with the YAML file header).
 * evaluate() + checkPathAccess() do NOT act on `path_rules` — the four-tier
 * schema above supersedes it. The existing YAML file keeps the key for docs.
 */

'use strict';

const fs = require('fs');
const { z } = require('zod');
const { parseYaml } = require('./yaml-parser');

// ── Zod schema — D1 ──────────────────────────────────────────────────────────

/**
 * Validator that a string is a valid JavaScript RegExp source.
 * Accepts both plain patterns (case-insensitive substring if no slashes) and
 * /regex/ forms. For `/regex/` we strip the delimiters before compiling.
 */
const regexStringSchema = z.string().refine(
    (s) => {
        if (typeof s !== 'string' || s.length === 0) return false;
        const inner = s.startsWith('/') && s.endsWith('/') && s.length > 2 ? s.slice(1, -1) : s;
        try { new RegExp(inner); return true; } catch { return false; }
    },
    { message: 'invalid RegExp source' },
);

const rulesSchema = z.object({
    block_patterns:     z.array(z.string()).optional().default([]),
    confirm_patterns:   z.array(z.string()).optional().default([]),
    dangerousPatterns:  z.array(regexStringSchema).optional().default([]),
    zeroAccessPaths:    z.array(z.string()).optional().default([]),
    readOnlyPaths:      z.array(z.string()).optional().default([]),
    noDeletePaths:      z.array(z.string()).optional().default([]),
    path_rules:         z.unknown().optional(), // legacy pass-through (not acted upon)
}).passthrough();

/**
 * Empty-rules sentinel returned when the YAML file is missing, malformed,
 * or schema-invalid. Block-safe: empty arrays for every tier means nothing
 * is blocked BUT nothing dangerous is passed through either — callers can
 * inspect `rules.block_patterns.length === 0 && ...` to surface a warning.
 */
function emptyRules() {
    return {
        block_patterns: [],
        confirm_patterns: [],
        dangerousPatterns: [],
        zeroAccessPaths: [],
        readOnlyPaths: [],
        noDeletePaths: [],
    };
}

/**
 * Load and parse a guardrail-rules.yaml file from the given absolute path.
 *
 * Callers are responsible for constructing the path — this module does NOT
 * resolve paths internally (pattern: anchor-paths-to-project-root-not-cwd).
 *
 * Graceful degradation contract:
 *   - Missing file     → return emptyRules() (no throw, no stderr)
 *   - Unreadable file  → return emptyRules()
 *   - Malformed YAML   → return emptyRules()
 *   - Corrupted arrays → return emptyRules()
 *   - Zod schema fails → return emptyRules() — per-tier fail-safe (D1)
 *
 * The Zod validator at each tier defaults missing/invalid arrays to [] rather
 * than allowing them through. This is the block-all posture: when something
 * looks wrong, default to "nothing is specially guarded" rather than "nothing
 * is checked at all" — the existing block_patterns + confirm_patterns still
 * fire from their YAML entries if those pass validation.
 *
 * @param {string} yamlPath - Absolute path to the guardrail-rules.yaml file
 * @returns {{ block_patterns: string[], confirm_patterns: string[], dangerousPatterns: string[], zeroAccessPaths: string[], readOnlyPaths: string[], noDeletePaths: string[], path_rules?: object }}
 */
function loadRules(yamlPath) {
    if (!fs.existsSync(yamlPath)) {
        return emptyRules();
    }

    let raw;
    try {
        raw = fs.readFileSync(yamlPath, 'utf8');
    } catch {
        return emptyRules();
    }

    let parsed;
    try {
        parsed = parseYaml(raw);
    } catch {
        return emptyRules();
    }

    // Backstop: when YAML authoring collapses an array into a scalar, fail safe
    // before even hitting Zod (Zod would flag it too, but block_patterns /
    // confirm_patterns must be arrays — else return emptyRules() to keep the
    // existing contract for P2.3). Exception: a key with no children parses
    // as `{}` under the minimal YAML parser; coerce that to [] since "no
    // entries" is legitimate authoring.
    const pattKeys = ['block_patterns', 'confirm_patterns'];
    for (const key of pattKeys) {
        if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
            if (typeof parsed[key] === 'object' && parsed[key] !== null && Object.keys(parsed[key]).length === 0) {
                parsed[key] = [];
            } else {
                return emptyRules();
            }
        }
    }

    // Same coercion for the four-tier schema keys — the minimal YAML parser
    // returns `{}` for any "key:" with no children, but Zod's z.array(z.string())
    // would reject that and cascade the whole object to emptyRules(). This is
    // a graceful-authoring fix: leaving a tier key empty in the YAML ("we have
    // nothing to put here yet") should normalize to [], not invalidate the
    // entire ruleset.
    const tierKeys = ['dangerousPatterns', 'zeroAccessPaths', 'readOnlyPaths', 'noDeletePaths'];
    for (const key of tierKeys) {
        if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
            if (typeof parsed[key] === 'object' && parsed[key] !== null && Object.keys(parsed[key]).length === 0) {
                parsed[key] = [];
            }
            // Other non-array values fall through to Zod, which will reject
            // and the safeParse failure path below handles it.
        }
    }

    // Per-tier Zod validation. If the whole object fails to parse, drop to
    // emptyRules(). If individual tier keys fail, Zod's .default([]) kicks in
    // via .optional() — the tier falls back to [] but other valid tiers survive.
    const result = rulesSchema.safeParse(parsed);
    if (!result.success) {
        // Global failure — only fall back to emptyRules when block/confirm lists
        // themselves are invalid. Tier-only failures are already normalised
        // by the per-key defaults; safeParse failure here means the object is
        // structurally wrong at the top level. Choose block-safe.
        return emptyRules();
    }

    // When a regex-string item in dangerousPatterns is invalid, Zod will fail
    // validation. We want PER-ITEM fallback (keep the valid entries, drop bad
    // ones). safeParse() gives us an all-or-nothing result. Post-process by
    // re-filtering each tier with each tier's schema:
    const safeList = (arr, schema) => {
        if (!Array.isArray(arr)) return [];
        return arr.filter((item) => schema.safeParse(item).success);
    };

    const validated = result.data;

    // If dangerousPatterns contains any entries, re-validate items individually;
    // if ANY fails per-item validation, drop the entire list (block-safe).
    let dangerousOut = [];
    if (Array.isArray(validated.dangerousPatterns) && validated.dangerousPatterns.length > 0) {
        const kept = safeList(validated.dangerousPatterns, regexStringSchema);
        if (kept.length !== validated.dangerousPatterns.length) {
            dangerousOut = [];
        } else {
            dangerousOut = kept;
        }
    }

    return {
        block_patterns:    validated.block_patterns,
        confirm_patterns:  validated.confirm_patterns,
        dangerousPatterns: dangerousOut,
        zeroAccessPaths:   validated.zeroAccessPaths,
        readOnlyPaths:     validated.readOnlyPaths,
        noDeletePaths:     validated.noDeletePaths,
        ...(parsed.path_rules ? { path_rules: parsed.path_rules } : {}),
    };
}

/**
 * Test whether a single command string matches a single pattern string.
 *
 * Two pattern formats are supported:
 *   - Plain string — case-insensitive substring match
 *   - /regex/      — JavaScript regex wrapped in slashes (case-insensitive)
 *
 * Invalid regex patterns return false (do not throw).
 * Empty patterns return false.
 */
function matchesPattern(command, pattern) {
    if (!pattern || typeof pattern !== 'string') return false;

    // Regex pattern: /expr/
    if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
        const expr = pattern.slice(1, -1);
        try {
            const re = new RegExp(expr, 'i');
            return re.test(command);
        } catch {
            return false;
        }
    }

    // Plain substring match (case-insensitive)
    return command.toLowerCase().includes(pattern.toLowerCase());
}

/**
 * Evaluate a bash command against the loaded rule set.
 *
 * Precedence: dangerousPatterns → block_patterns → confirm_patterns → pass.
 * dangerousPatterns are treated as hard blocks (same semantics as
 * block_patterns) but are part of the four-tier A3 schema and can be extended
 * independently of the historical block_patterns list.
 */
function evaluate(command, rules) {
    const dangerousPatterns = Array.isArray(rules.dangerousPatterns) ? rules.dangerousPatterns : [];
    const blockPatterns     = Array.isArray(rules.block_patterns)    ? rules.block_patterns    : [];
    const confirmPatterns   = Array.isArray(rules.confirm_patterns)  ? rules.confirm_patterns  : [];

    for (const pattern of dangerousPatterns) {
        if (matchesPattern(command, pattern)) {
            return { decision: 'block', pattern, tier: 'dangerousPatterns' };
        }
    }

    for (const pattern of blockPatterns) {
        if (matchesPattern(command, pattern)) {
            return { decision: 'block', pattern };
        }
    }

    for (const pattern of confirmPatterns) {
        if (matchesPattern(command, pattern)) {
            const reason = `Guardrail: "${pattern}" — ${command}`;
            return { decision: 'confirm', pattern, reason };
        }
    }

    return { decision: 'pass' };
}

// ── Path tier checker — A3 ───────────────────────────────────────────────────

/**
 * Test whether a file-path glob matches a given absolute path.
 *
 * Simple glob semantics:
 *   - trailing `/` means "directory prefix" (matches any file under it)
 *   - `*` matches any non-slash characters
 *   - otherwise plain substring/suffix match
 *
 * Matching is case-insensitive on Windows path strings (since the repo is
 * a Windows host in practice); comparison uses forward-slash normalized paths.
 */
function globMatchesPath(glob, absPath) {
    if (typeof glob !== 'string' || typeof absPath !== 'string') return false;
    const normGlob = glob.replace(/\\/g, '/');
    const normPath = absPath.replace(/\\/g, '/');

    // Directory-prefix glob (ends with /)
    if (normGlob.endsWith('/')) {
        return normPath.toLowerCase().includes('/' + normGlob.toLowerCase())
            || normPath.toLowerCase().includes(normGlob.toLowerCase());
    }

    // Wildcard glob — convert to regex (only * supported for now)
    if (normGlob.includes('*')) {
        const escaped = normGlob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
        try {
            const re = new RegExp('(^|/)' + escaped + '$', 'i');
            return re.test(normPath);
        } catch {
            return false;
        }
    }

    // Plain filename or relative path — endsWith match
    return normPath.toLowerCase().endsWith('/' + normGlob.toLowerCase())
        || normPath.toLowerCase().endsWith(normGlob.toLowerCase());
}

/**
 * Check whether an operation on an absolute path is allowed under the
 * four-tier schema. `zeroAccess` takes precedence over `readOnly` over
 * `noDelete` — first matching tier wins.
 *
 * @param {string} absPath   Absolute filesystem path (or repo-relative)
 * @param {'read'|'write'|'delete'} operation
 * @param {object} rules     Rules object from loadRules()
 * @returns {{ allowed: boolean, reason?: string, tier?: string }}
 */
function checkPathAccess(absPath, operation, rules) {
    const zeroAccess = Array.isArray(rules.zeroAccessPaths) ? rules.zeroAccessPaths : [];
    const readOnly   = Array.isArray(rules.readOnlyPaths)   ? rules.readOnlyPaths   : [];
    const noDelete   = Array.isArray(rules.noDeletePaths)   ? rules.noDeletePaths   : [];

    // Tier 1: zeroAccessPaths — blocks ALL operations
    for (const glob of zeroAccess) {
        if (globMatchesPath(glob, absPath)) {
            return {
                allowed: false,
                tier: 'zeroAccessPaths',
                reason: `Path is in zero-access tier (matched: ${glob})`,
            };
        }
    }

    // Tier 2: readOnlyPaths — blocks write + delete
    for (const glob of readOnly) {
        if (globMatchesPath(glob, absPath)) {
            if (operation === 'write' || operation === 'delete') {
                return {
                    allowed: false,
                    tier: 'readOnlyPaths',
                    reason: `Path is read-only (matched: ${glob})`,
                };
            }
        }
    }

    // Tier 3: noDeletePaths — blocks delete only
    for (const glob of noDelete) {
        if (globMatchesPath(glob, absPath)) {
            if (operation === 'delete') {
                return {
                    allowed: false,
                    tier: 'noDeletePaths',
                    reason: `Path is protected from deletion (matched: ${glob})`,
                };
            }
        }
    }

    return { allowed: true };
}

module.exports = {
    loadRules,
    matchesPattern,
    evaluate,
    checkPathAccess,
    globMatchesPath, // exposed for tests + potential reuse
};
