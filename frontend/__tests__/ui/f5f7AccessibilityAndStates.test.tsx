/**
 * Phases F5 & F7 — U08, U09, U11, E18, U12 verification suite:
 * 1. U09 (`screenStateContract`): loading / auth_waiting vs empty separation,
 *    pending (`claimsServerSaved === false`) vs committed, and draft retention
 *    across conflict / retryable / recoverable / permanent failures.
 * 2. U11 (`MeasurableInputModal`): Turkish comma decimal parsing (`"1,5"` -> `1.5`),
 *    concrete type + weekly_count period hint (`measurable-type-hint`), pre-save
 *    impact preview (`measurable-presave-impact`), and non-mutation of habit config.
 * 3. U12 (`CalendarScreen`): accessible `calendar-change-time-<id>` trigger,
 *    `calendar-time-adjust-panel` with live overlap preview via `buildDayPlanPreview`,
 *    commit via `commitDayPlan` (`action: 'update_time_block'`), and receipt Undo
 *    via `calendar-time-undo` (`undoDayPlanCommit`).
 * 4. U08 & E18: non-color icons + semantic roles across all 9 screen states,
 *    reduced-motion gating on `CalendarScreen`, and `DESTINATIONS` route +
 *    `legacyRoutes` resolution uniqueness (`lib/destinations.ts`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { Animated } from 'react-native';

jest.setTimeout(30_000);

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-router/react-navigation', () => ({
  useHeaderHeight: () => 0,
}));
jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));

const mockCurrentUser = jest.fn<
  Promise<{ id: string; email: string | null; createdAt?: string | null } | null>,
  []
>(async () => ({ id: 'u-cal', email: null, createdAt: null }));

jest.mock('../../lib/session', () => ({
  currentUser: () => mockCurrentUser(),
}));

jest.mock('../../services/habitService', () => ({
  listHabits: jest.fn(async () => ({ ok: true, data: [] })),
  loadTimeOff: jest.fn(async () => ({
    ok: true,
    data: { available: true, pauses: [], versions: [] },
  })),
  loadChecklists: jest.fn(async () => ({
    ok: true,
    data: { available: false, items: [], checks: [] },
  })),
}));

const mockDeliverTaskCommand = jest.fn(async () => ({
  kind: 'applied' as const,
  version: '2026-11-24T10:05:00.000Z',
}));

jest.mock('../../services/taskService', () => ({
  listTasks: jest.fn(async () => ({
    ok: true,
    data: {
      rows: (globalThis as Record<string, unknown>).__f5f7Tasks ?? [],
      nextCursor: null,
      hasMore: false,
    },
  })),
  completionPatch: jest.fn(),
  newTaskRow: jest.fn(),
  deliverTaskCommand: (...args: unknown[]) => mockDeliverTaskCommand(...(args as [])),
}));

import CalendarScreen from '../../app/screens/calendar';
import MeasurableInputModal from '../../components/MeasurableInputModal';
import { resetAccountMemory } from '../../lib/accountScope';
import { ymd } from '../../lib/date';
import * as dayPlanPreviewModule from '../../lib/dayPlanPreview';
import {
  DESTINATIONS,
  destinationById,
  destinationForLegacyRoute,
  hrefFor,
  routeKeyOf,
} from '../../lib/destinations';
import {
  preserveDraftOnFailure,
  resolveScreenState,
  type ScreenStateKind,
} from '../../lib/screenStateContract';
import type { Habit } from '../../lib/supabase';
import type { Task } from '../../lib/taskTypes';
import * as dayPlanCommitService from '../../services/dayPlanCommitService';
import { invalidateHabitsFetch, useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useTaskStore } from '../../store/taskStore';
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  type RenderedScreen,
} from '../helpers/renderWithProviders';

const FRONTEND_ROOT = join(__dirname, '..', '..');

function walkAppRouteFiles(relDir: string): string[] {
  const abs = join(FRONTEND_ROOT, relDir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    if (entry.startsWith('.')) continue;
    const childRel = `${relDir}/${entry}`;
    const childAbs = join(FRONTEND_ROOT, childRel);
    if (statSync(childAbs).isDirectory()) {
      out.push(...walkAppRouteFiles(childRel));
    } else if (/\.(?:ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(childRel);
    }
  }
  return out;
}

function appRouteFileExistsForPathname(pathname: string, appFiles: readonly string[]): boolean {
  const clean = pathname.split('?')[0]?.replace(/^\//, '') ?? '';
  if (!clean) return false;
  return appFiles.some((rel) => {
    const withoutApp = rel.replace(/^app\//, '').replace(/\.(?:ts|tsx)$/, '');
    const strippedGroups = withoutApp
      .split('/')
      .filter((seg) => !/^\([^)]+\)$/.test(seg))
      .join('/');
    return (
      withoutApp === clean ||
      withoutApp === `${clean}/index` ||
      strippedGroups === clean ||
      strippedGroups === `${clean}/index`
    );
  });
}

function makeMeasurableHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h-water-weekly',
    user_id: 'u-cal',
    name: 'Water Intake',
    icon: 'water-outline',
    color: null,
    behavior_type: 'positive',
    tracking_type: 'numeric',
    unit: 'L',
    daily_goal: 2.5,
    target_direction: 'at_least',
    frequency_config: { kind: 'weekly', count: 3 },
    willpower_cost: 2,
    status: 'active',
    impact_level: 'medium',
    urgency: 'not_urgent',
    difficulty: 2,
    estimated_minutes: 5,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: null,
    end_condition: null,
    created_at: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

function makeCalendarTask(id: string, dueDay: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    user_id: 'u-cal',
    title: `Task ${id}`,
    priority: 'medium',
    status: 'pending',
    list_type: 'inbox',
    due_date: dueDay,
    time_block_start: null,
    time_block_end: null,
    completed: false,
    created_at: '2026-11-24T08:00:00.000Z',
    updated_at: '2026-11-24T08:00:00.000Z',
    ...overrides,
  };
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) {
      await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Phases F5 & F7 — Accessibility, Screen States, Measurable Clarity & Calendar Time Blocks', () => {
  const mounted: RenderedScreen[] = [];

  const track = (r: RenderedScreen): RenderedScreen => {
    mounted.push(r);
    return r;
  };

  beforeEach(async () => {
    jest.restoreAllMocks();
    resetAccountMemory('signed_out');
    await AsyncStorage.clear();
    invalidateHabitsFetch();
    mockCurrentUser.mockResolvedValue({ id: 'u-cal', email: null, createdAt: null });
    mockDeliverTaskCommand.mockResolvedValue({
      kind: 'applied',
      version: '2026-11-24T10:05:00.000Z',
    });
    (globalThis as Record<string, unknown>).__f5f7Tasks = [];
    useTaskStore.setState({
      tasks: [],
      outbox: null,
      cursor: null,
      hasMore: false,
      loading: false,
      error: null,
    });
    useHabitStore.setState({
      habits: [],
      pauses: [],
      goalVersions: [],
      timeOffAvailable: null,
      checklistItems: [],
      checklistChecks: [],
      checklistAvailable: null,
    } as never);
    useLogStore.setState({
      logs: [],
      pendingSyncCount: 0,
      deadSyncCount: 0,
      fetchLogsForDate: jest.fn(async () => undefined),
    } as never);
  });

  afterEach(async () => {
    while (mounted.length > 0) {
      const r = mounted.pop()!;
      await act(async () => {
        r.unmount();
      });
    }
  });

  describe('U09 — Unified Screen & Form State Contract (screenStateContract)', () => {
    it('separates auth_waiting, loading, and network errors from empty state', () => {
      const authWaiting = resolveScreenState({
        authReady: false,
        loading: false,
        hasCachedData: false,
        itemCount: 0,
      });
      expect(authWaiting.kind).toBe('loading');
      expect(authWaiting.kind).not.toBe('empty');
      expect(authWaiting.claimsServerSaved).toBe(false);

      const initialFetch = resolveScreenState({
        authReady: true,
        loading: true,
        hasCachedData: false,
        itemCount: 0,
      });
      expect(initialFetch.kind).toBe('loading');
      expect(initialFetch.kind).not.toBe('empty');

      const networkFailureOnZeroItems = resolveScreenState({
        authReady: true,
        loading: false,
        hasCachedData: false,
        itemCount: 0,
        error: { retryable: true, message: 'Network request failed' },
      });
      expect(networkFailureOnZeroItems.kind).toBe('recoverable');
      expect(networkFailureOnZeroItems.kind).not.toBe('empty');

      const genuineEmpty = resolveScreenState({
        authReady: true,
        loading: false,
        hasCachedData: false,
        itemCount: 0,
      });
      expect(genuineEmpty.kind).toBe('empty');
    });

    it('separates pending outbox writes (claimsServerSaved: false) from committed, conflict, recoverable, and permanent', () => {
      const pending = resolveScreenState({
        authReady: true,
        loading: false,
        hasCachedData: true,
        itemCount: 2,
        syncStatus: 'pending',
      });
      expect(pending.kind).toBe('pending');
      expect(pending.claimsServerSaved).toBe(false);

      const committed = resolveScreenState({
        authReady: true,
        loading: false,
        hasCachedData: true,
        itemCount: 2,
        syncStatus: 'committed',
      });
      expect(committed.kind).toBe('committed');
      expect(committed.claimsServerSaved).toBe(true);

      const stale = resolveScreenState({
        authReady: true,
        loading: false,
        hasCachedData: true,
        isStale: true,
        itemCount: 2,
      });
      expect(stale.kind).toBe('stale');
      expect(stale.claimsServerSaved).toBe(false);

      const idle = resolveScreenState({
        authReady: true,
        loading: false,
        hasCachedData: true,
        itemCount: 3,
      });
      expect(idle.kind).toBe('idle');
      expect(idle.claimsServerSaved).toBe(false);
    });

    it('preserveDraftOnFailure retains user draft across conflict, retryable, recoverable, and permanent failures', () => {
      const draft = { title: 'Deep review note', minutes: '25' };

      for (const failureStatus of [
        'conflict',
        'retryable',
        'recoverable',
        'permanent',
      ] as const) {
        const res = preserveDraftOnFailure(draft, { ok: false, status: failureStatus });
        expect(res.shouldClearInput).toBe(false);
        expect(res.draft).toEqual({ title: 'Deep review note', minutes: '25' });

        const defensiveRes = preserveDraftOnFailure(draft, { ok: true, status: failureStatus });
        expect(defensiveRes.shouldClearInput).toBe(false);
        expect(defensiveRes.draft).toEqual({ title: 'Deep review note', minutes: '25' });
      }

      expect(preserveDraftOnFailure(draft, { ok: true, status: 'pending' }).shouldClearInput).toBe(
        true,
      );
      expect(
        preserveDraftOnFailure(draft, { ok: true, status: 'committed' }).shouldClearInput,
      ).toBe(true);
    });
  });

  describe('U11 — MeasurableInputModal Data Type Clarity & Pre-Save Impact', () => {
    it('parses "1,5" on an "L" weekly_count (count: 3) habit, renders type hint & pre-save impact, and calls onConfirm(1.5) without mutating habit', async () => {
      const onConfirm = jest.fn();
      const onClose = jest.fn();
      const habit = makeMeasurableHabit({
        unit: 'L',
        daily_goal: 2.5,
        frequency_config: { kind: 'weekly', count: 3 },
      });
      const snapshotGoal = habit.daily_goal;
      const snapshotFreq = JSON.stringify(habit.frequency_config);

      const r = track(
        renderWithProviders(
          <MeasurableInputModal
            visible
            habit={habit}
            currentValue={0}
            onClose={onClose}
            onConfirm={onConfirm}
          />,
        ),
      );

      const typeHintNode = screen.getByTestId('measurable-type-hint');
      const hintText = String(typeHintNode.props.children);
      expect(hintText).toMatch(/1,5 L/);
      expect(hintText).toMatch(/3/);

      expect(screen.queryByTestId('measurable-presave-impact')).toBeNull();

      const input = screen.getByTestId('measurable-amount-input');
      fireEvent.changeText(input, '1,5');

      const impactNode = screen.getByTestId('measurable-presave-impact');
      const impactText = String(impactNode.props.children);
      expect(impactText).toMatch(/60%/);

      await r.user.press(screen.getByTestId('measurable-confirm-btn'));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith(1.5);

      // Habit configuration is never mutated by logging progress
      expect(habit.daily_goal).toBe(snapshotGoal);
      expect(JSON.stringify(habit.frequency_config)).toBe(snapshotFreq);

      // Verify full-completion impact branch when entry reaches daily_goal
      r.rerender(
        <MeasurableInputModal
          visible
          habit={habit}
          currentValue={1.0}
          onClose={onClose}
          onConfirm={onConfirm}
        />,
      );
      fireEvent.changeText(screen.getByTestId('measurable-amount-input'), '1,5');
      const completionImpactText = String(
        screen.getByTestId('measurable-presave-impact').props.children,
      );
      expect(completionImpactText).not.toMatch(/60%/);
      expect(completionImpactText.length).toBeGreaterThan(20);
    });
  });

  describe('U12 — CalendarScreen Accessible Time-Block Editor via Preview / Commit / Undo', () => {
    it('renders calendar-change-time-<id>, previews fixed-block overlap via buildDayPlanPreview, commits via commitDayPlan, and undoes via calendar-time-undo', async () => {
      const todayKey = ymd(new Date());
      const fixedPeerTask = makeCalendarTask('t-peer', todayKey, {
        title: 'Team Sync',
        time_block_start: '14:00',
        time_block_end: '14:30',
        updated_at: '2026-11-24T08:00:00.000Z',
      });
      const editableTask = makeCalendarTask('t-edit', todayKey, {
        title: 'Write Architecture RFC',
        time_block_start: null,
        time_block_end: null,
        updated_at: '2026-11-24T09:00:00.000Z',
      });

      (globalThis as Record<string, unknown>).__f5f7Tasks = [fixedPeerTask, editableTask];
      useTaskStore.setState({ tasks: [fixedPeerTask, editableTask] });

      const previewSpy = jest.spyOn(dayPlanPreviewModule, 'buildDayPlanPreview');
      const commitSpy = jest.spyOn(dayPlanCommitService, 'commitDayPlan');
      const undoSpy = jest.spyOn(dayPlanCommitService, 'undoDayPlanCommit');

      const r = track(renderWithProviders(<CalendarScreen />));
      await flushAsync();

      expect(screen.getByTestId('calendar-change-time-t-peer')).toBeTruthy();
      const changeBtn = screen.getByTestId('calendar-change-time-t-edit');
      expect(changeBtn.props.accessibilityRole).toBe('button');

      await r.user.press(changeBtn);
      expect(screen.getByTestId('calendar-time-adjust-panel')).toBeTruthy();
      expect(previewSpy).toHaveBeenCalled();

      // Selecting 14:00-14:30 overlaps existing Team Sync block -> highlights overlap warning
      await r.user.press(screen.getByTestId('calendar-time-slot-14:00-14:30'));
      const overlapWarning = screen.getByTestId('calendar-time-overlap-warning');
      expect(overlapWarning.props.accessibilityRole).toBe('alert');
      expect(commitSpy).not.toHaveBeenCalled();

      // Selecting non-overlapping 16:00-16:30 clears overlap warning
      await r.user.press(screen.getByTestId('calendar-time-slot-16:00-16:30'));
      expect(screen.queryByTestId('calendar-time-overlap-warning')).toBeNull();

      // Commit time block via commitDayPlan
      await r.user.press(screen.getByTestId('calendar-time-commit'));
      await flushAsync();

      expect(commitSpy).toHaveBeenCalledTimes(1);
      const commitArg = commitSpy.mock.calls[0]?.[0];
      expect(commitArg?.items).toHaveLength(1);
      expect(commitArg?.items[0]).toMatchObject({
        entity: 'task',
        targetId: 't-edit',
        expectedVersion: '2026-11-24T09:00:00.000Z',
        action: 'update_time_block',
        taskPatch: {
          time_block_start: '16:00',
          time_block_end: '16:30',
        },
        priorTaskSnapshot: {
          due_date: todayKey,
          list_type: 'inbox',
          time_block_start: null,
          time_block_end: null,
        },
      });

      const updatedTask = useTaskStore.getState().tasks.find((t) => t.id === 't-edit');
      expect(updatedTask?.time_block_start).toBe('16:00');
      expect(updatedTask?.time_block_end).toBe('16:30');
      expect(screen.queryByTestId('calendar-time-adjust-panel')).toBeNull();

      // Receipt-backed Undo via calendar-time-undo
      const undoBtn = screen.getByTestId('calendar-time-undo');
      mockDeliverTaskCommand.mockResolvedValueOnce({
        kind: 'applied',
        version: '2026-11-24T10:06:00.000Z',
      });
      await r.user.press(undoBtn);
      await flushAsync();

      expect(undoSpy).toHaveBeenCalledTimes(1);
      const revertedTask = useTaskStore.getState().tasks.find((t) => t.id === 't-edit');
      expect(revertedTask?.time_block_start).toBeNull();
      expect(revertedTask?.time_block_end).toBeNull();
    });
  });

  describe('U08 & E18 — Non-Color State Icons/Roles, Reduced Motion, and Destination Uniqueness', () => {
    it('provides non-empty nonColorIcon and valid accessibilityRole across all 9 ScreenStateKind states', () => {
      const samples: Record<ScreenStateKind, ReturnType<typeof resolveScreenState>> = {
        idle: resolveScreenState({
          authReady: true,
          loading: false,
          hasCachedData: true,
          itemCount: 4,
        }),
        loading: resolveScreenState({
          authReady: false,
          loading: true,
          hasCachedData: false,
          itemCount: 0,
        }),
        stale: resolveScreenState({
          authReady: true,
          loading: false,
          hasCachedData: true,
          isStale: true,
          itemCount: 4,
        }),
        empty: resolveScreenState({
          authReady: true,
          loading: false,
          hasCachedData: false,
          itemCount: 0,
        }),
        pending: resolveScreenState({
          authReady: true,
          loading: false,
          hasCachedData: true,
          itemCount: 1,
          syncStatus: 'pending',
        }),
        committed: resolveScreenState({
          authReady: true,
          loading: false,
          hasCachedData: true,
          itemCount: 1,
          syncStatus: 'committed',
        }),
        conflict: resolveScreenState({
          authReady: true,
          loading: false,
          hasCachedData: true,
          itemCount: 1,
          syncStatus: 'conflict',
        }),
        recoverable: resolveScreenState({
          authReady: true,
          loading: false,
          hasCachedData: true,
          itemCount: 1,
          syncStatus: 'retryable',
        }),
        permanent: resolveScreenState({
          authReady: true,
          loading: false,
          hasCachedData: true,
          itemCount: 1,
          syncStatus: 'permanent',
        }),
      };

      const validRoles = new Set(['none', 'progressbar', 'summary', 'text', 'alert']);
      const validLiveRegions = new Set(['none', 'polite', 'assertive']);

      for (const [expectedKind, descriptor] of Object.entries(samples)) {
        expect(descriptor.kind).toBe(expectedKind);
        expect(descriptor.nonColorIcon.trim().length).toBeGreaterThan(3);
        expect(validRoles.has(descriptor.accessibilityRole)).toBe(true);
        expect(validLiveRegions.has(descriptor.liveRegion)).toBe(true);
      }

      // Error/conflict states must announce assertively with alert role
      expect(samples.conflict.accessibilityRole).toBe('alert');
      expect(samples.recoverable.accessibilityRole).toBe('alert');
      expect(samples.permanent.accessibilityRole).toBe('alert');
    });

    it('gates CalendarScreen page-flip Animated.timing when reduced motion is enabled', async () => {
      const timingSpy = jest.spyOn(Animated, 'timing');
      const r = track(renderWithProviders(<CalendarScreen />));
      await flushAsync();

      // In test environment useReducedMotion() defaults to true -> zero page-flip timing calls
      expect(timingSpy).not.toHaveBeenCalled();

      // Trigger month navigation button (first header button = prevMonth)
      const headersBefore = r.getAllByRole('header');
      const monthBefore = String(headersBefore[0]?.props.children);
      const buttons = r.getAllByRole('button');
      fireEvent.press(buttons[0]);

      const headersAfter = r.getAllByRole('header');
      const monthAfter = String(headersAfter[0]?.props.children);
      expect(monthAfter).not.toBe(monthBefore);

      const pageFlipTimings = timingSpy.mock.calls.filter(
        ([, cfg]) => cfg.duration === 430 || cfg.duration === 480,
      );
      expect(pageFlipTimings).toEqual([]);
    });

    it('E18: guarantees unique destination IDs, unique canonical href keys, unique legacyRoutes, and real app/ route files', () => {
      const appFiles = walkAppRouteFiles('app');
      expect(appFiles.length).toBeGreaterThan(25);
      expect(DESTINATIONS.length).toBeGreaterThanOrEqual(30);

      const seenIds = new Set<string>();
      const seenHrefKeys = new Set<string>();
      const legacyOwnerByKey = new Map<string, string>();

      for (const dest of DESTINATIONS) {
        expect(seenIds.has(dest.id)).toBe(false);
        seenIds.add(dest.id);

        expect(destinationById(dest.id)).toBe(dest);
        expect(hrefFor(dest.id)).toEqual(dest.href);

        const canonicalKey = routeKeyOf(dest.href);
        expect(seenHrefKeys.has(canonicalKey)).toBe(false);
        seenHrefKeys.add(canonicalKey);

        expect(appRouteFileExistsForPathname(dest.href.pathname, appFiles)).toBe(true);
        expect(destinationForLegacyRoute(canonicalKey)?.id).toBe(dest.id);

        for (const legacy of dest.legacyRoutes) {
          const legacyKey = routeKeyOf(legacy);
          const existingOwner = legacyOwnerByKey.get(legacyKey);
          expect(existingOwner ?? dest.id).toBe(dest.id);
          legacyOwnerByKey.set(legacyKey, dest.id);

          expect(destinationForLegacyRoute(legacy)?.id).toBe(dest.id);
          expect(appRouteFileExistsForPathname(legacy, appFiles)).toBe(true);
        }
      }
    });
  });
});
