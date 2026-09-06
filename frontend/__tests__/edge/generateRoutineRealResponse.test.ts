/**
 * A REAL Anthropic response, captured from production, run through the gate.
 *
 * Every other fixture in this suite is written by hand — which is exactly how
 * the `balance, cost, replayed` envelope defect survived: a hand-written
 * fixture tests the shape its author imagined. This one is not written at
 * all. It is the verbatim body of a live 200 from `generate-routine` on
 * project kbcuolhjjnmhjaarxxmu, captured on 2026-09-06:
 *
 *   request_id : fp-mtpohn73-8wv5a6wm5glf6c1c
 *   prompt     : "Sabah rutini: erken kalkmak ve güne odaklanarak başlamak istiyorum"
 *   cost       : 25 FP, charged exactly once, not refunded
 *   sha256     : 6ce20a34fb3665d052c8bad19b983933eb4c47041843624244e0c94542fb8629
 *
 * ## What it also pins
 *
 * The model PRETTY-PRINTS. This capture is ~1.4 KB across ~45 lines, and that
 * is the whole reason `MAX_TOKENS = 400` broke every routine generation: the
 * answer was cut mid-`items`, the greedy `/\{[\s\S]*\}/` still matched a
 * plausible-looking fragment ending at the last surviving `}`, and
 * `JSON.parse` threw. Four consecutive live attempts failed at the identical
 * offset — "line 40 column 6" — before `ROUTINE_MAX_TOKENS` was introduced.
 *
 * So this file guards two things at once: that the app accepts what the
 * provider really sends, and that the shape it really sends is the large,
 * indented one the token budget has to accommodate.
 */
import { adaptEdgeRoutineResponse } from '../../lib/routineProposal';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    functions: { invoke: jest.fn() },
    from: () => ({ insert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }),
  },
}));

import { supabase } from '../../lib/supabase';
import { useRoutineStore } from '../../store/routineStore';
import { useSubscriptionStore } from '../../store/subscriptionStore';

/** Verbatim. Do not tidy, reformat or "fix" — it is evidence, not a fixture. */
const REAL_RESPONSE = {
    "name": "Sabah Başlangıcı",
    "description": "Erken kalkıp odaklanarak günü başlatmak için basit sabah rutini.",
    "items": [
      {
        "name": "Erken kalkış",
        "icon": "alarm-outline",
        "tracking_type": "boolean",
        "unit": null,
        "daily_goal": null,
        "frequency_config": {
          "kind": "daily",
          "part_of_day": [
            "morning"
          ]
        },
        "willpower_cost": 4
      },
      {
        "name": "Su içme",
        "icon": "water-outline",
        "tracking_type": "boolean",
        "unit": null,
        "daily_goal": null,
        "frequency_config": {
          "kind": "daily",
          "part_of_day": [
            "morning"
          ]
        },
        "willpower_cost": 1
      },
      {
        "name": "Günün planını yap",
        "icon": "list-outline",
        "tracking_type": "boolean",
        "unit": null,
        "daily_goal": null,
        "frequency_config": {
          "kind": "daily",
          "part_of_day": [
            "morning"
          ]
        },
        "willpower_cost": 3
      },
      {
        "name": "5 dakika meditasyon",
        "icon": "leaf-outline",
        "tracking_type": "boolean",
        "unit": null,
        "daily_goal": null,
        "frequency_config": {
          "kind": "daily",
          "part_of_day": [
            "morning"
          ]
        },
        "willpower_cost": 2
      }
    ],
    "balance": 0,
    "cost": 25,
    "replayed": false
  } as const;

