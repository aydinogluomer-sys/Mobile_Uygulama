// https://docs.expo.dev/guides/using-eslint/
//
// ## Why this file is more than `[expoConfig]`
//
// `npx expo lint` only walks the app directories, so `eslint .` — which CI
// now runs with `--max-warnings=0` — reached files the base config never
// described, and reported three `no-undef` errors that were not defects:
//
//   jest.setup.js:15                 'jest' is not defined
//   scripts/fix-expo-tsconfig.js:6   '__dirname' is not defined
//
// Both files are correct. `jest` and `__dirname` genuinely exist where they
// run; what was missing was a statement of WHERE they run. Declaring the
// environment is the fix. Switching the rule off would have silenced real
// undefined-variable errors in the same files.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'coverage/*', 'android/*', 'ios/*'],
  },
  {
    // Build and tooling scripts: CommonJS, running under Node, not Metro.
    files: ['scripts/**/*.js', 'run-tests.js', '*.config.js', 'jest.setup.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      // `require` is the module system these files are written in.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['__tests__/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
    rules: {
      // `import/first` wants every import above the first statement. In a
      // jest file the statement above them is usually `jest.mock(...)`, which
      // babel-plugin-jest-hoist lifts ABOVE the imports anyway — so the
      // source order the rule objects to is the one that matches the real
      // evaluation order, and obeying the rule would misdescribe it.
      'import/first': 'off',
    },
  },
]);
