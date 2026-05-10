import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('metrics', () => {
    it('loads without side effects and exports helpers', () => {
        const exports = require('../metrics');
        expect(exports).toBeDefined();
        expect(typeof exports.buildReport).toBe('function');
        expect(typeof exports.prettyReport).toBe('function');
        expect(typeof exports.findTodoFiles).toBe('function');
        expect(typeof exports.parseTodoFileStories).toBe('function');
    });
});
