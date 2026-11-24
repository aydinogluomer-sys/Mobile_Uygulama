/**
 * Faz F7 — U13, U15, P05:
 * Yargılamayan kümülatif çaba özeti (`buildCalmEffortSummary`), çoklu gecikme
 * yığınını tek adıma indiren sakin dönüş ipucu (`evaluateCalmReturnHint`) ve
 * örneklem eşikli kişisel süre kalibrasyonu (`evaluateDurationCalibration`).
 *
 * Saf (pure) modül: I/O, Supabase, Zustand, AsyncStorage veya gizli saat içermez;
 * hiçbir girdi dizisini veya nesnesini mutate etmez.
 */

import { parseLocalDate, type Ymd } from './date';
import { inQuietHours } from './reminderPlan';
import type { HabitLog } from './supabase';

// ---------------------------------------------------------------------------
// U13 — Yargılamayan Kümülatif Çaba & Sakin Dönüş Özeti
// ---------------------------------------------------------------------------

export type EffortLogEntry = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'>;

export type CalmEffortInput = {
  readonly logs: readonly EffortLogEntry[];
  readonly completedTasksCount: number;
  readonly focusSessionsCount: number;
  readonly skippedOrLightenedCount?: number;
};

export type CalmEffortSummary = {
  readonly preservedHabitCompletions: number;
  readonly doneHabitCount: number;
  readonly partialHabitCount: number;
  readonly completedTasksCount: number;
  readonly focusSessionsCount: number;
  readonly totalSustainedEffortCount: number;
  readonly skippedOrLightenedCount: number;
  readonly calmReturnCount: number;
  readonly calmReturnDays: readonly Ymd[];
  readonly priorAchievementsIntact: true;
  readonly headline: string;
  readonly returnCopy: string;
  readonly assuranceCopy: string;
};

function logStatePriority(state: HabitLog['state']): number {
  if (state === 'done') return 3;
  if (state === 'partial') return 2;
  if (state === 'skip') return 1;
  return 0;
}

function isEffortState(state: HabitLog['state']): boolean {
  return state === 'done' || state === 'partial';
}

function isGapState(state: HabitLog['state']): boolean {
  return state === 'miss' || state === 'skip';
}

/**
 * Kaçırılan veya hafifletilen günlerin önceki kazanımları asla silmediğini kanıtlayan,
 * kümülatif tamamlamaları ve ara sonrası sakin dönüşleri sayan özet üretir (`U13`).
 */
