/**
 * jest-expo harness.  (task 1E-L1, F15 TST-06, F48 TST-18 / BLD-16)
 *
 * TZ defaults to Europe/Istanbul (overridable via TEST_TZ, e.g. `npm run test:tz`)
 * in jest.globalSetup.js and jest.setup.js, NOT here, because it must be set
 * before workers spawn and before any Date is constructed. Pinning makes the
 * 00:30 / 23:30 and DST boundary cases mean the same thing on every machine and in CI.
 *
 * F48 ratchets:
 * - `passWithNoTests` is intentionally omitted so a broken `roots`/`testMatch` fails loudly.
 * - `setupFilesAfterEnv` enforces the React `act()` warning ratchet (`jest.afterEnv.js`).
 * - `collectCoverageFrom` + `coverageThreshold` lock critical date, schedule, outbox, and
 *   repository modules without instrumenting the entire UI tree on every run.
 */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/__tests__'],
  globalSetup: '<rootDir>/jest.globalSetup.js',
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.afterEnv.js'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  // Never read .env - the old run-tests.js did, and a test that depends on a
  // gitignored file is not reproducible.
  testPathIgnorePatterns: ['/node_modules/'],
  // supabase/functions/_shared/** lives OUTSIDE this package, so when babel
  // transpiles its async functions the emitted `require('@babel/runtime/...')`
  // has no node_modules to walk up to -- the repo root has none. Point jest at
  // this package's node_modules explicitly. The modules must stay where they
  // are: they are edge-function source that happens to be pure enough to test.
  modulePaths: ['<rootDir>/node_modules'],
  moduleNameMapper: {
    '^yaml$': '<rootDir>/node_modules/yaml/dist/index.js',
  },
  maxWorkers: 2,
  workerIdleMemoryLimit: '512MB',
  clearMocks: true,
  collectCoverageFrom: [
    'lib/date.ts',
    'lib/habitSchedule.ts',
    'lib/outbox.ts',
    'services/outboxRunner.ts',
    'repositories/shared.ts',
  ],
  coverageReporters: ['text-summary', 'json-summary'],
  coverageDirectory: '<rootDir>/coverage',
  coverageThreshold: {
    './lib/date.ts': { lines: 98, functions: 100, statements: 97, branches: 94 },
    './lib/habitSchedule.ts': { lines: 100, functions: 100, statements: 97, branches: 94 },
    './lib/outbox.ts': { lines: 95, functions: 96, statements: 95, branches: 86 },
    './services/outboxRunner.ts': { lines: 100, functions: 100, statements: 97, branches: 94 },
    './repositories/shared.ts': { lines: 98, functions: 100, statements: 90, branches: 87 },
  },
};
