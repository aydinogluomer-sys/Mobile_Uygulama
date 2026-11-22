/**
 * The first-run plan engine.
 *
 * ## The claim that matters most
 *
 * A new account gets a usable plan with no provider, no network and no
 * credit. That is not a nice-to-have: `generate-routine` currently fails on
 * all three counts, and making the first screen a user ever sees depend on it
 * would mean the worst first impression happens on exactly the days the
 * provider is unwell. AC-SP00 enforces it by walking the module's transitive
 * imports, so the dependency cannot come back through a helper.
 *
 * ## Every answer has to change something
 *
 * The rest of this file is that promise, one answer at a time. A question
 * whose answer does not move the plan is a question that should not be asked,
 * so each of these is a test that the onboarding is not a survey.
 *
 * AC-SP00  no AI / network / supabase anywhere in the import graph
 * AC-SP01  deterministic: same answers in, identical plan out
 * AC-SP02  pace decides size, within the Capacity Engine's ceiling
 * AC-SP03  goals decide which habits are chosen
 * AC-SP04  dayparts decide ordering and the persisted schedule
 * AC-SP05  lack_of_time shortens; oversized_goals lowers the target
 * AC-SP06  the ceiling wins over the pace card, and says so
 * AC-SP07  the plan is installable: it validates as a RoutineProposal
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { buildStarterPlan, starterCandidates, groupByDaypart } from '../../lib/starterPlan';
import { validateRoutineProposal } from '../../lib/routineProposal';
import { CAPACITY_CEILING_DEFAULT } from '../../lib/capacity';
import { EMPTY_ANSWERS, type OnboardingAnswers } from '../../lib/onboarding';
import { stripComments } from '../helpers/sourceText';

const LIB = join(__dirname, '..', '..', 'lib');

function answers(patch: Partial<OnboardingAnswers>): OnboardingAnswers {
  return { ...EMPTY_ANSWERS, pace: 'balanced', ...patch };
}

const NO_LOAD = { activeHabits: [], asOf: new Date(2026, 7, 4, 12, 0, 0) };

// ---------------------------------------------------------------------------
describe('AC-SP00 first-run planning has no external dependency', () => {
  /**
   * Every local module reachable from `entry` AT RUNTIME, transitively.
   *
   * `import type { … }` statements are removed first, and that is the point
   * rather than a convenience: a type-only import is erased by the compiler
   * and creates no runtime edge. `starterPlan.ts` and `routinePacks.ts` both
   * take `FrequencyConfig` from `lib/supabase.ts` that way — the shape of a
   * schedule, not the client. Counting those would report a dependency that
   * does not exist in the bundle, and the honest fix would then have been to
   * duplicate the type rather than to remove a dependency.
   */
  function importGraph(entry: string): string[] {
    const seen = new Set<string>();
    const stack = [entry];
    while (stack.length) {
      const file = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, 'utf8').replace(/import\s+type\s+[^;]*;/g, '');
      const re = /from\s+'(\.[^']+)'/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const base = resolve(dirname(file), m[1]);
        const candidate = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]
          .find((p) => existsSync(p));
        if (candidate) stack.push(candidate);
      }
    }
    return [...seen];
  }

  const graph = importGraph(join(LIB, 'starterPlan.ts'));

  it('the walker actually walked something', () => {
    // A one-file graph would make every assertion below vacuous.
    expect(graph.length).toBeGreaterThan(3);
    expect(graph.some((f) => f.endsWith('routinePacks.ts'))).toBe(true);
    expect(graph.some((f) => f.endsWith('capacity.ts'))).toBe(true);
  });

  it('reaches no AI, edge-function or network module', () => {
    const forbidden = ['aiInvoke', 'edgeCall', 'supabase.ts'];
    const offenders = graph.filter((f) => forbidden.some((bad) => f.endsWith(`${bad}.ts`) || f.endsWith(bad)));
    // `lib/supabase.ts` constructs a client on import; reaching it would make
    // plan generation depend on a configured project even offline.
    expect(offenders.map((f) => f.replace(LIB, 'lib'))).toEqual([]);
  });

  it('calls nothing over the network', () => {
    // Comments are stripped: `routineProposal.ts` documents the edge
    // function's contract at length, and a module that DESCRIBES an AI
    // response is not a module that fetches one.
    for (const file of graph) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const call of ['fetch(', 'functions.invoke(', 'withEdgeDeadline(', 'invokeAi(']) {
        expect({ file: file.replace(LIB, 'lib'), call, present: code.includes(call) })
          .toEqual({ file: file.replace(LIB, 'lib'), call, present: false });
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe('AC-SP01 deterministic', () => {
  it('the same answers produce an identical plan', () => {
    const a = answers({ goals: ['sleep', 'health_energy'], primaryBarrier: 'consistency', preferredDayparts: ['bedtime'] });
    const first = buildStarterPlan(a, NO_LOAD);
    const second = buildStarterPlan(a, NO_LOAD);
    expect(second).toEqual(first);
  });

  it('equal-scoring candidates come out in candidate order', () => {
    // With no goals, no dayparts and no barrier every candidate scores 0, so
    // this is the case where the tiebreak alone decides.
    const flat = answers({ pace: 'intensive' });
    const plan = buildStarterPlan(flat, NO_LOAD);
    const candidateOrder = starterCandidates().map((c) => c.name);
    const chosen = plan.habits.map((h) => h.name);
    expect(chosen).toEqual(candidateOrder.filter((n) => chosen.includes(n)));
  });

  it('the comparator does not rely on the engine to break ties', () => {
    /**
     * A SOURCE assertion, and deliberately so.
     *
     * The behavioural test above passes with or without the explicit
     * `index` fallback — measured, not assumed: deleting `|| (a.c.index -
     * b.c.index)` leaves the whole suite green, because V8's `Array#sort`
     * has been stable since ES2019 and equal scores keep insertion order
     * either way.
     *
     * So the property "determinism is a property of these rules, not of the
     * runtime that happens to run them" cannot be observed from outside; the
     * only way to check it is to look at the comparator. Writing a
     * behavioural test that appears to cover it would be worse than this one,
     * because it would claim a guarantee it does not hold.
     */
    const src = stripComments(readFileSync(join(LIB, 'starterPlan.ts'), 'utf8'));
    expect(src).toContain('(a.c.index - b.c.index)');
  });
});

// ---------------------------------------------------------------------------
describe('AC-SP02 pace decides size', () => {
  it('gentle stays at or below two habits', () => {
    const plan = buildStarterPlan(answers({ pace: 'gentle' }), NO_LOAD);
    expect(plan.habits.length).toBeGreaterThan(0);
    expect(plan.habits.length).toBeLessThanOrEqual(2);
  });

  it('balanced lands on three', () => {
    const plan = buildStarterPlan(answers({ pace: 'balanced' }), NO_LOAD);
    expect(plan.habits).toHaveLength(3);
  });

  it('intensive never exceeds five', () => {
    const plan = buildStarterPlan(answers({ pace: 'intensive' }), NO_LOAD);
    expect(plan.habits.length).toBeLessThanOrEqual(5);
    expect(plan.habits.length).toBeGreaterThan(3);
  });

  it('a plan never pushes the day past the ceiling', () => {
    for (const pace of ['gentle', 'balanced', 'intensive'] as const) {
      const plan = buildStarterPlan(answers({ pace }), NO_LOAD);
      expect(plan.projectedLoad).toBeLessThanOrEqual(CAPACITY_CEILING_DEFAULT);
    }
  });
});

// ---------------------------------------------------------------------------
describe('AC-SP03 goals decide which habits are chosen', () => {
  it('sleep goals produce sleep habits', () => {
    const plan = buildStarterPlan(answers({ goals: ['sleep'] }), NO_LOAD);
    expect(plan.habits.length).toBeGreaterThan(0);
    for (const habit of plan.habits) expect(habit.goals).toContain('sleep');
  });

  it('a finance goal is not decorative — it changes the plan', () => {
    // The four original packs had no finance habit at all, which would have
    // made this answer change nothing. `everyday-foundations` exists for it.
    const plan = buildStarterPlan(answers({ goals: ['finance'], pace: 'gentle' }), NO_LOAD);
    expect(plan.habits.some((h) => h.goals.includes('finance'))).toBe(true);
  });

  it('different goals produce different plans', () => {
    const sleep = buildStarterPlan(answers({ goals: ['sleep'] }), NO_LOAD);
    const focus = buildStarterPlan(answers({ goals: ['focus_productivity'] }), NO_LOAD);
    expect(focus.habits.map((h) => h.name)).not.toEqual(sleep.habits.map((h) => h.name));
  });
});

// ---------------------------------------------------------------------------
describe('AC-SP04 dayparts reach the plan and the schedule', () => {
  it('a morning preference pulls morning habits in', () => {
    const plan = buildStarterPlan(
      answers({ goals: ['health_energy'], preferredDayparts: ['morning'], pace: 'gentle' }),
      NO_LOAD,
    );
    expect(plan.habits.some((h) => h.daypart === 'morning')).toBe(true);
  });

  it('the daypart becomes real schedule data, not just a label', () => {
    const plan = buildStarterPlan(answers({ preferredDayparts: ['bedtime'], goals: ['sleep'] }), NO_LOAD);
    const bedtime = plan.habits.filter((h) => h.daypart === 'bedtime');
    expect(bedtime.length).toBeGreaterThan(0);
    for (const habit of bedtime) {
      // `bedtime` folds into `evening` — the schema's `part_of_day` has three
      // values, and widening a shared enum for an onboarding-only distinction
      // would push this vocabulary into everything that reads a schedule.
      expect(habit.frequency_config.part_of_day).toEqual(['evening']);
    }
  });

  it('grouping is in day order, not selection order', () => {
    const plan = buildStarterPlan(answers({ pace: 'intensive' }), NO_LOAD);
    const order = groupByDaypart(plan).map((g) => g.daypart);
    const expected = ['morning', 'daytime', 'evening', 'bedtime'].filter((d) => order.includes(d as never));
    expect(order).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
describe('AC-SP05 barriers change the habits themselves', () => {
  it('lack_of_time shortens the day', () => {
    const base = buildStarterPlan(answers({ goals: ['health_energy'] }), NO_LOAD);
    const rushed = buildStarterPlan(answers({ goals: ['health_energy'], primaryBarrier: 'lack_of_time' }), NO_LOAD);
    expect(rushed.totalMinutes).toBeLessThan(base.totalMinutes);
  });

  it('oversized_goals halves a numeric target rather than dropping the habit', () => {
    const plan = buildStarterPlan(
      answers({ goals: ['health_energy'], primaryBarrier: 'oversized_goals', pace: 'intensive' }),
      NO_LOAD,
    );
    const numeric = plan.habits.filter((h) => h.daily_goal != null);
    expect(numeric.length).toBeGreaterThan(0);
    for (const habit of numeric) {
      expect(habit.reduced).not.toBeNull();
      expect(habit.reduced!.goalFrom).not.toBeNull();
      expect(habit.daily_goal!).toBeLessThan(habit.reduced!.goalFrom!);
    }
  });

  it('nothing is reduced below a floor', () => {
    const plan = buildStarterPlan(answers({ primaryBarrier: 'lack_of_time', pace: 'intensive' }), NO_LOAD);
    for (const habit of plan.habits) expect(habit.estimated_minutes).toBeGreaterThanOrEqual(3);
  });

  it('no barrier means no reduction', () => {
    const plan = buildStarterPlan(answers({ goals: ['health_energy'] }), NO_LOAD);
    for (const habit of plan.habits) expect(habit.reduced).toBeNull();
  });

  it('getting_started prefers the easiest habits available', () => {
    const plan = buildStarterPlan(answers({ primaryBarrier: 'getting_started', pace: 'gentle' }), NO_LOAD);
    for (const habit of plan.habits) expect(habit.difficulty).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
describe('AC-SP06 the ceiling outranks the pace card', () => {
  it('a nearly-full day yields a smaller plan, and the plan says so', () => {
    // An explicit low ceiling rather than a pile of heavy habits: the
    // assertion is about the trim, and deriving "nearly full" from fixture
    // load would make this test fail whenever `capacity.ts`'s v1 heuristic
    // constants are retuned — which is a different thing going wrong.
    const plan = buildStarterPlan(answers({ pace: 'intensive' }), {
      activeHabits: [],
      ceiling: 12,
      asOf: new Date(2026, 7, 4, 12, 0, 0),
    });
    expect(plan.habits.length).toBeLessThan(plan.requestedMax);
    expect(plan.trimmedByCapacity).toBe(true);
    expect(plan.projectedLoad).toBeLessThanOrEqual(12);
  });

  it('an empty day is not reported as trimmed', () => {
    const plan = buildStarterPlan(answers({ pace: 'balanced' }), NO_LOAD);
    expect(plan.trimmedByCapacity).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('AC-SP07 the plan is installable', () => {
  it('it passes the same validator an AI proposal must pass', () => {
    const plan = buildStarterPlan(answers({ goals: ['sleep'], pace: 'intensive' }), NO_LOAD);
    const result = validateRoutineProposal({
      title: 'Başlangıç planın',
      goal: 'Onboarding sırasında oluşturulan kişisel başlangıç planı.',
      habits: plan.habits.map((h) => ({
        name: h.name,
        tracking_type: h.tracking_type,
        difficulty: h.difficulty,
        estimated_minutes: h.estimated_minutes,
      })),
    });
    expect(result.ok).toBe(true);
  });

  it('every habit carries the fields the installer persists', () => {
    const plan = buildStarterPlan(answers({ pace: 'intensive' }), NO_LOAD);
    for (const habit of plan.habits) {
      expect(typeof habit.icon).toBe('string');
      expect(habit.frequency_config.kind).toBe('daily');
      expect(['binary', 'numeric']).toContain(habit.tracking_type);
    }
  });
});
