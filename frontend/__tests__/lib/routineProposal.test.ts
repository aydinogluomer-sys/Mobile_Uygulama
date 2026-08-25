/**
 * Routine Proposal Gate tests.  (Phase 3, CODER-J, plan §13 / Gate D)
 *
 * Pure domain tests -- no I/O, no Supabase, no store. This is the barrier
 * plan §13 demands ("AI hiçbir zaman doğrudan database write yapmayacaktır"):
 * every hostile/malformed input class named in this task's brief gets its
 * own test, asserting BOTH that it is rejected AND that the rejection
 * carries the right reason (the "unknown tracking_type" vs "blocked
 * tracking_type" distinction in particular).
 */
import {
  validateRoutineProposal,
  evaluateProposal,
  VALID_DIFFICULTIES,
  PERSISTABLE_TRACKING_TYPES,
  BLOCKED_TRACKING_TYPES,
  MAX_ESTIMATED_MINUTES,
  MAX_HABITS_PER_PROPOSAL,
  type RoutineProposal,
} from '../../lib/routineProposal';
import { habitLoadPoints, CAPACITY_CEILING_DEFAULT, type HabitLoadInput } from '../../lib/capacity';

// A minimal, fully-valid proposal matching plan §13's schema verbatim.
function validRaw() {
  return {
    title: 'Sabah Rutini',
    goal: 'Daha üretken bir sabah',
    habits: [
      { name: 'Su iç', tracking_type: 'binary', difficulty: 1, estimated_minutes: 2 },
      { name: 'Meditasyon', tracking_type: 'binary', difficulty: 3, estimated_minutes: 15 },
    ],
  };
}

describe('validateRoutineProposal -- the happy path', () => {
  it('accepts a well-formed proposal matching plan §13\'s schema', () => {
    const result = validateRoutineProposal(validRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.proposal.title).toBe('Sabah Rutini');
    expect(result.proposal.habits).toHaveLength(2);
    expect(result.proposal.habits[0]).toEqual({
      name: 'Su iç', tracking_type: 'binary', difficulty: 1, estimated_minutes: 2,
    });
  });

  it('trims title/goal/habit names', () => {
    const raw = validRaw();
    raw.title = '  Sabah Rutini  ';
    raw.habits[0].name = '  Su iç  ';
    const result = validateRoutineProposal(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.proposal.title).toBe('Sabah Rutini');
    expect(result.proposal.habits[0].name).toBe('Su iç');
  });

  it('the ok:false branch never carries a usable "proposal" field (no partial-valid shape)', () => {
    const result = validateRoutineProposal({ title: '', goal: '', habits: [] });
    expect(result.ok).toBe(false);
    expect('proposal' in result).toBe(false);
  });

  it('accumulates every error in one pass instead of failing fast on the first', () => {
    const raw = { title: '', goal: 'ok', habits: [{ name: '', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5 }] };
    const result = validateRoutineProposal(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    // Both the empty title AND the empty habit name are reported -- neither
    // masks the other.
    expect(result.errors.some((e) => e.path === 'title')).toBe(true);
    expect(result.errors.some((e) => e.path === 'habits[0].name')).toBe(true);
  });
});

describe('validateRoutineProposal -- root shape', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', ['x']],
    ['a string', 'hello'],
    ['a number', 42],
  ])('rejects a root that is %s, not an object', (_label, raw) => {
    const result = validateRoutineProposal(raw);
    expect(result.ok).toBe(false);
  });
});

