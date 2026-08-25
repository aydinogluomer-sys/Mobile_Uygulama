import { create } from 'zustand';
import { supabase, Routine } from '../lib/supabase';
import { useSubscriptionStore } from './subscriptionStore';
import { useHabitStore } from './habitStore';
import {
  validateRoutineProposal,
  evaluateProposal,
  type RoutineProposal,
  type ProposalEvaluation,
} from '../lib/routineProposal';
import { findRoutinePack, packToProposal, type RoutinePackKey } from '../lib/routinePacks';
import { insertRoutineHabits, type InstallHabitRow } from '../repositories/habitRepository';
import { computeWillpowerCost } from '../lib/triage';
import type { HabitLoadInput } from '../lib/capacity';

/**
 * The AI/Routine Pack install gate.  (Phase 3, CODER-J, plan §13 / Gate D)
 *
 * BEFORE this change: `addGeneratedToHabits` took the AI's JSON straight off
 * the wire and wrote it to `habits` with only nullish-coalescing defaults
 * (`item.tracking_type ?? 'boolean'`) -- no schema check, no capacity check.
 * That is the exact thing plan §13 forbids ("AI hiçbir zaman doğrudan
 * database write yapmayacaktır"). See this task's report for the full
 * before/after.
 *
 * NOW: every write in this file runs
 *   AI/pack proposal -> validateRoutineProposal -> evaluateProposal
 *   -> staged in state for the UI to preview -> confirmInstall()
 *   (explicit user action) -> repositories/habitRepository.ts
 * `proposal`/`evaluation` are the ONLY things `confirmInstall` ever writes,
 * and both are only ever set together, only ever from
 * `validateRoutineProposal`'s `ok:true` branch -- there is no code path that
 * sets `proposal` from an unvalidated value.
 */

export type ProposalSource = 'ai' | 'pack';

type RoutineStore = {
  routines: Routine[];
  fetchRoutines: () => Promise<void>;

  // ── AI generation (unchanged wire call; the difference is what happens to
  // the response once it arrives -- see generateRoutine below). ──
  generating: boolean;
  generateError: string | null;
  generateRoutine: (prompt: string) => Promise<void>;

  // ── The gate's staged state. Populated by generateRoutine (AI) or
  // loadPack (Routine Packs) -- the two entry points share one pipeline, so
  // a pack gets exactly the same validation + capacity treatment an AI
  // response does, never a bypass. Only ever consumed by confirmInstall. ──
  proposalSource: ProposalSource | null;
  proposal: RoutineProposal | null;
  /** Non-null only when validation FAILED -- a clear, user-facing reason per
   *  problem, never a crash and never a silent no-op (Gate D). */
  proposalErrors: string[] | null;
  evaluation: ProposalEvaluation | null;
  loadPack: (key: RoutinePackKey) => void;
  clearGenerated: () => void;

  // ── Step 5 of the pipeline -- the only place a write happens. ──
  installing: boolean;
  installError: string | null;
  installed: boolean;
  confirmInstall: () => Promise<boolean>;
};

/**
 * Bridges TODAY's actual `generate-routine` wire shape
 * (`{name, description, items:[{name, tracking_type, ...}]}`) onto the field
 * names `validateRoutineProposal` checks (`{title, goal,
 * habits:[{name, tracking_type, difficulty, estimated_minutes}]}` -- plan
 * §13's canonical schema).
 *
 * This is a PURE RENAME of whatever value is already present at each key --
 * it invents nothing and drops nothing the validator itself checks. In
 * particular, the edge function's current prompt never asks the AI for
 * `difficulty`/`estimated_minutes` (see this task's Edge Function Findings);
 * those two keys come through here as `undefined`, and the validator
 * correctly rejects the proposal for a missing required field rather than
 * this function silently inventing a plausible-looking value. That is by
 * design -- see `lib/routineProposal.ts`'s "no coercion" rule in its file
 * doc. This function is intentionally NOT exported from `lib/routineProposal.ts`:
 * it is wiring for today's specific edge-function response shape, not part
 * of the plan §13 schema the validator itself embodies.
 */
function adaptGeneratedRoutine(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const r = raw as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items : undefined;
  return {
    title: r.name,
    goal: r.description,
    habits: items?.map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
      const i = item as Record<string, unknown>;
      return {
        name: i.name,
        tracking_type: i.tracking_type,
        difficulty: i.difficulty,
        estimated_minutes: i.estimated_minutes,
      };
    }),
  };
}

/** Today's active habits, shaped for `evaluateProposal`'s capacity baseline. */
function activeHabitLoadInputs(): HabitLoadInput[] {
  return useHabitStore
    .getState()
    .habits.filter((h) => h.status === 'active')
    .map((h) => ({
      difficulty: h.difficulty,
      estimated_minutes: h.estimated_minutes,
      frequency_config: h.frequency_config,
      impact_level: h.impact_level,
    }));
}

