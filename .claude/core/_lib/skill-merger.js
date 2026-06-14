/**
 * Skill Merger — section-aware merge for template-owned skill files.
 *
 * Skill files (skills/<name>/SKILL.md and its references) are Template zone — they
 * overwrite on `template-updater update`. But a project sometimes needs to append
 * its own stack-specific guidance to a template skill: the generic skill body must
 * stay fresh (so template improvements still land) while the project's tail survives
 * every sync. This is the skill analog of the agent Soul Zone / Project Context merge
 * (agent-merger.js) — without it, every fleet sync silently clobbers project additions
 * to a template skill, the way the hardcoded `skills/brand-guidelines/**` project-zone
 * exception was a one-off patch for exactly this problem.
 *
 * Convention — a skill file MAY contain the sentinel line:
 *
 *     <!-- @@project-additions -->
 *
 * Everything from that line to EOF is ADOPTER-OWNED and preserved under `--merge`;
 * everything above it is template-owned and refreshed from source. If the dest file
 * has no marker, it overwrites exactly as before (a pure template skill — nothing to
 * preserve). Commands that add project-specific content to a template skill
 * (/review:specialize, /sweep, /review:evolve-skills) MUST write it below the marker.
 *
 * Mirrors agent-merger.js: only runs under --merge; never calls process.cwd();
 * all paths are explicit srcPath / dstPath arguments.
 *
 * @module skill-merger
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** The sentinel that opens the adopter-owned tail of a template skill file. */
const PROJECT_ADDITIONS_MARKER = '<!-- @@project-additions -->';

/**
 * True if the text carries a project-additions tail.
 * @param {string} text
 * @returns {boolean}
 */
function hasProjectAdditions(text) {
    return text.includes(PROJECT_ADDITIONS_MARKER);
}

/**
 * Split text at the project-additions marker.
 *
 * @param {string} text
 * @returns {{ head: string, tail: string|null }} — when no marker is present, tail is
 *   null and head is the whole text. When present, head is everything BEFORE the
 *   marker's line and tail starts AT the marker line (marker preserved).
 */
function splitAtMarker(text) {
    const norm = text.replace(/\r\n/g, '\n');
    const idx = norm.indexOf(PROJECT_ADDITIONS_MARKER);
    if (idx === -1) return { head: norm, tail: null };
    // Back up to the start of the marker's own line so the marker line stays intact.
    const lineStart = norm.lastIndexOf('\n', idx) + 1; // 0 when marker is on line 1
    return { head: norm.slice(0, lineStart), tail: norm.slice(lineStart) };
}

/**
 * Merge skill file content: refresh the template head from source, preserve the
 * dest's project-additions tail (marker line → EOF).
 *
 *   - dest has no marker  → return source verbatim (overwrite; nothing to preserve)
 *   - dest has the marker → source head (source's own marker stub dropped, if any)
 *                           + one blank line + dest's tail
 *
 * @param {string} srcText
 * @param {string} dstText
 * @returns {{ content: string, preserved: boolean }}
 */
function mergeSkillContent(srcText, dstText) {
    const dst = splitAtMarker(dstText);
    if (dst.tail === null) {
        // No project additions to keep — pure template overwrite.
        return { content: srcText.replace(/\r\n/g, '\n'), preserved: false };
    }
    // Template head is always from source. splitAtMarker drops source's own marker
    // stub if the template ships one, so the marker is never duplicated; the dest tail
    // is the single source of truth below the line.
    const src = splitAtMarker(srcText);
    const head = src.head.replace(/\s*$/, '\n\n'); // exactly one blank line before marker
    let content = head + dst.tail;
    if (!content.endsWith('\n')) content += '\n';
    return { content, preserved: true };
}

/**
 * Merge a skill file from srcPath into dstPath.
 *
 * If dstPath doesn't exist: simple copy (fresh install).
 * If dstPath exists: refresh the template head, preserve any project-additions tail.
 *
 * @param {string} srcPath
 * @param {string} dstPath
 * @returns {{ changed: boolean, preserved: boolean, detail: string }}
 */
function mergeSkillFile(srcPath, dstPath) {
    const srcContent = fs.readFileSync(srcPath, 'utf8');

    if (!fs.existsSync(dstPath)) {
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.writeFileSync(dstPath, srcContent, 'utf8');
        return { changed: true, preserved: false, detail: 'copied (fresh install)' };
    }

    const dstContent = fs.readFileSync(dstPath, 'utf8');
    const { content, preserved } = mergeSkillContent(srcContent, dstContent);
    const changed = content !== dstContent;
    if (changed) {
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.writeFileSync(dstPath, content, 'utf8');
    }

    const detail = preserved
        ? (changed ? 'merged (preserved project additions)' : 'unchanged (project additions intact)')
        : (changed ? 'overwritten (no project additions)' : 'unchanged');

    return { changed, preserved, detail };
}

module.exports = {
    PROJECT_ADDITIONS_MARKER,
    hasProjectAdditions,
    splitAtMarker,
    mergeSkillContent,
    mergeSkillFile,
};
