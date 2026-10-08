/**
 * R03.01 — "Bugün ekranını öncelik, mevcut yük, sıradaki uygulanabilir adım ve
 * devam eden oturum etrafında düzenle." The one next step, in a fixed,
 * explainable order; an open (even paused) session always comes first.
 */
import { nextActionable, primaryAction, todaySummaryLine, type NextActionInput } from '../../lib/todayNext';

const empty: NextActionInput = {
  focus: { status: 'idle' }, routine: null, recoveryToday: [], overdueTasks: [], habitsToDo: [], tasksToday: [],
};
const all: NextActionInput = {
  focus: { status: 'running', title: 'Rapor taslağı' },
  routine: { status: 'running', templateName: 'Sabah', done: 1, total: 4 },
  recoveryToday: [{ id: 'p1', habitName: 'Koşu' }],
  overdueTasks: [{ id: 't0', title: 'Fatura' }],
  habitsToDo: [{ id: 'h1', name: 'Kitap' }],
  tasksToday: [{ id: 't1', title: 'Arama' }],
};

it('nothing to do -> null (the card is not shown)', () => {
  expect(nextActionable(empty)).toBeNull();
});

it('the order, peeled one level at a time', () => {
  const kinds: string[] = [];
  let i: NextActionInput = all;
  const peel: ((x: NextActionInput) => NextActionInput)[] = [
    (x) => ({ ...x, focus: { status: 'idle' } }),
    (x) => ({ ...x, routine: null }),
    (x) => ({ ...x, recoveryToday: [] }),
    (x) => ({ ...x, overdueTasks: [] }),
    (x) => ({ ...x, habitsToDo: [] }),
    (x) => ({ ...x, tasksToday: [] }),
  ];
  for (const p of peel) { const a = nextActionable(i)!; kinds.push(`${a.kind}:${a.label}`); i = p(i); }
  expect(kinds).toEqual(['focus:Odak: Rapor taslağı', 'routine:Sabah', 'recovery:Koşu', 'task:Fatura', 'habit:Kitap', 'task:Arama']);
  expect(nextActionable(i)).toBeNull();
});

it('a paused focus session is still the next step, and says so', () => {
  expect(nextActionable({ ...empty, focus: { status: 'paused' } })).toMatchObject({ kind: 'focus', detail: expect.stringMatching(/Duraklatıldı/) });
});

it('a finished routine is not "in progress"', () => {
  expect(nextActionable({ ...empty, routine: { status: 'finished', templateName: 'Akşam', done: 3, total: 3 }, tasksToday: [{ id: 't', title: 'X' }] })!.kind).toBe('task');
});

it('the routine line says how far along it is', () => {
  expect(nextActionable({ ...empty, routine: { status: 'paused', templateName: 'Akşam', done: 2, total: 5 } })!.detail).toBe('2/5 adım — duraklatıldı, devam et');
});

describe('R06.02 — the dominant action and the summary line', () => {
  it('continue for work in progress, start for the rest, focus when there is nothing', () => {
    expect(primaryAction(nextActionable({ ...empty, focus: { status: 'running' } }))).toMatchObject({ verb: 'Devam et', label: 'Devam et: Odak oturumu' });
    expect(primaryAction(nextActionable({ ...empty, routine: { status: 'paused', templateName: 'Akşam', done: 1, total: 3 } })).verb).toBe('Devam et');
    expect(primaryAction(nextActionable({ ...empty, habitsToDo: [{ id: 'h', name: 'Kitap' }] }))).toMatchObject({ verb: 'Başla', label: 'Başla: Kitap', hint: 'Bugünün alışkanlığı' });
    expect(primaryAction(null)).toMatchObject({ verb: 'Başla', label: 'Başla: odak' });
  });
  it('the summary is one short line', () => {
    expect(todaySummaryLine({ used: 6, budget: 15, habitsLeft: 2, tasksLeft: 3 })).toBe('İrade 6/15 · 2 alışkanlık, 3 görev kaldı');
    expect(todaySummaryLine({ used: null, budget: null, habitsLeft: 0, tasksLeft: 0 })).toBe('bugün için açık iş yok');
  });
});