export const useRoutineStore = create<RoutineStore>((set, get) => ({
  routines: [],
  fetchRoutines: async () => {
    const { data } = await supabase.from('routines').select('*').order('id');
    if (data) set({ routines: data as Routine[] });
  },

  generating: false,
  generateError: null,

  proposalSource: null,
  proposal: null,
  proposalErrors: null,
  evaluation: null,

  installing: false,
  installError: null,
  installed: false,

  generateRoutine: async (prompt) => {
    // Oturum kontrolü
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      set({ generateError: 'Bu özelliği kullanmak için giriş yapman gerekiyor.', generating: false });
      return;
    }

    set({
      generating: true,
      generateError: null,
      proposalSource: null,
      proposal: null,
      proposalErrors: null,
      evaluation: null,
      installed: false,
      installError: null,
    });
    try {
      const { data, error } = await supabase.functions.invoke('generate-routine', {
        body: { prompt },
      });

      if (error) {
        // FunctionsHttpError içinden sunucunun döndürdüğü mesajı çek
        let msg = 'Bir hata oluştu, tekrar deneyin.';
        try {
          const body = await (error as any).context?.json?.();
          if (body?.error) msg = body.error;
          if (typeof body?.balance === 'number') useSubscriptionStore.getState().setBalance(body.balance);
        } catch {
          if (error.message) msg = error.message;
        }
        set({ generateError: msg, generating: false });
        return;
      }

      if (data?.error) {
        set({ generateError: data.error, generating: false });
        return;
      }

      if (typeof data?.balance === 'number') useSubscriptionStore.getState().setBalance(data.balance);

      // ── THE GATE (plan §13). Nothing past this line is the AI's raw
      // response -- `validation.proposal` only exists on the `ok:true`
      // branch, so there is no variable in this function that could hold an
      // unvalidated value and later reach `confirmInstall`. ──
      const validation = validateRoutineProposal(adaptGeneratedRoutine(data));
      if (!validation.ok) {
        set({
          generating: false,
          proposalSource: 'ai',
          proposalErrors: validation.errors.map((e) => e.message),
        });
        return;
      }

      const evaluation = evaluateProposal(validation.proposal, { activeHabits: activeHabitLoadInputs() });
      set({
        generating: false,
        proposalSource: 'ai',
        proposal: validation.proposal,
        evaluation,
        proposalErrors: null,
      });
    } catch (err) {
      set({ generateError: err instanceof Error ? err.message : 'Sunucu hatası.', generating: false });
    }
  },

  loadPack: (key) => {
    const pack = findRoutinePack(key);
    if (!pack) {
      set({ proposalSource: 'pack', proposal: null, evaluation: null, proposalErrors: [`Bilinmeyen paket: ${key}`] });
      return;
    }
    // A pack goes through the SAME validator an AI response does -- see
    // routinePacks.ts's doc. A pack failing here would be a bug in
    // routinePacks.ts, not a real AI failure, but it is still surfaced
    // through the same never-silently-write path rather than thrown.
    const validation = validateRoutineProposal(packToProposal(pack));
    if (!validation.ok) {
      set({
        proposalSource: 'pack',
        proposal: null,
        evaluation: null,
        proposalErrors: validation.errors.map((e) => e.message),
      });
      return;
    }
    const evaluation = evaluateProposal(validation.proposal, { activeHabits: activeHabitLoadInputs() });
    set({
      proposalSource: 'pack',
      proposal: validation.proposal,
      evaluation,
      proposalErrors: null,
      generateError: null,
      installed: false,
      installError: null,
    });
  },

  clearGenerated: () => set({
    generateError: null,
    proposalSource: null,
    proposal: null,
    proposalErrors: null,
    evaluation: null,
    installed: false,
    installError: null,
  }),

  // Step 5 of the pipeline -- the ONLY function in this store that writes to
  // the database, and only ever from `proposal`/`evaluation` already staged
  // by a validated + capacity-evaluated result above. Capacity-gated:
  // `evaluation.toActivate` habits install as 'active', everything else
  // (`evaluation.toQueue`) installs as 'waiting' -- never force-activated.
  confirmInstall: async () => {
    const { proposal, evaluation, installing } = get();
    if (!proposal || !evaluation || installing) return false;

    set({ installing: true, installError: null });
    try {
      const activateSet = new Set(evaluation.toActivate);
      const rows: InstallHabitRow[] = proposal.habits.map((h) => {
        const trackingType: 'boolean' | 'numeric' = h.tracking_type === 'numeric' ? 'numeric' : 'boolean';
        const dailyFreq = { kind: 'daily' as const };
        return {
          name: h.name,
          icon: null,
          tracking_type: trackingType,
          unit: null,
          daily_goal: null,
          target_direction: null,
          frequency_config: dailyFreq,
          willpower_cost: computeWillpowerCost({
            difficulty: h.difficulty,
            impact_level: 'medium',
            behavior_type: 'positive',
            tracking_type: trackingType,
            frequency_config: dailyFreq,
            estimated_minutes: h.estimated_minutes,
          }),
          difficulty: h.difficulty,
          estimated_minutes: h.estimated_minutes,
          status: activateSet.has(h.name) ? 'active' : 'waiting',
        };
      });

      const result = await insertRoutineHabits(rows);
      if (!result.ok) {
        set({ installing: false, installError: result.error });
        return false;
      }

      // Reflect the new habits immediately -- same pattern habitStore.addHabit
      // uses (prepend to local state rather than forcing a refetch).
      useHabitStore.setState((s) => ({ habits: [...result.data, ...s.habits] }));

      set({
        installing: false,
        installed: true,
        installError: null,
        proposal: null,
        evaluation: null,
        proposalErrors: null,
      });
      return true;
    } catch (err) {
      set({ installing: false, installError: err instanceof Error ? err.message : 'Kurulum başarısız.' });
      return false;
    }
  },
}));
