/**
 * Routine Packs.  (Phase 3, CODER-J, plan §13)
 *
 * Pure data + a couple of pure helpers. No I/O, no `supabase` import, no
 * React, no store — same discipline as `routineProposal.ts`.
 *
 * Plan §13 explicitly REJECTS a giant habit library ("Productive benzeri dev
 * habit listesi yapılmamalıdır"): four hand-authored packs, not fifty. Their
 * stated loads (plan §13, verbatim):
 *
 *   MORNING RESET       5 habits  Load 24
 *   DEEP WORK            4 habits  Load 38
 *   SLEEP RESET          6 habits  Load 29
 *   FITNESS FOUNDATION   5 habits  Load 41
 *
 * `statedLoad` below is that plan number, stored as data. `packLoad()`
 * computes the REAL number from each pack's actual `difficulty` /
 * `estimated_minutes` / `frequency_config` via `lib/capacity.ts` — the same
 * function every other habit load in this app goes through. The two are
 * never the same value by construction; `__tests__/lib/routinePacks.test.ts`
 * asserts they land within a documented tolerance of each other (see that
 * file for the tolerance and the reasoning) instead of this file hardcoding
 * a computed-looking number and calling it done.
 *
 * A pack is not a privileged bypass of the AI gate: `packToProposal` below
 * down-converts a pack to the exact same `RoutineProposal` shape an AI
 * response produces, so `store/routineStore.ts` (W3) can run a pack through
 * the identical `validateRoutineProposal` + `evaluateProposal` pipeline —
 * install-time capacity awareness ("3 aktifleşir, 2 kuyruğa" per plan §13's
 * worked example) applies to a pack exactly as it does to an AI proposal.
 */
import type { TrackingType } from './habitEngine';
import type { FrequencyConfig } from './supabase';
import { habitLoadPoints, type HabitLoadInput } from './capacity';
import type { RoutineProposal, ProposalHabit } from './routineProposal';
import type { DaypartId, GoalId } from './onboarding';

/** A pack habit carries everything the AI-facing schema does (name,
 *  tracking_type, difficulty, estimated_minutes) PLUS the extra `Habit`
 *  columns a pack -- unlike a free-form AI proposal -- is allowed to specify
 *  up front, because a pack is app-authored, not untrusted AI output. Those
 *  extra fields are only consumed at actual insert time (store/
 *  routineStore.ts), never by the validator (see `packToProposal`, which
 *  strips them back down to the four canonical fields before validating). */
export type RoutinePackHabit = {
  name: string;
  icon: string;
  /**
   * Which onboarding goals this habit serves, and when it belongs in the day.
   *
   * Required, not optional. The first-run plan engine ranks candidates by
   * these tags (`lib/starterPlan.ts`), and an untagged habit would silently
   * never be selected -- an omission that looks exactly like "this habit is
   * unpopular" rather than "somebody forgot a field". Making it required
   * means a new pack habit cannot be added without deciding what it is for.
   */
  goals: GoalId[];
  daypart: DaypartId;
  tracking_type: Extract<TrackingType, 'binary' | 'numeric'>;
  difficulty: 1 | 3 | 5;
  estimated_minutes: number;
  frequency_config: FrequencyConfig;
  unit?: string | null;
  daily_goal?: number | null;
  target_direction?: 'at_least' | 'at_most' | null;
};

export type RoutinePackKey =
  | 'morning-reset' | 'deep-work' | 'sleep-reset' | 'fitness-foundation'
  | 'everyday-foundations';

export type RoutinePack = {
  key: RoutinePackKey;
  title: string;
  goal: string;
  /** Plan §13's stated load for this pack -- data, not a computed value. */
  statedLoad: number;
  habits: RoutinePackHabit[];
};

