/**
 * F34 (INT-19, PS-30) — Pure robustness, corrupt-save validation, honest ETA,
 * part-of-day parity with F27, and active routine suggestion.
 */
import { isTimerClock } from '../../lib/focusTimer';
import {
  BUILT_IN_TEMPLATES,
  MAX_STEPS,
  MAX_STEP_SECONDS,
  applySessionToTemplate,
  completeStep,
  computeRunnerClock,
  currentStep,
  editMark,
  etaLabel,
  formatMmSs,
  habitLogsToWrite,
  isUsableTemplate,
  latestVersion,
  moveStep,
  parseSaved,
  pauseSession,
  planHabitLogs,
  runnerPartOfDay,
  skipStep,
  staleLogs,
  startSession,
  suggestTemplate,
  type HistoryEntry,
  type RoutineTemplate,
  type SavedBlob,
} from '../../lib/routineRunner';
import { currentPartOfDay } from '../../lib/todaySelectors';

const T0 = new Date(2026, 10, 22, 14, 23, 0, 0).getTime();
const MIN = 60_000;

const TIMED_ONLY_TPL: RoutineTemplate = {
  id: 'tpl-timed',
  name: 'Süreli Test',
  builtIn: false,
  partOfDay: 'morning',
  versions: [
    {
      version: 1,
      createdAt: '2026-11-22T08:00:00.000Z',
      steps: [
        { id: 's1', title: 'Nefes', kind: 'timed', durationSec: 300, habitId: null },
        { id: 's2', title: 'Okuma', kind: 'timed', durationSec: 420, habitId: 'h-read' },
      ],
    },
  ],
};

const MIXED_TPL: RoutineTemplate = {
  id: 'tpl-mixed',
  name: 'Karışık Test',
  builtIn: false,
  versions: [
    {
      version: 1,
      createdAt: '2026-11-22T08:00:00.000Z',
      steps: [
        { id: 'm1', title: 'Su iç', kind: 'check', habitId: 'h-water' },
        { id: 'm2', title: 'Esneme', kind: 'timed', durationSec: 300, habitId: 'h-stretch' },
        { id: 'm3', title: 'Vitamin', kind: 'check', habitId: null },
      ],
    },
  ],
};

describe('F34 INT-19/1 & INT-19/2 — empty versions, usable templates, moveStep bounds', () => {
  it('(+) empty versions -> latestVersion undefined, isUsableTemplate false, startSession null', () => {
    const emptyVersions: RoutineTemplate = { id: 'bad-1', name: 'Boş', builtIn: false, versions: [] };
    const emptySteps: RoutineTemplate = {
      id: 'bad-2',
      name: 'Adımsız',
      builtIn: false,
      versions: [{ version: 1, createdAt: 'x', steps: [] }],
    };

    expect(latestVersion(emptyVersions)).toBeUndefined();
    expect(isUsableTemplate(emptyVersions)).toBe(false);
    expect(startSession(emptyVersions, 'sid', T0)).toBeNull();

    expect(latestVersion(emptySteps)?.steps).toEqual([]);
    expect(isUsableTemplate(emptySteps)).toBe(false);
    expect(startSession(emptySteps, 'sid', T0)).toBeNull();

    for (const b of BUILT_IN_TEMPLATES) {
      expect(isUsableTemplate(b)).toBe(true);
    }

    // applySessionToTemplate handles an empty-versions target safely (starts at v1)
    const s = startSession(TIMED_ONLY_TPL, 'sid', T0)!;
    const applied = applySessionToTemplate(emptyVersions, s, '2026-11-22T09:00:00.000Z');
    expect(applied.versions).toHaveLength(1);
    expect(applied.versions[0].version).toBe(1);
  });

  it('(+) moveStep preserves index when all steps are already marked (index === steps.length)', () => {
    let s = startSession(MIXED_TPL, 'sid', T0)!;
    s = completeStep(s, T0 + MIN);
    s = completeStep(s, T0 + 2 * MIN);
    s = skipStep(s, T0 + 3 * MIN);
    expect(s.index).toBe(s.steps.length);
    expect(currentStep(s)).toBeUndefined();

    const reordered = moveStep(s, 'm3', -1);
    expect(reordered.steps.map((x) => x.id)).toEqual(['m1', 'm3', 'm2']);
    expect(reordered.index).toBe(reordered.steps.length);
    expect(currentStep(reordered)).toBeUndefined();
  });

  it('(-) regression: moveStep while mid-session still tracks the active step id', () => {
    let s = startSession(MIXED_TPL, 'sid', T0)!;
    s = completeStep(s, T0); // now at m2 (index 1)
    expect(currentStep(s)?.id).toBe('m2');

    const movedDown = moveStep(s, 'm2', 1);
    expect(movedDown.steps.map((x) => x.id)).toEqual(['m1', 'm3', 'm2']);
    expect(movedDown.index).toBe(2);
    expect(currentStep(movedDown)?.id).toBe('m2');
  });
});

