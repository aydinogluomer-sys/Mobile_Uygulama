/**
 * F48 C4 (BLD-16) — React `act()` warning ratchet (`setupFilesAfterEnv`).
 *
 * Listens to `console.error` across every test; when a message matches
 * `/not wrapped in act\(/`, records it for the active test file.
 * - Under `ACT_WARNING_RECORD=1`, appends the relative test path to
 *   `ACT_WARNING_FILE` or `os.tmpdir()/act-warnings.jsonl` to record baseline debt.
 * - Otherwise, throws in `afterEach` for any test file not listed in
 *   `__tests__/helpers/actWarningDebt.ts` (including the relative file path and
 *   the first 300 characters of the warning).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');

const realConsoleError = console.error.bind(console);
let actWarnings = [];

console.error = (...args) => {
  const formatted = util.format(...args);
  if (/not wrapped in act\(/i.test(formatted)) {
    actWarnings.push(formatted);
  }
  realConsoleError(...args);
};

beforeEach(() => {
  actWarnings = [];
});

afterEach(() => {
  if (actWarnings.length === 0) return;

  const state = expect.getState();
  const testPath = state && state.testPath ? state.testPath : '';
  const relPath = testPath
    ? path.relative(__dirname, testPath).split(path.sep).join('/')
    : '<unknown>';
  const firstSample = actWarnings[0].slice(0, 300);
  actWarnings = [];

  if (process.env.ACT_WARNING_RECORD === '1') {
    const outFile = process.env.ACT_WARNING_FILE || path.join(os.tmpdir(), 'act-warnings.jsonl');
    fs.appendFileSync(
      outFile,
      `${JSON.stringify({ file: relPath, sample: firstSample })}\n`,
      'utf8',
    );
    return;
  }

  const { ACT_WARNING_DEBT } = require('./__tests__/helpers/actWarningDebt');
  if (Array.isArray(ACT_WARNING_DEBT) && ACT_WARNING_DEBT.includes(relPath)) {
    return;
  }

  throw new Error(
    `Unexpected React act() warning in ${relPath} (not in ACT_WARNING_DEBT):\n${firstSample}`,
  );
});