export const ROUTINE_PACKS: readonly RoutinePack[] = [
  {
    key: 'morning-reset',
    title: 'Sabah Sıfırlama',
    goal: 'Güne sakin ve kontrollü başla.',
    statedLoad: 24,
    habits: [
      { name: 'Bir bardak su iç', icon: 'water-outline', tracking_type: 'binary', difficulty: 1, estimated_minutes: 2, frequency_config: { kind: 'daily' }, goals: ['health_energy'], daypart: 'morning' },
      { name: 'Yatağını topla', icon: 'bed-outline', tracking_type: 'binary', difficulty: 1, estimated_minutes: 3, frequency_config: { kind: 'daily' }, goals: ['daily_order'], daypart: 'morning' },
      { name: '10 dakika esneme / mobilite', icon: 'body-outline', tracking_type: 'binary', difficulty: 3, estimated_minutes: 12, frequency_config: { kind: 'daily' }, goals: ['health_energy'], daypart: 'morning' },
      { name: 'Günün 3 önceliğini yaz', icon: 'journal-outline', tracking_type: 'binary', difficulty: 3, estimated_minutes: 10, frequency_config: { kind: 'daily' }, goals: ['focus_productivity', 'daily_order'], daypart: 'morning' },
      { name: 'Gün ışığında kısa yürüyüş', icon: 'sunny-outline', tracking_type: 'binary', difficulty: 3, estimated_minutes: 15, frequency_config: { kind: 'daily' }, goals: ['health_energy', 'mental_wellbeing'], daypart: 'morning' },
    ],
  },
  {
    key: 'deep-work',
    title: 'Derin Çalışma',
    goal: 'Dikkat dağınıklığını azalt, odaklanmış bloklar kur.',
    statedLoad: 38,
    habits: [
      { name: 'Kesintisiz derin çalışma bloğu', icon: 'hourglass-outline', tracking_type: 'binary', difficulty: 5, estimated_minutes: 50, frequency_config: { kind: 'daily' }, goals: ['focus_productivity'], daypart: 'daytime' },
      { name: 'Günün 3 önceliğini planla', icon: 'list-outline', tracking_type: 'binary', difficulty: 3, estimated_minutes: 15, frequency_config: { kind: 'daily' }, goals: ['focus_productivity', 'daily_order'], daypart: 'morning' },
      { name: 'Bildirimsiz odak seansı', icon: 'eye-off-outline', tracking_type: 'binary', difficulty: 5, estimated_minutes: 25, frequency_config: { kind: 'daily' }, goals: ['focus_productivity'], daypart: 'daytime' },
      { name: 'Gün sonu değerlendirme', icon: 'checkmark-done-outline', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5, frequency_config: { kind: 'daily' }, goals: ['focus_productivity', 'daily_order'], daypart: 'evening' },
    ],
  },
  {
    key: 'sleep-reset',
    title: 'Uyku Sıfırlama',
    goal: 'Uyku düzenini ve kalitesini iyileştir.',
    statedLoad: 29,
    habits: [
      { name: 'Sabit yatış saati', icon: 'moon-outline', tracking_type: 'binary', difficulty: 1, estimated_minutes: 2, frequency_config: { kind: 'daily' }, goals: ['sleep'], daypart: 'bedtime' },
      { name: 'Yatmadan 1 saat önce ekran yok', icon: 'phone-portrait-outline', tracking_type: 'binary', difficulty: 3, estimated_minutes: 25, frequency_config: { kind: 'daily' }, goals: ['sleep'], daypart: 'bedtime' },
      { name: 'Işıkları kıs', icon: 'bulb-outline', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5, frequency_config: { kind: 'daily' }, goals: ['sleep'], daypart: 'bedtime' },
      { name: 'Sakinleştirici okuma', icon: 'book-outline', tracking_type: 'binary', difficulty: 3, estimated_minutes: 15, frequency_config: { kind: 'daily' }, goals: ['sleep', 'learning'], daypart: 'bedtime' },
      { name: 'Öğleden sonra kafeini kes', icon: 'cafe-outline', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5, frequency_config: { kind: 'daily' }, goals: ['sleep'], daypart: 'daytime' },
      { name: 'Uyumadan önce şükran notu', icon: 'heart-outline', tracking_type: 'binary', difficulty: 3, estimated_minutes: 5, frequency_config: { kind: 'daily' }, goals: ['mental_wellbeing'], daypart: 'bedtime' },
    ],
  },
  {
    key: 'fitness-foundation',
    title: 'Fitness Temeli',
    goal: 'Düzenli hareket ve temel fitness alışkanlığı kur.',
    statedLoad: 41,
    habits: [
      { name: 'Yapılandırılmış antrenman', icon: 'barbell-outline', tracking_type: 'binary', difficulty: 5, estimated_minutes: 90, frequency_config: { kind: 'daily' }, goals: ['health_energy'], daypart: 'evening' },
      { name: 'Mobilite / esneme', icon: 'body-outline', tracking_type: 'binary', difficulty: 3, estimated_minutes: 20, frequency_config: { kind: 'daily' }, goals: ['health_energy'], daypart: 'evening' },
      { name: 'Protein hedefi', icon: 'nutrition-outline', tracking_type: 'numeric', difficulty: 3, estimated_minutes: 5, frequency_config: { kind: 'daily' }, unit: 'g', daily_goal: 120, target_direction: 'at_least', goals: ['health_energy'], daypart: 'daytime' },
      { name: 'Su hedefi', icon: 'water-outline', tracking_type: 'numeric', difficulty: 1, estimated_minutes: 5, frequency_config: { kind: 'daily' }, unit: 'bardak', daily_goal: 8, target_direction: 'at_least', goals: ['health_energy'], daypart: 'daytime' },
      { name: 'Adım hedefi', icon: 'footsteps-outline', tracking_type: 'numeric', difficulty: 3, estimated_minutes: 8, frequency_config: { kind: 'daily' }, unit: 'adım', daily_goal: 8000, target_direction: 'at_least', goals: ['health_energy'], daypart: 'daytime' },
    ],
  },
  {
    // The fifth pack exists because of a hole the first four left.
    //
    // Tagging the original packs for the onboarding goals showed that
    // `finance` had ZERO candidate habits and `learning` had one, so a user
    // who picked Finans on the first screen would have watched their answer
    // change nothing — the question would have been decorative, which is the
    // one thing the onboarding brief forbids. These are five deliberately
    // small, low-difficulty habits covering the thin goals; it is a pack in
    // the same file, of the same type, through the same validator and the
    // same installer, not a second habit library.
    key: 'everyday-foundations',
    title: 'Günlük Temeller',
    goal: 'Küçük ama düzenli günlük çapalar kur.',
    // NOT a plan quote: the other four carry plan §13's own numbers, and this
    // pack postdates that plan. 14 is the author's intended load, kept as data
    // for the same reason the others are -- so the tolerance test compares a
    // written intention against a computed reality instead of a number against
    // itself.
    statedLoad: 14,
    habits: [
      { name: '10 dakika okuma', icon: 'book-outline', tracking_type: 'binary', difficulty: 1, estimated_minutes: 10, frequency_config: { kind: 'daily' }, goals: ['learning'], daypart: 'evening' },
      { name: 'Günlük harcamaları kaydet', icon: 'wallet-outline', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5, frequency_config: { kind: 'daily' }, goals: ['finance'], daypart: 'evening' },
      { name: '5 dakika nefes egzersizi', icon: 'leaf-outline', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5, frequency_config: { kind: 'daily' }, goals: ['mental_wellbeing'], daypart: 'morning' },
      { name: 'Çalışma alanını topla', icon: 'file-tray-outline', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5, frequency_config: { kind: 'daily' }, goals: ['daily_order'], daypart: 'evening' },
      { name: 'Bugünü tek cümleyle yaz', icon: 'create-outline', tracking_type: 'binary', difficulty: 1, estimated_minutes: 3, frequency_config: { kind: 'daily' }, goals: ['mental_wellbeing', 'daily_order'], daypart: 'bedtime' },
    ],
  },
];

