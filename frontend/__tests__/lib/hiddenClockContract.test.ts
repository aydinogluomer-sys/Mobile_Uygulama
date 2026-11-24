/**
 * F15 (INT-20): Pure domain calculators (`starterPlan.ts`, `focusReport.ts`,
 * `journalStats.ts`) take explicit clock inputs instead of reading hidden
 * wall-clock time inside function bodies.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { HabitLoadInput } from '../../lib/capacity';
import { ranking, type FocusSessionRow } from '../../lib/focusReport';
import { computeJournalStats } from '../../lib/journalStats';
import { EMPTY_ANSWERS, type OnboardingAnswers } from '../../lib/onboarding';
import { buildStarterPlan, type StarterPlanContext } from '../../lib/starterPlan';
import type { JournalEntry } from '../../store/journalStore';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');

function stripFunctionParamDateDefaults(code: string): string {
  let out = '';
  const re = /\bfunction\b[^{()]*\(/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    out += code.slice(last, openIdx + 1);
    let depth = 1;
    let i = openIdx + 1;
    while (i < code.length && depth > 0) {
      if (code[i] === '(') depth += 1;
      else if (code[i] === ')') depth -= 1;
      i += 1;
    }
    const paramList = code
      .slice(openIdx + 1, i - 1)
      .replace(/=\s*new\s+Date\s*\(\s*\)/g, '= __CLOCK_DEFAULT__');
    out += `${paramList})`;
    last = i;
    re.lastIndex = i;
  }
  out += code.slice(last);
  return out;
}

function findHiddenClockReads(sourceText: string): string[] {
  const withoutComments = stripComments(sourceText);
  // Allow ONLY `= new Date()` inside `function ... (...)` parameter lists.
  const withoutDefaults = stripFunctionParamDateDefaults(withoutComments);
  const hits: string[] = [];
  const lines = withoutDefaults.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/\bnew\s+Date\s*\(\s*\)/.test(line)) {
      hits.push(`L${i + 1}: bare new Date()`);
    }
    if (/\bDate\.now\s*\(/.test(line)) {
      hits.push(`L${i + 1}: Date.now()`);
    }
  }
  return hits;
}

describe('F15 hiddenClockContract — static source fence', () => {
  it('(-) detector flags bare new Date() and Date.now() while allowing = new Date() defaults', () => {
    expect(findHiddenClockReads('function f(now: Date = new Date()) { return new Date(now); }')).toEqual([]);
    expect(findHiddenClockReads('function f() { const now = new Date(); return now; }')).toEqual([
      'L1: bare new Date()',
    ]);
    expect(findHiddenClockReads('function f() { let d: Date = new Date(); return d; }')).toEqual([
      'L1: bare new Date()',
    ]);
    expect(findHiddenClockReads('function f() { return Date.now(); }')).toEqual(['L1: Date.now()']);
  });

  it.each([
    'lib/starterPlan.ts',
    'lib/focusReport.ts',
    'lib/journalStats.ts',
  ])('(-) %s has zero hidden new Date() or Date.now() calls outside = new Date() parameter defaults', (relPath) => {
    const raw = readFileSync(join(ROOT, relPath), 'utf8');
    expect({ file: relPath, hits: findHiddenClockReads(raw) }).toEqual({
      file: relPath,
      hits: [],
    });
  });
});

describe('F15 hiddenClockContract — deterministic clock behavior across local midnight', () => {
  it('(+) buildStarterPlan is deterministic for a fixed asOf and shifts load when asOf crosses range_start at midnight', () => {
    const a: OnboardingAnswers = { ...EMPTY_ANSWERS, pace: 'intensive', goals: ['focus_productivity'] };
    const rangedHeavy: HabitLoadInput = {
      difficulty: 5,
      estimated_minutes: 60,
      frequency_config: { kind: 'daily', range_start: '2026-08-05', range_end: '2026-08-31' },
      impact_level: 'high',
    };

    const beforeMidnight = new Date(2026, 7, 4, 23, 59, 59);
    const afterMidnight = new Date(2026, 7, 5, 0, 0, 1);

    const ctxBefore: StarterPlanContext = {
      activeHabits: [rangedHeavy],
      ceiling: 18,
      asOf: beforeMidnight,
    };
    const ctxAfter: StarterPlanContext = {
      activeHabits: [rangedHeavy],
      ceiling: 18,
      asOf: afterMidnight,
    };

    const first = buildStarterPlan(a, ctxBefore);
    const second = buildStarterPlan(a, ctxBefore);
    expect(second).toEqual(first);

    const nextDay = buildStarterPlan(a, ctxAfter);
    expect(first.currentLoad).toBe(0);
    expect(nextDay.currentLoad).toBeGreaterThan(0);
    expect(nextDay.habits.length).toBeLessThan(first.habits.length);
  });

  it('(+) ranking(sessions, now) evaluates streak relative to injected now across 23:59:59 -> 00:00:01 local', () => {
    const sAug3: FocusSessionRow = {
      id: 's-aug3',
      task_id: null,
      task_title: 'Derin okuma',
      mode: 'work',
      started_at: new Date(2026, 7, 3, 14, 0, 0).toISOString(),
      ended_at: new Date(2026, 7, 3, 14, 25, 0).toISOString(),
      planned_seconds: 1500,
      completed_seconds: 1500,
      completed: true,
    };

    const aug4Late = ranking([sAug3], new Date(2026, 7, 4, 23, 59, 59));
    const aug5Early = ranking([sAug3], new Date(2026, 7, 5, 0, 0, 1));
    expect(aug4Late.streak).toBe(1);
    expect(aug5Early.streak).toBe(0);
  });

  it('(+) computeJournalStats(entries, now) evaluates streak and thisMonth relative to injected now across local midnight', () => {
    const entries: JournalEntry[] = [
      {
        id: 'j1',
        user_id: 'u1',
        date: '2026-08-30',
        content: 'Ağustos sonu',
        mood: 4,
        ai_summary: null,
        created_at: '2026-08-30T18:00:00.000Z',
      },
    ];

    const aug31Late = computeJournalStats(entries, new Date(2026, 7, 31, 23, 59, 59));
    const sep1Early = computeJournalStats(entries, new Date(2026, 8, 1, 0, 0, 1));

    expect(aug31Late.streak).toBe(1);
    expect(aug31Late.thisMonth).toBe(1);
    expect(sep1Early.streak).toBe(0);
    expect(sep1Early.thisMonth).toBe(0);
  });
});