describe('validateRoutineProposal -- missing / wrong-typed fields', () => {
  it('rejects a missing title', () => {
    const raw = validRaw() as any;
    delete raw.title;
    const result = validateRoutineProposal(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    expect(result.errors.some((e) => e.path === 'title')).toBe(true);
  });

  it('rejects a non-string title', () => {
    const raw = { ...validRaw(), title: 12345 };
    const result = validateRoutineProposal(raw);
    expect(result.ok).toBe(false);
  });

  it('rejects null in place of goal', () => {
    const raw = { ...validRaw(), goal: null };
    const result = validateRoutineProposal(raw);
    expect(result.ok).toBe(false);
  });

  it('rejects a title over the max length', () => {
    const raw = { ...validRaw(), title: 'x'.repeat(101) };
    const result = validateRoutineProposal(raw);
    expect(result.ok).toBe(false);
  });
});

describe('validateRoutineProposal -- habits array shape', () => {
  it('rejects habits: undefined', () => {
    const raw = validRaw() as any;
    delete raw.habits;
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it('rejects habits that is not an array', () => {
    const raw = { ...validRaw(), habits: 'not-an-array' };
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it('rejects an EMPTY habit array', () => {
    const raw = { ...validRaw(), habits: [] };
    const result = validateRoutineProposal(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    expect(result.errors.some((e) => e.path === 'habits')).toBe(true);
  });

  it(`rejects more than ${MAX_HABITS_PER_PROPOSAL} habits (defensive ceiling on a hostile/glitched response)`, () => {
    const raw = {
      ...validRaw(),
      habits: Array.from({ length: MAX_HABITS_PER_PROPOSAL + 1 }, (_, i) => ({
        name: `Habit ${i}`, tracking_type: 'binary', difficulty: 1, estimated_minutes: 5,
      })),
    };
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it('rejects a non-object element inside habits', () => {
    const raw = { ...validRaw(), habits: ['not-an-object'] };
    const result = validateRoutineProposal(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    expect(result.errors.some((e) => e.path === 'habits[0]')).toBe(true);
  });
});

describe('validateRoutineProposal -- per-habit name', () => {
  it('rejects a missing name', () => {
    const raw = validRaw();
    delete (raw.habits[0] as any).name;
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it('rejects a non-string name', () => {
    const raw = validRaw();
    (raw.habits[0] as any).name = 42;
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it('rejects an empty / whitespace-only name', () => {
    const raw = validRaw();
    raw.habits[0].name = '   ';
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it('rejects a name of unreasonable length', () => {
    const raw = validRaw();
    raw.habits[0].name = 'x'.repeat(81);
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it('rejects duplicate habit names (case-insensitive, trimmed)', () => {
    const raw = validRaw();
    raw.habits[1].name = '  su iç  ';
    const result = validateRoutineProposal(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    expect(result.errors.some((e) => /duplicate habit name/.test(e.message))).toBe(true);
  });
});

describe('validateRoutineProposal -- tracking_type', () => {
  it('rejects a missing tracking_type', () => {
    const raw = validRaw();
    delete (raw.habits[0] as any).tracking_type;
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it('rejects a non-string tracking_type', () => {
    const raw = validRaw();
    (raw.habits[0] as any).tracking_type = 7;
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it('rejects a totally unknown tracking_type with a GENERIC "unknown" reason', () => {
    const raw = validRaw();
    raw.habits[0].tracking_type = 'quantum';
    const result = validateRoutineProposal(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    const err = result.errors.find((e) => e.path === 'habits[0].tracking_type')!;
    expect(err.message).toMatch(/unknown tracking_type/);
  });

  it.each(BLOCKED_TRACKING_TYPES)(
    "rejects '%s' with a SPECIFIC not-persistable reason naming the blocked migration -- distinct from 'unknown'",
    (blocked) => {
      const raw = validRaw();
      raw.habits[0].tracking_type = blocked;
      const result = validateRoutineProposal(raw);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected ok:false');
      const err = result.errors.find((e) => e.path === 'habits[0].tracking_type')!;
      expect(err.message).toMatch(/cannot be persisted/);
      expect(err.message).toMatch(/migration/i);
      expect(err.message).not.toMatch(/unknown tracking_type/);
    }
  );

  it.each(PERSISTABLE_TRACKING_TYPES)("accepts '%s' (persistable today)", (tt) => {
    const raw = validRaw();
    raw.habits[0].tracking_type = tt;
    expect(validateRoutineProposal(raw).ok).toBe(true);
  });
});

describe('validateRoutineProposal -- difficulty', () => {
  it('rejects a missing difficulty', () => {
    const raw = validRaw();
    delete (raw.habits[0] as any).difficulty;
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it('rejects a non-number difficulty', () => {
    const raw = validRaw();
    (raw.habits[0] as any).difficulty = '3';
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it.each([0, 99, -1, 2, 4, NaN, Infinity])('rejects the absurd/invalid difficulty %p', (d) => {
    const raw = validRaw();
    (raw.habits[0] as any).difficulty = d;
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it.each(VALID_DIFFICULTIES)('accepts the real difficulty level %p', (d) => {
    const raw = validRaw();
    raw.habits[0].difficulty = d as 1 | 3 | 5;
    expect(validateRoutineProposal(raw).ok).toBe(true);
  });
});

describe('validateRoutineProposal -- estimated_minutes', () => {
  it('rejects a missing estimated_minutes', () => {
    const raw = validRaw();
    delete (raw.habits[0] as any).estimated_minutes;
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it('rejects a negative estimated_minutes', () => {
    const raw = validRaw();
    raw.habits[0].estimated_minutes = -5;
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it(`rejects an absurdly large estimated_minutes (10^6, well past the ${MAX_ESTIMATED_MINUTES}-minute ceiling of one day)`, () => {
    const raw = validRaw();
    raw.habits[0].estimated_minutes = 1_000_000;
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it('rejects NaN / Infinity', () => {
    const rawNaN = validRaw();
    rawNaN.habits[0].estimated_minutes = NaN;
    expect(validateRoutineProposal(rawNaN).ok).toBe(false);

    const rawInf = validRaw();
    rawInf.habits[0].estimated_minutes = Infinity;
    expect(validateRoutineProposal(rawInf).ok).toBe(false);
  });

  it('accepts 0 (a legitimately near-instant habit)', () => {
    const raw = validRaw();
    raw.habits[0].estimated_minutes = 0;
    expect(validateRoutineProposal(raw).ok).toBe(true);
  });
});

describe('validateRoutineProposal -- extra / hostile keys', () => {
  it('rejects an unexpected top-level key', () => {
    const raw = { ...validRaw(), admin: true };
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it('rejects an unexpected per-habit key', () => {
    const raw = validRaw();
    (raw.habits[0] as any).willpower_cost = 3;
    expect(validateRoutineProposal(raw).ok).toBe(false);
  });

  it('rejects a __proto__ key on the root object, arriving via real JSON.parse (not just an object literal)', () => {
    const json = '{"title":"t","goal":"g","__proto__":{"polluted":true},"habits":[{"name":"x","tracking_type":"binary","difficulty":1,"estimated_minutes":5}]}';
    const parsed = JSON.parse(json);
    // Sanity: JSON.parse really does create __proto__ as an own key here.
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(true);
    const result = validateRoutineProposal(parsed);
    expect(result.ok).toBe(false);
  });

  it('rejects a constructor key inside a habit, via real JSON.parse', () => {
    const json = '{"title":"t","goal":"g","habits":[{"name":"x","tracking_type":"binary","difficulty":1,"estimated_minutes":5,"constructor":{"polluted":true}}]}';
    const result = validateRoutineProposal(JSON.parse(json));
    expect(result.ok).toBe(false);
  });

  it('does NOT flag a legitimate proposal that merely mentions "constructor" or "prototype" as a VALUE (only as a KEY)', () => {
    const raw = validRaw();
    raw.habits[0].name = 'Read about JS prototype chains';
    expect(validateRoutineProposal(raw).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateProposal -- capacity gate (step 2 of plan §13's pipeline)
// ---------------------------------------------------------------------------

function loadInput(overrides: Partial<HabitLoadInput> = {}): HabitLoadInput {
  return { difficulty: 5, estimated_minutes: 90, frequency_config: { kind: 'daily' }, impact_level: null, ...overrides };
}

describe('evaluateProposal -- activates what fits, queues what does not', () => {
  it("plan §13's worked shape: a heavy day + a multi-habit proposal activates some, queues the rest", () => {
    // 4 already-active maximally-heavy habits: 4 * 18 = 72 points of load.
    const activeHabits: HabitLoadInput[] = [loadInput(), loadInput(), loadInput(), loadInput()];

    const proposal: RoutineProposal = {
      title: 'Ağır paket', goal: 'test',
      habits: [
        { name: 'Light 1', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5 },   // small
        { name: 'Light 2', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5 },   // small
        { name: 'Heavy 1', tracking_type: 'binary', difficulty: 5, estimated_minutes: 90 },  // 18 points -- pushes 72->90, over 85
        { name: 'Heavy 2', tracking_type: 'binary', difficulty: 5, estimated_minutes: 90 },
      ],
    };

    const evaluation = evaluateProposal(proposal, { activeHabits });

    expect(evaluation.currentLoad).toBe(72);
    // The two light habits fit (72 -> ~73 -> ~74); the two heavy ones would
    // each individually cross the 85 ceiling from that point on, so both
    // are queued, never force-activated.
    expect(evaluation.toActivate).toEqual(['Light 1', 'Light 2']);
    expect(evaluation.toQueue).toEqual(['Heavy 1', 'Heavy 2']);
    expect(evaluation.habits.find((h) => h.name === 'Heavy 1')!.fits).toBe(false);
  });

  it('a queued habit does not consume capacity -- a LATER light habit can still fit', () => {
    const proposal: RoutineProposal = {
      title: 't', goal: 'g',
      habits: [
        { name: 'Heavy (queued)', tracking_type: 'binary', difficulty: 5, estimated_minutes: 90 }, // 18 pts
        { name: 'Light (fits)', tracking_type: 'binary', difficulty: 1, estimated_minutes: 2 },
      ],
    };
    // Baseline load 72 (4 maximally-heavy active habits, 18 pts each): the
    // heavy proposal habit alone would push 72 -> 90 (over the 85 ceiling)
    // so it is queued and its points are NOT folded into the running total
    // -- the light habit right after it is evaluated against 72 again, not
    // 90, and fits.
    const activeHabits: HabitLoadInput[] = [loadInput(), loadInput(), loadInput(), loadInput()];
    const evaluation = evaluateProposal(proposal, { activeHabits });
    expect(evaluation.currentLoad).toBe(72);
    expect(evaluation.toQueue).toContain('Heavy (queued)');
    expect(evaluation.toActivate).toContain('Light (fits)');
  });

  it('respects a ceiling override', () => {
    const proposal: RoutineProposal = {
      title: 't', goal: 'g',
      habits: [{ name: 'Any', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5 }],
    };
    const strict = evaluateProposal(proposal, { activeHabits: [], ceiling: 0 });
    expect(strict.toActivate).toEqual([]);
    expect(strict.toQueue).toEqual(['Any']);

    const lenient = evaluateProposal(proposal, { activeHabits: [], ceiling: 100 });
    expect(lenient.toActivate).toEqual(['Any']);
  });

  it('defaults to CAPACITY_CEILING_DEFAULT when no ceiling is supplied', () => {
    const proposal: RoutineProposal = {
      title: 't', goal: 'g',
      habits: [{ name: 'Any', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5 }],
    };
    const evaluation = evaluateProposal(proposal, { activeHabits: [] });
    expect(evaluation.ceiling).toBe(CAPACITY_CEILING_DEFAULT);
  });

  it('each habit\'s reported `points` matches capacity.ts\'s own habitLoadPoints for the same inputs', () => {
    const proposal: RoutineProposal = {
      title: 't', goal: 'g',
      habits: [{ name: 'X', tracking_type: 'numeric', difficulty: 3, estimated_minutes: 20 }],
    };
    const evaluation = evaluateProposal(proposal, { activeHabits: [] });
    const expected = habitLoadPoints({ difficulty: 3, estimated_minutes: 20, frequency_config: { kind: 'daily' }, impact_level: null });
    expect(evaluation.habits[0].points).toBeCloseTo(expected, 10);
  });

  it('totalIncomingPoints sums every habit\'s points regardless of fit/queue outcome', () => {
    const proposal: RoutineProposal = {
      title: 't', goal: 'g',
      habits: [
        { name: 'A', tracking_type: 'binary', difficulty: 5, estimated_minutes: 90 },
        { name: 'B', tracking_type: 'binary', difficulty: 5, estimated_minutes: 90 },
      ],
    };
    const evaluation = evaluateProposal(proposal, { activeHabits: [], ceiling: 10 }); // forces both to queue
    expect(evaluation.toActivate).toEqual([]);
    expect(evaluation.toQueue).toEqual(['A', 'B']);
    expect(evaluation.totalIncomingPoints).toBeCloseTo(36, 5); // 18 + 18
  });
});