describe('F34 INT-19/3 — isTimerClock & parseSaved piece-by-piece validation', () => {
  const makeHistory = (n: number): HistoryEntry => ({
    id: `hist-${n}`,
    templateName: 'Sabah',
    startedAt: T0 - 10 * MIN,
    endedAt: T0 - 2 * MIN,
    summary: { total: 3, done: 2, skipped: 1, open: 0, activeMs: 8 * MIN, habitsDone: ['h-water'] },
  });

  it('(+) isTimerClock accepts 0-second check clocks and rejects malformed clocks', () => {
    expect(isTimerClock({ plannedSeconds: 0, accumulatedMs: 0, runningSince: T0 })).toBe(true);
    expect(isTimerClock({ plannedSeconds: 300, accumulatedMs: 1200, runningSince: null })).toBe(true);
    expect(isTimerClock(null)).toBe(false);
    expect(isTimerClock([])).toBe(false);
    expect(isTimerClock({ plannedSeconds: -1, accumulatedMs: 0, runningSince: null })).toBe(false);
    expect(isTimerClock({ plannedSeconds: 60, accumulatedMs: -5, runningSince: null })).toBe(false);
    expect(isTimerClock({ plannedSeconds: 60, accumulatedMs: 0, runningSince: 'bad' })).toBe(false);
  });

  it('(+) parseSaved round-trips a valid SavedBlob with zero dropped items', () => {
    const session = pauseSession(startSession(MIXED_TPL, 'sess-1', T0)!, T0 + 2 * MIN);
    const blob: SavedBlob = {
      v: 1,
      templates: [TIMED_ONLY_TPL],
      session,
      logged: ['h-water'],
      history: [makeHistory(1)],
      savedAt: T0 + 2 * MIN,
      activeTemplateId: 'tpl-timed',
    };
    const res = parseSaved(JSON.stringify(blob));
    expect(res).not.toBeNull();
    expect(res!.dropped).toEqual({ templates: 0, session: false, history: 0 });
    expect(res!.saved).toEqual(blob);
  });

  it('(-) parseSaved rejects null, invalid JSON, wrong version, and isolates corrupt pieces', () => {
    expect(parseSaved(null)).toBeNull();
    expect(parseSaved('')).toBeNull();
    expect(parseSaved('{broken-json')).toBeNull();
    expect(parseSaved('[]')).toBeNull();
    expect(parseSaved(JSON.stringify({ v: 2, templates: [], session: null, logged: [], history: [], savedAt: T0 }))).toBeNull();

    const validSession = startSession(TIMED_ONLY_TPL, 'sess-ok', T0)!;
    const tooShortStepTpl = {
      ...TIMED_ONLY_TPL,
      id: 'bad-short',
      versions: [{ version: 1, createdAt: 'x', steps: [{ id: 'a', title: 'Kısa', kind: 'timed', durationSec: 5 }] }],
    };
    const tooLongStepTpl = {
      ...TIMED_ONLY_TPL,
      id: 'bad-long',
      versions: [{ version: 1, createdAt: 'x', steps: [{ id: 'a', title: 'Uzun', kind: 'timed', durationSec: MAX_STEP_SECONDS + 9200 }] }],
    };
    const builtInCollisionTpl = {
      ...TIMED_ONLY_TPL,
      id: 'builtin-morning',
    };
    const tooManyStepsTpl = {
      ...TIMED_ONLY_TPL,
      id: 'bad-many',
      versions: [
        {
          version: 1,
          createdAt: 'x',
          steps: Array.from({ length: MAX_STEPS + 1 }, (_, i) => ({
            id: `st-${i}`,
            title: `Adım ${i}`,
            kind: 'check',
          })),
        },
      ],
    };

    const badSession = { ...validSession, index: 99 };
    const thirtyOneHistory = Array.from({ length: 31 }, (_, i) => makeHistory(i));

    const mixedRaw = JSON.stringify({
      v: 1,
      templates: [TIMED_ONLY_TPL, tooShortStepTpl, tooLongStepTpl, builtInCollisionTpl, tooManyStepsTpl],
      session: badSession,
      logged: ['h-valid', 42, null, '', 'h-second'],
      history: [...thirtyOneHistory, { id: 'broken' }],
      savedAt: 'not-a-number',
      activeTemplateId: 12345,
    });

    const parsed = parseSaved(mixedRaw)!;
    expect(parsed).not.toBeNull();
    expect(parsed.dropped).toEqual({ templates: 4, session: true, history: 1 });
    expect(parsed.saved.templates.map((t) => t.id)).toEqual(['tpl-timed']);
    expect(parsed.saved.session).toBeNull();
    expect(parsed.saved.logged).toEqual(['h-valid', 'h-second']);
    expect(parsed.saved.history).toHaveLength(30);
    expect(parsed.saved.savedAt).toBe(0);
    expect(parsed.saved.activeTemplateId).toBeNull();
  });
});

