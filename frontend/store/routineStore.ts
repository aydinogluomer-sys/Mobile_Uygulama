import { create } from 'zustand';
import { supabase, Routine } from '../lib/supabase';
import { useSubscriptionStore } from './subscriptionStore';
import { useHabitStore } from './habitStore';
import {
  validateRoutineProposal,
  evaluateProposal,
  adaptEdgeRoutineResponse,
  completeAdaptedProposal,
  type RoutineProposal,
  type ProposalEvaluation,
  type AdaptedRoutineProposal,
  type ProposalCompletion,
} from '../lib/routineProposal';
import { findRoutinePack, packToProposal, type RoutinePackKey } from '../lib/routinePacks';
import { insertRoutineHabits, type InstallHabitRow } from '../repositories/habitRepository';
import { computeWillpowerCost } from '../lib/triage';
import type { HabitLoadInput } from '../lib/capacity';
import { buildEvent, emitEvent, type AnalyticsEventName } from '../lib/analytics';
import { fetchRoutines as repoFetchRoutines } from '../repositories/routineRepository';

/**
 * §22 analytics emission seam (task Phase-4 CODER-O) -- see the identical
 * wrapper in `store/habitStore.ts` for the full rationale. In short: run the
 * payload through `buildEvent` (which drops free text by shape, here, at the
 * call site), hand the result to `lib/analytics.ts`'s sink funnel, and never
 * let `buildEvent`'s deliberate throw escape into the user action.
 */
function emitAnalytics(name: AnalyticsEventName, props: Record<string, unknown>): void {
  try {
    emitEvent(buildEvent(name, props));
  } catch {
    /* §22: an analytics failure is never a product failure. */
  }
}

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
  /** Non-null when validation FAILED (a clear, user-facing reason per
   *  problem -- never a crash and never a silent no-op, Gate D) OR when a
   *  proposal was accepted but is still `pendingProposal`-incomplete (in
   *  that case these are "please supply X" prompts, not rejection reasons
   *  -- see `pendingProposal`'s own doc). */
  proposalErrors: string[] | null;
  evaluation: ProposalEvaluation | null;
  /** Non-null ONLY for an AI proposal `adaptEdgeRoutineResponse` accepted
   *  but could not fully evaluate -- today's real edge function never sends
   *  `difficulty`/`estimated_minutes` (see `lib/routineProposal.ts`'s doc).
   *  `proposal`/`evaluation` stay `null` while this is set: nothing here is
   *  capacity-evaluated or installable until `completeProposal` below turns
   *  it into a real `proposal`, using values the user supplies -- never a
   *  guessed default. */
  pendingProposal: AdaptedRoutineProposal | null;
  loadPack: (key: RoutinePackKey) => void;
  clearGenerated: () => void;
  /** Step 1.5 of the pipeline, AI-only: turns `pendingProposal` into a real,
   *  capacity-evaluated `proposal` using one user-supplied
   *  {difficulty, estimated_minutes} pair per habit (index-aligned). Runs
   *  the completed values through the exact same strict validator as
   *  everything else -- a hostile/absurd value typed into the completion UI
   *  is rejected here exactly like anywhere else in the gate. */
  completeProposal: (completions: ProposalCompletion[]) => void;

  // ── Step 5 of the pipeline -- the only place a write happens. ──
  installing: boolean;
  installError: string | null;
  installed: boolean;
  confirmInstall: () => Promise<boolean>;
};