function toHabitLoadInput(h: RoutinePackHabit): HabitLoadInput {
  return {
    difficulty: h.difficulty,
    estimated_minutes: h.estimated_minutes,
    frequency_config: h.frequency_config,
    impact_level: null,
  };
}

/** The pack's REAL computed load -- sum of `habitLoadPoints` over its
 *  habits, via `lib/capacity.ts`. Not the same value as `statedLoad` by
 *  construction; see the tolerance test for how close the two land. */
export function packLoad(pack: RoutinePack): number {
  return pack.habits.reduce((sum, h) => sum + habitLoadPoints(toHabitLoadInput(h)), 0);
}

/** Down-converts a pack to the exact canonical shape `validateRoutineProposal`
 *  expects -- a pack is "just" an app-authored proposal, not a bypass of the
 *  AI gate. Every pack is expected to pass this validator; that expectation
 *  is asserted directly in `__tests__/lib/routinePacks.test.ts`. */
export function packToProposal(pack: RoutinePack): RoutineProposal {
  return {
    title: pack.title,
    goal: pack.goal,
    habits: pack.habits.map((h): ProposalHabit => ({
      name: h.name,
      tracking_type: h.tracking_type,
      difficulty: h.difficulty,
      estimated_minutes: h.estimated_minutes,
    })),
  };
}

export function findRoutinePack(key: string): RoutinePack | undefined {
  return ROUTINE_PACKS.find((p) => p.key === key);
}
