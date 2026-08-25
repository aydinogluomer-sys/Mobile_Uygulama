/**
 * Rule 8 regression fix (Phase 3, CODER-K): the edge-function response
 * adapter, `adaptEdgeRoutineResponse` / `completeAdaptedProposal` in
 * `lib/routineProposal.ts`.
 *
 * `supabase/functions/generate-routine/index.ts:11`'s SYSTEM_PROMPT asks the
 * AI for `{name, description, items:[{name, icon, tracking_type, unit,
 * daily_goal, frequency_config, willpower_cost}]}` -- field names, a
 * `tracking_type` vocabulary (`'boolean'`) and a missing
 * `difficulty`/`estimated_minutes` pair that do NOT match plan §13's
 * canonical schema (`{title, goal, habits:[{name, tracking_type, difficulty,
 * estimated_minutes}]}`). Before this fix, `validateRoutineProposal` was
 * handed that shape after only a pure field rename (no `tracking_type`
 * mapping, no missing-field handling) and rejected EVERY real AI response
 * outright -- `__tests__/store/routineInstallGate.test.ts`'s "Gate D 2" test
 * (written in e3a9a33) pins exactly that rejection as the observed
 * behaviour; it is in fact the regression this file fixes.
 *
 * The headline test directly below reproduces that exact payload and
 * asserts the OPPOSITE of Gate D 2's old-code assumption: the adapter now
 * ACCEPTS it, producing an explicitly `incomplete` proposal the UI must
 * complete with user input before it can be evaluated or written -- never a
 * silently-guessed default (see this file's own "no coercion" rule).
 */
import {
  adaptEdgeRoutineResponse,
  completeAdaptedProposal,
  evaluateProposal,
  type AdaptedRoutineProposal,
} from '../../lib/routineProposal';
import type { HabitLoadInput } from '../../lib/capacity';

/** TODAY's real edge-function response shape -- exactly as
 *  `supabase/functions/generate-routine/index.ts:11`'s SYSTEM_PROMPT
 *  specifies it, field-for-field: `{name, description,
 *  items:[{name, icon, tracking_type:'boolean', unit, daily_goal,
 *  frequency_config, willpower_cost}]}`. No `difficulty`. No
 *  `estimated_minutes`. Not a contrived fixture. */
function realEdgeResponse() {
  return {
    name: 'Sabah Rutini',
    description: 'Daha üretken bir sabah',
    items: [
      {
        name: 'Su iç', icon: 'water-outline', tracking_type: 'boolean',
        unit: null, daily_goal: null,
        frequency_config: { kind: 'daily', part_of_day: ['morning'] },
        willpower_cost: 2,
      },
      {
        name: 'Meditasyon', icon: 'leaf-outline', tracking_type: 'boolean',
        unit: null, daily_goal: null,
        frequency_config: { kind: 'daily', part_of_day: ['morning'] },
        willpower_cost: 3,
      },
    ],
  };
}

