import React, { useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, TouchableOpacity } from 'react-native';

const mockReduceMotion = { value: false };

jest.mock('../../components/seasonalMotion/useReducedMotion', () => ({
  useReducedMotion: () => mockReduceMotion.value,
}));

jest.mock('../../lib/haptics', () => ({
  haptic: { select: jest.fn(), light: jest.fn(), success: jest.fn() },
}));

import { colors, palettes } from '../../lib/tokens';
import type { Ymd } from '../../lib/date';
import {
  YEAR_GRID_CELL,
  YEAR_GRID_GAP,
  buildHabitYearGrid,
  yearGridSummaryText,
  type CellInput,
} from '../../lib/yearGrid';
import GoldMendShimmer, { GoldVein } from '../../components/motion/GoldMendShimmer';
import KintsugiYearGrid from '../../components/habits/KintsugiYearGrid';

function collectText(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    walk((n as { children?: unknown }).children);
  };
  walk(r.toJSON());
  return out.join(' ');
}

function sampleModel(todayYmd: Ymd = '2026-03-11') {
  const stateMap = new Map<Ymd, CellInput['state']>([
    ['2026-03-08', 'full'],
    ['2026-03-09', 'partial'],
    ['2026-03-10', 'skip'],
  ]);
  return buildHabitYearGrid({
    habit: { behavior_type: 'positive' },
    todayYmd,
    createdYmd: todayYmd,
    cellFor: (d) => {
      const y = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (y > todayYmd) return { state: 'future', value: null };
      return { state: stateMap.get(y) ?? 'miss', value: null };
    },
    logStateOn: () => null,
    noteOn: () => false,
    repairedDates: new Set<Ymd>(['2026-03-07']),
  });
}

beforeEach(() => {
  mockReduceMotion.value = false;
  jest.clearAllMocks();
});

