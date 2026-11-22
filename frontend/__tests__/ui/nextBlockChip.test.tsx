/**
 * F36 — `NextUpStrip` sıradaki blok geri sayım çipi ve `useMinuteClock` yaşam döngüsü testleri.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockFocused = true;
jest.mock('expo-router', () => ({
  useIsFocused: () => mockFocused,
}));

import NextUpStrip, { type NextUpItem } from '../../components/today/NextUpStrip';
import type { BlockTask } from '../../lib/nextBlock';

function textOf(r: TestRenderer.ReactTestRenderer): string {
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
    if (typeof n === 'object' && 'children' in (n as Record<string, unknown>)) {
      walk((n as { children?: unknown }).children);
    }
  };
  walk(r.toJSON());
  return out.join(' ');
}

const sampleItem: NextUpItem = {
  id: 'i1',
  title: ' Fatura öde',
  dueLabel: 'bugün',
  dotColor: '#87A678',
};

const makeBlockTask = (over: Partial<BlockTask> = {}): BlockTask => ({
  id: 'b1',
  title: 'Rapor yazma',
  due_date: '2026-11-02',
  time_block_start: '15:00',
  time_block_end: '15:45',
  completed: false,
  status: 'pending',
  priority: 'medium',
  ...over,
});

describe('F36 NextUpStrip — next-block countdown chip & minute timer hygiene', () => {
  const mounted: TestRenderer.ReactTestRenderer[] = [];

  beforeEach(() => {
    mockFocused = true;
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 2, 14, 35, 0, 0));
  });

  afterEach(() => {
    while (mounted.length > 0) {
      const r = mounted.pop()!;
      act(() => {
        r.unmount();
      });
    }
    jest.useRealTimers();
  });

  it('(+) shows "Sıradaki blok 25 dk sonra" at 14:35, ticks to 24 dk after 60s, exposes text role + title a11y, and renders with empty items', () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <NextUpStrip items={[]} blockTasks={[makeBlockTask()]} />,
      );
    });
    mounted.push(r);

    expect(textOf(r)).toContain('Sıradaki blok 25 dk sonra');
    expect(textOf(r)).not.toContain('AKIŞ / SIRADA');
    expect(jest.getTimerCount()).toBe(1);

    const chipNode = r.root.findAll(
      (n) => typeof n.type === 'string' && n.props?.accessibilityRole === 'text',
    )[0];
    expect(chipNode).toBeDefined();
    expect(chipNode.props.accessibilityLabel).toContain('Rapor yazma');
    expect(chipNode.props.accessibilityLabel).toContain('25 dakika sonra');
    expect(chipNode.props.onPress).toBeUndefined();
    expect(chipNode.props.accessibilityLiveRegion).toBeUndefined();

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(textOf(r)).toContain('Sıradaki blok 24 dk sonra');

    act(() => {
      r.unmount();
    });
    mounted.pop();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('(-) renders null with no items/blocks, arms zero timers when unfocused, and leaves zero pending timers after unmount', () => {
    // 1. No items and no timed tasks -> null & zero timers
    let rEmpty!: TestRenderer.ReactTestRenderer;
    act(() => {
      rEmpty = TestRenderer.create(<NextUpStrip items={[]} blockTasks={[]} />);
    });
    expect(rEmpty.toJSON()).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    act(() => {
      rEmpty.unmount();
    });
    expect(jest.getTimerCount()).toBe(0);

    // 2. Unfocused screen -> zero timers armed while mounted and after unmount
    mockFocused = false;
    let rUnfocused!: TestRenderer.ReactTestRenderer;
    act(() => {
      rUnfocused = TestRenderer.create(
        <NextUpStrip items={[]} blockTasks={[makeBlockTask()]} />,
      );
    });
    expect(jest.getTimerCount()).toBe(0);
    act(() => {
      rUnfocused.unmount();
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('(-) hides next-block chip when all blocks today are in the past while keeping AKIŞ / SIRADA when items exist', () => {
    let rPast!: TestRenderer.ReactTestRenderer;
    act(() => {
      rPast = TestRenderer.create(
        <NextUpStrip
          items={[sampleItem]}
          blockTasks={[makeBlockTask({ time_block_start: '09:00', time_block_end: '09:30' })]}
        />,
      );
    });
    mounted.push(rPast);
    expect(textOf(rPast)).not.toContain('Sıradaki blok');
    expect(textOf(rPast)).toContain('AKIŞ / SIRADA');

    let rPastNoItems!: TestRenderer.ReactTestRenderer;
    act(() => {
      rPastNoItems = TestRenderer.create(
        <NextUpStrip
          items={[]}
          blockTasks={[makeBlockTask({ time_block_start: '09:00', time_block_end: '09:30' })]}
        />,
      );
    });
    mounted.push(rPastNoItems);
    expect(rPastNoItems.toJSON()).toBeNull();
  });
});