export function buildCalmEffortSummary(input: CalmEffortInput): CalmEffortSummary {
  let doneHabitCount = 0;
  let partialHabitCount = 0;
  let skipLogsCount = 0;

  const perHabitByDay = new Map<string, Map<Ymd, HabitLog['state']>>();
  const dayAggregate = new Map<Ymd, { hasEffort: boolean; hasGap: boolean }>();

  for (const log of input.logs) {
    if (log.state === 'done') doneHabitCount += 1;
    else if (log.state === 'partial') partialHabitCount += 1;
    else if (log.state === 'skip') skipLogsCount += 1;

    if (typeof log.completed_at !== 'string' || log.completed_at.length < 10) continue;
    const dayKey = log.completed_at.slice(0, 10);
    if (parseLocalDate(dayKey) === null) continue;

    let habitDays = perHabitByDay.get(log.habit_id);
    if (!habitDays) {
      habitDays = new Map<Ymd, HabitLog['state']>();
      perHabitByDay.set(log.habit_id, habitDays);
    }
    const prevState = habitDays.get(dayKey);
    if (prevState === undefined || logStatePriority(log.state) > logStatePriority(prevState)) {
      habitDays.set(dayKey, log.state);
    }

    const agg = dayAggregate.get(dayKey) ?? { hasEffort: false, hasGap: false };
    if (isEffortState(log.state)) agg.hasEffort = true;
    if (isGapState(log.state)) agg.hasGap = true;
    dayAggregate.set(dayKey, agg);
  }

  const returnDaysSet = new Set<Ymd>();

  // 1) Alışkanlık bazında: miss/skip gününden sonra gelen ilk done/partial günü sakin dönüştür.
  for (const habitDays of perHabitByDay.values()) {
    const sortedDays = [...habitDays.keys()].sort();
    let sawGapBefore = false;
    for (const dayKey of sortedDays) {
      const st = habitDays.get(dayKey)!;
      if (isEffortState(st)) {
        if (sawGapBefore) {
          returnDaysSet.add(dayKey);
        }
        sawGapBefore = false;
      } else if (isGapState(st)) {
        sawGapBefore = true;
      }
    }
  }

  // 2) Gün toplamı bazında: tamamen miss/skip olan bir günden sonra herhangi bir alışkanlıkla dönüş.
  const sortedAllDays = [...dayAggregate.keys()].sort();
  let previousDayWasPureGap = false;
  for (const dayKey of sortedAllDays) {
    const agg = dayAggregate.get(dayKey)!;
    if (agg.hasEffort) {
      if (previousDayWasPureGap) {
        returnDaysSet.add(dayKey);
      }
      previousDayWasPureGap = false;
    } else if (agg.hasGap) {
      previousDayWasPureGap = true;
    }
  }

  const preservedHabitCompletions = doneHabitCount + partialHabitCount;
  const completedTasksCount = Number.isFinite(input.completedTasksCount)
    ? Math.max(0, Math.floor(input.completedTasksCount))
    : 0;
  const focusSessionsCount = Number.isFinite(input.focusSessionsCount)
    ? Math.max(0, Math.floor(input.focusSessionsCount))
    : 0;
  const skippedOrLightenedCount =
    typeof input.skippedOrLightenedCount === 'number' &&
    Number.isFinite(input.skippedOrLightenedCount)
      ? Math.max(0, Math.floor(input.skippedOrLightenedCount))
      : skipLogsCount;

  const calmReturnDays = [...returnDaysSet].sort();
  const calmReturnCount = calmReturnDays.length;
  const totalSustainedEffortCount =
    preservedHabitCompletions + completedTasksCount + focusSessionsCount;

  const returnCopy =
    calmReturnCount > 0
      ? `${calmReturnCount} kez ara veya aksama sonrası sakin dönüş yaptın.`
      : totalSustainedEffortCount > 0
        ? 'Biriken her tamamlama ve kısmi adım kaydında güvende duruyor.'
        : 'Hazır olduğunda atacağın tek bir küçük adım bile kalıcı olarak sayılır.';

  return {
    preservedHabitCompletions,
    doneHabitCount,
    partialHabitCount,
    completedTasksCount,
    focusSessionsCount,
    totalSustainedEffortCount,
    skippedOrLightenedCount,
    calmReturnCount,
    calmReturnDays,
    priorAchievementsIntact: true,
    headline: 'Sürdürülen Çaba & Sakin Dönüş',
    returnCopy,
    assuranceCopy:
      'Kaçırılan veya hafifletilen günler kazandığın ilerlemeyi ve rozetleri asla silmez; her adım olduğu gibi korunur.',
  };
}

// ---------------------------------------------------------------------------
// U15 — Çoklu Gecikmede Tek Adımlı Sakin Dönüş İpucu
// ---------------------------------------------------------------------------

export const MULTI_OVERDUE_BACKLOG_THRESHOLD = 3;

export type CalmReturnCandidateTask = {
  readonly id: string;
  readonly title: string;
  readonly estimatedMinutes?: number | null;
};

export type CalmReturnCandidateHabit = {
  readonly id: string;
  readonly name: string;
};

export type CalmReturnTarget = 'first_action' | 'recovery';

export type CalmReturnSuppressionReason =
  | 'below_threshold'
  | 'quiet_hours'
  | 'dismissed';

export type EvaluateCalmReturnHintInput = {
  readonly localDayKey: Ymd;
  readonly nowLocalHm: string;
  readonly overdueTasks?: readonly CalmReturnCandidateTask[];
  readonly missedHabits?: readonly CalmReturnCandidateHabit[];
  readonly overdueTaskCount?: number;
  readonly missedHabitCount?: number;
  readonly quietStart?: string | null;
  readonly quietEnd?: string | null;
  readonly dismissedKeys?: ReadonlySet<string> | readonly string[];
};

