/**
 * The client gate must accept what `generate-routine` actually returns.
 *
 * ## The defect this exists to catch
 *
 * The edge function never returns the AI payload on its own. Every success
 * goes out through one line:
 *
 *     return json({ ...payload, balance, cost, replayed });
 *
 * Three envelope fields — the debited balance, the price and whether the
 * spend was an idempotent replay — are merged into the same object as the
 * AI's `{name, description, items}`. `routineStore.generateRoutine` then
 * hands that whole object to `adaptEdgeRoutineResponse`, whose first job is
 * to reject unexpected top-level keys.
 *
 * So a perfectly good AI response was rejected by the app's own gate with
 * `unexpected field(s): balance, cost, replayed`, and the user saw a
 * validation error for a routine that was generated correctly — after paying
 * 25 Focus Points for it, which are NOT refunded, because the edge function
 * succeeded and the failure is entirely client-side.
 *
 * Every fixture in the suite missed it by constructing the AI payload alone.
 * That is the whole lesson: a hand-written fixture tests the shape the author
 * imagined, so the fixture here is BUILT FROM THE EDGE FUNCTION'S OWN SOURCE
 * — the envelope keys are parsed out of its `return json(...)` line, and the
 * routine body is the literal example its SYSTEM_PROMPT shows the model.
 * Neither can drift from production without this file failing.
 *
 * Verified against the live deployment on 2026-09-06: `generate-routine` on
 * project kbcuolhjjnmhjaarxxmu returns exactly this envelope, and the 402/500
 * paths return `balance`/`cost` too.
 *
 * The envelope is now assembled in `_shared/aiIdempotency.ts` rather than in
 * the handler, because the replay path must return the STORED payload under
 * the same envelope without calling the provider. So that is where the keys
 * are read from — the file that writes them.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

// The store reaches the network and the habit table; neither is the subject
// here, so both are stubbed and the response is the only live variable.
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn(), getUser: jest.fn() },
    functions: { invoke: jest.fn() },
    from: () => ({ insert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }),
  },
}));

import { adaptEdgeRoutineResponse } from '../../lib/routineProposal';
import { supabase } from '../../lib/supabase';
import { useRoutineStore } from '../../store/routineStore';
import { useSubscriptionStore } from '../../store/subscriptionStore';

import { edgeSource } from '../helpers/edgeSource';

const ROOT = join(__dirname, '..', '..');
const FN_SRC = edgeSource('generate-routine');
/** The file that now builds the response body around the AI payload. */
const ORCH_SRC = readFileSync(
  join(ROOT, '..', 'supabase', 'functions', '_shared', 'aiIdempotency.ts'),
  'utf8',
);

/**
 * The keys the function merges alongside the AI payload, read from the
 * function itself rather than restated here.
 */
function envelopeKeysFromSource(): string[] {
  const m = /\{\s*\.\.\.result\.payload,([^}]*)\}/.exec(ORCH_SRC);
  if (!m) throw new Error('could not find the success body in aiIdempotency');
  return m[1]
    .split(',')
    .map((part) => part.trim().split(':')[0].trim())
    .filter(Boolean);
}

/** The replay path must wear the SAME envelope, or a recovered answer would
 *  arrive in a shape the client gate has never been shown. */
function replayEnvelopeKeysFromSource(): string[] {
  const at = ORCH_SRC.indexOf('...begin.response,');
  if (at < 0) throw new Error('could not find the replay body in aiIdempotency');
  const slice = ORCH_SRC.slice(at, at + 240);
  const keys = [...slice.matchAll(/\b(balance|cost|replayed)\b/g)].map((x) => x[1]);
  return [...new Set(keys)];
}

/**
 * The example object the SYSTEM_PROMPT shows the model — i.e. the exact shape
 * the function asks for, in the function's own words.
 */
