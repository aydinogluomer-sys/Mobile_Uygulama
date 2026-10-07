/**
 * T1 — the shared schedule control (creation form AND habit detail render
 * this one component, KD-09): pressing it produces the configs the schedule
 * engine reads.
 */
import React, { useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import FrequencyEditor from '../../components/FrequencyEditor';
import type { FrequencyConfig } from '../../lib/supabase';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

function Harness({ start, onValue }: { start: FrequencyConfig; onValue: (v: FrequencyConfig) => void }) {
  const [v, setV] = useState(start);
  return <FrequencyEditor value={v} onChange={(n) => { setV(n); onValue(n); }} />;
}
const press = async (r: TestRenderer.ReactTestRenderer, label: string) => {
  const n = r.root.findAll((x) => x.props?.accessibilityLabel === label && typeof x.props.onPress === 'function')[0];
  await act(async () => { n.props.onPress(); });
};

it('daily -> weekly on Monday and Thursday', async () => {
  let last: FrequencyConfig | null = null;
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<Harness start={{ kind: 'daily' }} onValue={(v) => { last = v; }} />); });
  await press(r, 'Haftalık');
  await press(r, 'Belirli günler');
  await press(r, 'Pazartesi');
  await press(r, 'Perşembe');
  expect(last).toMatchObject({ kind: 'weekly', days: [0, 3] });
});

it('weekly count mode steps the count, never both days and count', async () => {
  let last: FrequencyConfig | null = null;
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<Harness start={{ kind: 'weekly', days: [0] }} onValue={(v) => { last = v; }} />); });
  await press(r, 'Haftada N kez');
  await press(r, 'Haftada bir kez artır');
  expect(last!.kind).toBe('weekly');
  expect((last as any).days).toBeUndefined();
  expect((last as any).count).toBeGreaterThanOrEqual(1);
});

// R01.02 — the month-day grid and the yearly date, through the real controls.
it('monthly -> "Ayın günleri" -> 31st asks the short-month rule, and the stepper is gone', async () => {
  let last: FrequencyConfig | null = null;
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<Harness start={{ kind: 'daily' }} onValue={(v) => { last = v; }} />); });
  await press(r, 'Aylık');
  expect(r.root.findAll((x) => x.props?.accessibilityLabel === 'Ayda bir kez artır').length).toBeGreaterThan(0);
  await press(r, 'Ayın günleri');
  expect(r.root.findAll((x) => x.props?.accessibilityLabel === 'Ayda bir kez artır')).toHaveLength(0);
  expect(r.root.findAll((x) => x.props?.accessibilityLabel === 'Kısa ay kuralı')).toHaveLength(0);
  await press(r, 'Ayın 15. günü');
  expect(r.root.findAll((x) => x.props?.accessibilityLabel === 'Kısa ay kuralı')).toHaveLength(0);
  await press(r, 'Ayın 31. günü');
  expect(r.root.findAll((x) => x.props?.accessibilityLabel === 'Kısa ay kuralı').length).toBeGreaterThan(0);
  await press(r, 'Ayın son gününe al');
  expect(last).toEqual({ kind: 'monthly', month_days: [15, 31], short_month: 'last_day' });
});

it('the short-month rule appears from the 29th on (February lacks it), not for the 28th', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<Harness start={{ kind: 'monthly', month_days: [] }} onValue={() => {}} />); });
  await press(r, 'Ayın 28. günü');
  expect(r.root.findAll((x) => x.props?.accessibilityLabel === 'Kısa ay kuralı')).toHaveLength(0);
  await press(r, 'Ayın 29. günü');
  expect(r.root.findAll((x) => x.props?.accessibilityLabel === 'Kısa ay kuralı').length).toBeGreaterThan(0);
});

it('yearly -> February -> 29 asks the leap rule; Mar 1 is stored', async () => {
  let last: FrequencyConfig | null = null;
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<Harness start={{ kind: 'yearly', month: 2, day: 27 }} onValue={(v) => { last = v; }} />); });
  expect(r.root.findAll((x) => x.props?.accessibilityLabel === '29 Şubat kuralı')).toHaveLength(0);
  await press(r, 'Günü bir artır');
  await press(r, 'Günü bir artır');
  expect(last).toEqual({ kind: 'yearly', month: 2, day: 29 });
  const plus = r.root.findAll((x) => x.props?.accessibilityLabel === 'Günü bir artır' && typeof x.props.onPress === 'function')[0];
  expect(plus.props.disabled).toBe(true); // February ends at 29
  await press(r, '1 Mart');
  expect(last).toEqual({ kind: 'yearly', month: 2, day: 29, leap_day: 'mar1' });
  await press(r, 'Nisan');
  expect(last).toEqual({ kind: 'yearly', month: 4, day: 29 });
  expect(r.root.findAll((x) => x.props?.accessibilityLabel === '29 Şubat kuralı')).toHaveLength(0);
});

it('the kind row offers "Yıllık"', async () => {
  let last: FrequencyConfig | null = null;
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<Harness start={{ kind: 'daily' }} onValue={(v) => { last = v; }} />); });
  await press(r, 'Yıllık');
  expect(last!.kind).toBe('yearly');
  expect(typeof (last as any).month).toBe('number');
  expect((last as any).day).toBeLessThanOrEqual(28);
});
