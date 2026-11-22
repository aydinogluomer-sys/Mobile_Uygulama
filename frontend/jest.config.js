/**
 * jest-expo harness.  (task 1E-L1, F15 TST-06)
 *
 * TZ defaults to Europe/Istanbul (overridable via TEST_TZ, e.g. `npm run test:tz`)
 * in jest.globalSetup.js and jest.setup.js, NOT here, because it must be set
 * before workers spawn and before any Date is constructed. Pinning makes the
 * 00:30 / 23:30 and DST boundary cases mean the same thing on every machine and in CI.
 */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/__tests__'],
  globalSetup: '<rootDir>/jest.globalSetup.js',
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
