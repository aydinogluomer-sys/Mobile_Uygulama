import React from 'react';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pressable, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { stripComments } from '../helpers/sourceText';

const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
  Redirect: 'Redirect',
}));

const mockHabitState: {
  habits: {
    id: string;
    name: string;
    status: 'active' | 'waiting' | 'archived';
    color: string;
    icon: string;
    current_streak: number;
    longest_streak: number;
    strength_score: number;
    frequency_type: string;
    frequency_config: null;
    daily_goal: null;
    unit: null;
  }[];
  fetchHabits: jest.Mock;
} = {
  habits: [],
  fetchHabits: jest.fn(async () => undefined),
};

jest.mock('../../store/habitStore', () => ({
  useHabitStore: (sel?: (s: unknown) => unknown) => (sel ? sel(mockHabitState) : mockHabitState),
}));

const mockLogState = {
  fetchLogsForDate: jest.fn(async () => undefined),
  logHabit: jest.fn(async () => undefined),
  getLogForHabit: jest.fn(() => undefined),
  getRemainingValue: jest.fn(() => 0),
};

jest.mock('../../store/logStore', () => ({
  useLogStore: (sel?: (s: unknown) => unknown) => (sel ? sel(mockLogState) : mockLogState),
}));

import HabitListView from '../../components/HabitListView';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string): string => stripComments(read(rel));

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walkTsx(rel));
    else if (/\.(?:ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe('F28 (NAV-09, PRF-18) — habitScreenUnification', () => {
  afterEach(() => {
    mockHabitState.habits = [];
    mockPush.mockReset();
    mockNavigate.mockReset();
  });

  it('(+) app/tabs/habits.tsx is <= 20 lines and redirects to /tabs/timeline', () => {
    const raw = read('app/tabs/habits.tsx').trim();
    const lines = raw.split(/\r?\n/);
    expect(lines.length).toBeLessThanOrEqual(20);
    expect(raw).toContain('<Redirect href="/tabs/timeline"');
  });

  it('(+) HabitListView empty-state CTA and FAB invoke onAdd when provided', async () => {
    const onAdd = jest.fn();

    // 1. Empty state CTA calls onAdd
    mockHabitState.habits = [];
    let emptyTree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      emptyTree = TestRenderer.create(React.createElement(HabitListView, { onAdd }));
    });
    const ctaBtn = [
      ...emptyTree.root.findAllByType(Pressable),
      ...emptyTree.root.findAllByType(TouchableOpacity),
    ].find((b) => b.props.accessibilityLabel === 'Alışkanlık Ekle');
    expect(ctaBtn).toBeDefined();
    await act(async () => {
      ctaBtn?.props.onPress();
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    await act(async () => {
      emptyTree.unmount();
    });

    // 2. Non-empty list FAB calls onAdd
    onAdd.mockClear();
    mockHabitState.habits = [
      {
        id: 'h1',
        name: 'Su İç',
        status: 'active',
        color: '#22c55e',
        icon: 'water-outline',
        current_streak: 3,
        longest_streak: 5,
        strength_score: 40,
        frequency_type: 'daily',
        frequency_config: null,
        daily_goal: null,
        unit: null,
      },
    ];
    let listTree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      listTree = TestRenderer.create(React.createElement(HabitListView, { onAdd }));
    });
    const fab = listTree.root
      .findAllByType(TouchableOpacity)
      .find((b) => b.props.accessibilityLabel === 'Alışkanlık ekle');
    expect(fab).toBeDefined();
    await act(async () => {
      fab?.props.onPress();
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    await act(async () => {
      listTree.unmount();
    });
  });

  it('(+) timeline.tsx consumes both new-habit and ai-routine command intents and delegates HabitMgmtCard', () => {
    const timeline = code('app/tabs/timeline.tsx');
    expect(timeline).toMatch(/pendingIntent\s*===\s*['"]new-habit['"][\s\S]*?setShowOnboarding\(true\)/);
    expect(timeline).toMatch(/pendingIntent\s*===\s*['"]ai-routine['"][\s\S]*?setShowAIRoutine\(true\)/);
    expect(timeline).toContain('<HabitOnboarding');
    expect(timeline).toContain('<AIRoutineModal');
    expect(timeline).toContain('<HabitMgmtCard');
  });

  it('(-) zero "/tabs/habits" literals remain under app/ or components/, and dashboard.tsx no longer renders HabitListView', () => {
    const files = [...walkTsx('app'), ...walkTsx('components')];
    const offenders = files.filter((rel) => code(rel).includes("'/tabs/habits'") || code(rel).includes('"/tabs/habits"'));
    expect(offenders).toEqual([]);

    const dashboard = code('app/screens/dashboard.tsx');
    expect(dashboard).not.toContain('HabitListView');
    expect(dashboard).toContain('<Redirect href="/tabs/timeline"');
  });
});