describe('adaptEdgeRoutineResponse -- THE REGRESSION (Rule 8)', () => {
  it("accepts TODAY'S real edge-function response shape and marks it incomplete instead of rejecting it outright", () => {
    const result = adaptEdgeRoutineResponse(realEdgeResponse());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.complete).toBe(false);
    if (result.complete) throw new Error('expected complete:false');

    expect(result.proposal.title).toBe('Sabah Rutini');
    expect(result.proposal.goal).toBe('Daha üretken bir sabah');
    expect(result.proposal.incomplete).toBe(true);
    expect(result.proposal.habits).toHaveLength(2);

    // tracking_type vocabulary mapped: the DB-storage literal the edge
    // function actually sends -> the V2 domain vocabulary the validator
    // expects.
    expect(result.proposal.habits[0].tracking_type).toBe('binary');
    expect(result.proposal.habits[1].tracking_type).toBe('binary');

    // The two capacity-critical fields are explicitly UNSET -- never a
    // guessed default (this is the exact "estimated_minutes: 0" bug this
    // gate exists to prevent from ever recurring).
    expect(result.proposal.habits[0].difficulty).toBeNull();
    expect(result.proposal.habits[0].estimated_minutes).toBeNull();
    expect(result.proposal.habits[1].difficulty).toBeNull();
    expect(result.proposal.habits[1].estimated_minutes).toBeNull();

    // The user is told exactly what to supply, per habit, per field.
    expect(result.proposal.missingFieldNotices.length).toBeGreaterThan(0);
    expect(result.proposal.missingFieldNotices.some((m) => /Su iç/.test(m) && /difficulty/.test(m))).toBe(true);
    expect(result.proposal.missingFieldNotices.some((m) => /Su iç/.test(m) && /estimated_minutes/.test(m))).toBe(true);
  });

  it("maps tracking_type 'numeric' through unchanged", () => {
    const raw = realEdgeResponse();
    (raw.items[0] as any).tracking_type = 'numeric';
    const result = adaptEdgeRoutineResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok || result.complete) throw new Error('expected ok:true, complete:false');
    expect(result.proposal.habits[0].tracking_type).toBe('numeric');
  });

  it('a fully-formed response (difficulty/estimated_minutes already present) is accepted as COMPLETE -- a real, trusted RoutineProposal, ready for evaluateProposal immediately', () => {
    const raw = realEdgeResponse();
    (raw.items[0] as any).difficulty = 3;
    (raw.items[0] as any).estimated_minutes = 10;
    (raw.items[1] as any).difficulty = 1;
    (raw.items[1] as any).estimated_minutes = 2;

    const result = adaptEdgeRoutineResponse(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.complete).toBe(true);
    if (!result.complete) throw new Error('expected complete:true');
    expect(result.proposal.habits[0]).toEqual({ name: 'Su iç', tracking_type: 'binary', difficulty: 3, estimated_minutes: 10 });
    expect(result.proposal.habits[1]).toEqual({ name: 'Meditasyon', tracking_type: 'binary', difficulty: 1, estimated_minutes: 2 });
  });
});

