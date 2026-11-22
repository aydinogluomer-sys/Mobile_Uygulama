import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.setTimeout(30_000);

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/notifications', () => ({
  listScheduled: async () => [],
  cancelScheduled: async () => undefined,
}));

const mockCurrentUser = jest.fn<Promise<{ id: string; email: string | null } | null>, []>(
  async () => ({ id: 'u1', email: null }),
);
jest.mock('../../lib/session', () => ({
  currentUser: () => mockCurrentUser(),
}));

type DeliverOutcome =
  | { kind: 'applied'; version?: string }
  | { kind: 'offline' };

const mockDeliverTaskCommand = jest.fn<Promise<DeliverOutcome>, [unknown]>(
  async () => ({ kind: 'applied', version: '2026-11-02T21:00:01.000Z' }),
);

jest.mock('../../services/taskService', () => ({
  listTasks: jest.fn(async () => ({ ok: true, data: { rows: [], nextCursor: null, hasMore: false } })),
  completionPatch: jest.fn((completed: boolean) => ({
    completed,
    status: completed ? 'completed' : 'pending',
    completed_at: completed ? '2026-11-02T21:00:00.000Z' : null,
  })),
  newTaskRow: jest.fn(),
  deliverTaskCommand: (cmd: unknown) => mockDeliverTaskCommand(cmd),
}));

import DayCloseEcho from '../../components/today/DayCloseEcho';
import DayCloseMood from '../../components/today/DayCloseMood';
import DayCloseTasks, { type DayCloseRowView } from '../../components/today/DayCloseTasks';
import { Chip } from '../../components/ui';
import { useDayClose, type UseDayClose } from '../../hooks/useDayClose';
import { resetAccountMemory } from '../../lib/accountScope';
import { DAY_CLOSE_COPY, dayCloseKey, loadDayClose, saveDayClose } from '../../lib/dayClose';
import { memoryOutboxStorage } from '../../lib/outboxStorage';
import { colors, palettes } from '../../lib/tokens';
import { useMoodStore } from '../../store/moodStore';
import { setTaskOutboxStorage, useTaskStore, type Task } from '../../store/taskStore';

const makeTask = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  user_id: 'u1',
  title: `Görev ${id}`,
  priority: 'medium',
  status: 'pending',
  list_type: 'inbox',
  due_date: '2026-11-02',
  completed: false,
  created_at: '2026-11-01T09:00:00Z',
  updated_at: '2026-11-01T09:00:00Z',
  ...over,
});

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown): void => {
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
      walk((n as { children: unknown }).children);
    }
  };
  walk(r.toJSON());
  return out.join(' ');
}

