import React from 'react';
import { ScrollView, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TestRenderer, { act } from 'react-test-renderer';

jest.setTimeout(30_000);

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'Image' }));

const mockSpeechStop = jest.fn();
const mockSpeechSpeak = jest.fn();
jest.mock('expo-speech', () => ({
  stop: () => mockSpeechStop(),
  speak: (...args: unknown[]) => mockSpeechSpeak(...args),
}));

const mockPush = jest.fn();
let mockFocused = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => false }),
  useIsFocused: () => mockFocused,
}));

jest.mock('../../components/seasonalMotion/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('react-native-webview', () => ({
  WebView: 'WebView',
}));

const mockSession = { uid: 'u1' as string | null };
jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () =>
    mockSession.uid ? { id: mockSession.uid, email: null } : null,
  ),
}));

const mockAddHabit = jest.fn(async () => ({ id: 'new-h' }));
const mockFetchHabits = jest.fn();
jest.mock('../../store/habitStore', () => {
  const state = {
    habits: [],
    fetchHabits: (...args: unknown[]) => mockFetchHabits(...args),
    addHabit: (...args: unknown[]) => mockAddHabit(...(args as [])),
  };
  const useHabitStore = (sel?: (s: typeof state) => unknown) =>
    sel ? sel(state) : state;
  useHabitStore.getState = () => state;
  return { useHabitStore };
});

jest.mock('../../store/taskStore', () => {
  const state = { tasks: [] };
  const useTaskStore = (sel?: (s: typeof state) => unknown) =>
    sel ? sel(state) : state;
  useTaskStore.getState = () => state;
  return { useTaskStore };
});

jest.mock('../../store/focusStore', () => {
  const state = {
    sessionsCompleted: 0,
    status: 'idle',
    startSmallStep: jest.fn(),
  };
  const useFocusStore = (sel?: (s: typeof state) => unknown) =>
    sel ? sel(state) : state;
  useFocusStore.getState = () => state;
  return { useFocusStore };
});

import FocusFlowView from '../../components/FocusFlowView';
import FlowClosurePage from '../../components/focusFlow/FlowClosurePage';
import { FocusFlowPage } from '../../components/focusFlow/FocusFlowPage';
import { isInWindow } from '../../components/focusFlow/FocusFlowPager';
import Button from '../../components/ui/Button';
import { SEEN_DWELL_MS } from '../../hooks/useFocusFlowFeed';
import { resetAccountMemory } from '../../lib/accountScope';
import { FLOW_COPY } from '../../lib/flowCopy';
import { FOCUS_FLOW_ITEMS, flowSeenKey } from '../../lib/focusFlowCatalog';
import { useLowEnergyStore } from '../../store/lowEnergyStore';

type JsonNode = TestRenderer.ReactTestRendererJSON;

