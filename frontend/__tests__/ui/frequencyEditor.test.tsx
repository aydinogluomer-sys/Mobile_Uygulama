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
