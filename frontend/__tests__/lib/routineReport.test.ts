/**
 * R05.07 — "Oturumu görev/alışkanlıkla bağla; özet, log ve rapor tek etkiden
 * beslensin. Tamamlanma için kullanıcı eylemi gerekiyorsa salt sürenin
 * dolmasını tamamlandı sayma."
 */
import * as fs from 'fs';
import * as path from 'path';
import { routineReport, type RoutineHistoryEntry } from '../../lib/routineReport';
import { startSession, completeStep, finishSession, summarize, habitLogsToWrite, timeUp, type RoutineTemplate } from '../../lib/routineRunner';

const T0 = new Date(2026, 9, 5, 7, 0).getTime();
const template: RoutineTemplate = {
  id: 't', name: 'Sabah', builtIn: false,
  versions: [{ version: 1, steps: [
    { id: 's1', title: 'Su', kind: 'check', habitId: 'h-water' },
    { id: 's2', title: 'Esneme', kind: 'timed', durationSec: 60, habitId: 'h-stretch' },
    { id: 's3', title: 'Plan', kind: 'check', habitId: null },
  ] }],
} as unknown as RoutineTemplate;

function run(endAt: number, completeAll: boolean) {
  let s = startSession(template, `sess-${endAt}`, endAt - 10 * 60_000);
  s = completeStep(s, endAt - 9 * 60_000);
  if (completeAll) { s = completeStep(s, endAt - 5 * 60_000); s = completeStep(s, endAt - 60_000); }
  return finishSession(s, endAt);
}
const entry = (s: ReturnType<typeof run>): RoutineHistoryEntry => ({ id: s.id, templateName: s.templateName, startedAt: s.startedAt, endedAt: s.endedAt!, summary: summarize(s) });

it('a timed step whose time ran out is not done until the user marks it', () => {
  let s = startSession(template, 'x', T0);
  s = completeStep(s, T0 + 1000);            // s1 done, s2 (timed 60s) is current
  expect(timeUp(s, T0 + 1000 + 61_000)).toBe(true);
  const f = finishSession(s, T0 + 1000 + 61_000);
  expect(summarize(f)).toMatchObject({ done: 1, open: 2, habitsDone: ['h-water'] });
  expect(routineReport([entry(f)], '2026-10-05', '2026-10-05')).toMatchObject({ stepsDone: 1, stepsTotal: 3 });
});

it('one effect: the report counts exactly the habits the session logged, and never twice', () => {
  const s = run(T0, true);
  expect(habitLogsToWrite(s, [])).toEqual(['h-water', 'h-stretch']);
  const r = routineReport([entry(s), entry(s)], '2026-10-05', '2026-10-05'); // the same session listed twice
  expect(r).toMatchObject({ sessions: 1, stepsDone: 3, stepsTotal: 3, habitsViaRoutine: 2 });
  expect(r.label).toBe(`1 rutin · 3/3 adım · ${r.activeMinutes} dk`);
});

it('the range is the local day a session ENDED', () => {
  const late = run(new Date(2026, 9, 4, 23, 59).getTime(), true);
  const next = run(new Date(2026, 9, 6, 0, 1).getTime(), false);
  expect(routineReport([entry(late), entry(next)], '2026-10-05', '2026-10-11').sessions).toBe(1);
  expect(routineReport([entry(late), entry(next)], '2026-09-28', '2026-10-04').sessions).toBe(1);
  expect(routineReport([], '2026-10-05', '2026-10-11').label).toBe('Rutin yok');
});

it('both reviews render it from the runner history', () => {
  for (const f of ['app/screens/weekly-review.tsx', 'app/screens/monthly-review.tsx']) {
    const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
    expect(src).toMatch(/routineReport\(routineHistory, start, end\)/);
    expect(src).toMatch(/routines\.label/);
  }
});

it('a session crossing midnight belongs to the day it ended (local, not UTC, not start)', () => {
  const s = run(new Date(2026, 9, 5, 0, 5).getTime(), true); // started 23:55 on the 4th, ended 00:05 on the 5th
  expect(routineReport([entry(s)], '2026-10-05', '2026-10-11').sessions).toBe(1);
  expect(routineReport([entry(s)], '2026-09-28', '2026-10-04').sessions).toBe(0);
});

it('a habit completed by two different sessions is one habit, the steps are not', () => {
  const a = run(new Date(2026, 9, 6, 8, 0).getTime(), true);
  const b = run(new Date(2026, 9, 7, 8, 0).getTime(), true);
  expect(routineReport([entry(a), entry(b)], '2026-10-05', '2026-10-11')).toMatchObject({ sessions: 2, stepsDone: 6, habitsViaRoutine: 2 });
});
