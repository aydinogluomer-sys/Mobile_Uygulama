import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../../components/FocusFlowView', () => 'FocusFlowView');
jest.mock('../../components/AIRoutineModal', () => 'AIRoutineModal');

jest.mock('../../store/taskStore', () => ({
  useTaskStore: (sel?: (s: unknown) => unknown) => {
    const s = { tasks: [] };
    return sel ? sel(s) : s;
  },
}));
jest.mock('../../store/habitStore', () => ({
  useHabitStore: (sel?: (s: unknown) => unknown) => {
    const s = { habits: [], fetchHabits: jest.fn(), addHabit: jest.fn() };
    return sel ? sel(s) : s;
  },
}));
jest.mock('../../store/routineStore', () => ({
  useRoutineStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      loadPack: jest.fn(),
      evaluation: null,
      installing: false,
      installed: false,
      installError: null,
      confirmInstall: jest.fn(),
      clearGenerated: jest.fn(),
    };
    return sel ? sel(s) : s;
  },
}));

import HubScreen from '../../app/tabs/hub';
import ExploreView from '../../components/hub/ExploreView';
import ToolsView from '../../components/hub/ToolsView';
import { hubDestinations, type HubCategory } from '../../lib/destinations';

const ROOT = join(__dirname, '..', '..');

type JsonNode = TestRenderer.ReactTestRendererJSON;

function collectStrings(tree: TestRenderer.ReactTestRenderer): string[] {
  const out: string[] = [];
  const walk = (n: JsonNode | string | null): void => {
    if (!n) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    (n.children ?? []).forEach(walk);
  };
  const json = tree.toJSON();
  (Array.isArray(json) ? json : [json]).forEach(walk);
  return out;
}

describe('F28 (PRF-12) — hubSplit', () => {
  afterEach(() => {
    mockPush.mockReset();
    mockNavigate.mockReset();
  });

  it('(+) HubScreen source is <= 300 lines and contains no HUB_ITEMS table', () => {
    const raw = readFileSync(join(ROOT, 'app', 'tabs', 'hub.tsx'), 'utf8');
    expect(raw.split(/\r?\n/).length).toBeLessThanOrEqual(300);
    expect(raw).not.toContain('HUB_ITEMS');
  });

  it('(+) switching HubScreen to explore renders ExploreView, and tools renders ToolsView', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<HubScreen />);
    });

    const exploreTab = tree.root
      .findAllByType(TouchableOpacity)
      .find((b) => b.props.accessibilityLabel === 'Rutin ve Alışkanlık Keşfet');
    await act(async () => {
      exploreTab?.props.onPress();
    });
    expect(tree.root.findAllByType(ExploreView)).toHaveLength(1);
    expect(tree.root.findAllByType(ToolsView)).toHaveLength(0);

    const toolsTab = tree.root
      .findAllByType(TouchableOpacity)
      .find((b) => b.props.accessibilityLabel === 'Sistem ve Araçlar');
    await act(async () => {
      toolsTab?.props.onPress();
    });
    expect(tree.root.findAllByType(ToolsView)).toHaveLength(1);
    expect(tree.root.findAllByType(ExploreView)).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('(+) ToolsView renders exact hubDestinations(category) labels and filters out other categories (-)', async () => {
    let currentCat: HubCategory | 'all' = 'all';
    const onCategory = jest.fn((next: HubCategory | 'all') => {
      currentCat = next;
    });

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ToolsView category={currentCat} onCategory={onCategory} />);
    });

    const allExpected = hubDestinations('all').map((d) => d.label);
    const allTexts = collectStrings(tree);
    for (const label of allExpected) {
      expect(allTexts).toContain(label);
    }

    // Tap "Strateji & OKR" chip
    const strategyChip = tree.root
      .findAllByType(TouchableOpacity)
      .find((b) => b.props.accessibilityLabel === 'Strateji & OKR');
    await act(async () => {
      strategyChip?.props.onPress();
    });
    expect(onCategory).toHaveBeenCalledWith('strategy');

    await act(async () => {
      tree.update(<ToolsView category="strategy" onCategory={onCategory} />);
    });

    const strategyLabels = hubDestinations('strategy').map((d) => d.label);
    const nonStrategyLabels = hubDestinations('all')
      .filter((d) => d.hub.category !== 'strategy')
      .map((d) => d.label);

    const filteredTexts = collectStrings(tree);
    for (const label of strategyLabels) {
      expect(filteredTexts).toContain(label);
    }
    // (-) Negative: non-strategy modules do not appear
    for (const other of nonStrategyLabels) {
      expect(filteredTexts).not.toContain(other);
    }

    await act(async () => {
      tree.unmount();
    });
  });
});