function payloadShapeFromSource(): Record<string, unknown> {
  const m = /^\{"name":"Rutin.*\}$/m.exec(FN_SRC);
  if (!m) throw new Error('could not find the SYSTEM_PROMPT example payload');
  return JSON.parse(m[0]) as Record<string, unknown>;
}

const ENVELOPE_KEYS = envelopeKeysFromSource();
const PROMPT_SHAPE = payloadShapeFromSource();

/** A plausible model answer in exactly the prompt's shape. */
const AI_PAYLOAD = {
  name: 'Sabah Rutini',
  description: 'Güne odaklanarak başlamak için kısa bir başlangıç.',
  items: [
    {
      name: 'Bir bardak su iç',
      icon: 'water-outline',
      tracking_type: 'boolean',
      unit: null,
      daily_goal: null,
      frequency_config: { kind: 'daily', part_of_day: ['morning'] },
      willpower_cost: 1,
    },
    {
      name: '10 dakika yürüyüş',
      icon: 'walk-outline',
      tracking_type: 'boolean',
      unit: null,
      daily_goal: null,
      frequency_config: { kind: 'daily', part_of_day: ['morning'] },
      willpower_cost: 3,
    },
  ],
};

/** What the client really receives: payload + envelope, as one object. */
const REAL_RESPONSE = { ...AI_PAYLOAD, balance: 5, cost: 25, replayed: false };

// ---------------------------------------------------------------------------
describe('the fixture is the function’s own contract, not an invention', () => {
  it('the success path merges envelope fields into the AI payload', () => {
    expect(ENVELOPE_KEYS).toEqual(['balance', 'cost', 'replayed']);
  });

  it('the replay path wears the same envelope', () => {
    expect(replayEnvelopeKeysFromSource().sort()).toEqual(['balance', 'cost', 'replayed']);
  });

  it('the prompt asks for exactly the top-level keys used above', () => {
    expect(Object.keys(PROMPT_SHAPE).sort()).toEqual(['description', 'items', 'name']);
    expect(Object.keys(AI_PAYLOAD).sort()).toEqual(Object.keys(PROMPT_SHAPE).sort());
  });

  it('the per-item keys match the ones the prompt shows the model', () => {
    const promptItem = (PROMPT_SHAPE.items as Record<string, unknown>[])[0];
    for (const item of AI_PAYLOAD.items) {
      expect(Object.keys(item).sort()).toEqual(Object.keys(promptItem).sort());
    }
  });

  it('the response really does carry keys the AI payload does not', () => {
    // Guards against this file passing vacuously if the envelope were dropped.
    const extra = Object.keys(REAL_RESPONSE).filter((k) => !(k in AI_PAYLOAD));
    expect(extra.sort()).toEqual(['balance', 'cost', 'replayed']);
  });
});

// ---------------------------------------------------------------------------
describe('adaptEdgeRoutineResponse accepts the real response', () => {
  it('does not reject the envelope as an unexpected field', () => {
    const adapted = adaptEdgeRoutineResponse(REAL_RESPONSE);
    if (!adapted.ok) {
      throw new Error(
        `the gate rejected a real edge response: ${adapted.errors.map((e: { message: string }) => e.message).join('; ')}`,
      );
    }
    expect(adapted.ok).toBe(true);
  });

  it('stages it as incomplete, because the prompt never asks for the two capacity fields', () => {
    const adapted = adaptEdgeRoutineResponse(REAL_RESPONSE);
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.complete).toBe(false);
    expect(adapted.proposal.habits).toHaveLength(2);
    expect(adapted.proposal.habits[0].name).toBe('Bir bardak su iç');
    // `boolean` is the DB storage literal; the domain vocabulary is `binary`.
    expect(adapted.proposal.habits[0].tracking_type).toBe('binary');
    // Never guessed — absent stays null until the user supplies it.
    expect(adapted.proposal.habits[0].difficulty).toBeNull();
    expect(adapted.proposal.habits[0].estimated_minutes).toBeNull();
  });

  it('the envelope is not smuggled into the proposal', () => {
    const adapted = adaptEdgeRoutineResponse(REAL_RESPONSE);
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(Object.keys(adapted.proposal)).not.toContain('balance');
    expect(Object.keys(adapted.proposal)).not.toContain('cost');
    expect(Object.keys(adapted.proposal)).not.toContain('replayed');
  });

  it('tolerance is limited to the envelope — other unknown keys still fail', () => {
    // The gate must not have been widened into "accept anything".
    const smuggled = { ...REAL_RESPONSE, install_now: true };
    const adapted = adaptEdgeRoutineResponse(smuggled);
    expect(adapted.ok).toBe(false);
    if (adapted.ok) return;
    expect(adapted.errors[0].message).toContain('install_now');
    expect(adapted.errors[0].message).not.toContain('balance');
  });

  it('a hostile key on an item is still rejected', () => {
    const hostile = {
      ...REAL_RESPONSE,
      items: [{ ...AI_PAYLOAD.items[0], status: 'active' }],
    };
    const adapted = adaptEdgeRoutineResponse(hostile);
    expect(adapted.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('the app stages the real response instead of erroring on it', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: { user: { id: 'u1' } } },
    });
    useRoutineStore.setState({
      generating: false, generateError: null, proposalSource: null,
      proposal: null, proposalErrors: null, evaluation: null, pendingProposal: null,
      installing: false, installError: null, installed: false,
    });
    useSubscriptionStore.setState({ focusPoints: 0 });
  });

  it('a real response reaches the staging state, not the error state', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: REAL_RESPONSE, error: null });

    await useRoutineStore.getState().generateRoutine('Sabah rutini istiyorum');
    const st = useRoutineStore.getState();

    // The defect surfaced HERE: `generateError` stayed null but `proposalErrors`
    // held "unexpected field(s): balance, cost, replayed" and nothing was
    // staged, so the screen showed a validation failure for a routine the user
    // had already paid 25 FP for.
    expect(st.proposalErrors).not.toContain('unexpected field(s): balance, cost, replayed');
    expect(st.generateError).toBeNull();
    expect(st.generating).toBe(false);
    expect(st.proposalSource).toBe('ai');
    expect(st.pendingProposal).not.toBeNull();
    expect(st.pendingProposal!.habits).toHaveLength(2);
    expect(st.pendingProposal!.habits.map((h) => h.name))
      .toEqual(['Bir bardak su iç', '10 dakika yürüyüş']);
  });

  it('what the screen renders is the completion prompt, not a rejection', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: REAL_RESPONSE, error: null });
    await useRoutineStore.getState().generateRoutine('Sabah rutini istiyorum');

    const notices = useRoutineStore.getState().proposalErrors ?? [];
    // One notice per genuinely-absent field, naming the habit -- the two the
    // prompt never asks the model for, and nothing else.
    expect(notices).toHaveLength(4);
    for (const n of notices) expect(n).toMatch(/zorluk \(difficulty\)|süreyi \(estimated_minutes\)/);
    expect(notices.some((n) => n.includes('Bir bardak su iç'))).toBe(true);
  });

  it('the envelope balance is applied to the credit display', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: REAL_RESPONSE, error: null });
    await useRoutineStore.getState().generateRoutine('Sabah rutini istiyorum');
    // The same field the gate used to choke on is the one the UI needs.
    expect(useSubscriptionStore.getState().focusPoints).toBe(REAL_RESPONSE.balance);
  });

  it('a genuinely malformed response still lands in the error state', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: { ...REAL_RESPONSE, items: [{ ...AI_PAYLOAD.items[0], tracking_type: 'timer' }] },
      error: null,
    });
    await useRoutineStore.getState().generateRoutine('Sabah rutini istiyorum');
    const st = useRoutineStore.getState();
    expect(st.pendingProposal).toBeNull();
    expect(st.proposalErrors && st.proposalErrors.length).toBeGreaterThan(0);
  });
});
