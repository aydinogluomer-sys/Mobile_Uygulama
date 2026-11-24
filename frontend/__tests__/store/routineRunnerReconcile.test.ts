/**
 * F34 (INT-14, INT-19/3, PS-30) — Single-writer habit-log reconciler,
 * corrupt-storage `.bad` quarantine, account-epoch guard, and active template
 * persistence in `routineRunnerStore`.
 */
type LogCall = { habitId: string; date: Date; state: string };

const mockLogCalls: LogCall[] = [];
let mockLogImpl: (p: LogCall) => Promise<{ ok: boolean; error?: string }> = async (p) => {
  mockLogCalls.push(p);
  return { ok: true };
};
const mockSession: { user: { id: string; email: string | null } | null } = {
  user: { id: 'user-a', email: null },
};

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => mockSession.user),
}));
jest.mock('../../store/logStore', () => ({
  useLogStore: {
    getState: () => ({
      logHabit: jest.fn((p: LogCall) => mockLogImpl(p)),
    }),
  },
}));
jest.mock('../../store/habitStore', () => ({
  useHabitStore: {
    getState: () => ({
      habits: [
        { id: 'h-water', name: 'Su', tracking_type: 'boolean', status: 'active' },
        { id: 'h-stretch', name: 'Esneme', tracking_type: 'boolean', status: 'active' },
        { id: 'h-num', name: 'Adım', tracking_type: 'numeric', status: 'active' },
      ],
    }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetAccountMemory } from '../../lib/accountScope';
import { staleLogs, type RoutineTemplate } from '../../lib/routineRunner';
import { RUNNER_BAD_KEY, RUNNER_KEY, useRoutineRunnerStore } from '../../store/routineRunnerStore';

const st = () => useRoutineRunnerStore.getState();
const flush = () => new Promise((r) => setTimeout(r, 0));

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

beforeEach(async () => {
  mockLogCalls.length = 0;
  mockLogImpl = async (p) => {
    mockLogCalls.push(p);
    return { ok: true };
  };
  mockSession.user = { id: 'user-a', email: null };
  await AsyncStorage.clear();
  useRoutineRunnerStore.setState({
    userId: null,
    templates: [],
    session: null,
    logged: [],
    history: [],
    activeTemplateId: null,
    staleDismissed: [],
    error: null,
  });
  await st().hydrate();
});

describe('F34 INT-14 — single-writer reconcileLogs & stale tracking', () => {
  it('(+) two concurrent complete() calls while logHabit is in flight invoke logHabit ONCE per habit', async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    mockLogImpl = async (p) => {
      mockLogCalls.push(p);
      if (mockLogCalls.length === 1) await gate;
      return { ok: true };
    };

    const custom: RoutineTemplate = {
      id: 'custom-two',
      name: 'İkili',
      builtIn: false,
      versions: [
        {
          version: 1,
          createdAt: '2026-11-22T08:00:00.000Z',
          steps: [
            { id: 's1', title: 'Su iç', kind: 'check', habitId: 'h-water' },
            { id: 's2', title: 'Esne', kind: 'check', habitId: 'h-stretch' },
          ],
        },
      ],
    };
    useRoutineRunnerStore.setState({ templates: [custom] });
    expect(st().start('custom-two')).toBe(true);

    const p1 = st().complete();
    const p2 = st().complete();
    releaseFirst();
    await Promise.all([p1, p2]);
    await flush();

    expect(mockLogCalls.map((c) => c.habitId)).toEqual(['h-water', 'h-stretch']);
    expect(st().logged).toEqual(['h-water', 'h-stretch']);
  });

  it('(+) skipped -> done via mark() writes the habit log without requiring complete()', async () => {
    st().start('builtin-morning');
    st().addStep({ title: 'Su', kind: 'check', habitId: 'h-water' });
    const waterStepId = st().session!.steps[3].id;

    st().mark(waterStepId, 'skipped');
    await flush();
    expect(mockLogCalls).toEqual([]);

    st().mark(waterStepId, 'done');
    await flush();
    expect(mockLogCalls).toHaveLength(1);
    expect(mockLogCalls[0].habitId).toBe('h-water');
    expect(mockLogCalls[0].state).toBe('done');
    expect(st().logged).toEqual(['h-water']);
  });

  it('(+) done -> skipped keeps logged, surfaces in staleLogs, dismissStale hides it, and never writes non-done logs', async () => {
    st().start('builtin-morning');
    st().addStep({ title: 'Su', kind: 'check', habitId: 'h-water' });
    const waterStepId = st().session!.steps[3].id;

    st().mark(waterStepId, 'done');
    await flush();
    expect(st().logged).toEqual(['h-water']);

    st().mark(waterStepId, 'skipped');
    await flush();
    expect(st().logged).toEqual(['h-water']);
    expect(staleLogs(st().session!, st().logged, st().staleDismissed)).toEqual(['h-water']);

    st().dismissStale('h-water');
    expect(staleLogs(st().session!, st().logged, st().staleDismissed)).toEqual([]);
    expect(mockLogCalls).toHaveLength(1);
    expect(mockLogCalls.every((c) => c.state === 'done')).toBe(true);
  });

  it('(+) failed logHabit (ok: false) stays out of logged, records error, and retries on next mark', async () => {
    let shouldFail = true;
    mockLogImpl = async (p) => {
      mockLogCalls.push(p);
      if (shouldFail) return { ok: false, error: 'çevrimdışı hata' };
      return { ok: true };
    };

    st().start('builtin-morning');
    st().addStep({ title: 'Su', kind: 'check', habitId: 'h-water' });
    const waterStepId = st().session!.steps[3].id;

    st().mark(waterStepId, 'done');
    await flush();
    expect(st().logged).toEqual([]);
    expect(st().error).toContain('kaydedilemedi');

    shouldFail = false;
    st().mark(st().session!.steps[0].id, 'done');
    await flush();
    expect(st().logged).toEqual(['h-water']);
    expect(mockLogCalls).toHaveLength(2);
  });

  it('(-) measurable habits are never logged, dates are never backdated, and epoch/discard drop in-flight results', async () => {
    const todayStr = ymdLocal(new Date());
    let releaseCall!: () => void;
    let gate = new Promise<void>((r) => {
      releaseCall = r;
    });

    mockLogImpl = async (p) => {
      mockLogCalls.push(p);
      await gate;
      return { ok: true };
    };

    st().start('builtin-morning');
    st().addStep({ title: 'Adım', kind: 'check', habitId: 'h-num' });
    st().addStep({ title: 'Su', kind: 'check', habitId: 'h-water' });
    const numId = st().session!.steps[3].id;
    const waterId = st().session!.steps[4].id;

    st().mark(numId, 'done');
    await flush();
    expect(mockLogCalls).toEqual([]);

    // In-flight discard() does not leak into logged
    st().mark(waterId, 'done');
    st().discard();
    releaseCall();
    await flush();
    expect(st().logged).toEqual([]);
    expect(ymdLocal(mockLogCalls[0].date)).toBe(todayStr);

    // In-flight account boundary (epoch increment) drops late result
    gate = new Promise<void>((r) => {
      releaseCall = r;
    });
    mockSession.user = { id: 'user-a', email: null };
    await st().hydrate();
    st().start('builtin-morning');
    st().addStep({ title: 'Esne', kind: 'check', habitId: 'h-stretch' });
    const stretchId = st().session!.steps[3].id;
    st().mark(stretchId, 'done');
    resetAccountMemory('user_changed');
    releaseCall();
    await flush();
    expect(st().logged).toEqual([]);
  });
});

describe('F34 INT-19/3 & PS-30 — corrupt blob quarantine (.bad) & activeTemplateId persistence', () => {
  it('(+) corrupt blob quarantines to .bad, starts clean, and a second corruption NEVER overwrites the first .bad', async () => {
    const firstCorrupt = '{corrupt-first-payload';
    await AsyncStorage.setItem(RUNNER_KEY('user-b'), firstCorrupt);
    mockSession.user = { id: 'user-b', email: null };
    await st().hydrate();

    expect(st().session).toBeNull();
    expect(st().templates).toEqual([]);
    expect(st().error).toContain('okunamadı');
    expect(await AsyncStorage.getItem(RUNNER_BAD_KEY('user-b'))).toBe(firstCorrupt);

    // Second corruption for same user must NOT overwrite the original .bad snapshot
    const secondCorrupt = JSON.stringify({ v: 99, broken: true });
    await AsyncStorage.setItem(RUNNER_KEY('user-b'), secondCorrupt);
    useRoutineRunnerStore.setState({ userId: null, error: null });
    await st().hydrate();
    expect(await AsyncStorage.getItem(RUNNER_BAD_KEY('user-b'))).toBe(firstCorrupt);
  });

  it('(+) partially corrupt blob quarantines raw copy while loading valid templates', async () => {
    const validTpl: RoutineTemplate = {
      id: 'user-good',
      name: 'Sağlam Rutin',
      builtIn: false,
      partOfDay: 'evening',
      versions: [
        {
          version: 1,
          createdAt: '2026-11-22T10:00:00.000Z',
          steps: [{ id: 'g1', title: 'Kitap oku', kind: 'timed', durationSec: 600, habitId: null }],
        },
      ],
    };
    const rawPartial = JSON.stringify({
      v: 1,
      templates: [validTpl, { id: 'broken-tpl', versions: [] }],
      session: { broken: true },
      logged: ['h-water'],
      history: [],
      savedAt: 1_800_000_000_000,
      activeTemplateId: 'user-good',
    });

    await AsyncStorage.setItem(RUNNER_KEY('user-c'), rawPartial);
    mockSession.user = { id: 'user-c', email: null };
    await st().hydrate();

    expect(await AsyncStorage.getItem(RUNNER_BAD_KEY('user-c'))).toBe(rawPartial);
    expect(st().templates.map((t) => t.id)).toEqual(['user-good']);
    expect(st().session).toBeNull();
    expect(st().activeTemplateId).toBe('user-good');
    expect(st().error).toContain('okunamadı');
  });

  it('(+) setActive persists across hydrate; (-) unknown templateId and unusable template start() are refused', async () => {
    st().setActive('builtin-evening');
    await flush();
    expect(st().activeTemplateId).toBe('builtin-evening');

    // Unknown ID does not mutate activeTemplateId
    st().setActive('does-not-exist');
    expect(st().activeTemplateId).toBe('builtin-evening');

    // Simulate app restart & re-hydrate
    useRoutineRunnerStore.setState({ userId: null, activeTemplateId: null });
    await st().hydrate();
    expect(st().activeTemplateId).toBe('builtin-evening');

    st().setActive(null);
    expect(st().activeTemplateId).toBeNull();

    // Unusable template injected into state is filtered from allTemplates and start() returns false
    const unusable: RoutineTemplate = { id: 'empty-tpl', name: 'Boş', builtIn: false, versions: [] };
    useRoutineRunnerStore.setState({ templates: [unusable] });
    expect(st().allTemplates().some((t) => t.id === 'empty-tpl')).toBe(false);
    expect(st().start('empty-tpl')).toBe(false);
    expect(st().session).toBeNull();
  });
});
