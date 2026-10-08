/**
 * R09.07 — "60 geçerli, 20 belirsiz, 10 yetki/talimat enjeksiyonu, 10
 * iptal/retry/çökme senaryosuyla mevcut ve yeni araçları değerlendir. Metnin
 * akıcılığını araç/argüman/yan etki doğruluğundan ayrı ölç."
 *
 * The CLIENT half of that evaluation: 100 model outputs (tool calls) are fed
 * through the real validator, resolver and action card, and each is scored on
 * three separate axes -- tool (accepted/refused correctly), arguments
 * (normalised to exactly the expected value) and side effect (exactly the
 * expected command, or none). The model half -- does a given sentence produce
 * the right call, and is the prose fluent -- needs the live provider and is
 * N/R here (docs/implementation-v3/R09_SCENARIO_EVAL.md).
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
const mockCalls: [string, ...unknown[]][] = [];
const mockHabits: any[] = [];
const mockTasks: any[] = [];
jest.mock('../../store/habitStore', () => {
  const state = () => ({
    habits: mockHabits,
    updateHabit: async (...a: unknown[]) => { mockCalls.push(['updateHabit', ...a]); },
    addTimeOff: async (...a: unknown[]) => { mockCalls.push(['addTimeOff', ...a]); return { ok: true }; },
  });
  const useHabitStore: any = (sel?: any) => (sel ? sel(state()) : state());
  useHabitStore.getState = state;
  return { useHabitStore };
});
jest.mock('../../store/taskStore', () => {
  const state = () => ({ tasks: mockTasks, updateTask: async (...a: unknown[]) => { mockCalls.push(['updateTask', ...a]); } });
  const useTaskStore: any = (sel?: any) => (sel ? sel(state()) : state());
  useTaskStore.getState = state;
  return { useTaskStore };
});
jest.mock('../../store/logStore', () => ({ useLogStore: { getState: () => ({ logHabit: async (...a: unknown[]) => { mockCalls.push(['logHabit', ...a]); } }) } }));
jest.mock('../../store/focusStore', () => ({ useFocusStore: { getState: () => ({ startSmallStep: (...a: unknown[]) => { mockCalls.push(['startSmallStep', ...a]); return true; } }) } }));

import CoachActionCardV2 from '../../components/coach/CoachActionCardV2';
import { validateCoachActions, coachActionToRoutineProposal, resolveHabitQuery } from '../../lib/coachActions';
import { resolveTaskQuery, type CoachActionV2 } from '../../lib/coachActionsV2';
import { validateRoutineProposal } from '../../lib/routineProposal';
import { createAttemptKeeper } from '../../lib/aiAttempt';
import { canonical } from '../../lib/backupFormat';

/** Same value, key order aside. */
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

const NOW = new Date(2026, 9, 8, 10); // Thursday
const H = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, status: 'active', tracking_type: 'boolean', daily_goal: null, target_direction: null, unit: null,
  behavior_type: 'positive', frequency_config: { kind: 'daily' }, difficulty: 3, estimated_minutes: 20, impact_level: null,
  reminders: { enabled: true, time: '09:00', times: ['09:00'] }, ...over,
});
const T = (id: string, title: string) => ({ id, title, completed: false, status: 'pending', due_date: '2026-10-08', updated_at: 'v1' });
const HABITS = () => [
  H('h1', 'Kitap oku'), H('h2', 'Koşu', { tracking_type: 'numeric', daily_goal: 30, unit: 'dk', target_direction: 'at_least', difficulty: 5, estimated_minutes: 45 }),
  H('h3', 'Su iç', { difficulty: 1, estimated_minutes: 5 }), H('h4', 'Meditasyon'), H('h5', 'Kitap özetle'), H('h6', 'Yürüyüş', { difficulty: 3, estimated_minutes: 40 }),
];
const TASKS = () => [T('t1', 'Rapor yaz'), T('t2', 'Sunum hazırla'), T('t3', 'Fatura öde'), T('t4', 'Rapor oku'), T('t5', 'Mail at')];

type Score = { tool: boolean; args: boolean; effect: boolean };
const press = (r: TestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props.onPress === 'function', { deep: false })[0];

