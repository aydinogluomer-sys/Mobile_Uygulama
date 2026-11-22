import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { stripComments } from '../helpers/sourceText';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

let mockPeriodParam: string | undefined = 'yearly';
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => (mockPeriodParam ? { period: mockPeriodParam } : {}),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));
jest.mock('../../services/focusPointService', () => ({ newRequestId: () => 'req-1' }));

const mockEntries = [
  { id: 'j-1', user_id: 'u1', date: '2026-01-12', content: 'GİZLİ GÜNLÜK METNİ ASLA SIZMAMALI', mood: 4, ai_summary: null, created_at: '2026-01-12T09:00:00Z' },
  { id: 'j-2', user_id: 'u1', date: '2026-03-20', content: 'İkinci gizli metin', mood: 3, ai_summary: null, created_at: '2026-03-20T09:00:00Z' },
];
let mockTruncated = false;

jest.mock('../../store/journalStore', () => {
  const fetchEntries = jest.fn(async () => undefined);
  const state = () => ({ entries: mockEntries, fetchEntries, truncated: mockTruncated });
  const useJournalStore: any = (sel?: any) => (sel ? sel(state()) : state());
  useJournalStore.getState = state;
  return { useJournalStore };
});

jest.mock('../../store/moodStore', () => {
  const hydrate = jest.fn(async () => undefined);
  const state = { checkins: [], hydrate };
  const useMoodStore: any = (sel?: any) => (sel ? sel(state) : state);
  return { useMoodStore };
});

jest.mock('../../store/insightsStore', () => {
  const fetchInsight = jest.fn(async () => undefined);
  const saveInsight = jest.fn(async () => undefined);
  const state = () => ({ get: () => null, fetchInsight, saveInsight });
  const useInsightsStore: any = (sel?: any) => (sel ? sel(state()) : state());
  return { useInsightsStore };
});

jest.mock('../../store/subscriptionStore', () => {
  const state = { focusPoints: 50, fetch: jest.fn(async () => undefined), setBalance: jest.fn() };
  const useSubscriptionStore: any = (sel?: any) => (sel ? sel(state) : state);
  return { useSubscriptionStore };
});

import JournalInsightsScreen from '../../app/screens/journal-insights';
import YearInPixels from '../../components/journal/YearInPixels';
import { MOODS } from '../../lib/journalMoods';
import { colors } from '../../lib/tokens';
import {
  buildYearPixels,
  YEAR_PIXELS_SCOPE_NOTE_DEVICE,
  YEAR_PIXELS_TRUNCATED_NOTE,
} from '../../lib/yearPixels';

const ROOT = join(__dirname, '..', '..');

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