function flatStyle(styleProp: unknown): Record<string, unknown> {
  if (!styleProp) return {};
  const arr = Array.isArray(styleProp) ? styleProp.flat(4) : [styleProp];
  return Object.assign({}, ...arr.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object')));
}

describe('F29 — useDayClose hook & DayClose UI components', () => {
  const mounted: TestRenderer.ReactTestRenderer[] = [];

  beforeEach(async () => {
    jest.useRealTimers();
    resetAccountMemory('signed_out');
    await AsyncStorage.clear();
    setTaskOutboxStorage(memoryOutboxStorage());
    mockCurrentUser.mockResolvedValue({ id: 'u1', email: null });
    mockDeliverTaskCommand.mockReset();
    mockDeliverTaskCommand.mockResolvedValue({ kind: 'applied', version: '2026-11-02T21:00:01.000Z' });
    useTaskStore.setState({ tasks: [], outbox: null, cursor: null, hasMore: false, loading: false, error: null });
    useMoodStore.setState({ userId: null, definitions: [], checkins: [] });
  });

  afterEach(async () => {
    while (mounted.length > 0) {
      const r = mounted.pop()!;
      await act(async () => {
        r.unmount();
      });
    }
    jest.useRealTimers();
  });

  function mountHook(initialOpen: boolean, nowFn: () => Date = () => new Date(2026, 10, 2, 21, 30)) {
    let latest!: UseDayClose;
    function Probe({ open }: { open: boolean }) {
      latest = useDayClose(open, nowFn);
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Probe open={initialOpen} />);
    });
    mounted.push(renderer);
    return {
      get current() {
        return latest;
      },
      rerender(nextOpen: boolean) {
        act(() => {
          renderer.update(<Probe open={nextOpen} />);
        });
      },
    };
  }

  describe('useDayClose orchestration', () => {
    it('(+) snapshots <= 5 candidates, writes tomorrow/release/undo through outbox, and coalesces immediate tomorrow+undo offline', async () => {
      mockDeliverTaskCommand.mockResolvedValue({ kind: 'offline' });
      const tasks = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((ch, idx) =>
        makeTask(`t-${ch}`, {
          title: `Adım ${ch}`,
          priority: idx === 0 ? 'high' : 'medium',
          created_at: `2026-11-01T0${idx}:00:00Z`,
        }),
      );
      useTaskStore.setState({ tasks });

      const h = mountHook(true);
      expect(h.current.closingDay).toBe('2026-11-02');
      expect(h.current.tomorrow).toBe('2026-11-03');
      expect(h.current.rows).toHaveLength(5);
      expect(h.current.hasMore).toBe(true);

      await act(async () => {
        await h.current.decide('t-a', 'tomorrow');
      });
      expect(h.current.rows[0].decision).toBe('tomorrow');
      expect(useTaskStore.getState().outbox?.commands).toHaveLength(1);
      expect(useTaskStore.getState().outbox?.commands[0]).toMatchObject({
        entity: 'task',
        entityId: 't-a',
        kind: 'update',
        payload: { due_date: '2026-11-03' },
      });

      await act(async () => {
        await h.current.decide('t-b', 'release');
      });
      expect(h.current.rows[1].decision).toBe('release');
      expect(useTaskStore.getState().outbox?.commands[1]).toMatchObject({
        entity: 'task',
        entityId: 't-b',
        kind: 'update',
        payload: { list_type: 'someday', due_date: null },
      });

      // Immediate undo on t-a coalesces in outbox with original due_date & list_type
      await act(async () => {
        await h.current.undo('t-a');
      });
      expect(h.current.rows[0].decision).toBeNull();
      const cmdsForA = (useTaskStore.getState().outbox?.commands ?? []).filter((c) => c.entityId === 't-a');
      expect(cmdsForA).toHaveLength(1);
      expect(cmdsForA[0].payload).toEqual({ due_date: '2026-11-02', list_type: 'inbox' });
    });

    it('(-) ignores duplicate identical decisions, never calls removeTask/archiveTask, switches tomorrow<->release cleanly, and scopes moveVisibleToTomorrow to undecided visible rows', async () => {
      const tasks = ['a', 'b', 'c', 'd', 'e', 'f'].map((ch, idx) =>
        makeTask(`t-${ch}`, {
          list_type: idx === 0 ? 'this_week' : 'inbox',
          created_at: `2026-11-01T0${idx}:00:00Z`,
        }),
      );
      useTaskStore.setState({ tasks });

      const updateSpy = jest.spyOn(useTaskStore.getState(), 'updateTask');
      const removeSpy = jest.spyOn(useTaskStore.getState(), 'removeTask');
      const archiveSpy = jest.spyOn(useTaskStore.getState(), 'archiveTask');

      try {
        const h = mountHook(true);

        // Duplicate decision produces only 1 write
        await act(async () => {
          await h.current.decide('t-a', 'tomorrow');
          await h.current.decide('t-a', 'tomorrow');
        });
        expect(updateSpy).toHaveBeenCalledTimes(1);

        // Switch tomorrow -> release -> tomorrow restores original list_type ('this_week')
        updateSpy.mockClear();
        await act(async () => {
          await h.current.decide('t-a', 'release');
        });
        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(updateSpy).toHaveBeenLastCalledWith('t-a', { due_date: null, list_type: 'someday' });

        updateSpy.mockClear();
        await act(async () => {
          await h.current.decide('t-a', 'tomorrow');
        });
        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(updateSpy).toHaveBeenLastCalledWith('t-a', {
          list_type: 'this_week',
          due_date: '2026-11-03',
        });

        // Set t-b to release; moveVisibleToTomorrow must only touch t-c, t-d, t-e (not t-a, t-b, or hidden t-f)
        await act(async () => {
          await h.current.decide('t-b', 'release');
        });
        updateSpy.mockClear();

        await act(async () => {
          await h.current.moveVisibleToTomorrow();
        });
        expect(updateSpy.mock.calls.map((c) => c[0])).toEqual(['t-c', 't-d', 't-e']);
        expect(h.current.rows.find((r) => r.task.id === 't-b')?.decision).toBe('release');
        expect(useTaskStore.getState().tasks.find((t) => t.id === 't-f')?.due_date).toBe('2026-11-02');

        expect(removeSpy).not.toHaveBeenCalled();
        expect(archiveSpy).not.toHaveBeenCalled();
      } finally {
        updateSpy.mockRestore();
        removeSpy.mockRestore();
        archiveSpy.mockRestore();
      }
    });

    it('(+) flips waitingForSync after 1200ms offline and clears on flush; (-) stays false on fast sync', async () => {
      jest.useFakeTimers();
      useTaskStore.setState({ tasks: [makeTask('t1'), makeTask('t2')] });

      // Negative first: fast delivery never flickers waitingForSync
      mockDeliverTaskCommand.mockResolvedValue({ kind: 'applied', version: '2026-11-02T21:00:05.000Z' });
      const h = mountHook(true);
      await act(async () => {
        await h.current.decide('t1', 'tomorrow');
      });
      act(() => {
        jest.advanceTimersByTime(1500);
      });
      expect(h.current.waitingForSync).toBe(false);

      // Positive: offline keeps command pending -> false before 1200ms, true at 1200ms, false when flushed
      mockDeliverTaskCommand.mockResolvedValue({ kind: 'offline' });
      await act(async () => {
        await h.current.decide('t2', 'tomorrow');
      });
      expect(h.current.waitingForSync).toBe(false);

      act(() => {
        jest.advanceTimersByTime(1199);
      });
      expect(h.current.waitingForSync).toBe(false);

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(h.current.waitingForSync).toBe(true);

      mockDeliverTaskCommand.mockResolvedValue({ kind: 'applied', version: '2026-11-02T21:00:10.000Z' });
      await act(async () => {
        await useTaskStore.getState().flush();
      });
      expect(h.current.waitingForSync).toBe(false);
    });

    it('(+) finish persists movedCount (excluding released), merges same-day re-close, survives light-day modal round-trip, and (-) aborts on missing user, storage error, or accountEpoch race', async () => {
      useTaskStore.setState({
        tasks: [makeTask('t1'), makeTask('t2'), makeTask('t3'), makeTask('t4')],
      });
      const h = mountHook(true);

      await act(async () => {
        await h.current.decide('t1', 'tomorrow');
        await h.current.decide('t2', 'release');
      });

      // Simulate Hafiflet round-trip (close -> reopen before finish)
      h.rerender(false);
      h.rerender(true);

      await act(async () => {
        await h.current.decide('t3', 'tomorrow');
      });

      let ok = false;
      await act(async () => {
        ok = await h.current.finish(3);
      });
      expect(ok).toBe(true);
      expect(await loadDayClose('u1')).toMatchObject({
        v: 1,
        date: '2026-11-02',
        movedCount: 2,
        easedCount: 3,
      });

      // Second close on the same evening merges movedCount (2 + 1 = 3)
      h.rerender(false);
      h.rerender(true);
      await act(async () => {
        await h.current.decide('t4', 'tomorrow');
        ok = await h.current.finish(4);
      });
      expect(ok).toBe(true);
      expect(await loadDayClose('u1')).toMatchObject({
        date: '2026-11-02',
        movedCount: 3,
        easedCount: 4,
      });

      // Negative: no user -> false
      mockCurrentUser.mockResolvedValueOnce(null);
      await act(async () => {
        ok = await h.current.finish(0);
      });
      expect(ok).toBe(false);

      // Negative: AsyncStorage write failure -> false without throwing
      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('io'));
      await act(async () => {
        ok = await h.current.finish(0);
      });
      expect(ok).toBe(false);

      // Negative: accountEpoch changes mid-finish -> write is dropped
      await AsyncStorage.clear();
      let resolveUser!: (u: { id: string; email: null }) => void;
      mockCurrentUser.mockImplementationOnce(
        () => new Promise((res) => { resolveUser = res; }),
      );
      let finishPromise!: Promise<boolean>;
      act(() => {
        finishPromise = h.current.finish(2);
      });
      resetAccountMemory('signed_out');
      await act(async () => {
        resolveUser({ id: 'u1', email: null });
        ok = await finishPromise;
      });
      expect(ok).toBe(false);
      expect(await AsyncStorage.getItem(dayCloseKey('u1'))).toBeNull();
    });

    it('(+) chooseMood checks in builtin-<n> with intensity 2 and replaces prior session check-in; (-) handles unauthenticated user and skippable mood', async () => {
      const h = mountHook(true);
      expect(h.current.mood).toBeNull();

      await act(async () => {
        h.current.chooseMood(4);
        for (let i = 0; i < 6; i += 1) await Promise.resolve();
      });
      expect(h.current.mood).toBe(4);
      expect(useMoodStore.getState().checkins).toHaveLength(1);
      expect(useMoodStore.getState().checkins[0]).toMatchObject({
        moodId: 'builtin-4',
        intensity: 2,
      });
      const firstId = useMoodStore.getState().checkins[0].id;

      // Re-choosing replaces the previous check-in instead of piling duplicates
      await act(async () => {
        h.current.chooseMood(2);
        for (let i = 0; i < 6; i += 1) await Promise.resolve();
      });
      expect(h.current.mood).toBe(2);
      expect(useMoodStore.getState().checkins).toHaveLength(1);
      expect(useMoodStore.getState().checkins[0].id).not.toBe(firstId);
      expect(useMoodStore.getState().checkins[0].moodId).toBe('builtin-2');

      // Negative: unauthenticated -> checkIn returns false, state stays unchanged
      resetAccountMemory('signed_out');
      mockCurrentUser.mockResolvedValue(null);
      const hAnon = mountHook(true);
      await act(async () => {
        hAnon.current.chooseMood(5);
        for (let i = 0; i < 6; i += 1) await Promise.resolve();
      });
      expect(hAnon.current.mood).toBeNull();
    });
  });

  describe('DayCloseTasks, DayCloseMood & DayCloseEcho UI contracts', () => {
    it('(+) DayCloseTasks enforces >=44pt targets, accessible task labels, status/undo copy, bulk button on 2+ rows, and (-) calm empty/single-row states with zero digits', () => {
      const twoRows: DayCloseRowView[] = [
        { id: '1', title: 'Raporu gözden geçir', priority: 'high', decision: null },
        { id: '2', title: 'Mektubu gönder', priority: 'low', decision: null },
      ];

      let r!: TestRenderer.ReactTestRenderer;
      act(() => {
        r = TestRenderer.create(
          <DayCloseTasks
            rows={twoRows}
            hasMore={true}
            waitingForSync={false}
            onDecide={jest.fn()}
            onUndo={jest.fn()}
            onMoveAll={jest.fn()}
          />,
        );
      });
      mounted.push(r);

      const txt = textOf(r);
      expect(txt).toContain(DAY_CLOSE_COPY.tasksTitle);
      expect(txt).toContain(DAY_CLOSE_COPY.moveAll);
      expect(txt).toContain(DAY_CLOSE_COPY.moreHidden);
      expect(txt).not.toMatch(/\d/);

      const tomorrowBtn = r.root.findAll(
        (n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Raporu gözden geçir: yarına taşı',
      )[0];
      const releaseBtn = r.root.findAll(
        (n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Raporu gözden geçir: Bir Gün listesine bırak',
      )[0];
      expect(tomorrowBtn).toBeDefined();
      expect(releaseBtn).toBeDefined();
      expect(Number(flatStyle(tomorrowBtn.props.style).minHeight)).toBeGreaterThanOrEqual(44);
      expect(Number(flatStyle(releaseBtn.props.style).minHeight)).toBeGreaterThanOrEqual(44);

      // Decided state + waitingForSync + only 1 undecided row left -> bulk button disappears
      act(() => {
        r.update(
          <DayCloseTasks
            rows={[
              { id: '1', title: 'Raporu gözden geçir', priority: 'high', decision: 'tomorrow' },
              { id: '2', title: 'Mektubu gönder', priority: 'low', decision: null },
            ]}
            hasMore={false}
            waitingForSync={true}
            onDecide={jest.fn()}
            onUndo={jest.fn()}
            onMoveAll={jest.fn()}
          />,
        );
      });
      const decidedTxt = textOf(r);
      expect(decidedTxt).toContain(DAY_CLOSE_COPY.tomorrowDone);
      expect(decidedTxt).toContain(DAY_CLOSE_COPY.undo);
      expect(decidedTxt).toContain(DAY_CLOSE_COPY.waitingForSync);
      expect(decidedTxt).not.toContain(DAY_CLOSE_COPY.moveAll);

      // Empty state: calm copy only, no header, no buttons
      act(() => {
        r.update(
          <DayCloseTasks
            rows={[]}
            hasMore={false}
            waitingForSync={false}
            onDecide={jest.fn()}
            onUndo={jest.fn()}
            onMoveAll={jest.fn()}
          />,
        );
      });
      expect(textOf(r)).toBe(DAY_CLOSE_COPY.empty);
      expect(r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityRole === 'button')).toHaveLength(0);
    });

    it('(+) DayCloseMood renders 5 >=44x44 radio chips with MOODS labels and (-) zero initial selection or error colors', () => {
      const onChoose = jest.fn();
      let r!: TestRenderer.ReactTestRenderer;
      act(() => {
        r = TestRenderer.create(<DayCloseMood value={null} onChoose={onChoose} />);
      });
      mounted.push(r);

      const group = r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityRole === 'radiogroup')[0];
      expect(group).toBeDefined();
      expect(group.props.accessibilityLabel).toBe(DAY_CLOSE_COPY.moodPrompt);

      const radios = r.root.findAll(
        (n) => typeof n.type === 'string' && n.props?.accessibilityRole === 'radio',
      );
      expect(radios).toHaveLength(5);
      expect(radios.map((n) => n.props.accessibilityLabel)).toEqual(['Zor', 'Yorgun', 'Orta', 'İyi', 'Harika']);

      for (const radio of radios) {
        expect(radio.props.accessibilityState?.selected).toBe(false);
        const st = flatStyle(radio.props.style);
        expect(Number(st.minHeight)).toBeGreaterThanOrEqual(44);
        expect(Number(st.minWidth)).toBeGreaterThanOrEqual(44);
        const serialized = JSON.stringify(st);
        expect(serialized).not.toContain(colors.error);
        expect(serialized).not.toContain(palettes.light.error);
      }

      const chips = r.root.findAllByType(Chip);
      expect(chips).toHaveLength(5);
      act(() => {
        chips[3].props.onPress?.();
      });
      expect(onChoose).toHaveBeenCalledWith(4);

      act(() => {
        r.update(<DayCloseMood value={4} onChoose={onChoose} />);
      });
      const updatedRadios = r.root.findAll(
        (n) => typeof n.type === 'string' && n.props?.accessibilityRole === 'radio',
      );
      expect(updatedRadios[3].props.accessibilityState?.selected).toBe(true);
      expect(updatedRadios[0].props.accessibilityState?.selected).toBe(false);
    });

    it('(+) DayCloseEcho renders yesterday echo as non-interactive text and (-) renders null when absent or stale', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 10, 3, 9, 0));

      // Absent -> null
      let rEmpty!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        rEmpty = TestRenderer.create(<DayCloseEcho />);
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
      });
      mounted.push(rEmpty);
      expect(rEmpty.toJSON()).toBeNull();

      // Yesterday record (movedCount: 2) -> renders calm text with zero onPress handlers
      await saveDayClose('u1', {
        v: 1,
        date: '2026-11-02',
        movedCount: 2,
        easedCount: 1,
        closedAt: '2026-11-02T22:00:00.000Z',
      });
      let rEcho!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        rEcho = TestRenderer.create(<DayCloseEcho />);
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
      });
      mounted.push(rEcho);
      expect(textOf(rEcho)).toBe('Dün günü kapattın; iki işi bugüne taşıdın.');
      expect(rEcho.root.findAll((n) => typeof n.props?.onPress === 'function')).toHaveLength(0);

      // Two days ago -> null
      await saveDayClose('u1', {
        v: 1,
        date: '2026-11-01',
        movedCount: 2,
        easedCount: 0,
        closedAt: '2026-11-01T22:00:00.000Z',
      });
      let rStale!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        rStale = TestRenderer.create(<DayCloseEcho />);
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
      });
      mounted.push(rStale);
      expect(rStale.toJSON()).toBeNull();
    });
  });
});
