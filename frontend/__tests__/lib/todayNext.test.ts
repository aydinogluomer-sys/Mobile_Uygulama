/**
 * R03.01 — "Bugün ekranını öncelik, mevcut yük, sıradaki uygulanabilir adım ve
 * devam eden oturum etrafında düzenle." The one next step, in a fixed,
 * explainable order; an open (even paused) session always comes first.
 */
import {
  FOCUS_PAUSE_YIELD_MS,
  FOCUS_STALE_MS,
  focusForNext,
  nextActionable,
  primaryAction,
  todaySummaryLine,
  type NextActionInput,
} from '../../lib/todayNext';

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

describe('F16 (INT-10) — yielded focus sessions step aside until the queue is empty', () => {
  const NOW = 1_800_000_000_000;
  const MIN = 60_000;

  it('exposes 30-minute pause yield and 12-hour stale thresholds', () => {
    expect(FOCUS_PAUSE_YIELD_MS).toBe(30 * 60 * 1000);
    expect(FOCUS_STALE_MS).toBe(12 * 60 * 60 * 1000);
  });

  it('paused > 30 min yields to today work; paused <= 30 min stays first', () => {
    const yieldedFocus = focusForNext(
      {
        status: 'paused',
        title: 'Rapor taslağı',
        pausedAt: NOW - 31 * MIN,
        startedAtIso: new Date(NOW - 45 * MIN).toISOString(),
      },
      NOW,
    );
    expect(yieldedFocus).toEqual({ status: 'paused', title: 'Rapor taslağı', yielded: true });
    expect(
      nextActionable({ ...empty, focus: yieldedFocus, habitsToDo: [{ id: 'h1', name: 'Kitap' }] }),
    ).toEqual({ kind: 'habit', id: 'h1', label: 'Kitap', detail: 'Bugünün alışkanlığı' });

    const freshPaused = focusForNext(
      {
        status: 'paused',
        title: 'Rapor taslağı',
        pausedAt: NOW - 29 * MIN,
        startedAtIso: new Date(NOW - 40 * MIN).toISOString(),
      },
      NOW,
    );
    expect(freshPaused.yielded).toBe(false);
    expect(
      nextActionable({ ...empty, focus: freshPaused, habitsToDo: [{ id: 'h1', name: 'Kitap' }] })?.kind,
    ).toBe('focus');

    const exactBoundary = focusForNext(
      {
        status: 'paused',
        title: 'Rapor taslağı',
        pausedAt: NOW - FOCUS_PAUSE_YIELD_MS,
        startedAtIso: new Date(NOW - 40 * MIN).toISOString(),
      },
      NOW,
    );
    expect(exactBoundary.yielded).toBe(false);
  });

  it('a > 12h session yields, and still surfaces at the bottom with gentle copy when nothing else is due', () => {
    const stale = focusForNext(
      {
        status: 'paused',
        title: 'Eski oturum',
        pausedAt: NOW - 5 * MIN,
        startedAtIso: new Date(NOW - 13 * 60 * MIN).toISOString(),
      },
      NOW,
    );
    expect(stale.yielded).toBe(true);
    expect(nextActionable({ ...empty, focus: stale })).toEqual({
      kind: 'focus',
      label: 'Odak: Eski oturum',
      detail: 'Yarım kalan oturum var — istersen bitir ya da bırak',
    });
    expect(nextActionable({ ...empty, focus: { status: 'paused', title: null, yielded: true } })).toEqual({
      kind: 'focus',
      label: 'Odak oturumu',
      detail: 'Yarım kalan oturum var — istersen bitir ya da bırak',
    });
  });

  it('a running session under 12h never yields, and idle returns status idle', () => {
    const running = focusForNext(
      {
        status: 'running',
        title: 'Derin odak',
        pausedAt: NOW - 120 * MIN,
        startedAtIso: new Date(NOW - 20 * MIN).toISOString(),
      },
      NOW,
    );
    expect(running).toEqual({ status: 'running', title: 'Derin odak', yielded: false });
    expect(nextActionable({ ...all, focus: running })?.kind).toBe('focus');

    expect(
      focusForNext({ status: 'idle', title: 'X', pausedAt: NOW, startedAtIso: new Date(NOW).toISOString() }, NOW),
    ).toEqual({ status: 'idle' });
  });
});

describe('F27 (INT-22) — calm overdue ordering above OVERDUE_CALM_LIMIT', () => {
  const makeOverdue = (n: number, withMinutes = false) =>
    Array.from({ length: n }, (_, idx) => ({
      id: `o${idx + 1}`,
      title: `Gecikmiş ${idx + 1}`,
      ...(withMinutes ? { minutes: idx === 3 ? 5 : 25 } : {}),
    }));

  it('keeps overdue first at threshold (<= 5)', () => {
    const res = nextActionable({
      ...empty,
      overdueTasks: makeOverdue(5),
      habitsToDo: [{ id: 'h1', name: 'Su iç' }],
      tasksToday: [{ id: 't1', title: 'Bugün işi' }],
    });
    expect(res).toEqual({ kind: 'task', id: 'o1', label: 'Gecikmiş 1', detail: 'Gecikmiş görev' });
  });

  it('demotes > 5 overdue pile behind habitsToDo and tasksToday, while keeping focus/routine/recovery ahead', () => {
    const base6: NextActionInput = {
      ...empty,
      overdueTasks: makeOverdue(6),
      habitsToDo: [{ id: 'h1', name: 'Su iç' }],
      tasksToday: [{ id: 't1', title: 'Bugün işi' }],
    };

    expect(
      nextActionable({ ...base6, recoveryToday: [{ id: 'r1', habitName: 'Koşu' }] }),
    ).toEqual({ kind: 'recovery', id: 'r1', label: 'Koşu', detail: 'Bugün için planladığın telafi' });

    expect(nextActionable(base6)).toEqual({
      kind: 'habit',
      id: 'h1',
      label: 'Su iç',
      detail: 'Bugünün alışkanlığı',
    });

    expect(nextActionable({ ...base6, habitsToDo: [] })).toEqual({
      kind: 'task',
      id: 't1',
      label: 'Bugün işi',
      detail: 'Bugünün görevi',
    });

    expect(nextActionable({ ...base6, habitsToDo: [], tasksToday: [] })).toEqual({
      kind: 'task',
      id: 'o1',
      label: 'Gecikmiş 1',
      detail: 'Birikmişten tek bir iş',
    });
  });

  it('picks the smallest minutes item from > 5 overdue tasks when minutes is provided', () => {
    const res = nextActionable({
      ...empty,
      overdueTasks: makeOverdue(6, true),
    });
    expect(res).toEqual({
      kind: 'task',
      id: 'o4',
      label: 'Gecikmiş 4',
      detail: 'Birikmişten tek bir iş',
    });
  });
});