describe('components/journal/YearInPixels — UI & privacy invariants (PS-12)', () => {
  beforeAll(() => {
    jest.useFakeTimers({
      now: new Date(2026, 9, 8, 10),
      doNotFake: [
        'nextTick', 'setImmediate', 'clearImmediate',
        'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
        'queueMicrotask', 'hrtime', 'performance',
      ],
    });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    mockPeriodParam = 'yearly';
    mockTruncated = false;
  });

  it('(+) renders 12 month rows, image a11y summary, 5-mood legend, scope note, truncated note, and expandable 12-row monthly summary (>=44pt)', async () => {
    const model = buildYearPixels({
      year: 2026,
      moods: [
        { date: '2026-01-10', mood: 4 },
        { date: '2026-05-03', mood: 2 },
      ],
      todayYmd: '2026-10-08',
    });

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(
        <YearInPixels model={model} truncated scopeNote={YEAR_PIXELS_SCOPE_NOTE_DEVICE} />,
      );
    });

    const monthRows = r.root.findAll((n) => typeof n.props?.testID === 'string' && n.props.testID.startsWith('year-pixels-month-'), { deep: false });
    expect(monthRows).toHaveLength(12);

    const img = r.root.findAll((n) => n.props?.accessibilityRole === 'image')[0];
    expect(img).toBeDefined();
    expect(img.props.accessibilityLabel).toContain('2026: 2 gün kayıt');

    const txt = textOf(r);
    for (const m of MOODS) {
      expect(txt).toContain(m.label);
    }
    expect(txt).toContain("Bu cihazdaki check-in'ler ve tüm günlük kayıtların gösterilir.");
    expect(txt).toContain(YEAR_PIXELS_TRUNCATED_NOTE);

    // Toggle button >= 44pt and expands 12 monthly summary lines
    const toggleBtn = r.root.findAll(
      (n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === 'Aylara göre özet' && typeof n.props.onPress === 'function',
    )[0];
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn.props.accessibilityState?.expanded).toBe(false);
    const btnStyle = flatStyle(toggleBtn.props.style);
    const slop = toggleBtn.props.hitSlop ?? { top: 0, bottom: 0 };
    expect((btnStyle.minHeight ?? 0) + (slop.top ?? 0) + (slop.bottom ?? 0)).toBeGreaterThanOrEqual(44);

    await act(async () => {
      toggleBtn.props.onPress();
    });

    expect(toggleBtn.props.accessibilityState?.expanded).toBe(true);
    const summaryRows = r.root.findAll(
      (n) => typeof n.type === 'string' && typeof n.props?.testID === 'string' && n.props.testID.startsWith('year-pixels-month-summary-'),
    );
    expect(summaryRows).toHaveLength(12);
    expect(textOf(r)).toContain('Ocak: 1 gün kayıt, ortalama İyi');
  });

  it('(-) empty cell background is neither colors.error nor MOODS[0].color, and truncated=false omits truncated note', async () => {
    const model = buildYearPixels({
      year: 2026,
      moods: [],
      todayYmd: '2026-06-15',
    });

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(
        <YearInPixels model={model} truncated={false} scopeNote={YEAR_PIXELS_SCOPE_NOTE_DEVICE} />,
      );
    });

    expect(textOf(r)).not.toContain(YEAR_PIXELS_TRUNCATED_NOTE);

    const emptyCells = r.root.findAll((n) => n.props?.testID === 'pixel-empty');
    expect(emptyCells.length).toBeGreaterThan(100);
    const sampleStyle = flatStyle(emptyCells[0].props.style);
    expect(sampleStyle.backgroundColor).toBeDefined();
    expect(sampleStyle.backgroundColor).not.toBe(colors.error);
    expect(sampleStyle.backgroundColor).not.toBe(MOODS[0].color);
  });

  it('(+/-) integration: journal-insights renders YearInPixels in yearly period ONLY (absent in weekly and monthly)', async () => {
    mockPeriodParam = 'yearly';
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<JournalInsightsScreen />);
    });
    expect(textOf(r)).toContain('2026 ruh hali');
    expect(textOf(r)).toContain(YEAR_PIXELS_SCOPE_NOTE_DEVICE);

    // Switch to Aylık -> grid gone
    const monthlyTab = r.root.findAll(
      (n) => n.props?.accessibilityRole === 'tab' && typeof n.props.onPress === 'function',
    )[1];
    await act(async () => {
      monthlyTab.props.onPress();
    });
    expect(textOf(r)).not.toContain('2026 ruh hali');

    // Switch to Haftalık -> grid gone
    const weeklyTab = r.root.findAll(
      (n) => n.props?.accessibilityRole === 'tab' && typeof n.props.onPress === 'function',
    )[0];
    await act(async () => {
      weeklyTab.props.onPress();
    });
    expect(textOf(r)).not.toContain('2026 ruh hali');
  });

  it('(-) source & privacy scan: YearInPixels has zero .content / Alert / console, and journal-insights maps { date, mood } only', () => {
    const compSrc = stripComments(
      readFileSync(join(ROOT, 'components', 'journal', 'YearInPixels.tsx'), 'utf8'),
    );
    expect(compSrc).not.toMatch(/\.content\b/);
    expect(compSrc).not.toMatch(/\bAlert\b/);
    expect(compSrc).not.toMatch(/\bconsole\./);

    const screenSrc = stripComments(
      readFileSync(join(ROOT, 'app', 'screens', 'journal-insights.tsx'), 'utf8'),
    );
    expect(screenSrc).toMatch(/entries\.map\(\s*\(\w+\)\s*=>\s*\(\{\s*date:\s*\w+\.date,\s*mood:\s*\w+\.mood\s*\}\)\s*\)/);
  });
});