describe('adaptEdgeRoutineResponse -- still rejects hostile input exactly like validateRoutineProposal does', () => {
  it('rejects a non-object root', () => {
    expect(adaptEdgeRoutineResponse(null).ok).toBe(false);
    expect(adaptEdgeRoutineResponse('x').ok).toBe(false);
    expect(adaptEdgeRoutineResponse(42).ok).toBe(false);
    expect(adaptEdgeRoutineResponse(['x']).ok).toBe(false);
  });

  it('rejects a __proto__ key on the root, arriving via real JSON.parse (not just an object literal)', () => {
    const json = '{"name":"n","description":"d","__proto__":{"polluted":true},"items":[{"name":"x","tracking_type":"boolean"}]}';
    const parsed = JSON.parse(json);
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(true);
    expect(adaptEdgeRoutineResponse(parsed).ok).toBe(false);
  });

  it('rejects a constructor key inside an item, via real JSON.parse', () => {
    const json = '{"name":"n","description":"d","items":[{"name":"x","tracking_type":"boolean","constructor":{"polluted":true}}]}';
    expect(adaptEdgeRoutineResponse(JSON.parse(json)).ok).toBe(false);
  });

  it('rejects an unexpected top-level field', () => {
    const raw = { ...realEdgeResponse(), admin: true };
    expect(adaptEdgeRoutineResponse(raw).ok).toBe(false);
  });

  it('rejects an unexpected per-item field (one the edge function never sends)', () => {
    const raw = realEdgeResponse();
    (raw.items[0] as any).evil = 'yes';
    expect(adaptEdgeRoutineResponse(raw).ok).toBe(false);
  });

  it('rejects a wrong-typed tracking_type', () => {
    const raw = realEdgeResponse();
    (raw.items[0] as any).tracking_type = 7;
    expect(adaptEdgeRoutineResponse(raw).ok).toBe(false);
  });

  it('rejects a totally unknown tracking_type with a generic reason', () => {
    const raw = realEdgeResponse();
    raw.items[0].tracking_type = 'quantum';
    const result = adaptEdgeRoutineResponse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    expect(result.errors.some((e) => /unknown tracking_type/.test(e.message))).toBe(true);
  });

  it("rejects a blocked tracking_type ('abstinence') with the specific not-persistable/migration reason, distinct from 'unknown'", () => {
    const raw = realEdgeResponse();
    raw.items[0].tracking_type = 'abstinence';
    const result = adaptEdgeRoutineResponse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    expect(result.errors.some((e) => /cannot be persisted/.test(e.message) && /migration/i.test(e.message))).toBe(true);
  });

  it('rejects an empty items array', () => {
    const raw = { ...realEdgeResponse(), items: [] };
    expect(adaptEdgeRoutineResponse(raw).ok).toBe(false);
  });

  it('rejects more than 10 habits (MAX_HABITS_PER_PROPOSAL)', () => {
    const raw = {
      name: 'n', description: 'd',
      items: Array.from({ length: 11 }, (_, i) => ({ name: `H${i}`, tracking_type: 'boolean' })),
    };
    expect(adaptEdgeRoutineResponse(raw).ok).toBe(false);
  });

  it('rejects a present-but-absurd estimated_minutes (10^6) even though difficulty is ALSO absent -- a real problem is never masked by the "incomplete" path', () => {
    const raw = realEdgeResponse();
    (raw.items[0] as any).estimated_minutes = 1_000_000; // present, absurd -- NOT "missing"
    const result = adaptEdgeRoutineResponse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    expect(result.errors.some((e) => /estimated_minutes/.test(e.message) && /ceiling/.test(e.message))).toBe(true);
  });

  it('rejects a present-but-out-of-range difficulty (99) even though estimated_minutes is ALSO absent', () => {
    const raw = realEdgeResponse();
    (raw.items[0] as any).difficulty = 99; // present, absurd -- NOT "missing"
    expect(adaptEdgeRoutineResponse(raw).ok).toBe(false);
  });

  it('rejects a duplicate habit name when the response is otherwise COMPLETE (difficulty/estimated_minutes present)', () => {
    // validateRoutineProposal only runs its duplicate-name check once every
    // individual habit has ALREADY passed its own per-field checks (see that
    // function's own comment on `allHabitsClean`) -- with difficulty/
    // estimated_minutes present here, both habits clear their own checks, so
    // the duplicate check actually runs and fires.
    const raw = realEdgeResponse();
    (raw.items[0] as any).difficulty = 1; (raw.items[0] as any).estimated_minutes = 5;
    (raw.items[1] as any).difficulty = 3; (raw.items[1] as any).estimated_minutes = 5;
    (raw.items[1] as any).name = '  su iç  ';
    const result = adaptEdgeRoutineResponse(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    expect(result.errors.some((e) => /duplicate habit name/.test(e.message))).toBe(true);
  });

  it('a duplicate habit name that is INVISIBLE while incomplete (both habits also missing difficulty/estimated_minutes) is still caught once the user completes the proposal', () => {
    // The adapter itself accepts this as "incomplete" (see the note above --
    // the duplicate check cannot run yet), but completeAdaptedProposal's
    // final validateRoutineProposal pass -- run on the FULLY completed
    // candidate -- catches it before anything could be written.
    const raw = realEdgeResponse();
    (raw.items[1] as any).name = '  su iç  ';
    const accepted = adaptEdgeRoutineResponse(raw);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok || accepted.complete) throw new Error('expected ok:true, complete:false');

    const completed = completeAdaptedProposal(accepted.proposal, [
      { difficulty: 1, estimated_minutes: 5 },
      { difficulty: 3, estimated_minutes: 5 },
    ]);
    expect(completed.ok).toBe(false);
    if (completed.ok) throw new Error('expected ok:false');
    expect(completed.errors.some((e) => /duplicate habit name/.test(e.message))).toBe(true);
  });
});

