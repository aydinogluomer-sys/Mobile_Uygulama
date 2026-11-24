import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import type { Habit, WillpowerState } from '../../lib/supabase';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockHabits: Habit[] = [
  {
    id: 'existing-1',
    user_id: 'u1',
    name: 'Kitap Oku',
    icon: 'book-outline',
    color: '#6366f1',
    behavior_type: 'positive',
    tracking_type: 'boolean',
    unit: null,
    daily_goal: null,
    target_direction: null,
    frequency_config: { kind: 'daily' },
    willpower_cost: 3,
    status: 'active',
    impact_level: 'medium',
    urgency: 'not_urgent',
    difficulty: 3,
    estimated_minutes: 20,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: null,
    end_condition: null,
    created_at: '2026-10-01T08:00:00.000Z',
  },
];

jest.mock('../../store/habitStore', () => ({
  useHabitStore: <T,>(selector: (state: { habits: Habit[]; loading: boolean }) => T): T =>
    selector({ habits: mockHabits, loading: false }),
}));

jest.mock('../../store/willpowerStore', () => ({
  useWillpowerStore: <T,>(
    selector: (state: {
      canActivate: () => boolean;
      score: () => number | null;
    }) => T,
  ): T =>
    selector({
      canActivate: () => true,
      score: () => 80,
    }),
}));

import HabitOnboarding from '../../components/HabitOnboarding';

export type StepCharacterization = {
  step: number;
  texts: string[];
  accessibilityLabels: string[];
  accessibilityRoles: string[];
  pressableCount: number;
};

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'habitOnboardingSteps.json');

const WILLPOWER_FIXTURE: WillpowerState = {
  user_id: 'u1',
  state_date: '2026-10-08',
  daily_budget: 15,
  used: 3,
  focus_capacity: 3,
  active_count: 1,
};

function flattenTextChildren(children: unknown): string {
  if (children == null || typeof children === 'boolean') return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(flattenTextChildren).join('');
  return '';
}

function captureStep(renderer: TestRenderer.ReactTestRenderer, step: number): StepCharacterization {
  const texts = renderer.root
    .findAllByType(Text)
    .map((node) => flattenTextChildren(node.props.children).trim())
    .filter((t) => t.length > 0);

  const accessibilityLabels: string[] = [];
  const accessibilityRoles: string[] = [];
  let pressableCount = 0;

  const allNodes = renderer.root.findAll((node) => typeof node.type === 'string');
  for (const node of allNodes) {
    if (typeof node.props?.accessibilityLabel === 'string' && node.props.accessibilityLabel.length > 0) {
      accessibilityLabels.push(node.props.accessibilityLabel);
    }
    if (typeof node.props?.accessibilityRole === 'string' && node.props.accessibilityRole.length > 0) {
      accessibilityRoles.push(node.props.accessibilityRole);
    }
  }

  pressableCount = renderer.root.findAllByType(TouchableOpacity).length;

  return {
    step,
    texts,
    accessibilityLabels,
    accessibilityRoles,
    pressableCount,
  };
}

export function compareHabitOnboardingSteps(
  actual: readonly StepCharacterization[],
  expected: readonly StepCharacterization[],
): string[] {
  const problems: string[] = [];
  if (expected.length === 0) {
    problems.push('fixture is empty');
    return problems;
  }
  if (actual.length !== expected.length) {
    problems.push(`step count mismatch: actual=${actual.length} expected=${expected.length}`);
    return problems;
  }
  for (let i = 0; i < actual.length; i += 1) {
    const a = actual[i];
    const e = expected[i];
    if (a.step !== e.step) problems.push(`step[${i}].step: actual=${a.step} expected=${e.step}`);
    if (JSON.stringify(a.texts) !== JSON.stringify(e.texts)) {
      problems.push(`step ${a.step} texts differ`);
    }
    if (JSON.stringify(a.accessibilityLabels) !== JSON.stringify(e.accessibilityLabels)) {
      problems.push(`step ${a.step} accessibilityLabels differ`);
    }
    if (JSON.stringify(a.accessibilityRoles) !== JSON.stringify(e.accessibilityRoles)) {
      problems.push(`step ${a.step} accessibilityRoles differ`);
    }
    if (a.pressableCount !== e.pressableCount) {
      problems.push(`step ${a.step} pressableCount: actual=${a.pressableCount} expected=${e.pressableCount}`);
    }
  }
  return problems;
}

describe('HabitOnboarding 7-step characterization', () => {
  jest.setTimeout(30_000);
  const mounted: TestRenderer.ReactTestRenderer[] = [];

  afterEach(async () => {
    await act(async () => {
      while (mounted.length > 0) {
        mounted.pop()!.unmount();
      }
    });
  });

  async function collectAllSevenSteps(): Promise<StepCharacterization[]> {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <HabitOnboarding
          visible={true}
          onClose={jest.fn()}
          onSubmit={jest.fn()}
          willpowerState={WILLPOWER_FIXTURE}
        />,
      );
    });
    mounted.push(renderer);

    const nameInput = renderer.root
      .findAllByType(TextInput)
      .find((input) => input.props.placeholder === 'Örn: Sabah Sporu')!;
    await act(async () => {
      nameInput.props.onChangeText('Sabah Sporu');
    });

    const steps: StepCharacterization[] = [];
    for (let s = 1; s <= 7; s += 1) {
      steps.push(captureStep(renderer, s));
      if (s < 7) {
        const nextBtn = renderer.root
          .findAllByType(TouchableOpacity)
          .find((btn) =>
            btn
              .findAllByType(Text)
              .some((t) => flattenTextChildren(t.props.children).trim() === 'Devam'),
          );
        if (!nextBtn) {
          throw new Error(`Devam button not found on step ${s}`);
        }
        await act(async () => {
          nextBtn.props.onPress();
        });
      }
    }
    return steps;
  }

  it('captures 7 steps, >= 40 visible texts, and matches habitOnboardingSteps.json verbatim', async () => {
    const actual = await collectAllSevenSteps();
    expect(actual).toHaveLength(7);
    const totalTexts = actual.reduce((sum, st) => sum + st.texts.length, 0);
    expect(totalTexts).toBeGreaterThanOrEqual(40);

    if (process.env.UPDATE_FIXTURE === '1') {
      writeFileSync(FIXTURE_PATH, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
    }

    const expected = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as StepCharacterization[];
    expect(compareHabitOnboardingSteps(actual, expected)).toEqual([]);
    expect(actual).toEqual(expected);
  });

  it('negative control: fails loudly when the fixture is empty, missing a step, or drifted in text', async () => {
    const actual = await collectAllSevenSteps();
    expect(compareHabitOnboardingSteps(actual, [])).toEqual(['fixture is empty']);
    expect(compareHabitOnboardingSteps(actual, actual.slice(0, 6))).toEqual([
      'step count mismatch: actual=7 expected=6',
    ]);
    const drifted = actual.map((s, idx) =>
      idx === 1 ? { ...s, texts: [...s.texts, 'hayalet satır'] } : s,
    );
    expect(compareHabitOnboardingSteps(actual, drifted)).toEqual(['step 2 texts differ']);
  });
});
