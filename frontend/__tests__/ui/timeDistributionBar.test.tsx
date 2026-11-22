import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import TimeDistributionBar from '../../components/review/TimeDistributionBar';
import { buildTimeDistribution, timeA11yLabel } from '../../lib/timeDistribution';
import { colors, palettes } from '../../lib/tokens';

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    walk(n.children);
  };
  walk(r.toJSON());
  return out.join(' ');
}

function flatStyle(styleProp: unknown): Record<string, any> {
  if (!styleProp) return {};
  const arr = Array.isArray(styleProp) ? (styleProp as unknown[]).flat(4) : [styleProp];
  return Object.assign({}, ...arr.filter(Boolean));
}

describe('components/review/TimeDistributionBar — stacked bar & non-judgmental copy (PS-14)', () => {
  it('(+) renders 3 proportional segments, 3 text rows (label + dk + %), image a11y label, past-week "O hafta" copy, unknown & excluded notes', async () => {
    const dist = buildTimeDistribution({
      focusMinutes: 120,
      routineMinutes: 45,
      habitMinutes: 30,
      excludedHabits: 2,
    });

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<TimeDistributionBar distribution={dist} weekLabel="O hafta" />);
    });

    const bar = r.root.findAll((n) => n.props?.testID === 'time-distribution-bar')[0];
    expect(bar).toBeDefined();
    expect(bar.props.accessibilityRole).toBe('image');
    expect(bar.props.accessibilityLabel).toBe(timeA11yLabel(dist, 'O hafta'));

    const segNodes = r.root.findAll(
      (n) => typeof n.type === 'string' && typeof n.props?.testID === 'string' && n.props.testID.startsWith('time-segment-'),
    );
    expect(segNodes).toHaveLength(3);

    // Color is never the sole carrier — every segment has its own text row with label, minutes, and %
    const txt = textOf(r);
    expect(txt).toContain('Zaman nereye gitti');
    expect(txt).toContain('O hafta zamanın en çok buraya aktı.');
    expect(txt).toContain('Odak · 120 dk · %62');
    expect(txt).toContain('Rutinler · 45 dk · %23');
    expect(txt).toContain('Süre tipli alışkanlıklar · 30 dk · %15');
    expect(txt).toContain('2 süre tipli alışkanlık birimi tanınmadığı için hariç.');
    expect(txt).toContain('Süreler kayıtlı olduğu kaynağa göre toplanır.');

    // Segment colors never use error red
    for (const seg of segNodes) {
      const st = flatStyle(seg.props.style);
      expect(st.backgroundColor).not.toBe(colors.error);
      expect(st.backgroundColor).not.toBe(palettes.light.error);
    }
  });

  it('(+) renders "Odak süresi okunamadı." when focusMinutes is null (unknown) without fabricating a focus segment', async () => {
    const dist = buildTimeDistribution({
      focusMinutes: null,
      routineMinutes: 40,
      habitMinutes: 0,
    });

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<TimeDistributionBar distribution={dist} weekLabel="Bu hafta" />);
    });

    const txt = textOf(r);
    expect(txt).toContain('Odak süresi okunamadı.');
    expect(txt).toContain('Rutinler · 40 dk · %100');
    expect(txt).not.toContain('Odak · 0 dk');
    const focusSeg = r.root.findAll((n) => n.props?.testID === 'time-segment-focus');
    expect(focusSeg).toHaveLength(0);
  });

  it('(-) does NOT render the bar when segments are empty, showing only neutral caption', async () => {
    const empty = buildTimeDistribution({
      focusMinutes: 0,
      routineMinutes: 0,
      habitMinutes: 0,
    });

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<TimeDistributionBar distribution={empty} weekLabel="Bu hafta" />);
    });

    expect(r.root.findAll((n) => n.props?.testID === 'time-distribution-bar')).toHaveLength(0);
    expect(textOf(r)).toContain('Bu hafta henüz süre kaydı yok.');
    expect(textOf(r)).not.toContain('en çok buraya aktı');
  });
});