export type CalmReturnHintResult =
  | {
      readonly visible: true;
      readonly isMultiOverdueBacklog: true;
      readonly totalBacklogCount: number;
      readonly collapsedItemCount: number;
      readonly stepCount: 1;
      readonly target: CalmReturnTarget;
      readonly focusItemId: string | null;
      readonly focusItemTitle: string | null;
      readonly headline: string;
      readonly body: string;
      readonly ctaLabel: string;
      readonly dismissKey: string;
      readonly suppressedReason: null;
    }
  | {
      readonly visible: false;
      readonly isMultiOverdueBacklog: boolean;
      readonly totalBacklogCount: number;
      readonly collapsedItemCount: number;
      readonly stepCount: 0;
      readonly target: null;
      readonly focusItemId: null;
      readonly focusItemTitle: null;
      readonly headline: null;
      readonly body: null;
      readonly ctaLabel: null;
      readonly dismissKey: string;
      readonly suppressedReason: CalmReturnSuppressionReason;
    };

function pickShortestCalmTask(
  tasks: readonly CalmReturnCandidateTask[],
): CalmReturnCandidateTask | null {
  if (tasks.length === 0) return null;
  let best: CalmReturnCandidateTask | null = null;
  let bestMin = Number.POSITIVE_INFINITY;
  for (const task of tasks) {
    if (
      typeof task.estimatedMinutes === 'number' &&
      Number.isFinite(task.estimatedMinutes) &&
      task.estimatedMinutes > 0 &&
      task.estimatedMinutes < bestMin
    ) {
      bestMin = task.estimatedMinutes;
      best = task;
    }
  }
  return best ?? tasks[0];
}

function hasDismissedKey(
  dismissedKeys: ReadonlySet<string> | readonly string[] | undefined,
  key: string,
): boolean {
  if (!dismissedKeys) return false;
  if (Array.isArray(dismissedKeys)) {
    return dismissedKeys.includes(key);
  }
  return (dismissedKeys as ReadonlySet<string>).has(key);
}

/**
 * Gecikmiş görev + kaçırılan alışkanlık toplamı `>= 3` olduğunda bunaltıcı liste
 * dökmek yerine sessiz saatlere ve kullanıcı kapatmasına saygılı tek adımlı
 * dönüş ipucu üretir (`U15`).
 */
