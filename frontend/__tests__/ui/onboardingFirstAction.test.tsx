/**
 * Phase F3 (U02, P03, LEAF-01) — Onboarding Immediate First Action UI tests.
 *
 * Verifies:
 *  1. Fresh/empty onboarding renders `onboarding-quick-start-card`, previews a concrete
 *     starter quick step, starts a real 5-minute `focusStore` small step with deterministic
 *     `suggestionId`, and navigates to `/tabs/focus` without mutating DB habits or requesting
 *     notification permissions (`LEAF-01`, `P03`, `U02`).
 *  2. Toggling `onboarding-add-own-task-toggle`, entering a task, and pressing
 *     `onboarding-start-own-step` derives a 5-minute micro-step via `deriveSplitSteps`,
 *     starts it in `focusStore` without marking any task completed, and preserves
 *     `onboardingStore` state if the user returns later (`U02`, `LEAF-01`).
 *  3. `partial` and `awaiting_completion` recovery states still render their recovery
 *     screens cleanly without offering duplicate plan installation or quick-start bypasses.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { createMockDb, makeSupabaseMock, type MockDb } from '../helpers/supabaseMock';

jest.setTimeout(30_000);

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

const mockDb: MockDb = createMockDb();
const mockClient = makeSupabaseMock(mockDb);

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'u-onb-1' }, access_token: 'tok' } },
        error: null,
      }),
    },
    from: (table: string) => mockClient.from(table),
  },
}));

const mockEnsurePermission = jest.fn(async () => true);

jest.mock('../../lib/notifications', () => ({
  ensurePermission: () => mockEnsurePermission(),
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
  syncAllReminders: jest.fn(),
  scheduleFocusEnd: jest.fn(async () => false),
  cancelFocusEnd: jest.fn(async () => undefined),
}));

import OnboardingPlanScreen from '../../app/onboarding/plan';
import { deterministicSuggestionId } from '../../lib/actionSuggestion';
import { todayLocal } from '../../lib/date';
import { EMPTY_ANSWERS } from '../../lib/onboarding';
import { pickStarterQuickStep } from '../../lib/routinePacks';
import { deriveSplitSteps } from '../../lib/taskDecomposition';
import { useFocusStore } from '../../store/focusStore';
import { useHabitStore } from '../../store/habitStore';
import { useOnboardingStore } from '../../store/onboardingStore';
import { act, fireEvent, renderWithProviders } from '../helpers/renderWithProviders';

async function resetAll() {
  for (const key of Object.keys(mockDb.rows)) delete mockDb.rows[key];
  mockDb.inserts.length = 0;
  mockDb.idSeq = 0;
  mockDb.failNext = null;
  mockPush.mockClear();
  mockReplace.mockClear();
  mockEnsurePermission.mockClear();
  await AsyncStorage.clear();
  useHabitStore.setState({ habits: [] });
  useFocusStore.getState().reset();
  useOnboardingStore.getState().resetForAccount();
  useOnboardingStore.setState({
    hydrationState: 'ready',
    status: 'pending',
    ownerId: 'u-onb-1',
    answers: EMPTY_ANSWERS,
  });
}

beforeEach(async () => {
  await resetAll();
});

describe('OnboardingPlanScreen — immediate first action (U02, P03, LEAF-01)', () => {
  it('(+) fresh onboarding state starts a 5-min starter sample focus step with deterministic suggestionId without mutating DB habits or requesting notification permission', async () => {
    const r = renderWithProviders(<OnboardingPlanScreen />);

    const card = r.getByTestId('onboarding-quick-start-card');
    expect(card).toBeTruthy();

    const expectedQuick = pickStarterQuickStep('morning-reset');
    const preview = r.getByTestId('onboarding-sample-step-preview');
    expect(preview.props.children).toBe(
      `${expectedQuick.firstStepTitle} · ${expectedQuick.estimatedMinutes} dk`,
    );

    const deferredNote = r.getByTestId('onboarding-deferred-permission-note');
    expect(typeof deferredNote.props.children).toBe('string');
    expect((deferredNote.props.children as string).length).toBeGreaterThan(20);

    // Local plan preview exists in memory, nothing written to DB yet
    expect(useOnboardingStore.getState().plan).not.toBeNull();
    expect(mockDb.inserts).toEqual([]);
    expect(useHabitStore.getState().habits).toEqual([]);
    expect(mockEnsurePermission).not.toHaveBeenCalled();

    const sampleBtn = r.getByTestId('onboarding-try-sample-step');
    await act(async () => {
      fireEvent.press(sampleBtn);
    });

    const focus = useFocusStore.getState();
    const expectedSuggestionId = deterministicSuggestionId({
      userId: 'u-onb-1',
      localDayKey: todayLocal(),
      kind: 'start_small',
      sourceEntity: 'starter_pack',
      sourceId: expectedQuick.packKey,
      stepTitle: expectedQuick.firstStepTitle,
    });

    expect(focus.status).toBe('running');
    expect(focus.phase).toBe('work');
    expect(focus.secondsLeft).toBe(300);
    expect(focus.smallStep).toEqual({
      title: expectedQuick.firstStepTitle,
      minutes: 5,
      parent: {
        kind: 'task',
        id: `starter:${expectedQuick.packKey}`,
        title: expectedQuick.habitName,
      },
      suggestionId: expectedSuggestionId,
    });
    expect(focus.smallStep?.suggestionId).toMatch(/^sug_v1_start_small_[0-9a-f]{16}$/);

    // Navigates via push so onboarding remains recoverable when returning
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/tabs/focus');
    expect(mockReplace).not.toHaveBeenCalled();

    // LEAF-01 + U02: zero DB mutations and zero notification permission prompts
    expect(mockDb.inserts).toEqual([]);
    expect(useHabitStore.getState().habits).toEqual([]);
    expect(mockEnsurePermission).not.toHaveBeenCalled();
    expect(useOnboardingStore.getState().status).toBe('pending');
    expect(useOnboardingStore.getState().plan).not.toBeNull();

    r.unmount();
  });

  it('(+) matches user goal selection when picking the starter sample step', () => {
    useOnboardingStore.setState({
      answers: {
        ...EMPTY_ANSWERS,
        goals: ['focus_productivity'],
        pace: 'gentle',
      },
    });

    const r = renderWithProviders(<OnboardingPlanScreen />);
    const expectedFocusQuick = pickStarterQuickStep('deep-work');
    const preview = r.getByTestId('onboarding-sample-step-preview');
    expect(preview.props.children).toBe(
      `${expectedFocusQuick.firstStepTitle} · ${expectedFocusQuick.estimatedMinutes} dk`,
    );

    r.unmount();
  });

  it('(+) inline own-task capture derives a 5-min micro-step, starts focus without completing any task, and preserves onboarding state', async () => {
    useOnboardingStore.setState({
      answers: {
        ...EMPTY_ANSWERS,
        goals: ['sleep'],
        pace: 'balanced',
      },
    });

    const r = renderWithProviders(<OnboardingPlanScreen />);
    const initialPlanCount = useOnboardingStore.getState().plan?.habits.length ?? 0;
    expect(initialPlanCount).toBeGreaterThan(0);

    // Input hidden until toggle is pressed
    expect(r.queryByTestId('onboarding-own-task-input')).toBeNull();

    await act(async () => {
      fireEvent.press(r.getByTestId('onboarding-add-own-task-toggle'));
    });

    const input = r.getByTestId('onboarding-own-task-input');
    const startOwnBtn = r.getByTestId('onboarding-start-own-step');
    expect(input.props.maxLength).toBe(120);
    expect(startOwnBtn.props.accessibilityState?.disabled).toBe(true);

    // Blank press is refused
    await act(async () => {
      fireEvent.press(startOwnBtn);
    });
    expect(useFocusStore.getState().status).toBe('idle');
    expect(mockPush).not.toHaveBeenCalled();

    const typedTask = 'Teklifi hazirla';
    const expectedDerivedStep = `${deriveSplitSteps(typedTask)[0]} — ${typedTask}`;

    await act(async () => {
      fireEvent.changeText(input, `  ${typedTask}  `);
    });

    const ownPreview = r.getByTestId('onboarding-own-step-preview');
    expect(ownPreview.props.children).toBe(`${expectedDerivedStep} · 5 dk`);
    expect(r.getByTestId('onboarding-start-own-step').props.accessibilityState?.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(r.getByTestId('onboarding-start-own-step'));
    });

    const expectedSuggestionId = deterministicSuggestionId({
      userId: 'u-onb-1',
      localDayKey: todayLocal(),
      kind: 'start_small',
      sourceEntity: 'draft',
      sourceId: 'onboarding-draft',
      stepTitle: expectedDerivedStep,
    });

    const focus = useFocusStore.getState();
    expect(focus.status).toBe('running');
    expect(focus.secondsLeft).toBe(300);
    expect(focus.smallStep).toEqual({
      title: expectedDerivedStep,
      minutes: 5,
      parent: {
        kind: 'task',
        id: 'onboarding-draft',
        title: typedTask,
      },
      suggestionId: expectedSuggestionId,
    });
    expect(focus.focusTasks).toEqual([]);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/tabs/focus');
    expect(mockReplace).not.toHaveBeenCalled();

    // Onboarding state remains untouched for later return, zero DB writes or permission prompts
    expect(mockDb.inserts).toEqual([]);
    expect(mockEnsurePermission).not.toHaveBeenCalled();
    expect(useOnboardingStore.getState().status).toBe('pending');
    expect(useOnboardingStore.getState().answers.goals).toEqual(['sleep']);
    expect(useOnboardingStore.getState().plan?.habits).toHaveLength(initialPlanCount);

    r.unmount();
  });

  it('(-) partial and awaiting_completion recovery states render recovery views cleanly without quick-start card or duplicate plan installation', async () => {
    // 1. partial recovery state
    useOnboardingStore.setState({
      status: 'installing',
      installPhase: 'partial',
      installedHabitCount: 1,
      installExpectedHabits: 3,
      plan: null,
    });

    const partialView = renderWithProviders(<OnboardingPlanScreen />);
    expect(partialView.queryByTestId('onboarding-quick-start-card')).toBeNull();
    expect(partialView.queryByTestId('onboarding-try-sample-step')).toBeNull();
    // Must not regenerate an installable plan while in partial recovery
    expect(useOnboardingStore.getState().plan).toBeNull();
    partialView.unmount();

    // 2. awaiting_completion recovery state
    useOnboardingStore.setState({
      status: 'installing',
      installPhase: 'awaiting_completion',
      installedHabitCount: 2,
      installExpectedHabits: 2,
      plan: null,
    });

    const awaitingView = renderWithProviders(<OnboardingPlanScreen />);
    expect(awaitingView.queryByTestId('onboarding-quick-start-card')).toBeNull();
    expect(useOnboardingStore.getState().plan).toBeNull();

    // Pressing the single recovery button writes only completion, zero habit inserts
    const buttons = awaitingView.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    await act(async () => {
      fireEvent.press(buttons[0]);
    });

    const habitInserts = mockDb.inserts.filter((i) => i.table === 'habits');
    expect(habitInserts).toEqual([]);
    expect(useOnboardingStore.getState().status).toBe('completed');
    expect(mockReplace).toHaveBeenCalledWith('/tabs/today');

    awaitingView.unmount();
  });
});
