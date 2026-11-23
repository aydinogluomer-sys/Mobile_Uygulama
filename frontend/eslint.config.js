// https://docs.expo.dev/guides/using-eslint/
//
// ## Why this file is more than `[expoConfig]`
//
// `npx expo lint` only walks the app directories, so `eslint .` — which CI
// now runs with `--max-warnings=0` — reached files the base config never
// described, and reported `no-undef` errors on CommonJS Node/Jest scripts.
// Declaring the environment is the fix rather than switching `no-undef` off.
//
// ## React Compiler hook rules (F48 C8 / BLD-15): frozen via eslint-suppressions.json
//
// `react-hooks/refs`, `react-hooks/set-state-in-effect`,
// `react-hooks/preserve-manual-memoization`, and `react-hooks/purity` are
// enabled at `error` severity across the entire repository (the `eslint-config-expo`
// default). Pre-existing legacy findings in `app/` and `components/` are frozen
// in `eslint-suppressions.json` (`--suppressions-location eslint-suppressions.json`)
// and ratcheted downward by `__tests__/repo/compilerLintRatchet.test.ts`:
// - any NEW violation in any file fails `npm run lint:ci` immediately;
// - fixing an existing violation requires `--prune-suppressions`, lowering the count.
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
    files: ['scripts/**/*.js', 'run-tests.js', '*.config.js', 'jest.setup.js', 'jest.afterEnv.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      // `require` is the module system these files are written in.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // F24 — one dialog layer. Alert / ActionSheetIOS / window.confirm are dead or truncated on
    // react-native-web and Android (GAP2-01, NAV-03); lib/dialog.ts is the only file allowed to call them.
    files: [
      'app/**/*.{ts,tsx}',
      'components/**/*.{ts,tsx}',
      'hooks/**/*.{ts,tsx}',
      'lib/**/*.{ts,tsx}',
      'services/**/*.{ts,tsx}',
      'store/**/*.{ts,tsx}',
      'repositories/**/*.{ts,tsx}',
    ],
    ignores: ['lib/dialog.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Alert'][callee.property.name=/^(alert|prompt)$/]",
          message: 'Use confirm()/notify()/actionSheet() from lib/dialog (Alert is a no-op on web and shows 3 buttons on Android).',
        },
        {
          selector: "ImportDeclaration[source.value='react-native'] > ImportSpecifier[imported.name=/^(Alert|ActionSheetIOS)$/]",
          message: 'Import dialogs from lib/dialog, not from react-native.',
        },
        {
          selector: "CallExpression[callee.object.name='window'][callee.property.name=/^(alert|confirm|prompt)$/]",
          message: 'Use lib/dialog; window.* dialogs bypass the theme, queue and account boundary.',
        },
      ],
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
