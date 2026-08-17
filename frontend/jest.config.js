/**
 * jest-expo harness.  (task 1E-L1)
 *
 * TZ is pinned to Europe/Istanbul in jest.setup.js, NOT here, because it must
 * be set before any Date is constructed. A date test that passes only because
 * the machine happens to sit at UTC+3 proves nothing; pinning makes the
 * 00:30 / 23:30 cases mean the same thing on every machine and in CI.
 */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/__tests__'],
  setupFiles: ['<rootDir>/jest.setup.js'],
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
  passWithNoTests: true,
};