export function evaluateCalmReturnHint(
  input: EvaluateCalmReturnHintInput,
): CalmReturnHintResult {
  const overdueTasks = input.overdueTasks ?? [];
  const missedHabits = input.missedHabits ?? [];
  const overdueCount =
    typeof input.overdueTaskCount === 'number' && Number.isFinite(input.overdueTaskCount)
      ? Math.max(0, Math.floor(input.overdueTaskCount))
      : overdueTasks.length;
  const missedCount =
    typeof input.missedHabitCount === 'number' && Number.isFinite(input.missedHabitCount)
      ? Math.max(0, Math.floor(input.missedHabitCount))
      : missedHabits.length;

  const totalBacklogCount = overdueCount + missedCount;
  const isMultiOverdueBacklog = totalBacklogCount >= MULTI_OVERDUE_BACKLOG_THRESHOLD;
  const dismissKey = `calm-return:${input.localDayKey}`;

  if (!isMultiOverdueBacklog) {
    return {
      visible: false,
      isMultiOverdueBacklog: false,
      totalBacklogCount,
      collapsedItemCount: 0,
      stepCount: 0,
      target: null,
      focusItemId: null,
      focusItemTitle: null,
      headline: null,
      body: null,
      ctaLabel: null,
      dismissKey,
      suppressedReason: 'below_threshold',
    };
  }

  const collapsedItemCount = Math.max(0, totalBacklogCount - 1);

  if (
    inQuietHours(input.nowLocalHm, {
      quietStart: input.quietStart ?? null,
      quietEnd: input.quietEnd ?? null,
    })
  ) {
    return {
      visible: false,
      isMultiOverdueBacklog: true,
      totalBacklogCount,
      collapsedItemCount,
      stepCount: 0,
      target: null,
      focusItemId: null,
      focusItemTitle: null,
      headline: null,
      body: null,
      ctaLabel: null,
      dismissKey,
      suppressedReason: 'quiet_hours',
    };
  }

  if (hasDismissedKey(input.dismissedKeys, dismissKey)) {
    return {
      visible: false,
      isMultiOverdueBacklog: true,
      totalBacklogCount,
      collapsedItemCount,
      stepCount: 0,
      target: null,
      focusItemId: null,
      focusItemTitle: null,
      headline: null,
      body: null,
      ctaLabel: null,
      dismissKey,
      suppressedReason: 'dismissed',
    };
  }

  const calmTask = pickShortestCalmTask(overdueTasks);
  const firstHabit = missedHabits[0] ?? null;
  const preferRecovery =
    overdueCount === 0 || (calmTask === null && missedCount > overdueCount);

  if (preferRecovery) {
    return {
      visible: true,
      isMultiOverdueBacklog: true,
      totalBacklogCount,
      collapsedItemCount,
      stepCount: 1,
      target: 'recovery',
      focusItemId: firstHabit?.id ?? null,
      focusItemTitle: firstHabit?.name ?? null,
      headline: 'Hepsini birden telafi etmek zorunda değilsin',
      body: 'Geri kalan birikimi kenara bırakıp günü tek adımla sakinleştirebilirsin.',
      ctaLabel: firstHabit ? `Günü hafiflet: ${firstHabit.name}` : 'Günü sakin hafiflet',
      dismissKey,
      suppressedReason: null,
    };
  }

  return {
    visible: true,
    isMultiOverdueBacklog: true,
    totalBacklogCount,
    collapsedItemCount,
    stepCount: 1,
    target: 'first_action',
    focusItemId: calmTask?.id ?? null,
    focusItemTitle: calmTask?.title ?? null,
    headline: 'Hepsini birden toparlamak zorunda değilsin',
    body: 'Biriken listeyi şimdilik kapatıp yalnız tek bir küçük adımla başlayabilirsin.',
    ctaLabel: calmTask ? `İlk adımla başla: ${calmTask.title}` : 'Tek küçük adımla başla',
    dismissKey,
    suppressedReason: null,
  };
}

// ---------------------------------------------------------------------------
// P05 — Örneklem Eşikli Kişisel Süre Kalibrasyonu
// ---------------------------------------------------------------------------

export const MIN_CALIBRATION_SAMPLES = 5;
export const MIN_CALIBRATION_UNIQUE_DAYS = 2;
export const CALIBRATION_MULTIPLIER_MIN = 0.5;
export const CALIBRATION_MULTIPLIER_MAX = 2.0;

export type DurationCalibrationSample = {
  readonly taskId: string;
  readonly estimatedMinutes: number;
  readonly actualFocusedMinutes: number;
  readonly localDayKey: string;
};

export type DurationCalibrationInput = {
  readonly optInEnabled: boolean;
  readonly samples: readonly DurationCalibrationSample[];
  readonly referenceEstimateMinutes?: number | null;
};

export type DurationCalibrationStatus = 'disabled' | 'insufficient_sample' | 'calibrated';

export type InsufficientSampleReason = 'too_few_samples' | 'single_day_only' | null;

export type DurationCalibrationResult = {
  readonly status: DurationCalibrationStatus;
  readonly reason: InsufficientSampleReason;
  readonly optInEnabled: boolean;
  readonly sampleCount: number;
  readonly uniqueDayCount: number;
  readonly suggestedMultiplier: number;
  readonly suggestedMinutes: number | null;
  readonly canReset: true;
  readonly explanation: string;
};

export type ResetCalibrationState = {
  readonly optInEnabled: false;
  readonly samples: readonly [];
  readonly status: 'disabled';
  readonly suggestedMultiplier: 1;
  readonly suggestedMinutes: null;
  readonly canReset: true;
  readonly explanation: string;
};

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Yalnızca açık rıza (`optInEnabled`), en az 5 geçerli örnek (`MIN_CALIBRATION_SAMPLES`)
 * ve en az 2 farklı yerel takvim günü (`uniqueDays.size >= 2`) sağlandığında
 * `[0.5, 2.0]` aralığında medyan süre çarpanı önerir (`P05`).
 */
