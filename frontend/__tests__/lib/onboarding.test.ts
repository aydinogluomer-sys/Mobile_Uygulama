/**
 * The onboarding vocabulary and its validation rules.
 *
 * ## Why the ids are tested against the migration
 *
 * `019_user_onboarding.sql` enumerates the allowed goals, barriers,
 * paces and dayparts in CHECK constraints. If this file's list and that file's
 * list drift, the failure appears as a constraint violation the user reads as
 * "kaydedilemedi" — at the end of the flow, after they answered everything.
 * AC-OB00 compares the two directly so the drift fails here instead.
 *
 * AC-OB00  the ids match the live CHECK constraints, both directions
 * AC-OB01  goal selection: minimum, maximum, and what happens at the limit
 * AC-OB02  barrier is single-select, daypart is multi
 * AC-OB03  unknown ids from the server are dropped, not carried
 * AC-OB04  the explanation comes from the answers, not from imagination
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BARRIER_IDS, DAYPART_IDS, GOAL_IDS, MAX_GOALS, PACE_IDS,
  EMPTY_ANSWERS, SKIP_DEFAULT_ANSWERS,
  canAdvanceFromNeeds, canAdvanceFromPreferences, explainPlan, normaliseAnswers,
  toggleDaypart, toggleGoal,
  type GoalId,
} from '../../lib/onboarding';
import * as onboarding from '../../lib/onboarding';

const MIGRATION = readFileSync(
  join(__dirname, '..', '..', '..', 'supabase', 'migrations', '019_user_onboarding.sql'),
  'utf8',
);

describe('AC-OB00 the vocabulary matches the database', () => {
  it('the migration was found', () => {
    // Reading an empty string would let every containment check below pass.
    expect(MIGRATION.length).toBeGreaterThan(1000);
    expect(MIGRATION).toContain('user_onboarding_goals_check');
  });

  it.each([...GOAL_IDS])('goal %s is accepted by the CHECK', (goal) => {
    expect(MIGRATION).toContain(`'${goal}'`);
  });

  it.each([...BARRIER_IDS])('barrier %s is accepted by the CHECK', (barrier) => {
    expect(MIGRATION).toContain(`'${barrier}'`);
  });

  it.each([...PACE_IDS])('pace %s is accepted by the CHECK', (pace) => {
    expect(MIGRATION).toContain(`'${pace}'`);
  });

  it.each([...DAYPART_IDS])('daypart %s is accepted by the CHECK', (daypart) => {
    expect(MIGRATION).toContain(`'${daypart}'`);
  });

  it('the maximum this app enforces is the maximum the database enforces', () => {
    // Client-side `MAX_GOALS` and the SQL `array_length(goals, 1) <= 3` are
    // the same rule written twice; if only one moves, one of them is wrong.
    expect(MIGRATION).toContain(`array_length(goals, 1) <= ${MAX_GOALS}`);
  });
});

describe('AC-OB01 goal selection', () => {
  it('needs at least one goal before advancing', () => {
    expect(canAdvanceFromNeeds({ goals: [] })).toBe(false);
    expect(canAdvanceFromNeeds({ goals: ['sleep'] })).toBe(true);
  });

  it('adds and removes', () => {
    let goals: GoalId[] = [];
    goals = toggleGoal(goals, 'sleep');
    expect(goals).toEqual(['sleep']);
    goals = toggleGoal(goals, 'sleep');
    expect(goals).toEqual([]);
  });

  it('refuses the fourth rather than evicting the first', () => {
    // Silent eviction would make the chip the user just tapped appear to work
    // while one they chose earlier vanishes — correct count, wrong contents,
    // and no way for them to tell what happened.
    const three: GoalId[] = ['sleep', 'learning', 'finance'];
    const after = toggleGoal(three, 'health_energy');
    expect(after).toEqual(three);
    expect(after).not.toContain('health_energy');
  });

  it('deselecting at the limit still works', () => {
    const three: GoalId[] = ['sleep', 'learning', 'finance'];
    expect(toggleGoal(three, 'learning')).toEqual(['sleep', 'finance']);
  });
});

describe('AC-OB02 barrier is single, dayparts are many', () => {
  it('preferences need a pace and nothing else', () => {
    expect(canAdvanceFromPreferences({ pace: null })).toBe(false);
    expect(canAdvanceFromPreferences({ pace: 'gentle' })).toBe(true);
  });

  it('dayparts accumulate', () => {
    let parts = toggleDaypart([], 'morning');
    parts = toggleDaypart(parts, 'evening');
    expect(parts).toEqual(['morning', 'evening']);
    parts = toggleDaypart(parts, 'morning');
    expect(parts).toEqual(['evening']);
  });

  it('there is no toggle for the barrier — it is set, so it replaces', () => {
    // A shape assertion rather than prose: a `toggleBarrier` appearing later
    // would be the moment single-select quietly became multi, and the screen
    // would keep working while storing two answers to a one-answer question.
    const exported = onboarding as unknown as Record<string, unknown>;
    expect(exported.toggleBarrier).toBeUndefined();
    expect(typeof exported.toggleGoal).toBe('function');      // positive control
  });
});

describe('AC-OB03 server values are normalised, not trusted', () => {
  it('keeps what it knows', () => {
    const a = normaliseAnswers({
      goals: ['sleep', 'finance'],
      primary_barrier: 'consistency',
      pace: 'gentle',
      preferred_dayparts: ['morning', 'bedtime'],
      reminder_intent: true,
    });
    expect(a).toEqual({
      goals: ['sleep', 'finance'],
      primaryBarrier: 'consistency',
      pace: 'gentle',
      preferredDayparts: ['morning', 'bedtime'],
      reminderIntent: true,
    });
  });

  it('drops ids this build does not know', () => {
    // A goal nothing can match would narrow the candidate pool to nothing and
    // the user would get an empty plan with no explanation.
    const a = normaliseAnswers({
      goals: ['sleep', 'astrology', 42],
      primary_barrier: 'procrastination_v2',
      pace: 'turbo',
      preferred_dayparts: ['morning', 'lunchtime'],
      reminder_intent: 'yes',
    });
    expect(a.goals).toEqual(['sleep']);
    expect(a.primaryBarrier).toBeNull();
    expect(a.pace).toBeNull();
    expect(a.preferredDayparts).toEqual(['morning']);
    expect(a.reminderIntent).toBeNull();
  });

  it('survives a row with nothing in it', () => {
    expect(normaliseAnswers({})).toEqual(EMPTY_ANSWERS);
  });

  it('caps an over-long goal list from an older or newer client', () => {
    const a = normaliseAnswers({ goals: ['sleep', 'learning', 'finance', 'daily_order'] });
    expect(a.goals).toHaveLength(MAX_GOALS);
  });
});

describe('AC-OB04 "Neden bu plan?" is derived, not invented', () => {
  const full = { habitCount: 3, requestedMax: 3 };

  it('names the barrier the user actually chose', () => {
    const lines = explainPlan({ ...EMPTY_ANSWERS, primaryBarrier: 'consistency' }, full);
    expect(lines.join(' ')).toContain('Devamlılığı korumakta zorlandığını');
  });

  it('a different barrier produces a different reason', () => {
    const a = explainPlan({ ...EMPTY_ANSWERS, primaryBarrier: 'lack_of_time' }, full);
    const b = explainPlan({ ...EMPTY_ANSWERS, primaryBarrier: 'consistency' }, full);
    expect(a).not.toEqual(b);
  });

  it('cites the chosen goals by their Turkish labels', () => {
    // OWNER DECISION OD-06 (2026-11-21): GOAL_LABELS.finance = 'Ev & Evrak Düzeni'.
    const lines = explainPlan({ ...EMPTY_ANSWERS, goals: ['sleep', 'finance'] }, full);
    expect(lines.join(' ')).toContain('Uyku ve Ev & Evrak Düzeni');
  });

  it('says nothing at all when nothing was answered', () => {
    // No barrier, no goals, no dayparts, and the plan matched the request:
    // there is genuinely nothing to explain, and inventing a sentence here is
    // exactly the "fake AI language" the brief rules out.
    expect(explainPlan(EMPTY_ANSWERS, full)).toEqual([]);
  });

  it('admits when the ceiling, not the pace, decided the size', () => {
    const lines = explainPlan(EMPTY_ANSWERS, { habitCount: 2, requestedMax: 5 });
    expect(lines.join(' ')).toContain('Günlük kapasiten');
    expect(lines.join(' ')).toContain('2 alışkanlığı');
  });

  it('the skip defaults still produce an explanation', () => {
    // A skipped user gets a real plan, so they get a real reason too.
    expect(explainPlan(SKIP_DEFAULT_ANSWERS, full).length).toBeGreaterThan(0);
  });
});
