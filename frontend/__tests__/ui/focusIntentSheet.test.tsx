import React from 'react';
import { Animated, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u1', email: 'u1@example.com' })),
}));
jest.mock('../../services/focusService', () => ({
  sessionsSince: jest.fn(async () => ({ ok: true, data: [] })),
  allSessions: jest.fn(async () => ({ ok: true, data: [] })),
  allTasks: jest.fn(async () => ({ ok: true, data: [] })),
  clearAllSessions: jest.fn(async () => ({ ok: true })),
}));

let mockReduceMotion = false;
jest.mock('../../components/seasonalMotion/useReducedMotion', () => ({
  useReducedMotion: () => mockReduceMotion,
}));

import FocusIntentSheet from '../../components/focus/FocusIntentSheet';
import FocusSessionCompleteModal from '../../components/focus/FocusSessionCompleteModal';
import FocusSettingsModal from '../../components/focus/FocusSettingsModal';
import InterruptionPrompt from '../../components/focus/InterruptionPrompt';
import { FLOW_COPY } from '../../lib/flowCopy';
import {
  AWAY_PROMPT_AUTO_DISMISS_MS,
  INTENT_MAX_LENGTH,
  acknowledgementFor,
  interruptionSummary,
} from '../../lib/focusRitual';
import { DEFAULT_SETTINGS } from '../../store/focusStore';

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
  return out.join(' ');
}

function findButton(tree: TestRenderer.ReactTestRenderer, label: string) {
  return tree.root
    .findAllByType(TouchableOpacity)
    .find((b) => b.props.accessibilityLabel === label);
}