describe('components/habits/KintsugiYearGrid (F31 PS-07)', () => {
  it('(+) exposes single accessibilityRole="image" with positive summary, has zero per-cell TouchableOpacity (<= 4 onPress nodes), and selects cells via locationX/Y + ‹ › steppers >= 44pt', () => {
    const model = sampleModel('2026-03-11');

    function Controlled() {
      const [sel, setSel] = useState<Ymd | null>('2026-03-08');
      return (
        <KintsugiYearGrid
          mode="habit"
          model={model}
          accent={colors.primary}
          selected={sel}
          onSelect={setSel}
          status="ready"
          repairedCount={model.summary.repaired}
        />
      );
    }

    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<Controlled />);
    });

    // Single accessible image with positive summary text
    const imgs = r.root.findAll(
      (n) => typeof n.type === 'string' && n.props?.accessibilityRole === 'image',
    );
    expect(imgs).toHaveLength(1);
    expect(imgs[0].props.accessibilityLabel).toBe(yearGridSummaryText(model));

    // (-) Zero per-cell TouchableOpacity; total nodes with onPress <= 4
    expect(r.root.findAllByType(TouchableOpacity)).toHaveLength(0);
    const pressables = r.root.findAll((n) => typeof n.props?.onPress === 'function');
    expect(pressables.length).toBeLessThanOrEqual(4);

    // Selected strip renders "8 Mart Pazar: Tamamlandı" (even in America/New_York, never "7 Mart")
    expect(collectText(r)).toContain('8 Mart Pazar: Tamamlandı');
    expect(collectText(r)).not.toContain('7 Mart');

    // Stepper buttons >= 44pt update selected day & strip text
    const prevBtn = r.root.find(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Önceki gün',
    );
    const nextBtn = r.root.find(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Sonraki gün',
    );
    for (const btn of [prevBtn, nextBtn]) {
      const st = StyleSheet.flatten(btn.props.style) as { minWidth?: number; minHeight?: number };
      expect(st.minWidth ?? 0).toBeGreaterThanOrEqual(44);
      expect(st.minHeight ?? 0).toBeGreaterThanOrEqual(44);
    }

    act(() => {
      nextBtn.props.onPress();
    });
    expect(collectText(r)).toContain('9 Mart Pazartesi: Kısmi');

    act(() => {
      prevBtn.props.onPress();
    });
    expect(collectText(r)).toContain('8 Mart Pazar: Tamamlandı');

    // Single Pressable surface selects cell at (col=12, row=1 -> Tuesday 2026-03-10 -> Atlandı)
    const surface = r.root.find(
      (n) => typeof n.props?.onPress === 'function' && n.props?.testID === 'year-grid-surface',
    );
    const pitch = YEAR_GRID_CELL + YEAR_GRID_GAP;
    act(() => {
      surface.props.onPress({
        nativeEvent: {
          locationX: 12 * pitch + 2,
          locationY: 1 * pitch + 2,
        },
      });
    });
    expect(collectText(r)).toContain('10 Mart Salı: Atlandı');
    act(() => {
      r.unmount();
    });
  });

  it('(+) renders GoldVein on repaired cells even when Reduce Motion is enabled and GoldMendShimmer returns null; (-) missed cell is NEVER red/error', () => {
    mockReduceMotion.value = true;
    const model = sampleModel('2026-03-11');

    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <KintsugiYearGrid
          mode="habit"
          model={model}
          accent={colors.primary}
          selected={null}
          onSelect={jest.fn()}
          status="ready"
          repairedCount={1}
        />,
      );
    });

    const shimmers = r.root.findAllByType(GoldMendShimmer);
    for (const sh of shimmers) {
      expect(sh.children).toHaveLength(0);
    }
    expect(r.root.findAllByType(GoldVein).length).toBeGreaterThanOrEqual(2);

    const missedCells = r.root.findAll(
      (n) => typeof n.type === 'string' && n.props?.testID === 'year-cell-missed',
    );
    expect(missedCells.length).toBeGreaterThan(0);
    const forbiddenReds = new Set([
      colors.error.toLowerCase(),
      palettes.light.error.toLowerCase(),
      '#ef4444',
      '#dc2626',
      '#f87171',
    ]);
    for (const cell of missedCells) {
      const flat = StyleSheet.flatten(cell.props.style) as { backgroundColor?: string };
      const bg = String(flat.backgroundColor ?? '').toLowerCase();
      expect(forbiddenReds.has(bg)).toBe(false);
      expect(bg).not.toContain('199, 106, 106');
      expect(bg).not.toContain('239, 68, 68');
    }
    act(() => {
      r.unmount();
    });
  });

  it('(+) renders skeleton on status="loading" and retry >= 44pt on status="error"; (-) paints ZERO state cells on error', () => {
    const model = sampleModel('2026-03-11');
    const onRetry = jest.fn();

    let rLoad!: TestRenderer.ReactTestRenderer;
    act(() => {
      rLoad = TestRenderer.create(
        <KintsugiYearGrid
          mode="habit"
          model={model}
          accent={colors.primary}
          selected={null}
          onSelect={jest.fn()}
          status="loading"
          repairedCount={0}
        />,
      );
    });
    expect(
      rLoad.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === 'year-grid-loading')
        .length,
    ).toBeGreaterThan(0);
    expect(
      rLoad.root.findAll(
        (n) => typeof n.type === 'string' && String(n.props?.testID ?? '').startsWith('year-cell-'),
      ),
    ).toHaveLength(0);
    act(() => {
      rLoad.unmount();
    });

    let rErr!: TestRenderer.ReactTestRenderer;
    act(() => {
      rErr = TestRenderer.create(
        <KintsugiYearGrid
          mode="habit"
          model={model}
          accent={colors.primary}
          selected={null}
          onSelect={jest.fn()}
          status="error"
          onRetry={onRetry}
          repairedCount={0}
        />,
      );
    });
    expect(collectText(rErr)).toContain('Kayıtlar okunamadı. Tekrar dene.');
    expect(
      rErr.root.findAll(
        (n) => typeof n.type === 'string' && String(n.props?.testID ?? '').startsWith('year-cell-'),
      ),
    ).toHaveLength(0);
    expect(collectText(rErr)).not.toContain('Kaçırıldı');

    const retryBtn = rErr.root.find(
      (n) => n.type === TouchableOpacity && n.props?.accessibilityLabel === 'Tekrar dene',
    );
    const retryStyle = StyleSheet.flatten(retryBtn.props.style) as {
      minWidth?: number;
      minHeight?: number;
    };
    expect(retryStyle.minWidth ?? 0).toBeGreaterThanOrEqual(44);
    expect(retryStyle.minHeight ?? 0).toBeGreaterThanOrEqual(44);
    act(() => {
      retryBtn.props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    act(() => {
      rErr.unmount();
    });
  });
});