// ---------------------------------------------------------------------------
describe('the capture is what the provider actually sent', () => {
  it('carries the AI payload and the transport envelope in one object', () => {
    expect(Object.keys(REAL_RESPONSE).sort())
      .toEqual(['balance', 'cost', 'description', 'items', 'name', 'replayed']);
  });

  it('is the successful, charged response — 25 FP, not a replay', () => {
    expect(REAL_RESPONSE.cost).toBe(25);
    expect(REAL_RESPONSE.replayed).toBe(false);
    expect(typeof REAL_RESPONSE.balance).toBe('number');
  });

  it('is large enough to have been truncated at the old 400-token budget', () => {
    // The concrete reason ROUTINE_MAX_TOKENS exists. If a future capture were
    // small enough to fit in 400 tokens, this file would stop witnessing the
    // defect it was written for, so it says so out loud.
    const serialised = JSON.stringify(REAL_RESPONSE, null, 2);
    expect(serialised.split('\n').length).toBeGreaterThan(40);
    expect(REAL_RESPONSE.items.length).toBeGreaterThan(2);
  });

  it('every item carries the seven fields the SYSTEM_PROMPT asks for', () => {
    for (const item of REAL_RESPONSE.items) {
      expect(Object.keys(item).sort()).toEqual([
        'daily_goal', 'frequency_config', 'icon', 'name', 'tracking_type', 'unit', 'willpower_cost',
      ]);
    }
  });
});

// ---------------------------------------------------------------------------
describe('the real response passes the app validator', () => {
  it('is accepted, not rejected', () => {
    const adapted = adaptEdgeRoutineResponse(REAL_RESPONSE);
    if (!adapted.ok) {
      throw new Error(`gate rejected a real response: ${adapted.errors.map((e) => e.message).join('; ')}`);
    }
    expect(adapted.ok).toBe(true);
  });

  it('is staged as incomplete, with the AI\'s own habit names intact', () => {
    const adapted = adaptEdgeRoutineResponse(REAL_RESPONSE);
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.complete).toBe(false);
    expect(adapted.proposal.habits).toHaveLength(REAL_RESPONSE.items.length);
    expect(adapted.proposal.habits.map((h) => h.name))
      .toEqual(REAL_RESPONSE.items.map((i) => i.name));
    expect(adapted.proposal.title).toBe(REAL_RESPONSE.name);
    // `boolean` is the DB storage literal; the domain vocabulary is `binary`.
    for (const h of adapted.proposal.habits) expect(h.tracking_type).toBe('binary');
    // Never guessed: the prompt does not ask for these, so they stay null.
    for (const h of adapted.proposal.habits) {
      expect(h.difficulty).toBeNull();
      expect(h.estimated_minutes).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
describe('the real response reaches the staging/preview path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    useRoutineStore.setState({
      generating: false, generateError: null, proposalSource: null,
      proposal: null, proposalErrors: null, evaluation: null, pendingProposal: null,
      installing: false, installError: null, installed: false,
    });
    useSubscriptionStore.setState({ focusPoints: 999 });
  });

  it('stages the proposal for preview instead of erroring', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: REAL_RESPONSE, error: null });

    await useRoutineStore.getState().generateRoutine('Sabah rutini istiyorum');
    const st = useRoutineStore.getState();

    expect(st.generateError).toBeNull();
    expect(st.generating).toBe(false);
    expect(st.proposalSource).toBe('ai');
    expect(st.pendingProposal).not.toBeNull();
    expect(st.pendingProposal!.habits.map((h) => h.name))
      .toEqual(REAL_RESPONSE.items.map((i) => i.name));
    // Nothing was installed: preview is the end of this path.
    expect(st.installed).toBe(false);
    expect(st.proposal).toBeNull();
  });

  it('applies the envelope balance the gate used to choke on', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: REAL_RESPONSE, error: null });
    await useRoutineStore.getState().generateRoutine('Sabah rutini istiyorum');
    expect(useSubscriptionStore.getState().focusPoints).toBe(REAL_RESPONSE.balance);
  });

  it('asks the user only for the two fields the AI genuinely never sends', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: REAL_RESPONSE, error: null });
    await useRoutineStore.getState().generateRoutine('Sabah rutini istiyorum');
    const notices = useRoutineStore.getState().proposalErrors ?? [];
    expect(notices).toHaveLength(REAL_RESPONSE.items.length * 2);
    for (const n of notices) expect(n).toMatch(/zorluk \(difficulty\)|süreyi \(estimated_minutes\)/);
  });
});