describe('F34 INT-19/4 — computeRunnerClock & honest etaLabel (zero fabricated 2-minute constant)', () => {
  it('(+) all open steps timed -> eta.kind === "exact", at === now + remainingMs, paused hides wall clock', () => {
    const s = startSession(TIMED_ONLY_TPL, 'sid', T0)!; // 5m + 7m = 12m
    const view = computeRunnerClock(s, T0);
    expect(view.remainingMs).toBe(5 * MIN);
    expect(view.timeUp).toBe(false);
    expect(view.eta).toEqual({ kind: 'exact', at: T0 + 12 * MIN, remainingMs: 12 * MIN });
    expect(etaLabel(view.eta)).toBe('Tahmini bitiş 14:35 (yaklaşık 12 dk kaldı)');
    expect(etaLabel(view.eta, { paused: true })).toBe('yaklaşık 12 dk kalan (duraklatıldı)');
    expect(formatMmSs(299_000)).toBe('04:59');
  });

  it('(+) mixed timed + check steps -> eta.kind === "partial"; all marked -> eta.kind === "done"', () => {
    const s = startSession(MIXED_TPL, 'sid', T0)!; // 1 timed (5m) + 2 check
    const view = computeRunnerClock(s, T0);
    expect(view.eta).toEqual({ kind: 'partial', timedRemainingMs: 5 * MIN, unknownSteps: 2 });
    expect(etaLabel(view.eta)).toBe('Süreli adımlardan yaklaşık 5 dk var; 2 adımın süresi belirsiz');

    let doneAll = completeStep(s, T0);
    doneAll = completeStep(doneAll, T0 + MIN);
    doneAll = skipStep(doneAll, T0 + 2 * MIN);
    const doneView = computeRunnerClock(doneAll, T0 + 2 * MIN);
    expect(doneView.eta).toEqual({ kind: 'done' });
    expect(etaLabel(doneView.eta)).toBe('Tüm adımlar işaretli');
  });

  it('(-) check-only remaining steps -> eta.kind === "steps_only", no HH:MM clock and no "2 dk" constant', () => {
    let s = startSession(MIXED_TPL, 'sid', T0)!;
    // Mark the timed step ('m2') skipped so only 2 check steps ('m1', 'm3') remain open
    s = editMark(s, 'm2', 'skipped', T0);
    const view = computeRunnerClock(s, T0);
    expect(view.eta).toEqual({ kind: 'steps_only', unknownSteps: 2 });
    const text = etaLabel(view.eta);
    expect(text).toBe('2 adım kaldı');
    expect(text).not.toMatch(/\d{2}:\d{2}/);
    expect(text).not.toContain('2 dk');
  });
});

