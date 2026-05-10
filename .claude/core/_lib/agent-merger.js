/**
 * Agent Merger — section-aware merge logic for agent .md files.
 *
 * An agent file has four zones:
 *   frontmatter  — YAML between opening and closing ---
 *   soulZone     — from first `# ` heading to `## Skills` heading (exclusive)
 *   skillsZone   — from `## Skills` heading to `## Project Context` or end
 *   projectCtx   — from `## Project Context` to end, or '' if absent
 *
 * Merge strategy (when dest exists):
 *   - frontmatter: take src, but preserve nickname: and aliases: from dest
 *   - soulZone:    preserve if dest is personalized (has nickname:); else take src
 *   - skillsZone:  always from src (template-owned)
 *   - projectCtx:  preserve if dest has it; otherwise omit
 *
 * Never calls process.cwd(). All paths are explicit srcPath / dstPath arguments.
 *
 * @module agent-merger
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Section Parser ─────────────────────────────────────────────────────────────

/**
 * Parse an agent .md file into its four zones.
 *
 * @param {string} content  — full file content (LF or CRLF)
 * @returns {{ frontmatter: string, soulZone: string, skillsZone: string, projectCtx: string }}
 */
function parseAgentSections(content) {
    // Normalize CRLF to LF so line comparisons work on Windows-edited files
    const lines = content.replace(/\r\n/g, '\n').split('\n');

    let frontmatterEnd = -1;  // index of closing ---
    let skillsStart = -1;     // index of ## Skills line
    let projectCtxStart = -1; // index of ## Project Context line

    // Find frontmatter block (must start at line 0)
    if (lines[0] === '---') {
        for (let i = 1; i < lines.length; i++) {
            if (lines[i] === '---') {
                frontmatterEnd = i;
                break;
            }
        }
    }

    // Search for section headings after frontmatter
    const searchStart = frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0;
    for (let i = searchStart; i < lines.length; i++) {
        if (skillsStart === -1 && lines[i].match(/^## Skills\s*$/)) {
            skillsStart = i;
        } else if (skillsStart !== -1 && projectCtxStart === -1 && lines[i].match(/^## Project Context\s*$/)) {
            projectCtxStart = i;
            break;
        }
    }

    // Extract frontmatter (lines between the two --- markers, no delimiters)
    const frontmatter = frontmatterEnd >= 0
        ? lines.slice(1, frontmatterEnd).join('\n')
        : '';

    // Soul zone: from line after closing --- to line before ## Skills (or end)
    const soulStart = frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0;
    const soulEnd = skillsStart >= 0 ? skillsStart : lines.length;
    let soulLines = lines.slice(soulStart, soulEnd);
    // Remove leading blank lines
    while (soulLines.length > 0 && soulLines[0].trim() === '') {
        soulLines.shift();
    }
    // Reassembly spacing: two leading newlines so the merged file has a blank line
    // between the closing `---` and the soul zone's first line (standard markdown
    // convention; was a one-newline bug that ran headings flush against frontmatter).
    const soulZone = soulLines.length > 0 ? '\n\n' + soulLines.join('\n') : '';

    // Skills zone: from ## Skills to ## Project Context or end
    const skillsEnd = projectCtxStart >= 0 ? projectCtxStart : lines.length;
    const skillsZone = skillsStart >= 0
        ? lines.slice(skillsStart, skillsEnd).join('\n')
        : '';

    // Project Context: from ## Project Context to end
    const projectCtx = projectCtxStart >= 0
        ? lines.slice(projectCtxStart).join('\n')
        : '';

    return { frontmatter, soulZone, skillsZone, projectCtx };
}

// ── Frontmatter Merge ─────────────────────────────────────────────────────────

/**
 * Detect whether an agent file has been personalized.
 * Personalization is indicated by a `nickname:` field in frontmatter.
 *
 * @param {string} frontmatter
 * @returns {boolean}
 */
function isPersonalized(frontmatter) {
    return /^nickname\s*:/m.test(frontmatter);
}

/**
 * Merge frontmatter strings: take src lines as the base, but preserve
 * `nickname:` and `aliases:` from dst if they exist.
 *
 * @param {string} srcFm  — frontmatter string from src (no --- delimiters)
 * @param {string} dstFm  — frontmatter string from dst (no --- delimiters)
 * @returns {string}       — merged frontmatter string (no --- delimiters)
 */
function mergeFrontmatter(srcFm, dstFm) {
    const srcLines = srcFm.split('\n');
    const destLines = dstFm.split('\n');

    // Extract preserved lines from dest
    const nicknameMatch = destLines.find(l => /^nickname\s*:/.test(l));
    const aliasesMatch = destLines.find(l => /^aliases\s*:/.test(l));

    // Build result from src, replacing nickname/aliases lines if dest has them
    const result = srcLines.map(line => {
        if (nicknameMatch && /^nickname\s*:/.test(line)) return nicknameMatch;
        if (aliasesMatch && /^aliases\s*:/.test(line)) return aliasesMatch;
        return line;
    });

    // If src had no nickname line but dest does, insert after `name:` line
    const srcHasNickname = srcLines.some(l => /^nickname\s*:/.test(l));
    if (!srcHasNickname && nicknameMatch) {
        const nameIdx = result.findIndex(l => /^name\s*:/.test(l));
        if (nameIdx >= 0) {
            result.splice(nameIdx + 1, 0, nicknameMatch);
        }
    }

    // If src had no aliases line but dest does, insert after nickname or name
    const srcHasAliases = srcLines.some(l => /^aliases\s*:/.test(l));
    if (!srcHasAliases && aliasesMatch) {
        const afterIdx = result.findIndex(l => /^nickname\s*:/.test(l));
        const insertAfter = afterIdx >= 0 ? afterIdx : result.findIndex(l => /^name\s*:/.test(l));
        if (insertAfter >= 0) {
            result.splice(insertAfter + 1, 0, aliasesMatch);
        }
    }

    return result.join('\n');
}

// ── File Merge ────────────────────────────────────────────────────────────────

/**
 * Merge an agent .md file from srcPath into dstPath.
 *
 * If dstPath doesn't exist: simple copy (fresh install).
 * If dstPath exists:
 *   - Overwrite frontmatter (preserving nickname/aliases if personalized)
 *   - Overwrite Skills Zone with source
 *   - Preserve Soul Zone if personalized; otherwise take source
 *   - Preserve Project Context if it exists in dest; otherwise omit
 *
 * @param {string} srcPath
 * @param {string} dstPath
 * @param {object} [opts]
 * @returns {{ changed: boolean, diff?: string }}
 */
function mergeAgentFile(srcPath, dstPath, opts) {
    opts = opts || {};

    if (!fs.existsSync(dstPath)) {
        const srcContent = fs.readFileSync(srcPath, 'utf8');
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.writeFileSync(dstPath, srcContent, 'utf8');
        return { changed: true, detail: 'copied (fresh install)' };
    }

    const srcContent = fs.readFileSync(srcPath, 'utf8');
    const destContent = fs.readFileSync(dstPath, 'utf8');

    const src = parseAgentSections(srcContent);
    const dest = parseAgentSections(destContent);

    const personalized = isPersonalized(dest.frontmatter);
    const hasProjectCtx = dest.projectCtx.length > 0;

    // Merge frontmatter
    const mergedFrontmatter = personalized
        ? mergeFrontmatter(src.frontmatter, dest.frontmatter)
        : src.frontmatter;

    // Choose soul zone
    const mergedSoulZone = personalized ? dest.soulZone : src.soulZone;

    // Skills zone always from source
    const mergedSkillsZone = src.skillsZone;

    // Project context from dest if it exists
    const mergedProjectCtx = hasProjectCtx ? dest.projectCtx : '';

    // Reassemble
    let result = '---\n' + mergedFrontmatter + '\n---';
    result += mergedSoulZone;
    if (mergedSkillsZone) {
        // Ensure blank line before ## Skills if soul zone doesn't end with one
        if (!result.endsWith('\n\n') && !result.endsWith('\n')) result += '\n';
        if (!result.endsWith('\n\n')) result += '\n';
        result += mergedSkillsZone;
    }
    if (mergedProjectCtx) {
        if (!result.endsWith('\n\n') && !result.endsWith('\n')) result += '\n';
        if (!result.endsWith('\n\n')) result += '\n';
        result += mergedProjectCtx;
    }
    // Ensure trailing newline
    if (!result.endsWith('\n')) result += '\n';

    const changed = result !== destContent;
    if (changed) {
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.writeFileSync(dstPath, result, 'utf8');
    }

    const details = [];
    if (personalized) details.push('preserved Soul Zone');
    if (hasProjectCtx) details.push('preserved Project Context');
    const detail = details.length > 0
        ? `merged (${details.join(', ')})`
        : changed ? 'merged (no personalization)' : 'unchanged';

    return { changed, detail };
}

module.exports = {
    parseAgentSections,
    isPersonalized,
    mergeFrontmatter,
    mergeAgentFile,
};
