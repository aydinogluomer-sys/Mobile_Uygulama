/**
 * First-run onboarding: vocabulary, validation and the explanation text.
 *
 * ## Why the IDs and the labels are separate
 *
 * Every answer is stored as a stable machine id (`health_energy`,
 * `consistency`, `gentle`) and rendered through a Turkish label looked up
 * here. Storing the label instead would make the database rows unqueryable
 * the first time a word is reworded, and would put UI copy inside a CHECK
 * constraint — `20260906_user_onboarding.sql` enumerates exactly these ids,
 * so the two have to agree and only the id half is allowed to be stable.
 *
 * ## What this file does NOT do
 *
 * It does not build a plan. Selecting habits needs the routine packs, and
 * `routinePacks.ts` needs the goal/daypart ids from here — importing in both
 * directions would be a cycle. The vocabulary lives here, the selection lives
 * in `starterPlan.ts`, and the packs import only the types.
 *
 * No I/O, no React, no supabase — same discipline as `routineProposal.ts`.
 */

// ── Goals ───────────────────────────────────────────────────────────────────

export const GOAL_IDS = [
  'health_energy',
  'focus_productivity',
  'sleep',
  'learning',
  'mental_wellbeing',
  'daily_order',
  'finance',
  'other',
] as const;
export type GoalId = (typeof GOAL_IDS)[number];

export const GOAL_LABELS: Record<GoalId, string> = {
  health_energy: 'Sağlık & Enerji',
  focus_productivity: 'Odak & Üretkenlik',
  sleep: 'Uyku',
  learning: 'Öğrenme',
  mental_wellbeing: 'Zihinsel İyi Oluş',
  daily_order: 'Günlük Düzen',
  finance: 'Finans',
  other: 'Diğer',
};

/** The most goals a user may pick. More than three stops being a focus. */
export const MAX_GOALS = 3;
export const MIN_GOALS = 1;

// ── Barriers ────────────────────────────────────────────────────────────────

export const BARRIER_IDS = [
  'getting_started',
  'consistency',
  'forgetting',
  'motivation',
  'oversized_goals',
  'lack_of_time',
  'unsure_where_to_start',
] as const;
export type BarrierId = (typeof BARRIER_IDS)[number];

export const BARRIER_LABELS: Record<BarrierId, string> = {
  getting_started: 'Başlamakta zorlanıyorum',
  consistency: 'Devamlılığı koruyamıyorum',
  forgetting: 'Unutuyorum',
  motivation: 'Motivasyonum çabuk düşüyor',
  oversized_goals: 'Fazla büyük hedefler koyuyorum',
  lack_of_time: 'Zaman ayıramıyorum',
  unsure_where_to_start: 'Nereden başlayacağımı bilmiyorum',
};

// ── Pace ────────────────────────────────────────────────────────────────────

export const PACE_IDS = ['gentle', 'balanced', 'intensive'] as const;
export type PaceId = (typeof PACE_IDS)[number];

export type PaceMeta = {
  id: PaceId;
  emoji: string;
  label: string;
  volume: string;
  detail: string;
  /** Inclusive habit-count band this pace aims for. */
  min: number;
  max: number;
  recommended?: boolean;
};

/**
 * The counts are a TARGET, not a guarantee.
 *
 * `starterPlan.ts` stops adding habits when the Capacity Engine says the day
 * is full, so an intensive plan on an account that already has habits can
 * come back with three. The card label is a promise about intent; the
 * ceiling is a promise about the user's day, and the ceiling wins.
 */
export const PACES: readonly PaceMeta[] = [
  { id: 'gentle', emoji: '🌱', label: 'Rahat', volume: 'Günde 1–2 alışkanlık', detail: 'Yavaş ama sürdürülebilir.', min: 1, max: 2 },
  { id: 'balanced', emoji: '⚡', label: 'Dengeli', volume: 'Günde 3 alışkanlık', detail: 'Düzenli ilerlemek için ideal.', min: 3, max: 3, recommended: true },
  { id: 'intensive', emoji: '🔥', label: 'Yoğun', volume: 'Günde 4–5 alışkanlık', detail: 'Daha fazla hedef, daha aktif takip.', min: 4, max: 5 },
];

export const PACE_LABELS: Record<PaceId, string> = {
  gentle: 'Rahat',
  balanced: 'Dengeli',
  intensive: 'Yoğun',
};

export function paceMeta(pace: PaceId): PaceMeta {
  const found = PACES.find((p) => p.id === pace);
  if (!found) throw new Error(`unknown pace: ${pace}`);
  return found;
}

// ── Dayparts ────────────────────────────────────────────────────────────────

export const DAYPART_IDS = ['morning', 'daytime', 'evening', 'bedtime'] as const;
export type DaypartId = (typeof DAYPART_IDS)[number];