describe('F34 INT-14 — planHabitLogs & staleLogs pure reconciliation', () => {
  it('(+) computes write vs stale sets and filters dismissed stale IDs', () => {
    let s = startSession(MIXED_TPL, 'sid', T0)!;
    s = completeStep(s, T0); // m1 -> h-water done
    expect(planHabitLogs(s, [])).toEqual({ write: ['h-water'], stale: [] });
    expect(habitLogsToWrite(s, [])).toEqual(['h-water']);

    // Revert m1 to skipped after h-water was already logged
    s = editMark(s, 'm1', 'skipped', T0 + MIN);
    expect(planHabitLogs(s, ['h-water'])).toEqual({ write: [], stale: ['h-water'] });
    expect(staleLogs(s, ['h-water'], [])).toEqual(['h-water']);
    expect(staleLogs(s, ['h-water'], ['h-water'])).toEqual([]);
  });
});

describe('F34 PS-30 — runnerPartOfDay 24h parity with F27 & suggestTemplate priority', () => {
  it('(+) runnerPartOfDay matches F27 currentPartOfDay across all 24 hours (0..23)', () => {
    for (let h = 0; h < 24; h++) {
      expect(runnerPartOfDay(h)).toBe(currentPartOfDay(h));
    }
  });

  it('(+) suggestTemplate: activeId wins -> user copy in slot beats built-in -> built-in in slot', () => {
    expect(suggestTemplate(BUILT_IN_TEMPLATES, 8, null)).toEqual({
      templateId: 'builtin-morning',
      reason: 'part_of_day',
    });
    expect(suggestTemplate(BUILT_IN_TEMPLATES, 14, null)).toEqual({
      templateId: 'builtin-work',
      reason: 'part_of_day',
    });
    expect(suggestTemplate(BUILT_IN_TEMPLATES, 21, null)).toEqual({
      templateId: 'builtin-evening',
      reason: 'part_of_day',
    });

    // User copy in morning slot beats builtin-morning
    const userMorningCopy: RoutineTemplate = {
      ...TIMED_ONLY_TPL,
      id: 'user-morning-copy',
      builtIn: false,
      partOfDay: 'morning',
    };
    expect(suggestTemplate([...BUILT_IN_TEMPLATES, userMorningCopy], 8, null)).toEqual({
      templateId: 'user-morning-copy',
      reason: 'part_of_day',
    });

    // Explicit activeId overrides part-of-day
    expect(suggestTemplate([...BUILT_IN_TEMPLATES, userMorningCopy], 8, 'builtin-evening')).toEqual({
      templateId: 'builtin-evening',
      reason: 'active',
    });
  });

  it('(-) unknown activeId falls back to part_of_day; returns null when no template matches', () => {
    expect(suggestTemplate(BUILT_IN_TEMPLATES, 8, 'non-existent-id')).toEqual({
      templateId: 'builtin-morning',
      reason: 'part_of_day',
    });

    const slotlessOnly: RoutineTemplate[] = [
      { ...MIXED_TPL, id: 'custom-no-slot', partOfDay: undefined },
    ];
    expect(suggestTemplate(slotlessOnly, 8, 'unknown')).toBeNull();
    expect(suggestTemplate([], 8, null)).toBeNull();
  });
});
