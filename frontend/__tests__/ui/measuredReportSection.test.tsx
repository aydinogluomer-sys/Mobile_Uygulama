/**
 * R07.04 — the review shows amount and duration per measured habit, or
 * nothing when there is none (no empty decorative section).
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as fs from 'fs';
import * as path from 'path';
import MeasuredReportSection from '../../components/MeasuredReportSection';

it('renders each row with a readable label, and nothing without rows', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<MeasuredReportSection rows={[]} />); });
  expect(r.toJSON()).toBeNull();
  const rows = [{ id: 'h', name: 'Su', line: '16/56 bardak · 4 açık · 2 kısmi', report: {} as never }];
  await act(async () => { r.update(<MeasuredReportSection rows={rows} />); });
  expect(r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Su: 16/56 bardak · 4 açık · 2 kısmi')).toHaveLength(1);
});

it('both reviews feed it from the engine rows built over the review range', () => {
  for (const f of ['app/screens/weekly-review.tsx', 'app/screens/monthly-review.tsx']) {
    const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
    expect(src).toMatch(/measuredRows\(habits, logsRes\.data, \{ start, end, asOf: new Date\(\) \}\)/);
    expect(src).toMatch(/<MeasuredReportSection rows=\{measured\} \/>/);
  }
});