describe('completeAdaptedProposal -- the only place a user-supplied value fills the two missing fields', () => {
  function incompleteFrom(raw: unknown): AdaptedRoutineProposal {
    const r = adaptEdgeRoutineResponse(raw);
    if (!r.ok || r.complete) throw new Error('expected an incomplete proposal for this test fixture');
    return r.proposal;
  }

  it('rejects when the completion count does not match the habit count', () => {
    const proposal = incompleteFrom(realEdgeResponse());
    const result = completeAdaptedProposal(proposal, [{ difficulty: 1, estimated_minutes: 5 }]); // only 1, proposal has 2
    expect(result.ok).toBe(false);
  });

  it('turns an incomplete proposal into a real, valid RoutineProposal once completed', () => {
    const proposal = incompleteFrom(realEdgeResponse());
    const result = completeAdaptedProposal(proposal, [
      { difficulty: 1, estimated_minutes: 2 },
      { difficulty: 3, estimated_minutes: 15 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.proposal.habits[0]).toEqual({ name: 'Su iç', tracking_type: 'binary', difficulty: 1, estimated_minutes: 2 });
    expect(result.proposal.habits[1]).toEqual({ name: 'Meditasyon', tracking_type: 'binary', difficulty: 3, estimated_minutes: 15 });
  });

  it('re-validates the user-supplied values -- an absurd completion is rejected, never trusted just because a human typed it', () => {
    const proposal = incompleteFrom(realEdgeResponse());
    const result = completeAdaptedProposal(proposal, [
      { difficulty: 1, estimated_minutes: 2 },
      { difficulty: 99 as any, estimated_minutes: 15 }, // hostile: out of VALID_DIFFICULTIES
    ]);
    expect(result.ok).toBe(false);
  });

  it('a habit whose difficulty was ALREADY present keeps that value, ignoring a different completion value supplied for it', () => {
    const raw = realEdgeResponse();
    (raw.items[0] as any).difficulty = 5; // already present -- only estimated_minutes is missing for it
    const proposal = incompleteFrom(raw);
    expect(proposal.habits[0].difficulty).toBe(5);

    const result = completeAdaptedProposal(proposal, [
      { difficulty: 1, estimated_minutes: 2 }, // difficulty:1 here must be IGNORED for habit 0
      { difficulty: 3, estimated_minutes: 15 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.proposal.habits[0].difficulty).toBe(5); // unchanged
  });

  it("proves the old `estimated_minutes: 0` blindness is gone -- a user-supplied HIGH estimated_minutes pushes a habit into evaluateProposal's queue", () => {
    const proposal = incompleteFrom(realEdgeResponse());
    const result = completeAdaptedProposal(proposal, [
      { difficulty: 5, estimated_minutes: 90 }, // 'Su iç' -- heavy, 18 capacity points
      { difficulty: 1, estimated_minutes: 2 },  // 'Meditasyon' -- light
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');

    // Baseline: 4 already-active maximally-heavy habits = 72 points of load
    // (identical fixture shape to __tests__/lib/routineProposal.test.ts's
    // own worked example).
    const heavy: HabitLoadInput = { difficulty: 5, estimated_minutes: 90, frequency_config: { kind: 'daily' }, impact_level: null };
    const evaluation = evaluateProposal(result.proposal, { activeHabits: [heavy, heavy, heavy, heavy] });

    expect(evaluation.currentLoad).toBe(72);
    // 'Su iç' (the user-supplied HIGH estimated_minutes) would push
    // 72 -> 90, over the 85 ceiling -- queued, never force-activated. Had
    // the old `estimated_minutes: 0` bug still been in effect here, this
    // habit would have registered near-zero load and been silently
    // activated regardless of capacity.
    expect(evaluation.toQueue).toContain('Su iç');
    expect(evaluation.habits.find((h) => h.name === 'Su iç')!.fits).toBe(false);
    expect(evaluation.toActivate).toContain('Meditasyon');
  });
});