export const DAYPART_LABELS: Record<DaypartId, string> = {
  morning: 'Sabah',
  daytime: 'Gün içinde',
  evening: 'Akşam',
  bedtime: 'Yatmadan önce',
};

export const DAYPART_EMOJI: Record<DaypartId, string> = {
  morning: '🌅',
  daytime: '☀️',
  evening: '🌆',
  bedtime: '🌙',
};

/**
 * Our four dayparts onto the three `frequency_config.part_of_day` values the
 * schema already has.
 *
 * `bedtime` folds into `evening` because that column is an existing additive
 * field consumed by `habitSchedule`, and widening a shared enum to carry an
 * onboarding-only distinction would push this feature's vocabulary into
 * everything that reads a schedule. The finer distinction survives where it
 * is actually used — grouping the plan preview — via the candidate's own tag.
 */
export const DAYPART_TO_PART_OF_DAY: Record<DaypartId, 'morning' | 'afternoon' | 'evening'> = {
  morning: 'morning',
  daytime: 'afternoon',
  evening: 'evening',
  bedtime: 'evening',
};

// ── Answers ─────────────────────────────────────────────────────────────────

export const ONBOARDING_VERSION = 1;

/**
 * A fresh identity for one onboarding install.
 *
 * RFC-4122 v4 SHAPE, because `habits.install_id` is a `uuid` column and
 * anything else is rejected by Postgres. Built from `Math.random` rather than
 * `crypto.randomUUID()` for the reason already recorded in
 * `services/focusPointService.newRequestId`: that global is absent on Hermes
 * in some Expo runtimes, and a missing global here would throw on the path
 * that installs the user's first habits.
 *
 * The weaker entropy is acceptable because of what this value has to be
 * unique ACROSS: the habits of one account. A collision would need the same
 * account to draw the same 122 bits twice, and the unique index
 * `habits_install_id_name_uniq` turns even that into a rejected write rather
 * than a silent merge.
 */
export function newInstallId(): string {
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0');
  // 8-4-4-4-12, with the version nibble pinned to 4 and the variant to 8..b.
  const variant = '89ab'[Math.floor(Math.random() * 4)];
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}

/**
 * `installing` is a DURABLE claim, not a transient UI flag: it is written to
 * `user_onboarding` before the habits are inserted and survives process
 * death, which is how a later session learns an install already happened.
 * See `supabase/migrations/20260906b_user_onboarding_installing_status.sql`.
 */
export type OnboardingStatus = 'pending' | 'installing' | 'completed' | 'skipped' | 'legacy';

export type OnboardingAnswers = {
  goals: GoalId[];
  primaryBarrier: BarrierId | null;
  pace: PaceId | null;
  preferredDayparts: DaypartId[];
  /** The user's WISH. Not the OS permission — see the migration's comment. */
  reminderIntent: boolean | null;
};

export const EMPTY_ANSWERS: OnboardingAnswers = {
  goals: [],
  primaryBarrier: null,
  pace: null,
  preferredDayparts: [],
  reminderIntent: null,
};

/**
 * What a skipped onboarding falls back to.
 *
 * Skipping must not produce an empty plan — the user still lands on a real
 * starting point. Balanced, no goal filter, no barrier: the generic
 * broad-appeal case, which is exactly what `unsure_where_to_start` is tuned
 * for, so the same rules produce it rather than a second code path.
 */
export const SKIP_DEFAULT_ANSWERS: OnboardingAnswers = {
  goals: [],
  primaryBarrier: 'unsure_where_to_start',
  pace: 'balanced',
  preferredDayparts: [],
  reminderIntent: null,
};

// ── Validation ──────────────────────────────────────────────────────────────

export function isGoalId(v: unknown): v is GoalId {
  return typeof v === 'string' && (GOAL_IDS as readonly string[]).includes(v);
}
export function isBarrierId(v: unknown): v is BarrierId {
  return typeof v === 'string' && (BARRIER_IDS as readonly string[]).includes(v);
}
export function isPaceId(v: unknown): v is PaceId {
  return typeof v === 'string' && (PACE_IDS as readonly string[]).includes(v);
}
export function isDaypartId(v: unknown): v is DaypartId {
  return typeof v === 'string' && (DAYPART_IDS as readonly string[]).includes(v);
}

/**
 * Toggles a goal, refusing the fourth rather than silently dropping the
 * oldest.
 *
 * Silently evicting would make the chip the user just tapped appear to work
 * while another one they chose deliberately disappears — the selection would
 * be correct and the UI would still be lying about which. Returning the list
 * unchanged lets the caller say why.
 */
export function toggleGoal(goals: GoalId[], goal: GoalId): GoalId[] {
  if (goals.includes(goal)) return goals.filter((g) => g !== goal);
  if (goals.length >= MAX_GOALS) return goals;
  return [...goals, goal];
}

