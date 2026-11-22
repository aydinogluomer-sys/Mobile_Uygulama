#!/usr/bin/env node
'use strict';
// Runs the zone-independent suites once per zone. Plain node, no new dependency.
const { spawnSync } = require('child_process');
const path = require('path');

const ZONES = ['Europe/Istanbul', 'America/New_York', 'Pacific/Auckland', 'UTC'];
// A suite joins this list only after it is green in ALL four zones (evidence goes to STATE.md).
// Step 30 empirical exclusion (F48 expands): `__tests__/lib/habitSchedule.test.ts` is kept
// unmodified per F15 Step 17 and has unstamped UTC-midnight fixtures at :338 and :430
// (`created_at: '2026-08-03T00:00:00Z'`), which shift to Sunday 2026-08-02 20:00 in America/New_York.
const TZ_SAFE_SUITES = [
  '__tests__/lib/dstMatrix.test.ts',
  '__tests__/lib/localDayRange.test.ts',
  '__tests__/lib/habitCreatedDay.test.ts',
  '__tests__/lib/hiddenClockContract.test.ts',
  '__tests__/lib/date.test.ts',
  '__tests__/lib/monthYearRules.test.ts',
  '__tests__/lib/rangeEnvelope.test.ts',
  '__tests__/lib/reportMetrics.test.ts',
  '__tests__/lib/crossConsumerFixtures.test.ts',
  '__tests__/lib/yearGrid.test.ts',
  '__tests__/lib/yearPixels.test.ts',
];

function assertZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    throw new Error(`Not an IANA zone: ${zone}`);
  }
}

const requested = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const zones = requested.length > 0 ? requested : ZONES;
const root = path.join(__dirname, '..');
const jestPkg = require.resolve('jest/package.json', { paths: [root] });
const jestBin = path.join(path.dirname(jestPkg), 'bin', 'jest.js');
const failed = [];

for (const zone of zones) {
  assertZone(zone);
  console.log(`\n=== TEST_TZ=${zone} ===`);
  const run = spawnSync(
    process.execPath,
    [jestBin, '--ci', '--maxWorkers=2', '--workerIdleMemoryLimit=512MB', '--runTestsByPath', ...TZ_SAFE_SUITES],
    { cwd: root, env: { ...process.env, TZ: zone, TEST_TZ: zone }, stdio: 'inherit' },
  );
  console.log(`exit=${run.status} zone=${zone}`);
  if (run.status !== 0) failed.push(zone);
}

if (failed.length > 0) {
  console.error(`TZ matrix FAILED in: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('TZ matrix passed in all zones');
