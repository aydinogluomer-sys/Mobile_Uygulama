import { registerAccountScoped } from '../lib/accountScope';
import { createLatest } from '../lib/latestOnly';
import { withEdgeDeadline } from '../lib/edgeCall';
import { newRequestId } from '../services/focusPointService';
import { createAttemptKeeper, isNoAnswer, NO_ANSWER_NOTE, IN_PROGRESS_NOTE, retryWhileInProgress } from '../lib/aiAttempt';
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
import { findRoutinePack, packIcons, packToProposal, type RoutinePackKey } from '../lib/routinePacks';
import { installProposal, listRoutines as repoFetchRoutines } from '../services/routineService';
import type { HabitLoadInput } from '../lib/capacity';
import { buildEvent, emitEvent, type AnalyticsEventName } from '../lib/analytics';


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

/**
 * Where the staged proposal came from.
 *
 * `'coach'` is a third ENTRY POINT, not a third pipeline: a habit suggested in
 * conversation goes through the same validator, the same capacity evaluation
 * and the same `confirmInstall` as an AI routine or a pack. That is the whole
 * reason it is a source value here rather than its own store — a second way to
 * write habits is exactly what this gate exists to prevent.
 */
export type ProposalSource = 'ai' | 'pack' | 'coach';

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
  /** R05.01 — the staged pack's icons by habit name; null for any other source. */
  stagedIcons: Record<string, string> | null;
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
  /** Stage a habit/plan suggested in AI Coach. Same validator, same capacity
   *  evaluation, same `confirmInstall` as every other source — returns whether
   *  the proposal survived validation so the caller can say so in chat. */
  stageCoachProposal: (proposal: RoutineProposal) => boolean;
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

// R09.06 -- one open (unanswered) generation attempt at a time.
const routineAttempt = createAttemptKeeper(newRequestId);
const generateLatest = createLatest();

export const useRoutineStore = create<RoutineStore>((set, get) => ({
  routines: [],
  fetchRoutines: async () => {
    const res = await repoFetchRoutines<Routine>();
    if (res.ok) set({ routines: res.data });
  },

  generating: false,
  generateError: null,

  proposalSource: null,

  stagedIcons: null,
  proposal: null,
  proposalErrors: null,
  evaluation: null,
  pendingProposal: null,

  installing: false,
  installError: null,
  installed: false,

  generateRoutine: async (prompt) => {
    // Çift dokunuş: ikinci çağrı ağ çağrısı yapmaz (farklı metinle iki ücretli çağrı olurdu).
    if (get().generating) return;
    const run = generateLatest.begin();
    set({
      generating: true,
      generateError: null,
      proposalSource: null,
      stagedIcons: null,
      proposal: null,
      proposalErrors: null,
      evaluation: null,
      pendingProposal: null,
      installed: false,
      installError: null,
    });
    try {
      // R09.06 -- a resend of the same prompt after a lost answer reuses the id (one charge).
      // Oturum kontrolü
      const { data: { session } } = await supabase.auth.getSession();
      if (!run.isCurrent()) return;
      if (!session) {
        set({ generateError: 'Bu özelliği kullanmak için giriş yapman gerekiyor.', generating: false });
        return;
      }

      const requestId = routineAttempt.begin(prompt);
      const outcome = await retryWhileInProgress(
        () => withEdgeDeadline('AI rutin', (signal) =>
          supabase.functions.invoke('generate-routine', {
            signal,
            body: { prompt, request_id: requestId },
          })),
      );
      if (!run.isCurrent()) return;
      const { data, error } = outcome;

      if (error && isNoAnswer(error)) {
        set({ generateError: NO_ANSWER_NOTE, generating: false });
        return;
      }
      if (outcome.stillInProgress) { set({ generateError: IN_PROGRESS_NOTE, generating: false }); return; }
      routineAttempt.answered();
      if (error) {
        // FunctionsHttpError içinden sunucunun döndürdüğü mesajı çek
        let msg = 'Bir hata oluştu, tekrar deneyin.';
        const body = outcome.errorInfo;
        if (body?.msg) msg = body.msg;
        if (typeof body?.balance === 'number') useSubscriptionStore.getState().setBalance(body.balance);
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
          proposalSource: 'ai', stagedIcons: null,
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
          proposalSource: 'ai', stagedIcons: null,
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
        proposalSource: 'ai', stagedIcons: null,
        proposal: adapted.proposal,
        evaluation,
        proposalErrors: null,
        pendingProposal: null,
      });
    } catch (err) {
      if (!run.isCurrent()) return;
      set({ generateError: isNoAnswer(err) ? NO_ANSWER_NOTE : err instanceof Error ? err.message : 'Sunucu hatası.', generating: false });
    } finally {
      run.done();
    }
  },

  stageCoachProposal: (incoming) => {
    // Deliberately re-validates a proposal the coach layer already checked.
    // That is not redundant: `lib/coachActions.ts` validates the MODEL's
    // output shape, this validates what is about to be installed, and the
    // second one is the invariant `confirmInstall` actually relies on. A
    // caller reaching this with something unvalidated must still fail here.
    const validation = validateRoutineProposal(incoming);
    if (!validation.ok) {
      set({
        proposalSource: 'coach', stagedIcons: null,
        proposal: null,
        evaluation: null,
        proposalErrors: validation.errors.map((e) => e.message),
        pendingProposal: null,
        installed: false,
        installError: null,
      });
      return false;
    }
    const evaluation = evaluateProposal(validation.proposal, { activeHabits: activeHabitLoadInputs() });
    set({
      proposalSource: 'coach', stagedIcons: null,
      proposal: validation.proposal,
      evaluation,
      proposalErrors: null,
      pendingProposal: null,
      installed: false,
      installError: null,
    });
    return true;
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
      stagedIcons: packIcons(pack),
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
    stagedIcons: null,
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
    const { proposal, evaluation, installing, proposalSource, stagedIcons } = get();
    if (!proposal || !evaluation || installing) return false;
    // A pack's icons ride along; any other source has none to add.
    const icons = proposalSource === 'pack' ? stagedIcons : null;

    set({ installing: true, installError: null });
    try {
      // Row construction, the derived willpower cost and the
      // activate-vs-queue decision are domain rules and live in
      // `services/routineService.buildInstallRows`.
      const result = await installProposal(
        proposal.habits.map((h) => (icons?.[h.name] ? { ...h, icon: icons[h.name] } : h)),
        evaluation.toActivate,
      );
      if (!result.ok) {
        set({ installing: false, installError: result.error });
        return false;
      }

      // Reflect the new habits immediately -- same pattern habitStore.addHabit
      // uses (prepend to local state rather than forcing a refetch).
      useHabitStore.getState().addInstalledHabits(result.habits);

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
      // Habit names live in the installed rows and are never passed. The
      // counts are read back from what was actually persisted rather than
      // from the request, so a partial write cannot be reported as a full one.
      emitAnalytics('routine_installed', {
        source: proposalSource,
        habit_count: result.habits.length,
        activated_count: result.habits.filter((h) => h.status === 'active').length,
        queued_count: result.habits.filter((h) => h.status === 'waiting').length,
      });
      return true;
    } catch (err) {
      set({ installing: false, installError: err instanceof Error ? err.message : 'Kurulum başarısız.' });
      return false;
    }
  },
}));

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'routine', store: useRoutineStore });