function collectText(tree: TestRenderer.ReactTestRenderer): string {
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
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function countMountedFlowPages(tree: TestRenderer.ReactTestRenderer): number {
  const innerType =
    (FocusFlowPage as unknown as { type?: React.ComponentType<unknown> }).type ??
    FocusFlowPage;
  return tree.root.findAllByType(innerType).length;
}

function pagerScrollView(tree: TestRenderer.ReactTestRenderer) {
  return tree.root
    .findAllByType(ScrollView)
    .find((sv) => sv.props.pagingEnabled === true)!;
}

async function scrollToPage(
  tree: TestRenderer.ReactTestRenderer,
  pageIndex: number,
  pageHeight = 640,
) {
  const sv = pagerScrollView(tree);
  await act(async () => {
    sv.props.onMomentumScrollEnd({
      nativeEvent: { contentOffset: { y: pageIndex * pageHeight } },
    });
  });
}

describe('FocusFlowView virtualization, blur discipline & daily cap (PRF-04, PRF-05, PS-17)', () => {
  const mounted: TestRenderer.ReactTestRenderer[] = [];

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 22, 14, 0, 0));
    mockFocused = true;
    mockSession.uid = 'u1';
    mockSpeechStop.mockClear();
    mockSpeechSpeak.mockClear();
    mockPush.mockClear();
    await AsyncStorage.clear();
    resetAccountMemory('signed_out');
    useLowEnergyStore.getState().set(false);
  });

  afterEach(async () => {
    while (mounted.length > 0) {
      const t = mounted.pop()!;
      await act(async () => {
        t.unmount();
      });
    }
    jest.useRealTimers();
  });

  async function renderFlow(props: React.ComponentProps<typeof FocusFlowView> = {}) {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<FocusFlowView {...props} />);
    });
    // Flush initial AsyncStorage hydration microtasks
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    mounted.push(tree);
    return tree;
  }

  it('(+) PRF-04: mounts only active page + neighbor (Image count <= 3) and slide auto-advance never re-renders FocusFlowView', async () => {
    expect(isInWindow(0, 0, 1)).toBe(true);
    expect(isInWindow(1, 0, 1)).toBe(true);
    expect(isInWindow(2, 0, 1)).toBe(false);

    let parentRenders = 0;
    function RenderCounter() {
      parentRenders += 1;
      return <FocusFlowView initialItemId="inflow-task-paralysis" />;
    }

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<RenderCounter />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    mounted.push(tree);

    expect(countMountedFlowPages(tree)).toBe(2);
    const imagesAtZero = tree.root.findAll((n) => (n.type as unknown) === 'Image');
    expect(imagesAtZero.length).toBeLessThanOrEqual(3);

    // Advance 10 seconds for kinetic slide auto-advance -> parent wrapper does NOT re-render,
    // and FocusFlowView itself does not re-render on slideIdx ticks (local state in FocusFlowPage).
    const beforeSlideText = collectText(tree);
    expect(beforeSlideText).toContain('1 / 4');

    const rendersBeforeAdvance = parentRenders;
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(parentRenders).toBe(rendersBeforeAdvance);
    const afterSlideText = collectText(tree);
    expect(afterSlideText).toContain('2 / 4');

    // Moving to index 1 mounts indices 0, 1, 2 (3 pages)
    await scrollToPage(tree, 1);
    expect(countMountedFlowPages(tree)).toBe(3);
  });

  it('(+) PS-17: dwelling >= 1200ms on 3 cards persists seen key, shows "3 / 3", and unlocks single-CTA "Bugünlük yeterli" closure page', async () => {
    const habitCards = FOCUS_FLOW_ITEMS.filter(
      (i) => i.cta.actionType === 'add_atomic_habit',
    );
    const tree = await renderFlow({ initialItemId: habitCards[0].id });

    expect(collectText(tree)).toContain('1 / 3');

    // Card 0: dwell 1200ms
    await act(async () => {
      jest.advanceTimersByTime(SEEN_DWELL_MS + 50);
      await Promise.resolve();
    });

    // Card 1: scroll & dwell 1200ms
    await scrollToPage(tree, 1);
    await act(async () => {
      jest.advanceTimersByTime(SEEN_DWELL_MS + 50);
      await Promise.resolve();
    });

    // Card 2: scroll & dwell 1200ms -> hits cap of 3
    await scrollToPage(tree, 2);
    await act(async () => {
      jest.advanceTimersByTime(SEEN_DWELL_MS + 50);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(collectText(tree)).toContain('3 / 3');
    const savedSeenRaw = await AsyncStorage.getItem(flowSeenKey('u1'));
    expect(savedSeenRaw).not.toBeNull();
    expect(JSON.parse(savedSeenRaw!).ids).toHaveLength(3);

    // Scroll to index 3 -> FlowClosurePage
    await scrollToPage(tree, 3);
    const closurePages = tree.root.findAllByType(FlowClosurePage);
    expect(closurePages).toHaveLength(1);
    const closureText = collectText(tree);
    expect(closureText).toContain(FLOW_COPY.flowDailyDoneTitle);
    expect(closureText).toContain(FLOW_COPY.flowDailyTry);
    // Counter stays "3 / 3" (closure entry is not counted as a 4th item)
    expect(closureText).toContain('3 / 3');
    expect(closureText).not.toContain('4 /');

    // Negative inside closure page: ONLY ONE action Button exists (no secondary button)
    const closureButtons = closurePages[0].findAllByType(Button);
    expect(closureButtons).toHaveLength(1);
  });

  it('(-) ignores < 1200ms quick swipes, leaves "Kaydedilenler" uncapped, resets at midnight, isolates accounts, and stops Speech on blur', async () => {
    // Seed 4 saved items to prove "Kaydedilenler" never caps
    const fourIds = FOCUS_FLOW_ITEMS.slice(0, 4).map((i) => i.id);
    await AsyncStorage.setItem(
      'aderyth:focus_flow_saved_v1',
      JSON.stringify(fourIds),
    );

    const tree = await renderFlow();

    // Quick swipe (< 1200ms) on card 0 does NOT mark seen
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    await scrollToPage(tree, 1);
    expect(await AsyncStorage.getItem(flowSeenKey('u1'))).toBeNull();

    // Switch to "Kaydedilenler" -> shows "1 / 4" and never produces FlowClosurePage
    const savedChip = tree.root
      .findAllByType(TouchableOpacity)
      .find((b) =>
        String(b.props.accessibilityLabel ?? '').includes('Kaydedilenler'),
      )!;
    await act(async () => {
      savedChip.props.onPress();
    });
    expect(collectText(tree)).toContain('1 / 4');
    expect(tree.root.findAllByType(FlowClosurePage)).toHaveLength(0);

    // Switch back to "Sizin İçin" and exhaust 3 cards for u1
    const forYouChip = tree.root
      .findAllByType(TouchableOpacity)
      .find((b) =>
        String(b.props.accessibilityLabel ?? '').includes('Sizin İçin'),
      )!;
    await act(async () => {
      forYouChip.props.onPress();
    });

    for (const idx of [0, 1, 2]) {
      if (idx > 0) await scrollToPage(tree, idx);
      await act(async () => {
        jest.advanceTimersByTime(SEEN_DWELL_MS + 50);
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    await scrollToPage(tree, 3);
    expect(tree.root.findAllByType(FlowClosurePage)).toHaveLength(1);

    // Blur screen -> Speech.stop called
    mockSpeechStop.mockClear();
    mockFocused = false;
    await act(async () => {
      tree.update(<FocusFlowView />);
    });
    expect(mockSpeechStop).toHaveBeenCalled();
    mockFocused = true;

    // Second account (u2) does NOT see u1's exhausted cap
    mockSession.uid = 'u2';
    await act(async () => {
      resetAccountMemory('user_changed');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(tree.root.findAllByType(FlowClosurePage)).toHaveLength(0);
    expect(await AsyncStorage.getItem(flowSeenKey('u2'))).toBeNull();

    // Back to u1 on NEXT calendar day -> daily cap resets
    mockSession.uid = 'u1';
    jest.setSystemTime(new Date(2026, 10, 23, 9, 0, 0));
    await act(async () => {
      resetAccountMemory('user_changed');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(tree.root.findAllByType(FlowClosurePage)).toHaveLength(0);
  });
});
