import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      '.claude/**/__tests__/**/*.test.{js,cjs}',
      'tools/**/__tests__/**/*.test.{js,cjs}',
    ],
    exclude: ['node_modules', 'docs/.output/**'],
    testTimeout: 30000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['.claude/core/**/*.js'],
      exclude: [
        '.claude/core/**/__tests__/**',
        '.claude/core/**/_helpers/**',
        '.claude/hooks/**',
        'docs/**',
        'node_modules/**',
      ],
      reportsDirectory: 'docs/.output/telemetry/coverage',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});