describe('FocusIntentSheet, InterruptionPrompt, CompleteModal & Settings (PS-11, PS-15)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReduceMotion = false;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('(+) submits normalized text, submits null when blank, handles Atla & Bir daha sorma, fills from initialText chip without auto-filling, and respects Reduce Motion & maxLength=80', () => {
    mockReduceMotion = true;
    const loopSpy = jest.spyOn(Animated, 'loop');
    const onSubmit = jest.fn();
    const onSkip = jest.fn();
    const onDisable = jest.fn();

    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <FocusIntentSheet
          visible
          initialText="Önceki niyet"
          accent="#D97757"
          onSubmit={onSubmit}
          onSkip={onSkip}
          onDisable={onDisable}
        />,
      );
    });

    // Reduce Motion: breath copy is shown and Animated.loop is never called
    expect(collectText(tree)).toContain(FLOW_COPY.intentBreath);
    expect(loopSpy).not.toHaveBeenCalled();

    // Negative: initialText does NOT auto-fill the TextInput; buttons are immediately enabled
    const input = tree.root.findByType(TextInput);
    expect(input.props.value).toBe('');
    expect(input.props.maxLength).toBe(INTENT_MAX_LENGTH);

    const startBtn = findButton(tree, 'Başla')!;
    const skipBtn = findButton(tree, 'Atla')!;
    const disableBtn = findButton(tree, 'Bir daha sorma')!;
    expect(startBtn.props.disabled).toBeFalsy();
    expect(skipBtn.props.disabled).toBeFalsy();
    expect(disableBtn.props.disabled).toBeFalsy();

    // Blank "Başla" -> onSubmit(null)
    act(() => {
      startBtn.props.onPress();
    });
    expect(onSubmit).toHaveBeenLastCalledWith(null);

    // Tap "Geçen sefer" suggestion chip -> fills input -> "Başla" submits it
    const chipBtn = tree.root
      .findAllByType(TouchableOpacity)
      .find((b) =>
        String(b.props.accessibilityLabel ?? '').includes('Önceki niyet'),
      )!;
    act(() => {
      chipBtn.props.onPress();
    });
    expect(tree.root.findByType(TextInput).props.value).toBe('Önceki niyet');
    act(() => {
      findButton(tree, 'Başla')!.props.onPress();
    });
    expect(onSubmit).toHaveBeenLastCalledWith('Önceki niyet');

    // Custom typed text -> normalized submit
    act(() => {
      tree.root.findByType(TextInput).props.onChangeText('  Yeni   taslak  ');
    });
    act(() => {
      findButton(tree, 'Başla')!.props.onPress();
    });
    expect(onSubmit).toHaveBeenLastCalledWith('Yeni taslak');

    // "Atla" and "Bir daha sorma"
    act(() => {
      skipBtn.props.onPress();
      disableBtn.props.onPress();
    });
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onDisable).toHaveBeenCalledTimes(1);

    act(() => {
      tree.unmount();
    });
    loopSpy.mockRestore();
  });

  it('(+) InterruptionPrompt handles choices and (-) auto-dismisses at 12s unless answered earlier', () => {
    const onChoose = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;

    act(() => {
      tree = TestRenderer.create(
        <InterruptionPrompt visible={false} accent="#D97757" onChoose={onChoose} />,
      );
    });
    expect(tree.toJSON()).toBeNull();

    act(() => {
      tree.update(
        <InterruptionPrompt visible accent="#D97757" onChoose={onChoose} />,
      );
    });
    expect(collectText(tree)).toContain(FLOW_COPY.interruptionAsk);

    // Choose "Kendim kaçtım" -> calls onChoose('self') and cancels 12s timer
    act(() => {
      findButton(tree, FLOW_COPY.interruptionSelf)!.props.onPress();
    });
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith('self');

    act(() => {
      jest.advanceTimersByTime(AWAY_PROMPT_AUTO_DISMISS_MS + 1000);
    });
    expect(onChoose).toHaveBeenCalledTimes(1);

    // Choose "Geç" -> onChoose(null)
    onChoose.mockClear();
    act(() => {
      findButton(tree, FLOW_COPY.interruptionSkip)!.props.onPress();
    });
    expect(onChoose).toHaveBeenCalledWith(null);

    // Re-open and wait full 12s without answering -> auto-dismisses with null
    onChoose.mockClear();
    act(() => {
      tree.update(
        <InterruptionPrompt visible={false} accent="#D97757" onChoose={onChoose} />,
      );
    });
    act(() => {
      tree.update(
        <InterruptionPrompt visible accent="#D97757" onChoose={onChoose} />,
      );
    });
    act(() => {
      jest.advanceTimersByTime(AWAY_PROMPT_AUTO_DISMISS_MS - 100);
    });
    expect(onChoose).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(null);

    act(() => {
      tree.unmount();
    });
  });

  it('(+) renders recall & away count in FocusSessionCompleteModal and intentPrompt toggle in FocusSettingsModal', async () => {
    let modal!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      modal = TestRenderer.create(
        <FocusSessionCompleteModal
          visible
          session={{
            taskTitle: 'Sunum',
            seconds: 1500,
            sessionNumber: 1,
            intent: '3 slaytı tamamla',
            interruptions: 2,
          }}
          accent="#D97757"
          onClose={jest.fn()}
          onOpenReport={jest.fn()}
        />,
      );
    });

    const initialModalText = collectText(modal);
    expect(initialModalText).toContain(FLOW_COPY.intentRecallTitle);
    expect(initialModalText).toContain('3 slaytı tamamla');
    expect(initialModalText).toContain(interruptionSummary(2)!);

    act(() => {
      findButton(modal, FLOW_COPY.intentAnswerNo)!.props.onPress();
    });
    expect(collectText(modal)).toContain(acknowledgementFor('no'));

    // Negative: session with null intent and 0 interruptions hides both blocks
    await act(async () => {
      modal.update(
        <FocusSessionCompleteModal
          visible
          session={{
            taskTitle: 'Sunum',
            seconds: 1500,
            sessionNumber: 2,
            intent: null,
            interruptions: 0,
          }}
          accent="#D97757"
          onClose={jest.fn()}
          onOpenReport={jest.fn()}
        />,
      );
    });
    const cleanText = collectText(modal);
    expect(cleanText).not.toContain(FLOW_COPY.intentRecallTitle);
    expect(cleanText).not.toContain('ayrıldın ve döndün');

    await act(async () => {
      modal.unmount();
    });

    // Settings modal: Zamanlayıcı tab exposes "Başlamadan önce niyet sor"
    const onSave = jest.fn();
    let settingsTree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      settingsTree = TestRenderer.create(
        <FocusSettingsModal
          visible
          onClose={jest.fn()}
          settings={DEFAULT_SETTINGS}
          accent="#D97757"
          onSave={onSave}
          onOpenTheme={jest.fn()}
        />,
      );
    });

    act(() => {
      findButton(settingsTree, 'Zamanlayıcı')!.props.onPress();
    });
    const intentToggle = findButton(settingsTree, 'Başlamadan önce niyet sor')!;
    expect(intentToggle.props.accessibilityRole).toBe('switch');
    expect(intentToggle.props.accessibilityState).toEqual({ checked: true });

    act(() => {
      intentToggle.props.onPress();
    });
    expect(onSave).toHaveBeenCalledWith({ intentPrompt: false });

    await act(async () => {
      settingsTree.unmount();
    });
  });
});