/**
 * Rule 8 regression fix (Phase 3, CODER-K): `adaptGeneratedRoutine` used to
 * live here as a PURE rename with no `tracking_type` mapping and no handling
 * for the edge function's real gap (it never sends `difficulty`/
 * `estimated_minutes` at all) -- so `validateRoutineProposal` rejected every
 * single real AI response outright ("Rutin Oluştur" was broken end-to-end;
 * Routine Packs, which build a complete `RoutineProposal` directly, were
 * unaffected). The adapter now lives in `lib/routineProposal.ts` as
 * `adaptEdgeRoutineResponse` -- it does the same field-renaming PLUS maps
 * `tracking_type`'s vocabulary (`'boolean' -> 'binary'`) AND, when
 * `difficulty`/`estimated_minutes` are genuinely absent, accepts the
 * response as an EXPLICITLY incomplete proposal instead of rejecting it --
 * still never inventing the two missing fields (see that file's doc for the
 * full reasoning). `completeProposal` below is the only place a user-
 * supplied value ever fills them in.
 */

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
    const res = await repoFetchRoutines<Routine>();
    if (res.ok) set({ routines: res.data });
  },

  generating: false,
  generateError: null,

  proposalSource: null,
  proposal: null,
  proposalErrors: null,
  evaluation: null,
  pendingProposal: null,

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
      pendingProposal: null,
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
      // response -- `adapted.proposal` only exists on the `ok:true` branch,
      // so there is no variable in this function that could hold an
      // unvalidated value and later reach `confirmInstall`. `adaptEdgeRoutineResponse`
      // renames today's real edge-function fields onto plan §13's schema
      // AND runs the identical hostile-input checks `validateRoutineProposal`
      // does -- see lib/routineProposal.ts's doc. ──
      const adapted = adaptEdgeRoutineResponse(data);
      if (!adapted.ok) {
        set({
          generating: false,
          proposalSource: 'ai',
          proposalErrors: adapted.errors.map((e) => e.message),
          pendingProposal: null,
        });
        return;
      }

      // §22 `ai_routine_generated`. THE single funnel: every AI response that
      // survives the gate passes exactly this line, whether it lands in the
      // `!adapted.complete` staging branch below or the fully-evaluated one
      // after it, and nothing that failed `adapted.ok` reaches it. Reported
      // here (generation), not at install -- an installed routine is a
      // separate event. `proposal.title`/`goal` are AI prose and are
      // deliberately not passed; only the shape of what came back is.
      emitAnalytics('ai_routine_generated', {
        habit_count: adapted.proposal.habits.length,
        complete: adapted.complete,
      });

      if (!adapted.complete) {
        // Accepted, but today's edge function never asks the AI for
        // difficulty/estimated_minutes -- staged here for the user to
        // supply via AIRoutineModal's completion step (`completeProposal`
        // below). `proposal`/`evaluation` stay null: there is nothing valid
        // to evaluate capacity against yet, and NOTHING is guessed.
        set({
          generating: false,
          proposalSource: 'ai',
          pendingProposal: adapted.proposal,
          proposalErrors: adapted.proposal.missingFieldNotices,
          proposal: null,
          evaluation: null,
        });
        return;
      }

      const evaluation = evaluateProposal(adapted.proposal, { activeHabits: activeHabitLoadInputs() });
      set({
        generating: false,
        proposalSource: 'ai',
        proposal: adapted.proposal,
        evaluation,
        proposalErrors: null,
        pendingProposal: null,
      });
    } catch (err) {
      set({ generateError: err instanceof Error ? err.message : 'Sunucu hatası.', generating: false });
    }
  },

  loadPack: (key) => {
    const pack = findRoutinePack(key);
    if (!pack) {
      set({ proposalSource: 'pack', proposal: null, evaluation: null, proposalErrors: [`Bilinmeyen paket: ${key}`], pendingProposal: null });
      return;
    }
    // A pack goes through the SAME validator an AI response does -- see
    // routinePacks.ts's doc. A pack failing here would be a bug in
    // routinePacks.ts, not a real AI failure, but it is still surfaced
    // through the same never-silently-write path rather than thrown. A pack
    // is always a COMPLETE `RoutineProposal` (difficulty/estimated_minutes
    // are app-authored data, never missing) -- `pendingProposal` is reset
    // here purely so a leftover incomplete AI proposal from a prior attempt
    // cannot linger alongside a freshly-loaded pack in the UI.
    const validation = validateRoutineProposal(packToProposal(pack));
    if (!validation.ok) {
      set({
        proposalSource: 'pack',
        proposal: null,
        evaluation: null,
        proposalErrors: validation.errors.map((e) => e.message),
        pendingProposal: null,
      });
      return;
    }
    const evaluation = evaluateProposal(validation.proposal, { activeHabits: activeHabitLoadInputs() });
    set({
      proposalSource: 'pack',
      proposal: validation.proposal,
      evaluation,
      proposalErrors: null,
      pendingProposal: null,
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
    pendingProposal: null,
    installed: false,
    installError: null,
  }),

  // Step 1.5 of the pipeline, AI-only (see `pendingProposal`'s doc on the
  // type above). Re-validates EVERYTHING via `completeAdaptedProposal` --
  // including the values the user just supplied -- so a hostile/absurd
  // completion input is rejected exactly like anywhere else in the gate,
  // never trusted just because a human typed it.
  completeProposal: (completions) => {
    const { pendingProposal } = get();
    if (!pendingProposal) return;
    const result = completeAdaptedProposal(pendingProposal, completions);
    if (!result.ok) {
      set({ proposalErrors: result.errors.map((e) => e.message) });
      return;
    }
    const evaluation = evaluateProposal(result.proposal, { activeHabits: activeHabitLoadInputs() });
    set({
      pendingProposal: null,
      proposal: result.proposal,
      evaluation,
      proposalErrors: null,
    });
  },

  // Step 5 of the pipeline -- the ONLY function in this store that writes to
  // the database, and only ever from `proposal`/`evaluation` already staged
  // by a validated + capacity-evaluated result above. Capacity-gated:
  // `evaluation.toActivate` habits install as 'active', everything else
  // (`evaluation.toQueue`) installs as 'waiting' -- never force-activated.
  confirmInstall: async () => {
    const { proposal, evaluation, installing, proposalSource } = get();
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
      // §22 `routine_installed`. `confirmInstall` is the only function in
      // this store that writes, and this is its only success exit -- both
      // the AI and the Routine Pack entry points funnel through it, so one
      // finished install is one event. Placed after `result.ok`, so a failed
      // bulk insert (which returns above) is never reported as an install.
      // Habit names live in `rows`/`result.data` and are never passed.
      emitAnalytics('routine_installed', {
        source: proposalSource,
        habit_count: result.data.length,
        activated_count: rows.filter((r) => r.status === 'active').length,
        queued_count: rows.filter((r) => r.status === 'waiting').length,
      });
      return true;
    } catch (err) {
      set({ installing: false, installError: err instanceof Error ? err.message : 'Kurulum başarısız.' });
      return false;
    }
  },
}));