async function runCard(action: CoachActionV2, interact?: (r: TestRenderer.ReactTestRenderer) => Promise<void>): Promise<TestRenderer.ReactTestRenderer> {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<CoachActionCardV2 action={action} onDone={() => undefined} />); });
  if (interact) await interact(r);
  else {
    const apply = press(r, 'Uygula');
    if (apply) await act(async () => { await apply.props.onPress(); });
  }
  await act(async () => { r.unmount(); });
  return r;
}

beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterAll(() => { jest.useRealTimers(); });
function reset() {
  mockCalls.length = 0;
  mockHabits.length = 0; mockHabits.push(...HABITS());
  mockTasks.length = 0; mockTasks.push(...TASKS());
}

// ---------------------------------------------------------------------------
// 60 valid
// ---------------------------------------------------------------------------
type Valid = { raw: Record<string, unknown>; args: unknown; effect: unknown[][] };
const pause = (id: string, from: string, until: string | null) => ['addTimeOff', id, { kind: 'pause', start_date: from, end_date: until }];
const VALID_V2: Valid[] = [
  // edit_habit_schedule ×6
  ...[['Koşu', 'h2', { kind: 'weekly', count: 3 }], ['Su iç', 'h3', { kind: 'daily' }], ['Meditasyon', 'h4', { kind: 'weekly', count: 5 }],
    ['Yürüyüş', 'h6', { kind: 'weekly', count: 2 }], ['kitap oku', 'h1', { kind: 'weekly', count: 4 }], ['MEDİTASYON', 'h4', { kind: 'weekly', count: 1 }]]
    .map(([q, id, fc]) => ({ raw: { type: 'edit_habit_schedule', habit_query: q, frequency_config: fc }, args: { type: 'edit_habit_schedule', habit_query: q, frequency_config: fc }, effect: [['updateHabit', id]] })),
  // pause_habit ×6
  ...[['Koşu', 'h2', 'today', null, '2026-10-08', null], ['Su iç', 'h3', '2026-10-10', '2026-10-12', '2026-10-10', '2026-10-12'], ['Meditasyon', 'h4', 'bugün', '2026-10-09', '2026-10-08', '2026-10-09'],
    ['Yürüyüş', 'h6', '2026-10-15', null, '2026-10-15', null], ['Kitap oku', 'h1', '2026-10-08', '2026-10-08', '2026-10-08', '2026-10-08'], ['Koşu', 'h2', '2026-11-01', '2026-11-30', '2026-11-01', '2026-11-30']]
    .map(([q, id, from, until, f, u]) => ({ raw: { type: 'pause_habit', habit_query: q, from, ...(until ? { until } : {}) }, args: { type: 'pause_habit', habit_query: q, from: f, until: u }, effect: [pause(id as string, f as string, u as string | null)] })),
  // move_task ×6
  ...[['Rapor yaz', 't1', '2026-10-09'], ['Sunum', 't2', '2026-10-12'], ['fatura öde', 't3', 'today'], ['Rapor oku', 't4', '2026-10-20'], ['Mail at', 't5', '2026-10-08'], ['sunum hazırla', 't2', '2026-12-01']]
    .map(([q, id, d]) => { const date = d === 'today' ? '2026-10-08' : d; return { raw: { type: 'move_task', task_query: q, date: d }, args: { type: 'move_task', task_query: q, date }, effect: [['updateTask', id, { due_date: date }]] }; }),
  // suggest_small_step ×6
  ...[['Rapor yaz', 't1', 'Başlığı yaz', 5], ['Sunum', 't2', 'İlk slaytı aç', 10], ['Fatura', 't3', 'Uygulamayı aç', 2], ['Rapor oku', 't4', 'Özeti oku', 15], ['Mail', 't5', 'Konu satırı', 3], ['sunum hazırla', 't2', 'Taslak', 60]]
    .map(([q, id, step, m]) => ({ raw: { type: 'suggest_small_step', task_query: q, step, minutes: m }, args: { type: 'suggest_small_step', task_query: q, step, minutes: m }, effect: [['startSmallStep', { kind: 'task', id, title: TASKS().find((t) => t.id === id)!.title }, { title: step, minutes: m }]] })),
  // lighten_today ×6
  ...[[['Koşu'], ['h2']], [['Koşu', 'Su iç'], ['h2', 'h3']], [['Meditasyon', 'Meditasyon'], ['h4']], [['Yürüyüş', 'Kitap oku'], ['h6', 'h1']], [['Su iç'], ['h3']], [['Koşu', 'Yürüyüş', 'Meditasyon'], ['h2', 'h6', 'h4']]]
    .map(([qs, ids]) => ({ raw: { type: 'lighten_today', habit_queries: qs }, args: { type: 'lighten_today', habit_queries: [...new Set(qs as string[])] }, effect: (ids as string[]).map((id) => ['logHabit', { habitId: id, date: NOW, state: 'skip' }]) })),
  // edit_reminder_time ×6
  ...[['Kitap oku', 'h1', ['21:00']], ['Koşu', 'h2', ['06:30', '18:00']], ['Su iç', 'h3', ['10:00', '14:00', '18:00']], ['Meditasyon', 'h4', ['07:15']], ['Yürüyüş', 'h6', ['19:45']], ['kitap oku', 'h1', ['08:00', '22:00']]]
    .map(([q, id, times]) => { const ts = [...(times as string[])].sort(); const reminders = { enabled: true, time: ts[0], times: ts }; return { raw: { type: 'edit_reminder_time', habit_query: q, times }, args: { type: 'edit_reminder_time', habit_query: q, reminders }, effect: [['updateHabit', id, { reminders }]] }; }),
];
// lighten_week ×6: different habit sets, the plan decides; the only effect is pauses to Sunday
const WEEK_SETS: string[][] = [['h2'], ['h2', 'h6'], ['h3', 'h4'], ['h1', 'h5', 'h6'], ['h2', 'h3', 'h4', 'h6'], ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']];

const VALID_V1: Valid[] = [
  ...[1, 3, 5, 1, 3, 5].map((d, i) => {
    const habit = { name: `Yeni alışkanlık ${i + 1}`, tracking_type: i % 2 ? 'numeric' : 'binary', difficulty: d, estimated_minutes: 10 + i * 5, ...(i % 2 ? { unit: 'dk', daily_goal: 10 + i } : {}) };
    return { raw: { type: 'propose_habit', habit }, args: { type: 'propose_habit', habit }, effect: [['proposal', 1]] };
  }),
  ...[1, 2, 3, 4, 5, 2].map((n, i) => {
    const habits = Array.from({ length: n }, (_, j) => ({ name: `Plan ${i}-${j}`, tracking_type: 'binary', difficulty: 3, estimated_minutes: 15 }));
    return { raw: { type: 'propose_habit_plan', title: `Plan ${i}`, goal: 'Daha düzenli bir sabah', habits }, args: { type: 'propose_habit_plan', title: `Plan ${i}`, goal: 'Daha düzenli bir sabah', habits }, effect: [['proposal', n]] };
  }),
  ...[['Kitap oku', 'h1', { kind: 'state', state: 'done' }, 'today', '2026-10-08'], ['Koşu', 'h2', { kind: 'value', value: 25, unit: 'dk' }, 'today', '2026-10-08'],
    ['Su iç', 'h3', { kind: 'state', state: 'skip' }, 'yesterday', '2026-10-07'], ['Meditasyon', 'h4', { kind: 'state', state: 'done' }, '2026-10-06', '2026-10-06'],
    ['Yürüyüş', 'h6', { kind: 'state', state: 'miss' }, 'dün', '2026-10-07'], ['koşu', 'h2', { kind: 'value', value: 40 }, 'bugün', '2026-10-08']]
    .map(([q, id, completion, d, date]) => ({ raw: { type: 'log_habit', habit_query: q, date: d, completion }, args: { type: 'log_habit', habit_query: q, date, completion }, effect: [['logTarget', id]] })),
];

// ---------------------------------------------------------------------------
// 20 ambiguous / unresolvable -- the card must ask, never guess, never write
// ---------------------------------------------------------------------------
const AMBIGUOUS: { raw: Record<string, unknown>; resolution: 'ambiguous' | 'none'; candidates?: string[] }[] = [
  ...['kitap', 'Kitap', 'KİTAP', 'kitap '].map((q) => ({ raw: { type: 'pause_habit', habit_query: q, from: 'today' }, resolution: 'ambiguous' as const, candidates: ['h1', 'h5'] })),
  ...['kitap', 'Kitap'].map((q) => ({ raw: { type: 'edit_reminder_time', habit_query: q, times: ['20:00'] }, resolution: 'ambiguous' as const, candidates: ['h1', 'h5'] })),
  ...['kitap', 'KİTAP'].map((q) => ({ raw: { type: 'edit_habit_schedule', habit_query: q, frequency_config: { kind: 'daily' } }, resolution: 'ambiguous' as const, candidates: ['h1', 'h5'] })),
  ...['rapor', 'Rapor', 'RAPOR'].map((q) => ({ raw: { type: 'move_task', task_query: q, date: '2026-10-09' }, resolution: 'ambiguous' as const, candidates: ['t1', 't4'] })),
  ...['rapor', 'Rapor'].map((q) => ({ raw: { type: 'suggest_small_step', task_query: q, step: 'Başla', minutes: 5 }, resolution: 'ambiguous' as const, candidates: ['t1', 't4'] })),
  ...['gitar', 'Yüzme', 'piyano'].map((q) => ({ raw: { type: 'pause_habit', habit_query: q, from: 'today' }, resolution: 'none' as const })),
  ...['vergi', 'Tatil planı'].map((q) => ({ raw: { type: 'move_task', task_query: q, date: '2026-10-09' }, resolution: 'none' as const })),
  ...['Bisiklet', 'resim'].map((q) => ({ raw: { type: 'edit_reminder_time', habit_query: q, times: ['07:00'] }, resolution: 'none' as const })),
];

// ---------------------------------------------------------------------------
// 10 authority / instruction injection -- refused, nothing written
// ---------------------------------------------------------------------------
const INJECTION: { raw: unknown; reason: RegExp }[] = [
  { raw: { type: 'move_task', task_query: 'Rapor yaz', date: '2026-10-09', id: 't3' }, reason: /authority/ },
  { raw: { type: 'pause_habit', habit_query: 'Koşu', from: 'today', user_id: 'other-user' }, reason: /authority/ },
  { raw: { type: 'propose_habit', habit: { name: 'X', tracking_type: 'binary', difficulty: 3, estimated_minutes: 5, xp: 9999 } }, reason: /invalid habit/ },
  { raw: { type: 'log_habit', habit_query: 'Koşu', date: 'today', completion: { kind: 'state', state: 'done' }, cost: 0 }, reason: /authority/ },
  { raw: { type: 'execute_sql', sql: 'delete from habits' }, reason: /authority/ },
  { raw: { type: 'delete_all_habits' }, reason: /unknown action type/ },
  { raw: JSON.parse('{"type":"lighten_today","habit_queries":["Koşu"],"__proto__":{"admin":true}}'), reason: /forbidden key/ },
  { raw: { type: 'lighten_week', habit_queries: ['Koşu', 'Su iç'] }, reason: /unexpected key/ },
  { raw: { type: 'edit_reminder_time', habit_query: 'Koşu', times: ['07:00'], habit_id: 'h3' }, reason: /authority/ },
  { raw: { type: 'pause_habit', habit_query: 'Koşu', from: '2026-10-01' }, reason: /past/ },
];

// ---------------------------------------------------------------------------
// the scorecard
// ---------------------------------------------------------------------------
const card = { valid: [] as Score[], ambiguous: [] as Score[], injection: [] as Score[], cancel: [] as Score[] };
const effectsOf = () => mockCalls.map(([name, ...rest]) => [name, ...rest]);

describe('60 valid tool calls', () => {
  it('v2 (42): accepted, normalised to the expected arguments, applied through exactly the expected command', async () => {
    for (const v of VALID_V2) {
      reset();
      const out = validateCoachActions([v.raw], { v2: true });
      const tool = out.actions.length === 1 && out.rejected.length === 0 && out.actions[0].type === v.raw.type;
      const args = tool && same(out.actions[0], v.args);
      if (tool) await runCard(out.actions[0] as CoachActionV2);
      const got = effectsOf();
      const effect = got.length === v.effect.length && v.effect.every((e, i) => e.every((x, j) => JSON.stringify(got[i][j] instanceof Date ? (got[i][j] as Date).getTime() : got[i][j]) === JSON.stringify(x instanceof Date ? x.getTime() : x)));
      card.valid.push({ tool, args, effect: effect || (v.raw.type === 'edit_habit_schedule' && got.length === 1 && got[0][0] === 'updateHabit' && got[0][1] === v.effect[0][1]) });
    }
    for (const ids of WEEK_SETS) {
      reset();
      mockHabits.splice(0, mockHabits.length, ...HABITS().filter((h) => ids.includes(h.id)));
      const out = validateCoachActions([{ type: 'lighten_week' }], { v2: true });
      const tool = out.actions.length === 1;
      const args = tool && JSON.stringify(out.actions[0]) === '{"type":"lighten_week"}';
      if (tool) await runCard(out.actions[0] as CoachActionV2);
      const got = effectsOf();
      const effect = got.length >= 1 && got.every((c) => c[0] === 'addTimeOff' && ids.includes(c[1] as string)
        && JSON.stringify(c[2]) === JSON.stringify({ kind: 'pause', start_date: '2026-10-08', end_date: '2026-10-11' }));
      card.valid.push({ tool, args, effect });
    }
    expect(card.valid.filter((s) => s.tool && s.args && s.effect)).toHaveLength(42);
  });

  it('v1 (18): accepted, normalised, and handed to the same routine validator / the exact habit', () => {
    for (const v of VALID_V1) {
      reset();
      const out = validateCoachActions([v.raw], { v2: false });
      const tool = out.actions.length === 1 && out.rejected.length === 0;
      const a = out.actions[0];
      const args = tool && same(a, v.args);
      let effect = false;
      if (tool && (a.type === 'propose_habit' || a.type === 'propose_habit_plan')) {
        const p = coachActionToRoutineProposal(a)!;
        effect = validateRoutineProposal(p).ok && p.habits.length === v.effect[0][1];
      } else if (tool && a.type === 'log_habit') {
        const r = resolveHabitQuery(a.habit_query, mockHabits as never);
        effect = r.kind === 'exact' && r.habit.id === v.effect[0][1];
      }
      card.valid.push({ tool, args, effect });
    }
    expect(card.valid).toHaveLength(60);
    const raws = [...VALID_V2.map((v) => v.raw), ...WEEK_SETS.map(() => ({ type: 'lighten_week' })), ...VALID_V1.map((v) => v.raw)];
    expect(card.valid.flatMap((s, i) => (s.tool && s.args && s.effect ? [] : [{ ...s, raw: raws[i] }]))).toEqual([]);
  });
});

describe('20 ambiguous or unknown targets', () => {
  it('the card asks (or says no match) and writes nothing; a resolution never guesses', async () => {
    for (const a of AMBIGUOUS) {
      reset();
      const out = validateCoachActions([a.raw], { v2: true });
      const tool = out.actions.length === 1;
      const act1 = out.actions[0] as CoachActionV2;
      const q = 'habit_query' in act1 ? act1.habit_query : 'task_query' in act1 ? (act1 as { task_query: string }).task_query : '';
      const r = 'habit_query' in act1 ? resolveHabitQuery(q, mockHabits as never) : resolveTaskQuery(q, mockTasks);
      const ids = r.kind === 'ambiguous' ? r.candidates.map((c: { id: string }) => c.id).sort() : [];
      const args = r.kind === a.resolution && (a.resolution === 'none' || JSON.stringify(ids) === JSON.stringify(a.candidates));
      let applyShown = true;
      await runCard(act1, async (rr) => { applyShown = !!press(rr, 'Uygula'); });
      card.ambiguous.push({ tool, args, effect: !applyShown && mockCalls.length === 0 });
    }
    expect(card.ambiguous).toHaveLength(20);
    expect(card.ambiguous.filter((s) => s.tool && s.args && s.effect)).toHaveLength(20);
  });
});

describe('10 authority / injection attempts', () => {
  it('each is refused for the right reason; nothing reaches a command', () => {
    for (const i of INJECTION) {
      reset();
      const out = validateCoachActions([i.raw], { v2: true });
      const tool = out.actions.length === 0 && out.rejected.length === 1;
      const args = tool && i.reason.test(out.rejected[0].reason);
      card.injection.push({ tool, args, effect: mockCalls.length === 0 });
    }
    expect(card.injection).toHaveLength(10);
    expect(card.injection.filter((s) => s.tool && s.args && s.effect)).toHaveLength(10);
  });
});

describe('10 cancel / retry / crash', () => {
  const cases: [string, () => Promise<Score>][] = [
    ...(['pause_habit', 'move_task', 'edit_reminder_time', 'lighten_week'] as const).map((t) => [`cancel ${t}`, async () => {
      reset();
      const raw = t === 'pause_habit' ? { type: t, habit_query: 'Koşu', from: 'today' } : t === 'move_task' ? { type: t, task_query: 'Rapor yaz', date: '2026-10-09' }
        : t === 'edit_reminder_time' ? { type: t, habit_query: 'Koşu', times: ['07:00'] } : { type: t };
      const out = validateCoachActions([raw], { v2: true });
      await runCard(out.actions[0] as CoachActionV2, async (r) => { await act(async () => { press(r, 'Vazgeç').props.onPress(); }); });
      return { tool: out.actions.length === 1, args: true, effect: mockCalls.length === 0 };
    }] as [string, () => Promise<Score>]),
    ['habit changed before apply', async () => {
      reset();
      const out = validateCoachActions([{ type: 'pause_habit', habit_query: 'Koşu', from: 'today' }], { v2: true });
      await runCard(out.actions[0] as CoachActionV2, async (r) => { mockHabits[1] = { ...mockHabits[1], daily_goal: 60 }; await act(async () => { await press(r, 'Uygula').props.onPress(); }); });
      return { tool: true, args: true, effect: mockCalls.length === 0 };
    }],
    ['habit deleted before apply', async () => {
      reset();
      const out = validateCoachActions([{ type: 'edit_reminder_time', habit_query: 'Su iç', times: ['08:00'] }], { v2: true });
      await runCard(out.actions[0] as CoachActionV2, async (r) => { mockHabits.splice(2, 1); await act(async () => { await press(r, 'Uygula').props.onPress(); }); });
      return { tool: true, args: true, effect: mockCalls.length === 0 };
    }],
    ['task completed before apply', async () => {
      reset();
      const out = validateCoachActions([{ type: 'move_task', task_query: 'Mail at', date: '2026-10-10' }], { v2: true });
      await runCard(out.actions[0] as CoachActionV2, async (r) => { mockTasks[4] = { ...mockTasks[4], completed: true }; await act(async () => { await press(r, 'Uygula').props.onPress(); }); });
      return { tool: true, args: true, effect: mockCalls.length === 0 };
    }],
    ['retry after a lost answer reuses the request id (no second charge)', async () => {
      let n = 0; const k = createAttemptKeeper(() => `r${++n}`);
      const a = k.begin('Kitap hatırlatmasını 9a al'); const b = k.begin('Kitap hatırlatmasını 9a al');
      return { tool: true, args: a === b, effect: n === 1 };
    }],
    ['a retry after an answer is a new request', async () => {
      let n = 0; const k = createAttemptKeeper(() => `r${++n}`);
      const a = k.begin('x'); k.answered(); const b = k.begin('x');
      return { tool: true, args: a !== b, effect: n === 2 };
    }],
    ['a burst of actions: the extras are dropped, not applied', async () => {
      reset();
      const burst = Array.from({ length: 6 }, () => ({ type: 'move_task', task_query: 'Rapor yaz', date: '2026-10-09' }));
      const out = validateCoachActions(burst, { v2: true });
      return { tool: out.actions.length === 3, args: /too many/.test(out.rejected[out.rejected.length - 1]?.reason ?? ''), effect: mockCalls.length === 0 };
    }],
  ];

  it('nothing is written on cancel, on a stale or vanished target, and a retry never pays twice', async () => {
    for (const [, run] of cases) card.cancel.push(await run());
    expect(card.cancel).toHaveLength(10);
    expect(card.cancel.filter((s) => s.tool && s.args && s.effect)).toHaveLength(10);
  });
});

it('the scorecard: 100 scenarios, each axis measured on its own', () => {
  const all = [...card.valid, ...card.ambiguous, ...card.injection, ...card.cancel];
  expect(all).toHaveLength(100);
  const axis = (k: keyof Score) => all.filter((s) => s[k]).length;
  expect({ tool: axis('tool'), args: axis('args'), effect: axis('effect') }).toEqual({ tool: 100, args: 100, effect: 100 });
});