export function toggleDaypart(dayparts: DaypartId[], daypart: DaypartId): DaypartId[] {
  return dayparts.includes(daypart)
    ? dayparts.filter((d) => d !== daypart)
    : [...dayparts, daypart];
}

/** The needs step is answerable once at least one goal is chosen. */
export function canAdvanceFromNeeds(a: Pick<OnboardingAnswers, 'goals'>): boolean {
  return a.goals.length >= MIN_GOALS && a.goals.length <= MAX_GOALS;
}

/** The preferences step needs a pace; dayparts and reminders may stay empty. */
export function canAdvanceFromPreferences(a: Pick<OnboardingAnswers, 'pace'>): boolean {
  return a.pace !== null;
}

/**
 * Normalises whatever came back from the server into answers this app can
 * reason about.
 *
 * The CHECK constraints make bad values unlikely, not impossible — a row
 * written by an older client, or by a future one, can carry an id this build
 * does not know. Unknown ids are DROPPED rather than kept: a goal nothing can
 * match would silently narrow the candidate pool to nothing and the user
 * would get an empty plan with no explanation.
 */
export function normaliseAnswers(raw: {
  goals?: unknown;
  primary_barrier?: unknown;
  pace?: unknown;
  preferred_dayparts?: unknown;
  reminder_intent?: unknown;
}): OnboardingAnswers {
  const goals = Array.isArray(raw.goals) ? raw.goals.filter(isGoalId).slice(0, MAX_GOALS) : [];
  const dayparts = Array.isArray(raw.preferred_dayparts)
    ? raw.preferred_dayparts.filter(isDaypartId)
    : [];
  return {
    goals,
    primaryBarrier: isBarrierId(raw.primary_barrier) ? raw.primary_barrier : null,
    pace: isPaceId(raw.pace) ? raw.pace : null,
    preferredDayparts: dayparts,
    reminderIntent: typeof raw.reminder_intent === 'boolean' ? raw.reminder_intent : null,
  };
}

// ── "Neden bu plan?" ────────────────────────────────────────────────────────

/**
 * One sentence per real reason, built from the answers the user actually
 * gave.
 *
 * Deliberately NOT phrased as a discovery. Behaviour Intelligence learns from
 * logged activity, and a brand-new account has none — writing "fark ettik ki"
 * here would claim an observation the app has not made. Every clause below
 * refers back to something the user typed on the previous two screens.
 */
export function explainPlan(
  answers: OnboardingAnswers,
  plan: { habitCount: number; requestedMax: number },
): string[] {
  const lines: string[] = [];

  const barrierReason: Record<BarrierId, string> = {
    getting_started: 'Başlamakta zorlandığını söylediğin için ilk adımları kasıtlı olarak çok küçük tuttuk.',
    consistency: 'Devamlılığı korumakta zorlandığını söylediğin için ilk haftayı daha düşük yükle başlatıyoruz.',
    forgetting: 'Unuttuğunu söylediğin için planı sabit bir günlük ritme oturttuk; hatırlatmaları da buradan açabilirsin.',
    motivation: 'Motivasyonun çabuk düştüğü için hızlı sonuç veren, kısa sürede tamamlanan alışkanlıkları öne aldık.',
    oversized_goals: 'Fazla büyük hedefler koyduğunu söylediğin için başlangıç hedeflerini bilinçli olarak düşürdük.',
    lack_of_time: 'Zaman ayırmakta zorlandığın için günlük toplam süreyi olabildiğince kısa tuttuk.',
    unsure_where_to_start: 'Nereden başlayacağını bilmediğini söylediğin için kendini kanıtlamış, geniş kapsamlı temel alışkanlıklarla başlıyoruz.',
  };
  if (answers.primaryBarrier) lines.push(barrierReason[answers.primaryBarrier]);

  if (answers.goals.length > 0) {
    const labels = answers.goals.map((g) => GOAL_LABELS[g]).join(' ve ');
    lines.push(`Seçtiğin odak alanları — ${labels} — planın merkezinde.`);
  }

  if (answers.preferredDayparts.length > 0) {
    const labels = answers.preferredDayparts.map((d) => DAYPART_LABELS[d]).join(', ');
    lines.push(`Alışkanlıkları tercih ettiğin zamana yerleştirdik: ${labels.toLowerCase()}.`);
  }

  // Honesty clause: the pace card promised a band and the ceiling overrode it.
  if (plan.habitCount < plan.requestedMax) {
    lines.push(
      `Günlük kapasiten şu an ${plan.habitCount} alışkanlığı güvenle taşıyor, bu yüzden daha fazlasını eklemedik. Sonradan istediğin zaman ekleyebilirsin.`,
    );
  }

  return lines;
}
