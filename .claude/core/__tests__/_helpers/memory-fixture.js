/**
 * memory-fixture — writes structured JSON memory files matching the shape
 * produced by memory-extractor.js and memory-manager.js create.
 *
 * File layout: {tmpDirHelper.root}/docs/.output/memories/{category}/{id}.json
 */

'use strict';

const path = require('node:path');
const CONSTANTS = require('../../constants');

const DEFAULT_CATEGORIES = Object.values(CONSTANTS.MEMORY_CATEGORIES);

/**
 * createMemory(tmpDirHelper, category, id, opts)
 *
 * opts:
 *   description  {string}        — content.description (the summary text the prime hook extracts)
 *   confidence   {number}        — metadata.confidence (default 1)
 *   usage_count  {number}        — default 0
 *   updated      {string|Date}   — ISO timestamp (default: now)
 *   created      {string|Date}   — ISO timestamp (default: now)
 *   extra        {object}        — extra fields spread into content
 */
function createMemory(tmpDirHelper, category, id, opts = {}) {
  const {
    description = '',
    confidence = 1,
    usage_count = 0,
    updated,
    created,
    extra = {},
  } = opts;

  const nowIso = new Date().toISOString();
  const updatedIso = updated instanceof Date
    ? updated.toISOString()
    : (updated || nowIso);
  const createdIso = created instanceof Date
    ? created.toISOString()
    : (created || updatedIso);

  const memory = {
    id,
    type: category.replace(/s$/, ''),
    category,
    created: createdIso,
    updated: updatedIso,
    usage_count,
    content: {
      description,
      ...extra,
    },
    metadata: {
      sessions: [],
      agents: [],
      confidence,
    },
  };

  const relPath = path.join('docs', '.output', 'memories', category, `${id}.json`);
  return tmpDirHelper.write(relPath, JSON.stringify(memory, null, 2));
}

module.exports = { createMemory, DEFAULT_CATEGORIES };