export function evaluateDurationCalibration(
  input: DurationCalibrationInput,
): DurationCalibrationResult {
  const validSamples = input.samples.filter(
    (s) =>
      typeof s.taskId === 'string' &&
      s.taskId.trim().length > 0 &&
      typeof s.estimatedMinutes === 'number' &&
      Number.isFinite(s.estimatedMinutes) &&
      s.estimatedMinutes > 0 &&
      typeof s.actualFocusedMinutes === 'number' &&
      Number.isFinite(s.actualFocusedMinutes) &&
      s.actualFocusedMinutes > 0 &&
      typeof s.localDayKey === 'string' &&
      parseLocalDate(s.localDayKey) !== null,
  );

  const uniqueDays = new Set<string>(validSamples.map((s) => s.localDayKey));

  if (!input.optInEnabled) {
    return {
      status: 'disabled',
      reason: null,
      optInEnabled: false,
      sampleCount: validSamples.length,
      uniqueDayCount: uniqueDays.size,
      suggestedMultiplier: 1,
      suggestedMinutes: null,
      canReset: true,
      explanation: 'Kişisel süre kalibrasyonu kapalı; girdiğin süre tahminleri olduğu gibi korunur.',
    };
  }

  if (validSamples.length < MIN_CALIBRATION_SAMPLES) {
    return {
      status: 'insufficient_sample',
      reason: 'too_few_samples',
      optInEnabled: true,
      sampleCount: validSamples.length,
      uniqueDayCount: uniqueDays.size,
      suggestedMultiplier: 1,
      suggestedMinutes: null,
      canReset: true,
      explanation: `Kişisel süre önerisi için en az ${MIN_CALIBRATION_SAMPLES} tamamlanmış görev odak örneği gerekir (${validSamples.length}/${MIN_CALIBRATION_SAMPLES}).`,
    };
  }

  if (uniqueDays.size < MIN_CALIBRATION_UNIQUE_DAYS) {
    return {
      status: 'insufficient_sample',
      reason: 'single_day_only',
      optInEnabled: true,
      sampleCount: validSamples.length,
      uniqueDayCount: uniqueDays.size,
      suggestedMultiplier: 1,
      suggestedMinutes: null,
      canReset: true,
      explanation:
        'Tek bir kötü gün kalıcı profil çıkarmaz; öneri için en az 2 farklı günden örnek gerekir.',
    };
  }

  const ratios = validSamples.map((s) => s.actualFocusedMinutes / s.estimatedMinutes);
  const rawMedianRatio = median(ratios);
  const boundedRatio = Math.max(
    CALIBRATION_MULTIPLIER_MIN,
    Math.min(CALIBRATION_MULTIPLIER_MAX, rawMedianRatio),
  );
  const suggestedMultiplier = Math.round(boundedRatio * 100) / 100;

  const baseMinutes =
    typeof input.referenceEstimateMinutes === 'number' &&
    Number.isFinite(input.referenceEstimateMinutes) &&
    input.referenceEstimateMinutes > 0
      ? input.referenceEstimateMinutes
      : median(validSamples.map((s) => s.estimatedMinutes));

  const suggestedMinutes = Math.max(1, Math.round(baseMinutes * suggestedMultiplier));

  return {
    status: 'calibrated',
    reason: null,
    optInEnabled: true,
    sampleCount: validSamples.length,
    uniqueDayCount: uniqueDays.size,
    suggestedMultiplier,
    suggestedMinutes,
    canReset: true,
    explanation: `${uniqueDays.size} farklı güne yayılan ${validSamples.length} odak örneğine göre tahmin çarpanı ${suggestedMultiplier}x olarak önerildi; dilediğinde sıfırlayabilirsin.`,
  };
}

/**
 * Kişisel süre kalibrasyon geçmişini ve önerisini anında temizler (`P05`).
 */
export function resetCalibration(): ResetCalibrationState {
  return {
    optInEnabled: false,
    samples: [],
    status: 'disabled',
    suggestedMultiplier: 1,
    suggestedMinutes: null,
    canReset: true,
    explanation: 'Kişisel süre kalibrasyonu sıfırlandı; tahminlerin varsayılan değerinde kullanılır.',
  };
}
