/**
 * Faz F4 — E02, P01, P04 (`REC-01`, `REC-02`, `REC-04`, `REC-05`):
 * Günün toparlanması («Koru -> Gör -> Uygula») için saf (pure), deterministik
 * gün planı önizleme, sabit randevu koruma, gerçek ölçüm açığı hesabı ve
 * sürüm/tazelik (`evaluatePreviewFreshness`) motoru.
 *
 * Saf modül kuralları:
 * - I/O, Supabase istemcisi, Zustand store, AsyncStorage, rastgelelik veya
 *   argümansız saat (`new Date()`, `Date.now()`) içermez.
 * - Hiçbir girdi dizisini veya nesnesini mutate etmez (`Object.freeze` güvenli).
 * - Dış takvim bağlı değilse sahte boş aralık uydurmaz; saat bloğu eksiği ile
 *   süre tahmini eksiğini kapasite hesabından ayrı raporlar (`P01`).
 * - Ölçülebilir alışkanlıkta (`P04`) `deficitFor` ile gerçek kalan açığı korur,
 *   sahte tamamlanmış değer üretmez ve «Telafi etme» (`do_not_recover`) seçeneğinde
 *   mevcut kısmi ilerleme kaydını güvende tutar.
 */

import { canonical, checksum } from './backupFormat';
import {
  bandFor,
  dailyLoad as computeDailyLoad,
  habitsInRangeOn,
  oneOccurrencePoints,
  type LoadBandKey,
} from './capacity';
import { decimalTR } from './chartText';
import { habitFingerprint, taskFingerprint } from './coachActionsV2';
import { parseLocalDate, ymdFromIso, type Ymd } from './date';
import { buildDayBoundarySnapshot } from './dayBoundaryContract';
import { DAY_ROLLOVER_HOUR, dayAfter, dueDayOf } from './dayClose';
import { isMeasurableTracking } from './habitEngine';
import { isPausedOn } from './habitPauses';
import {
  carriesDayLoad,
  isCountBasedSchedule,
  isEligibleOn,
  periodStatus,
} from './habitSchedule';
import { deficitFor, planFromRow } from './recovery';
import type { Habit, HabitLog, RecoveryPlan, RecoveryStrategy } from './supabase';
import {
  resolveTaskDuration,
  type TaskEstimateSource,
} from './taskDuration';
import type { ListType, Task } from './taskTypes';

export { resolveTaskDuration as resolveTaskEstimate } from './taskDuration';

/** Önizlemenin varsayılan geçerlilik süresi (dakika). */
export const DEFAULT_PREVIEW_TTL_MINUTES = 30;
/** Kalan kapasite türetilirken kullanılan makul akşam planlama sınırı (`21:00` = `1260` dk). */
export const DEFAULT_EVENING_CUTOFF_MINUTES = 21 * 60;
/** `shrink` eyleminde önerilen küçük ilk adım odak süresi (`5` dk). */
export const SHRINK_STEP_MINUTES = 5;
/** Açık takvim penceresinden sürdürülebilir odak kapasitesi türetme oranı (`P01`). */
export const SUSTAINABLE_FOCUS_WINDOW_RATIO = 0.18;

export const DAY_PLAN_ACTIONS = [
  'keep',
  'shrink',
  'postpone_tomorrow',
  'release_someday',
  'skip_today',
  'do_not_recover',
] as const;

export type DayPlanAction = (typeof DAY_PLAN_ACTIONS)[number];

export type FixedBlockSource = 'internal_fixed' | 'external_busy';

export type FixedPlanBlock = {
  readonly id: string;
  readonly user_id?: string;
  readonly title: string;
  readonly local_day: Ymd;
  readonly start_time: string;
  readonly end_time: string;
  readonly locked: true;
  readonly source?: FixedBlockSource;
};

export type ProtectedEntityKind = 'task' | 'habit';

export type ProtectedRef = {
  readonly entity: ProtectedEntityKind;
  readonly id: string;
};

export type DayPlanEntityKind = 'task' | 'habit' | 'recovery_plan';

export type DayPlanSourceRef = {
  readonly entity: DayPlanEntityKind;
  readonly id: string;
  readonly title: string;
};

export type PlanTimeBlock = {
  readonly start: string;
  readonly end: string | null;
};

export type LockedItemKind =
  | 'fixed_block'
  | 'completed_task'
  | 'completed_habit'
  | 'excused_habit';

export type LockedItemReasonCode =
  | 'fixed_appointment'
  | 'already_completed'
  | 'already_excused_today';

export type LockedPlanItem = {
  readonly kind: LockedItemKind;
  readonly id: string;
  readonly title: string;
  readonly localDay: Ymd;
  readonly locked: true;
  readonly timeBlock: PlanTimeBlock | null;
  readonly source: FixedBlockSource | 'task' | 'habit';
  readonly reasonCode: LockedItemReasonCode;
  readonly displayReason: string;
};

export type DayPlanItemSnapshot = {
  readonly dueDate: Ymd | null;
  readonly listType?: ListType | null;
  readonly timeBlock: PlanTimeBlock | null;
  readonly estimatedMinutes: number | null;
  readonly estimateSource: TaskEstimateSource | null;
  readonly isMissingEstimate: boolean;
  readonly habitState: HabitLog['state'] | null;
  readonly loggedValue: number | null;
  readonly targetValue: number | null;
  readonly unit: string | null;
  readonly deficitRemaining: number | null;
  readonly recoveryStrategy?: RecoveryStrategy | null;
  readonly shrunkStepMinutes?: number | null;
  readonly preservesParentTask?: boolean;
};

export type ProtectedPlanItem = {
  readonly sourceRef: {
    readonly entity: ProtectedEntityKind;
    readonly id: string;
    readonly title: string;
  };
  readonly expectedVersion: string | null;
  readonly expectedFingerprint: string;
  readonly expectedLogFingerprint?: string | null;
  readonly snapshot: DayPlanItemSnapshot;
  readonly conflictsWithFixedBlockId: string | null;
  readonly reasonCode: 'protected_by_user';
  readonly displayReason: string;
};

export type DayPlanReasonCode =
  | 'fits_remaining_capacity'
  | 'conflicts_with_fixed_block'
  | 'exceeds_remaining_capacity'
  | 'shrunk_to_fit_capacity'
  | 'lightened_for_today'
  | 'recovery_declined_preserve_progress'
  | 'released_to_someday'
  | 'user_override';

export type DayPlanChange = {
  readonly changeId: string;
  readonly sourceRef: DayPlanSourceRef;
  readonly expectedVersion: string | null;
  readonly expectedFingerprint: string;
  readonly expectedLogFingerprint?: string | null;
  readonly action: DayPlanAction;
  readonly availableActions: readonly DayPlanAction[];
  readonly before: DayPlanItemSnapshot;
  readonly after: DayPlanItemSnapshot;
  readonly conflictingFixedBlockId: string | null;
  readonly reasonCode: DayPlanReasonCode;
  readonly displayReason: string;
};

export type UnplacedItemReasonCode =
  | 'conflicts_with_fixed_block'
  | 'exceeds_remaining_capacity';

export type UnplacedPlanItem = {
  readonly sourceRef: DayPlanSourceRef;
  readonly recommendedAction: DayPlanAction;
  readonly requiredMinutes: number;
  readonly reasonCode: UnplacedItemReasonCode;
  readonly conflictingFixedBlockId: string | null;
  readonly displayReason: string;
};

export type CapacitySourceKind = 'explicit' | 'derived_from_window';

export type CapacitySummary = {
  readonly source: CapacitySourceKind;
  /** Planlamada kullanılan kalan odak kapasitesi (dk). */
  readonly effectiveCapacityMinutes: number;
  /** Korunan ve bugünde tutulan/küçültülen işlerin tükettiği toplam dakika. */
  readonly usedCapacityMinutes: number;
  /** Plan sonrası kalan boş kapasite (`max(effective - used, 0)`). */
  readonly remainingAfterPlanMinutes: number;
  /** Akşam sınırına (`21:00`) kadar sabit randevular çıkarıldıktan sonra kalan ham pencere (dk). */
  readonly unblockedWindowMinutes: number;
  /** Kalan pencerede kilitli sabit randevuların kapladığı toplam dakika. */
  readonly fixedBlockedMinutes: number;
  /** Harici takvim meşgul aralıkları bağlı mı? Bağlı değilse sahte takvim boşluğu uydurulmaz (`P01`). */
  readonly externalCalendarConnected: boolean;
  /** Kayıtlı süre tahmini veya geçerli saat bloğu olmayan görev kimlikleri (`E19` / `P01`). */
  readonly missingEstimateTaskIds: readonly string[];
  /** Bugün saat bloğu atanmamış açık görev kimlikleri (kapasite tahmininden ayrı raporlanır — `P01`). */
  readonly unblockedTaskIds: readonly string[];
};

export type DayPlanPreviewInput = {
  readonly userId: string;
  readonly localDayKey: Ymd;
  readonly nowLocalMinutes: number;
  readonly generatedAtIso: string;
  readonly protectedRef: ProtectedRef | null;
  readonly fixedBlocks: readonly FixedPlanBlock[];
  readonly tasks: readonly Task[];
  readonly habits: readonly Habit[];
  readonly todayLogs: readonly HabitLog[];
  readonly recoveryPlans?: readonly RecoveryPlan[];
  readonly remainingCapacityMinutes?: number | null;
  readonly externalCalendarConnected?: boolean;
  readonly itemOverrides?: Readonly<Record<string, DayPlanAction>>;
  readonly previewTtlMinutes?: number;
};

export type DayPlanPreview = {
  readonly previewId: string;
  readonly userId: string;
  readonly localDayKey: Ymd;
  readonly tomorrowDayKey: Ymd;
  readonly nowLocalMinutes: number;
  readonly generatedAtIso: string;
  readonly expiresAtIso: string;
  readonly protectedRef: ProtectedRef | null;
  readonly lockedItems: readonly LockedPlanItem[];
  readonly protectedItems: readonly ProtectedPlanItem[];
  readonly changes: readonly DayPlanChange[];
  readonly unplacedItems: readonly UnplacedPlanItem[];
  readonly missingEstimateTaskIds: readonly string[];
  readonly capacitySummary: CapacitySummary;
  readonly loadBefore: number;
  readonly loadAfter: number;
  readonly loadDelta: number;
  readonly bandBefore: LoadBandKey;
  readonly bandAfter: LoadBandKey;
};

export type PreviewStaleReason = 'expired' | 'day_changed' | 'version_conflict';

export type PreviewFreshnessInput = {
  readonly nowIso: string;
  readonly currentLocalDayKey: Ymd;
  readonly tasks: readonly Task[];
  readonly habits: readonly Habit[];
  readonly todayLogs?: readonly HabitLog[];
  readonly recoveryPlans?: readonly RecoveryPlan[];
};

export type PreviewFreshnessResult =
  | {
      readonly fresh: true;
      readonly staleItemIds: readonly [];
      readonly reason: null;
    }
  | {
      readonly fresh: false;
      readonly staleItemIds: readonly string[];
      readonly reason: PreviewStaleReason;
    };

const PRIORITY_RANK: Readonly<Record<Task['priority'], number>> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

const TASK_ACTIONS: readonly DayPlanAction[] = [
  'keep',
  'shrink',
  'postpone_tomorrow',
  'release_someday',
];

const HABIT_ACTIONS_DEFAULT: readonly DayPlanAction[] = [
  'keep',
  'skip_today',
  'do_not_recover',
];

const HABIT_ACTIONS_PARTIAL_FIRST: readonly DayPlanAction[] = [
  'keep',
  'do_not_recover',
  'skip_today',
];

const RECOVERY_PLAN_ACTIONS: readonly DayPlanAction[] = [
  'keep',
  'do_not_recover',
  'postpone_tomorrow',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function clampMinutesOfDay(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(1439, Math.floor(raw)));
}

/**
 * `'H:MM'`, `'HH:MM'` veya `'HH:MM:SS'` saat dizgesini gün içi dakikaya (`0..1439`) çevirir.
 * Geçersiz biçimlerde (`'24:00'`, `'12:60'`, boş dizge, `null`) `null` döner.
 */
export function parseHmToMinutes(hm: string | null | undefined): number | null {
  if (typeof hm !== 'string') return null;
  const trimmed = hm.trim();
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] !== undefined ? Number(match[3]) : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null;
  }
  return hour * 60 + minute;
}

/** Gün içi dakikayı (`0..1439`) `'HH:MM'` biçimine dönüştürür. */
export function formatMinutesToHm(totalMinutes: number): string {
  const safe = clampMinutesOfDay(totalMinutes);
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** `itemOverrides` haritası için varlık-önekli kanonik anahtar (`task:id`, `habit:id`, `recovery_plan:id`). */
export function previewItemKey(entity: DayPlanEntityKind, id: string): string {
  return `${entity}:${id}`;
}

/** `RecoveryPlan` satırı için deterministik sürüm parmak izi. */
export function recoveryPlanFingerprint(plan: RecoveryPlan): string {
  return canonical({
    id: plan.id,
    h: plan.habit_id,
    sl: plan.source_log_id ?? null,
    sd: plan.source_date,
    td: plan.target_date,
    dt: plan.deficit_type ?? null,
    dv: plan.deficit_value ?? null,
    st: plan.strategy,
    dd: plan.distributed_days ?? null,
    s: plan.status,
    ca: plan.completed_at ?? null,
  });
}

function todayLogFingerprint(log: HabitLog | undefined): string {
  if (!log) return canonical(null);
  return canonical({
    id: log.id,
    d: log.completed_at.slice(0, 10),
    s: log.state,
    v: log.value ?? null,
    ic: log.is_completed,
  });
}

/**
 * `04:00` Gün Kapanışı devir kuralıyla (`E04`) etkin yerel planlama gününü ve gün içi dakikayı çözer.
 * `00:00..03:59` aralığında kapanmakta olan önceki yerel günü (`closingDayKey`) döndürür.
 */
export function resolveEffectivePlanningDay(
  instant: Date,
  ianaZone?: string | null,
): {
  readonly localDayKey: Ymd;
  readonly closingDayKey: Ymd;
  readonly effectiveDayKey: Ymd;
  readonly nowLocalMinutes: number;
  readonly isBeforeRollover: boolean;
} {
  const snap = buildDayBoundarySnapshot(instant, ianaZone);
  return {
    localDayKey: snap.localDayKey,
    closingDayKey: snap.closingDayKey,
    effectiveDayKey: snap.closingDayKey,
    nowLocalMinutes: snap.localHour * 60 + snap.localMinute,
    isBeforeRollover: snap.isBeforeDayCloseRollover,
  };
}

type MinuteInterval = {
  readonly start: number;
  readonly end: number;
};

type ParsedFixedBlock = {
  readonly block: FixedPlanBlock;
  readonly startMin: number;
  readonly endMin: number;
  readonly normalizedTimeBlock: PlanTimeBlock;
};

function parseFixedBlocksForDay(
  fixedBlocks: readonly FixedPlanBlock[],
  localDayKey: Ymd,
): ParsedFixedBlock[] {
  const parsed: ParsedFixedBlock[] = [];
  const seenIds = new Set<string>();

  for (const b of fixedBlocks) {
    if (!b.locked || b.local_day !== localDayKey) continue;
    if (seenIds.has(b.id)) continue;
    const startMin = parseHmToMinutes(b.start_time);
    const endMin = parseHmToMinutes(b.end_time);
    if (startMin === null || endMin === null || endMin <= startMin) continue;
    seenIds.add(b.id);
    parsed.push({
      block: b,
      startMin,
      endMin,
      normalizedTimeBlock: {
        start: formatMinutesToHm(startMin),
        end: formatMinutesToHm(endMin),
      },
    });
  }

  return parsed.sort((a, b) => {
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    if (a.endMin !== b.endMin) return a.endMin - b.endMin;
    const titleDiff = a.block.title.localeCompare(b.block.title, 'tr');
    if (titleDiff !== 0) return titleDiff;
    return a.block.id.localeCompare(b.block.id);
  });
}

function mergedBlockedMinutesInWindow(
  blocks: readonly ParsedFixedBlock[],
  windowStart: number,
  windowEnd: number,
): number {
  if (windowEnd <= windowStart || blocks.length === 0) return 0;

  const clipped: MinuteInterval[] = [];
  for (const b of blocks) {
    const start = Math.max(windowStart, b.startMin);
    const end = Math.min(windowEnd, b.endMin);
    if (end > start) {
      clipped.push({ start, end });
    }
  }
  if (clipped.length === 0) return 0;

  clipped.sort((a, b) => a.start - b.start || a.end - b.end);
  let total = 0;
  let curStart = clipped[0].start;
  let curEnd = clipped[0].end;

  for (let i = 1; i < clipped.length; i += 1) {
    const next = clipped[i];
    if (next.start <= curEnd) {
      curEnd = Math.max(curEnd, next.end);
    } else {
      total += curEnd - curStart;
      curStart = next.start;
      curEnd = next.end;
    }
  }
  total += curEnd - curStart;
  return total;
}

/**
 * Kalan planlama kapasitesini deterministik olarak hesaplar (`P01`).
 * - Açık `explicitRemainingMinutes` verilmişse doğrudan kullanılır.
 * - Verilmemişse `nowLocalMinutes..21:00` penceresinden kilitli sabit randevular
 *   çıkarılır ve sürdürülebilir odak oranıyla (`SUSTAINABLE_FOCUS_WINDOW_RATIO`) ölçeklenir.
 * - `00:00..03:59` (`< 04:00` kapanış devri) veya `21:00` sonrasında türetilen kapasite `0` dk'dır.
 */
export function deriveRemainingCapacityMinutes(params: {
  readonly localDayKey: Ymd;
  readonly nowLocalMinutes: number;
  readonly fixedBlocks: readonly FixedPlanBlock[];
  readonly explicitRemainingMinutes?: number | null;
  readonly externalCalendarConnected?: boolean;
}): {
  readonly source: CapacitySourceKind;
  readonly effectiveCapacityMinutes: number;
  readonly unblockedWindowMinutes: number;
  readonly fixedBlockedMinutes: number;
  readonly externalCalendarConnected: boolean;
} {
  const parsedBlocks = parseFixedBlocksForDay(params.fixedBlocks, params.localDayKey);
  const externalCalendarConnected =
    params.externalCalendarConnected === true ||
    parsedBlocks.some((b) => b.block.source === 'external_busy');

  const nowMin = clampMinutesOfDay(params.nowLocalMinutes);
  const rolloverMinutes = DAY_ROLLOVER_HOUR * 60;
  const isClosingWindowOrLateEvening =
    nowMin < rolloverMinutes || nowMin >= DEFAULT_EVENING_CUTOFF_MINUTES;

  const rawWindow = isClosingWindowOrLateEvening
    ? 0
    : Math.max(0, DEFAULT_EVENING_CUTOFF_MINUTES - nowMin);
  const fixedBlockedMinutes = isClosingWindowOrLateEvening
    ? 0
    : mergedBlockedMinutesInWindow(parsedBlocks, nowMin, DEFAULT_EVENING_CUTOFF_MINUTES);
  const unblockedWindowMinutes = Math.max(0, rawWindow - fixedBlockedMinutes);

  if (
    typeof params.explicitRemainingMinutes === 'number' &&
    Number.isFinite(params.explicitRemainingMinutes)
  ) {
    return {
      source: 'explicit',
      effectiveCapacityMinutes: Math.max(0, Math.floor(params.explicitRemainingMinutes)),
      unblockedWindowMinutes,
      fixedBlockedMinutes,
      externalCalendarConnected,
    };
  }

  const derived = Math.floor(unblockedWindowMinutes * SUSTAINABLE_FOCUS_WINDOW_RATIO);
  return {
    source: 'derived_from_window',
    effectiveCapacityMinutes: Math.max(0, derived),
    unblockedWindowMinutes,
    fixedBlockedMinutes,
    externalCalendarConnected,
  };
}

function logStateRank(state: HabitLog['state']): number {
  if (state === 'done') return 3;
  if (state === 'partial') return 2;
  if (state === 'skip') return 1;
  return 0;
}

function selectRepresentativeTodayLogs(
  todayLogs: readonly HabitLog[],
  localDayKey: Ymd,
): Map<string, HabitLog> {
  const byHabitId = new Map<string, HabitLog>();
  for (const log of todayLogs) {
    if (typeof log.completed_at !== 'string') continue;
    const logDay = log.completed_at.slice(0, 10);
    if (logDay !== localDayKey) continue;
    const prev = byHabitId.get(log.habit_id);
    if (!prev || logStateRank(log.state) >= logStateRank(prev.state)) {
      byHabitId.set(log.habit_id, log);
    }
  }
  return byHabitId;
}

function normalizeTaskTimeBlock(task: Task): {
  readonly timeBlock: PlanTimeBlock | null;
  readonly startMin: number | null;
  readonly endMin: number | null;
} {
  const startMin = parseHmToMinutes(task.time_block_start);
  if (startMin === null) {
    return { timeBlock: null, startMin: null, endMin: null };
  }
  const rawEndMin = parseHmToMinutes(task.time_block_end);
  if (rawEndMin !== null && rawEndMin > startMin) {
    return {
      timeBlock: {
        start: formatMinutesToHm(startMin),
        end: formatMinutesToHm(rawEndMin),
      },
      startMin,
      endMin: rawEndMin,
    };
  }
  return {
    timeBlock: {
      start: formatMinutesToHm(startMin),
      end: null,
    },
    startMin,
    endMin: null,
  };
}

function findConflictingFixedBlock(
  task: Task,
  resolvedMinutes: number,
  localDayKey: Ymd,
  fixedBlocks: readonly ParsedFixedBlock[],
): ParsedFixedBlock | null {
  if (dueDayOf(task.due_date) !== localDayKey) return null;
  const { startMin, endMin } = normalizeTaskTimeBlock(task);
  if (startMin === null) return null;
  const effectiveEnd =
    endMin !== null ? endMin : Math.min(1440, startMin + Math.max(1, resolvedMinutes));
  for (const fb of fixedBlocks) {
    if (startMin < fb.endMin && fb.startMin < effectiveEnd) {
      return fb;
    }
  }
  return null;
}

function resolveOverrideAction(
  overrides: Readonly<Record<string, DayPlanAction>> | undefined,
  entity: DayPlanEntityKind,
  id: string,
  allowed: readonly DayPlanAction[],
): DayPlanAction | null {
  if (!overrides) return null;
  const raw = overrides[previewItemKey(entity, id)] ?? overrides[id];
  if (!raw) return null;
  return allowed.includes(raw) ? raw : null;
}

function buildTaskBeforeSnapshot(task: Task): DayPlanItemSnapshot {
  const duration = resolveTaskDuration(task);
  const due = dueDayOf(task.due_date);
  const { timeBlock } = normalizeTaskTimeBlock(task);
  return {
    dueDate: due !== '' ? due : null,
    listType: task.list_type,
    timeBlock,
    estimatedMinutes: duration.minutes,
    estimateSource: duration.source,
    isMissingEstimate: duration.isMissingEstimate,
    habitState: null,
    loggedValue: null,
    targetValue: null,
    unit: null,
    deficitRemaining: null,
    recoveryStrategy: null,
    shrunkStepMinutes: null,
    preservesParentTask: true,
  };
}

function buildTaskAfterSnapshot(
  before: DayPlanItemSnapshot,
  action: DayPlanAction,
  localDayKey: Ymd,
  tomorrowDayKey: Ymd,
): DayPlanItemSnapshot {
  switch (action) {
    case 'postpone_tomorrow':
      return {
        ...before,
        dueDate: tomorrowDayKey,
        shrunkStepMinutes: null,
        preservesParentTask: true,
      };
    case 'release_someday':
      return {
        ...before,
        dueDate: null,
        listType: 'someday',
        timeBlock: null,
        shrunkStepMinutes: null,
        preservesParentTask: true,
      };
    case 'shrink':
      return {
        ...before,
        dueDate: localDayKey,
        timeBlock: null,
        estimatedMinutes: SHRINK_STEP_MINUTES,
        shrunkStepMinutes: SHRINK_STEP_MINUTES,
        preservesParentTask: true,
      };
    case 'keep':
    default:
      return {
        ...before,
        shrunkStepMinutes: null,
        preservesParentTask: true,
      };
  }
}

function computeHabitDeficitRemaining(
  habit: Habit,
  todayLog: HabitLog | undefined,
): {
  readonly loggedValue: number | null;
  readonly targetValue: number | null;
  readonly deficitRemaining: number | null;
} {
  const loggedValue =
    todayLog && typeof todayLog.value === 'number' && Number.isFinite(todayLog.value)
      ? todayLog.value
      : null;

  const measurable = isMeasurableTracking(habit.tracking_type);
  const hasPositiveGoal =
    typeof habit.daily_goal === 'number' &&
    Number.isFinite(habit.daily_goal) &&
    habit.daily_goal > 0;
  const targetValue = measurable && hasPositiveGoal ? habit.daily_goal : null;

  if (measurable && habit.target_direction !== 'at_most') {
    if (targetValue === null) {
      // Eksik veya <= 0 hedefte uydurma sayı üretilmez (REC-05).
      return { loggedValue, targetValue: null, deficitRemaining: null };
    }
    const deficit = deficitFor({
      trackingType: habit.tracking_type,
      target: targetValue,
      value: loggedValue ?? 0,
      state: todayLog?.state ?? null,
      direction: habit.target_direction ?? null,
    });
    return { loggedValue, targetValue, deficitRemaining: deficit.value };
  }

  const deficit = deficitFor({
    trackingType: habit.tracking_type,
    target: habit.daily_goal ?? null,
    value: loggedValue,
    state: todayLog?.state ?? null,
    direction: habit.target_direction ?? null,
  });
  return { loggedValue, targetValue, deficitRemaining: deficit.value };
}

function buildHabitBeforeSnapshot(
  habit: Habit,
  todayLog: HabitLog | undefined,
  localDayKey: Ymd,
): DayPlanItemSnapshot {
  const { loggedValue, targetValue, deficitRemaining } = computeHabitDeficitRemaining(
    habit,
    todayLog,
  );
  const estMinutes =
    typeof habit.estimated_minutes === 'number' &&
    Number.isFinite(habit.estimated_minutes) &&
    habit.estimated_minutes > 0
      ? Math.round(habit.estimated_minutes)
      : null;

  return {
    dueDate: localDayKey,
    listType: null,
    timeBlock: null,
    estimatedMinutes: estMinutes,
    estimateSource: null,
    isMissingEstimate: false,
    habitState: todayLog?.state ?? null,
    loggedValue,
    targetValue,
    unit: habit.unit ?? null,
    deficitRemaining,
    recoveryStrategy: null,
    shrunkStepMinutes: null,
    preservesParentTask: false,
  };
}

function buildHabitAfterSnapshot(
  before: DayPlanItemSnapshot,
  action: DayPlanAction,
): DayPlanItemSnapshot {
  if (action === 'do_not_recover') {
    return {
      ...before,
      estimatedMinutes: 0,
      // P04: Önceki kısmi ilerleme (`0,5 L`, `partial`) ayrı ve güvende kalır; sahte tamamlama üretilmez.
      habitState: before.habitState,
      loggedValue: before.loggedValue,
      deficitRemaining: 0,
      recoveryStrategy: 'skip',
    };
  }
  if (action === 'skip_today') {
    const hasPartialProgress =
      before.habitState === 'partial' &&
      before.loggedValue !== null &&
      before.loggedValue > 0;
    return {
      ...before,
      estimatedMinutes: 0,
      habitState: hasPartialProgress ? 'partial' : 'skip',
      loggedValue: before.loggedValue,
      deficitRemaining: 0,
      recoveryStrategy: hasPartialProgress ? 'skip' : null,
    };
  }
  return { ...before };
}

function formatAmountWithUnit(value: number, unit: string | null): string {
  const trimmedUnit = typeof unit === 'string' ? unit.trim() : '';
  return trimmedUnit.length > 0
    ? `${decimalTR(value)} ${trimmedUnit}`
    : decimalTR(value);
}

function describeTaskChangeReason(params: {
  readonly action: DayPlanAction;
  readonly reasonCode: DayPlanReasonCode;
  readonly isMissingEstimate: boolean;
  readonly conflictingBlock: ParsedFixedBlock | null;
}): string {
  const { action, reasonCode, isMissingEstimate, conflictingBlock } = params;

  if (reasonCode === 'conflicts_with_fixed_block' && conflictingBlock !== null) {
    const endPart = conflictingBlock.normalizedTimeBlock.end
      ? `–${conflictingBlock.normalizedTimeBlock.end}`
      : '';
    return `«${conflictingBlock.block.title}» (${conflictingBlock.normalizedTimeBlock.start}${endPart}) sabit randevusuyla çakıştığı için yarına önerildi.`;
  }

  if (reasonCode === 'user_override') {
    switch (action) {
      case 'keep':
        return 'Seçiminle bugünün planında tutuldu.';
      case 'shrink':
        return 'Seçiminle asıl görev tamamlanmadan 5 dk ilk adım odağına küçültüldü.';
      case 'postpone_tomorrow':
        return 'Seçiminle yarına taşındı.';
      case 'release_someday':
        return 'Seçiminle Bir Gün listesine alındı; görev silinmedi.';
      default:
        return 'Seçiminle güncellendi.';
    }
  }

  switch (action) {
    case 'shrink':
      return 'Tam süresi kalan kapasiteyi aştığı için asıl görevi silmeden 5 dk ilk adım odak önerildi.';
    case 'postpone_tomorrow':
      return 'Bugünün kalan kapasitesini aşmamak için yarına önerildi.';
    case 'release_someday':
      return 'Bir Gün listesine alındı; görev silinmedi.';
    case 'keep':
    default:
      return isMissingEstimate
        ? 'Kayıtlı süre tahmini yok; varsayılan 15 dk tahminiyle kalan kapasiteye sığıyor.'
        : 'Kalan kapasiteye ve sabit randevulara çakışmadan sığıyor; bugün için korundu.';
  }
}

function describeHabitChangeReason(params: {
  readonly action: DayPlanAction;
  readonly reasonCode: DayPlanReasonCode;
  readonly before: DayPlanItemSnapshot;
}): string {
  const { action, reasonCode, before } = params;
  const hasLogged =
    before.loggedValue !== null && before.loggedValue > 0 && before.targetValue !== null;
  const hasDeficit = before.deficitRemaining !== null && before.deficitRemaining > 0;

  if (action === 'do_not_recover') {
    if (hasLogged && hasDeficit && before.loggedValue !== null && before.deficitRemaining !== null) {
      return `Mevcut ${formatAmountWithUnit(before.loggedValue, before.unit)} kaydın korundu; kalan ${formatAmountWithUnit(before.deficitRemaining, before.unit)} için telafi eklenmedi.`;
    }
    if (before.targetValue !== null && hasDeficit && before.deficitRemaining !== null) {
      return `Kalan ${formatAmountWithUnit(before.deficitRemaining, before.unit)} için telafi eklenmedi; yarın normal hedefinle devam eder.`;
    }
    return 'Telafi etme seçildi; yarına ek yük taşınmadan sakin kapatılır.';
  }

  if (action === 'skip_today') {
    if (hasLogged && before.loggedValue !== null) {
      return `Mevcut ${formatAmountWithUnit(before.loggedValue, before.unit)} ilerlemen korundu; kalan kısım bugünlük hafifletildi.`;
    }
    return reasonCode === 'user_override'
      ? 'Seçiminle bugünlük atlandı; seri ve oran korunur.'
      : 'Hafif Gün kapsamında bugünlük atlandı; seri ve oran korunur.';
  }

  if (hasDeficit && before.targetValue !== null && before.deficitRemaining !== null) {
    return `Bugün için açık tutuldu; kalan gerçek hedef açığı ${formatAmountWithUnit(before.deficitRemaining, before.unit)}.`;
  }
  return reasonCode === 'user_override'
    ? 'Seçiminle bugünün planında tutuldu.'
    : 'Kalan kapasiteye sığıyor; bugün için açık tutuldu.';
}

function computeExpiresAtIso(generatedAtIso: string, ttlMinutes: number): string {
  const safeTtl =
    typeof ttlMinutes === 'number' && Number.isFinite(ttlMinutes) && ttlMinutes > 0
      ? Math.floor(ttlMinutes)
      : DEFAULT_PREVIEW_TTL_MINUTES;
  const parsedMs = Date.parse(generatedAtIso);
  if (Number.isNaN(parsedMs)) {
    return new Date(safeTtl * 60_000).toISOString();
  }
  return new Date(parsedMs + safeTtl * 60_000).toISOString();
}

function compareOpenTasks(a: Task, b: Task, localDayKey: Ymd): number {
  const prioDiff = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
  if (prioDiff !== 0) return prioDiff;

  const dueA = dueDayOf(a.due_date);
  const dueB = dueDayOf(b.due_date);
  const startA = dueA === localDayKey ? parseHmToMinutes(a.time_block_start) : null;
  const startB = dueB === localDayKey ? parseHmToMinutes(b.time_block_start) : null;
  if (startA !== null && startB !== null && startA !== startB) return startA - startB;
  if (startA !== null && startB === null) return -1;
  if (startA === null && startB !== null) return 1;

  if (dueA !== dueB) return dueA < dueB ? -1 : 1;

  const createdA = a.created_at ?? '';
  const createdB = b.created_at ?? '';
  if (createdA !== createdB) return createdA < createdB ? -1 : 1;

  const titleDiff = a.title.localeCompare(b.title, 'tr');
  if (titleDiff !== 0) return titleDiff;
  return a.id.localeCompare(b.id);
}

function isIncompleteCandidateHabitOnDay(
  habit: Habit,
  dayDate: Date,
  todayLog: HabitLog | undefined,
  allTodayLogs: readonly HabitLog[],
): boolean {
  if (habit.status !== 'active') return false;
  if (isPausedOn(habit, dayDate)) return false;
  if (!isEligibleOn(habit, dayDate)) return false;

  if (todayLog?.state === 'done' || todayLog?.is_completed === true) return false;
  if (todayLog?.state === 'skip') return false;

  if (isCountBasedSchedule(habit)) {
    const pStatus = periodStatus(habit, allTodayLogs, dayDate, { asOf: dayDate });
    if (pStatus.status === 'satisfied' || pStatus.status === 'paused') return false;
  }

  // Tavan / bırakma alışkanlığında henüz kayıt yoksa ortada bir açık yoktur.
  if (
    (habit.behavior_type === 'negative' || habit.target_direction === 'at_most') &&
    todayLog === undefined
  ) {
    return false;
  }

  return true;
}

/**
 * Günün toparlanması önizlemesini (`DayPlanPreview`) saf ve deterministik olarak üretir.
 * Hiçbir girdi dizisini veya nesnesini mutate etmez.
 */
export function buildDayPlanPreview(input: DayPlanPreviewInput): DayPlanPreview {
  const safeDayDate = parseLocalDate(input.localDayKey) ?? new Date(1970, 0, 1);
  const localDayKey: Ymd =
    parseLocalDate(input.localDayKey) !== null ? input.localDayKey : '1970-01-01';
  const tomorrowDayKey: Ymd = dayAfter(localDayKey);
  const nowLocalMinutes = clampMinutesOfDay(input.nowLocalMinutes);

  const parsedFixedBlocks = parseFixedBlocksForDay(input.fixedBlocks, localDayKey);
  const derivedCapacity = deriveRemainingCapacityMinutes({
    localDayKey,
    nowLocalMinutes,
    fixedBlocks: input.fixedBlocks,
    explicitRemainingMinutes: input.remainingCapacityMinutes,
    externalCalendarConnected: input.externalCalendarConnected,
  });

  const repLogsByHabit = selectRepresentativeTodayLogs(input.todayLogs, localDayKey);

  // ---------------------------------------------------------------------------
  // Adım 1: Sabit randevuları ve tamamlanmış öğeleri `lockedItems` içine ayır
  // ---------------------------------------------------------------------------
  const lockedItems: LockedPlanItem[] = [];

  for (const fb of parsedFixedBlocks) {
    lockedItems.push({
      kind: 'fixed_block',
      id: fb.block.id,
      title: fb.block.title,
      localDay: localDayKey,
      locked: true,
      timeBlock: fb.normalizedTimeBlock,
      source: fb.block.source ?? 'internal_fixed',
      reasonCode: 'fixed_appointment',
      displayReason: 'Sabit randevu korundu; saati ve yeri değiştirilmez.',
    });
  }

  const completedTodayTasks = input.tasks
    .filter((t) => {
      if (t.status === 'cancelled') return false;
      if (!t.completed && t.status !== 'completed') return false;
      return (
        dueDayOf(t.due_date) === localDayKey ||
        ymdFromIso(t.completed_at) === localDayKey
      );
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'tr') || a.id.localeCompare(b.id));

  for (const ct of completedTodayTasks) {
    const { timeBlock } = normalizeTaskTimeBlock(ct);
    lockedItems.push({
      kind: 'completed_task',
      id: ct.id,
      title: ct.title,
      localDay: localDayKey,
      locked: true,
      timeBlock,
      source: 'task',
      reasonCode: 'already_completed',
      displayReason: 'Tamamlanan görev olduğu gibi korundu.',
    });
  }

  const sortedHabits = [...input.habits].sort(
    (a, b) => a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id),
  );

  for (const h of sortedHabits) {
    if (h.status !== 'active') continue;
    const log = repLogsByHabit.get(h.id);
    if (!log) continue;
    if (log.state === 'done' || log.is_completed) {
      lockedItems.push({
        kind: 'completed_habit',
        id: h.id,
        title: h.name,
        localDay: localDayKey,
        locked: true,
        timeBlock: null,
        source: 'habit',
        reasonCode: 'already_completed',
        displayReason: 'Bugün tamamlanan rutin olduğu gibi korundu.',
      });
    } else if (log.state === 'skip') {
      lockedItems.push({
        kind: 'excused_habit',
        id: h.id,
        title: h.name,
        localDay: localDayKey,
        locked: true,
        timeBlock: null,
        source: 'habit',
        reasonCode: 'already_excused_today',
        displayReason: 'Bugünlük zaten hafifletilmiş rutin korundu.',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Adım 2: Kullanıcının koruduğu tek işi (`protectedRef`) `protectedItems`'a al
  // ---------------------------------------------------------------------------
  const openCandidateTasksAll = input.tasks.filter((t) => {
    if (t.completed || t.status === 'completed' || t.status === 'cancelled') return false;
    const due = dueDayOf(t.due_date);
    return due !== '' && due <= localDayKey;
  });

  const incompleteHabitsAll = sortedHabits.filter((h) =>
    isIncompleteCandidateHabitOnDay(h, safeDayDate, repLogsByHabit.get(h.id), input.todayLogs),
  );

  const protectedItems: ProtectedPlanItem[] = [];
  let protectedTaskId: string | null = null;
  let protectedHabitId: string | null = null;
  let usedCapacityMinutes = 0;

  if (input.protectedRef !== null) {
    if (input.protectedRef.entity === 'task') {
      const targetTask = openCandidateTasksAll.find((t) => t.id === input.protectedRef?.id);
      if (targetTask) {
        protectedTaskId = targetTask.id;
        const snapshot = buildTaskBeforeSnapshot(targetTask);
        const conflict = findConflictingFixedBlock(
          targetTask,
          snapshot.estimatedMinutes ?? SHRINK_STEP_MINUTES,
          localDayKey,
          parsedFixedBlocks,
        );
        usedCapacityMinutes += snapshot.estimatedMinutes ?? 0;
        protectedItems.push({
          sourceRef: {
            entity: 'task',
            id: targetTask.id,
            title: targetTask.title,
          },
          expectedVersion: targetTask.updated_at ?? null,
          expectedFingerprint: taskFingerprint(targetTask),
          snapshot: {
            ...snapshot,
            dueDate: localDayKey,
          },
          conflictsWithFixedBlockId: conflict ? conflict.block.id : null,
          reasonCode: 'protected_by_user',
          displayReason: conflict
            ? `Bugün korumayı seçtiğin iş tutuldu; «${conflict.block.title}» sabit randevusu yerinde kalır.`
            : 'Bugün korumayı seçtiğin tek odak işi olarak yerinde tutuldu.',
        });
      }
    } else if (input.protectedRef.entity === 'habit') {
      const targetHabit = incompleteHabitsAll.find((h) => h.id === input.protectedRef?.id);
      if (targetHabit) {
        protectedHabitId = targetHabit.id;
        const log = repLogsByHabit.get(targetHabit.id);
        const snapshot = buildHabitBeforeSnapshot(targetHabit, log, localDayKey);
        usedCapacityMinutes += snapshot.estimatedMinutes ?? 0;
        protectedItems.push({
          sourceRef: {
            entity: 'habit',
            id: targetHabit.id,
            title: targetHabit.name,
          },
          expectedVersion: null,
          expectedFingerprint: habitFingerprint(targetHabit),
          expectedLogFingerprint: todayLogFingerprint(log),
          snapshot,
          conflictsWithFixedBlockId: null,
          reasonCode: 'protected_by_user',
          displayReason: 'Bugün korumayı seçtiğin rutin olarak yerinde tutuldu.',
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Adım 3, 4 & 5: Kalan açık görevleri, eksik alışkanlıkları ve telafi planlarını
  // deterministik sırala ve kapasite/çakışma kurallarıyla `changes` üret
  // ---------------------------------------------------------------------------
  const missingEstimateTaskIds: string[] = [];
  const unblockedTaskIds: string[] = [];

  for (const t of [...openCandidateTasksAll].sort((a, b) =>
    compareOpenTasks(a, b, localDayKey),
  )) {
    const resolution = resolveTaskDuration(t);
    if (resolution.isMissingEstimate) {
      missingEstimateTaskIds.push(t.id);
    }
    if (dueDayOf(t.due_date) === localDayKey && parseHmToMinutes(t.time_block_start) === null) {
      unblockedTaskIds.push(t.id);
    }
  }

  const remainingOpenTasks = openCandidateTasksAll
    .filter((t) => t.id !== protectedTaskId)
    .sort((a, b) => compareOpenTasks(a, b, localDayKey));

  const remainingHabits = incompleteHabitsAll
    .filter((h) => h.id !== protectedHabitId)
    .sort((a, b) => {
      const impRank = (lvl: Habit['impact_level']): number => {
        if (lvl === 'critical') return 0;
        if (lvl === 'high') return 1;
        if (lvl === 'medium') return 2;
        return 3;
      };
      const iDiff = impRank(a.impact_level) - impRank(b.impact_level);
      if (iDiff !== 0) return iDiff;
      const mA = a.estimated_minutes ?? 0;
      const mB = b.estimated_minutes ?? 0;
      if (mA !== mB) return mA - mB;
      const nDiff = a.name.localeCompare(b.name, 'tr');
      if (nDiff !== 0) return nDiff;
      return a.id.localeCompare(b.id);
    });

  const habitById = new Map<string, Habit>();
  for (const h of input.habits) {
    habitById.set(h.id, h);
  }

  const plannedRecoveriesToday = [...(input.recoveryPlans ?? [])]
    .filter((rp) => {
      if (rp.status !== 'planned') return false;
      const v2 = planFromRow(rp);
      return v2.scheduled_for.includes(localDayKey);
    })
    .sort((a, b) => a.source_date.localeCompare(b.source_date) || a.id.localeCompare(b.id));

  const changes: DayPlanChange[] = [];
  const unplacedItems: UnplacedPlanItem[] = [];
  let autoShrunkTasksCount = 0;

  // --- Görev değişiklikleri ---
  for (const task of remainingOpenTasks) {
    const before = buildTaskBeforeSnapshot(task);
    const taskMinutes = before.estimatedMinutes ?? SHRINK_STEP_MINUTES;
    const conflict = findConflictingFixedBlock(
      task,
      taskMinutes,
      localDayKey,
      parsedFixedBlocks,
    );

    const override = resolveOverrideAction(
      input.itemOverrides,
      'task',
      task.id,
      TASK_ACTIONS,
    );

    let action: DayPlanAction;
    let reasonCode: DayPlanReasonCode;

    if (override !== null) {
      action = override;
      reasonCode = 'user_override';
    } else if (conflict !== null) {
      action = 'postpone_tomorrow';
      reasonCode = 'conflicts_with_fixed_block';
    } else if (usedCapacityMinutes + taskMinutes <= derivedCapacity.effectiveCapacityMinutes) {
      action = 'keep';
      reasonCode = 'fits_remaining_capacity';
    } else if (
      autoShrunkTasksCount === 0 &&
      taskMinutes > SHRINK_STEP_MINUTES &&
      dueDayOf(task.due_date) === localDayKey &&
      usedCapacityMinutes + SHRINK_STEP_MINUTES <= derivedCapacity.effectiveCapacityMinutes
    ) {
      action = 'shrink';
      reasonCode = 'shrunk_to_fit_capacity';
      autoShrunkTasksCount += 1;
    } else {
      action = 'postpone_tomorrow';
      reasonCode = 'exceeds_remaining_capacity';
    }

    if (action === 'keep') {
      usedCapacityMinutes += taskMinutes;
    } else if (action === 'shrink') {
      usedCapacityMinutes += SHRINK_STEP_MINUTES;
    }

    const after = buildTaskAfterSnapshot(before, action, localDayKey, tomorrowDayKey);
    const displayReason = describeTaskChangeReason({
      action,
      reasonCode,
      isMissingEstimate: before.isMissingEstimate,
      conflictingBlock: conflict,
    });

    const sourceRef: DayPlanSourceRef = {
      entity: 'task',
      id: task.id,
      title: task.title,
    };

    changes.push({
      changeId: `chg:${localDayKey}:task:${task.id}:${action}`,
      sourceRef,
      expectedVersion: task.updated_at ?? null,
      expectedFingerprint: taskFingerprint(task),
      action,
      availableActions: TASK_ACTIONS,
      before,
      after,
      conflictingFixedBlockId: conflict ? conflict.block.id : null,
      reasonCode,
      displayReason,
    });

    if (
      override === null &&
      (reasonCode === 'conflicts_with_fixed_block' ||
        reasonCode === 'exceeds_remaining_capacity')
    ) {
      unplacedItems.push({
        sourceRef,
        recommendedAction: action,
        requiredMinutes: taskMinutes,
        reasonCode,
        conflictingFixedBlockId: conflict ? conflict.block.id : null,
        displayReason,
      });
    }
  }

  // --- Eksik alışkanlık değişiklikleri (P04) ---
  for (const habit of remainingHabits) {
    const todayLog = repLogsByHabit.get(habit.id);
    const before = buildHabitBeforeSnapshot(habit, todayLog, localDayKey);
    const habitMinutes = before.estimatedMinutes ?? SHRINK_STEP_MINUTES;
    const hasPartialProgress =
      before.habitState === 'partial' ||
      (before.loggedValue !== null && before.loggedValue > 0);
    const allowedActions = hasPartialProgress
      ? HABIT_ACTIONS_PARTIAL_FIRST
      : HABIT_ACTIONS_DEFAULT;

    const override = resolveOverrideAction(
      input.itemOverrides,
      'habit',
      habit.id,
      allowedActions,
    );

    let action: DayPlanAction;
    let reasonCode: DayPlanReasonCode;

    if (override !== null) {
      action = override;
      reasonCode = 'user_override';
    } else if (usedCapacityMinutes + habitMinutes <= derivedCapacity.effectiveCapacityMinutes) {
      action = 'keep';
      reasonCode = 'fits_remaining_capacity';
    } else if (hasPartialProgress) {
      action = 'do_not_recover';
      reasonCode = 'recovery_declined_preserve_progress';
    } else {
      action = 'skip_today';
      reasonCode = 'lightened_for_today';
    }

    if (action === 'keep') {
      usedCapacityMinutes += habitMinutes;
    }

    const after = buildHabitAfterSnapshot(before, action);
    const displayReason = describeHabitChangeReason({ action, reasonCode, before });
    const sourceRef: DayPlanSourceRef = {
      entity: 'habit',
      id: habit.id,
      title: habit.name,
    };

    changes.push({
      changeId: `chg:${localDayKey}:habit:${habit.id}:${action}`,
      sourceRef,
      expectedVersion: null,
      expectedFingerprint: habitFingerprint(habit),
      expectedLogFingerprint: todayLogFingerprint(todayLog),
      action,
      availableActions: allowedActions,
      before,
      after,
      conflictingFixedBlockId: null,
      reasonCode,
      displayReason,
    });

    if (override === null && action !== 'keep') {
      unplacedItems.push({
        sourceRef,
        recommendedAction: action,
        requiredMinutes: habitMinutes,
        reasonCode: 'exceeds_remaining_capacity',
        conflictingFixedBlockId: null,
        displayReason,
      });
    }
  }

  // --- Bugüne planlanmış telafi satırları (`recovery_plan` — P04) ---
  for (const plan of plannedRecoveriesToday) {
    const linkedHabit = habitById.get(plan.habit_id);
    const title = linkedHabit ? linkedHabit.name : 'Telafi planı';
    const dayDist = plan.distributed_days?.find((d) => d.date === localDayKey);
    const deficitVal =
      dayDist !== undefined
        ? dayDist.value
        : typeof plan.deficit_value === 'number' && Number.isFinite(plan.deficit_value)
          ? plan.deficit_value
          : null;
    const estMin =
      linkedHabit && linkedHabit.estimated_minutes > 0
        ? Math.max(1, Math.round(linkedHabit.estimated_minutes))
        : SHRINK_STEP_MINUTES;

    const before: DayPlanItemSnapshot = {
      dueDate: localDayKey,
      listType: null,
      timeBlock:
        parseHmToMinutes(plan.reminder_time) !== null
          ? {
              start: formatMinutesToHm(parseHmToMinutes(plan.reminder_time) ?? 0),
              end: null,
            }
          : null,
      estimatedMinutes: estMin,
      estimateSource: null,
      isMissingEstimate: false,
      habitState: null,
      loggedValue: null,
      targetValue: deficitVal,
      unit: linkedHabit?.unit ?? null,
      deficitRemaining: deficitVal,
      recoveryStrategy: plan.strategy,
      shrunkStepMinutes: null,
      preservesParentTask: false,
    };

    const override = resolveOverrideAction(
      input.itemOverrides,
      'recovery_plan',
      plan.id,
      RECOVERY_PLAN_ACTIONS,
    );

    let action: DayPlanAction;
    let reasonCode: DayPlanReasonCode;

    if (override !== null) {
      action = override;
      reasonCode = 'user_override';
    } else if (usedCapacityMinutes + estMin <= derivedCapacity.effectiveCapacityMinutes) {
      action = 'keep';
      reasonCode = 'fits_remaining_capacity';
    } else {
      action = 'do_not_recover';
      reasonCode = 'recovery_declined_preserve_progress';
    }

    if (action === 'keep') {
      usedCapacityMinutes += estMin;
    }

    const after: DayPlanItemSnapshot =
      action === 'do_not_recover'
        ? {
            ...before,
            estimatedMinutes: 0,
            deficitRemaining: 0,
            recoveryStrategy: 'skip',
          }
        : action === 'postpone_tomorrow'
          ? {
              ...before,
              dueDate: tomorrowDayKey,
              recoveryStrategy: 'push_tomorrow',
            }
          : { ...before };

    const displayReason =
      action === 'do_not_recover'
        ? deficitVal !== null
          ? `Kalan ${formatAmountWithUnit(deficitVal, before.unit)} telafisi iptal edildi; önceki ilerleme kaydı korunur.`
          : 'Telafi etme seçildi; önceki ilerleme kaydı korunur.'
        : action === 'postpone_tomorrow'
          ? 'Telafi planı yarına ertelendi.'
          : 'Planlanan telafi kalan kapasiteye sığıyor; bugün için korundu.';

    const sourceRef: DayPlanSourceRef = {
      entity: 'recovery_plan',
      id: plan.id,
      title,
    };

    changes.push({
      changeId: `chg:${localDayKey}:recovery_plan:${plan.id}:${action}`,
      sourceRef,
      expectedVersion: null,
      expectedFingerprint: recoveryPlanFingerprint(plan),
      action,
      availableActions: RECOVERY_PLAN_ACTIONS,
      before,
      after,
      conflictingFixedBlockId: null,
      reasonCode,
      displayReason,
    });

    if (override === null && action !== 'keep') {
      unplacedItems.push({
        sourceRef,
        recommendedAction: action,
        requiredMinutes: estMin,
        reasonCode: 'exceeds_remaining_capacity',
        conflictingFixedBlockId: null,
        displayReason,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Adım 6: `loadBefore` / `loadAfter` (`0..100` ve `LoadBandKey`) hesabı
  // ---------------------------------------------------------------------------
  const activeHabitsInEnvelope = habitsInRangeOn(
    sortedHabits.filter((h) => h.status === 'active'),
    safeDayDate,
  ).filter((h) => !isPausedOn(h, safeDayDate));

  const logsMutableCopy: HabitLog[] = [...input.todayLogs];
  const habitsCarryingBefore = activeHabitsInEnvelope.filter((h) => {
    const rep = repLogsByHabit.get(h.id);
    if (rep?.state === 'skip') return false;
    return carriesDayLoad(h, logsMutableCopy, safeDayDate);
  });

  const tasksTodayBefore = openCandidateTasksAll
    .filter((t) => dueDayOf(t.due_date) === localDayKey)
    .map((t) => ({ estimated_minutes: resolveTaskDuration(t).minutes }));

  const overdueCountBefore = openCandidateTasksAll.filter(
    (t) => dueDayOf(t.due_date) < localDayKey,
  ).length;

  let makeupPointsBefore = 0;
  for (const plan of plannedRecoveriesToday) {
    const linked = habitById.get(plan.habit_id);
    if (!linked) continue;
    const share = plan.strategy === 'split_two_days' ? 0.5 : 1;
    makeupPointsBefore += oneOccurrencePoints(linked) * share;
  }

  const rawLoadBefore =
    computeDailyLoad({
      habits: habitsCarryingBefore,
      tasks: tasksTodayBefore,
      overdueCount: overdueCountBefore,
    }).raw + makeupPointsBefore;

  const loadBefore = Math.max(0, Math.min(100, Math.round(rawLoadBefore)));
  const bandBefore = bandFor(loadBefore);

  const excusedHabitIdsAfter = new Set<string>();
  for (const ch of changes) {
    if (
      ch.sourceRef.entity === 'habit' &&
      (ch.action === 'skip_today' || ch.action === 'do_not_recover')
    ) {
      excusedHabitIdsAfter.add(ch.sourceRef.id);
    }
  }

  const habitsCarryingAfter = habitsCarryingBefore.filter(
    (h) => !excusedHabitIdsAfter.has(h.id),
  );

  const tasksTodayAfter: { estimated_minutes: number }[] = [];
  let overdueCountAfter = 0;

  if (protectedTaskId !== null) {
    const pt = openCandidateTasksAll.find((t) => t.id === protectedTaskId);
    if (pt) {
      tasksTodayAfter.push({ estimated_minutes: resolveTaskDuration(pt).minutes });
    }
  }

  for (const ch of changes) {
    if (ch.sourceRef.entity !== 'task') continue;
    if (ch.action === 'keep') {
      if (ch.before.dueDate === localDayKey) {
        tasksTodayAfter.push({
          estimated_minutes: ch.before.estimatedMinutes ?? SHRINK_STEP_MINUTES,
        });
      } else if (ch.before.dueDate !== null && ch.before.dueDate < localDayKey) {
        overdueCountAfter += 1;
      }
    } else if (ch.action === 'shrink') {
      tasksTodayAfter.push({ estimated_minutes: SHRINK_STEP_MINUTES });
    }
  }

  let makeupPointsAfter = 0;
  for (const ch of changes) {
    if (ch.sourceRef.entity !== 'recovery_plan' || ch.action !== 'keep') continue;
    const plan = plannedRecoveriesToday.find((p) => p.id === ch.sourceRef.id);
    const linked = plan ? habitById.get(plan.habit_id) : undefined;
    if (!plan || !linked) continue;
    const share = plan.strategy === 'split_two_days' ? 0.5 : 1;
    makeupPointsAfter += oneOccurrencePoints(linked) * share;
  }

  const rawLoadAfter =
    computeDailyLoad({
      habits: habitsCarryingAfter,
      tasks: tasksTodayAfter,
      overdueCount: overdueCountAfter,
    }).raw + makeupPointsAfter;

  const loadAfter = Math.max(0, Math.min(100, Math.round(rawLoadAfter)));
  const bandAfter = bandFor(loadAfter);

  const expiresAtIso = computeExpiresAtIso(
    input.generatedAtIso,
    input.previewTtlMinutes ?? DEFAULT_PREVIEW_TTL_MINUTES,
  );

  const capacitySummary: CapacitySummary = {
    source: derivedCapacity.source,
    effectiveCapacityMinutes: derivedCapacity.effectiveCapacityMinutes,
    usedCapacityMinutes,
    remainingAfterPlanMinutes: Math.max(
      0,
      derivedCapacity.effectiveCapacityMinutes - usedCapacityMinutes,
    ),
    unblockedWindowMinutes: derivedCapacity.unblockedWindowMinutes,
    fixedBlockedMinutes: derivedCapacity.fixedBlockedMinutes,
    externalCalendarConnected: derivedCapacity.externalCalendarConnected,
    missingEstimateTaskIds,
    unblockedTaskIds,
  };

  const previewId = `prv_${checksum(
    canonical({
      u: input.userId,
      d: localDayKey,
      m: nowLocalMinutes,
      g: input.generatedAtIso,
      p: input.protectedRef,
      l: lockedItems.map((x) => `${x.kind}:${x.id}`),
      pr: protectedItems.map((x) => `${x.sourceRef.entity}:${x.sourceRef.id}:${x.expectedFingerprint}`),
      c: changes.map((x) => `${x.changeId}:${x.expectedFingerprint}`),
    }),
  )}`;

  return {
    previewId,
    userId: input.userId,
    localDayKey,
    tomorrowDayKey,
    nowLocalMinutes,
    generatedAtIso: input.generatedAtIso,
    expiresAtIso,
    protectedRef: input.protectedRef ? { ...input.protectedRef } : null,
    lockedItems,
    protectedItems,
    changes,
    unplacedItems,
    missingEstimateTaskIds,
    capacitySummary,
    loadBefore,
    loadAfter,
    loadDelta: loadAfter - loadBefore,
    bandBefore,
    bandAfter,
  };
}

/**
 * «Gör» adımında tek bir maddenin eylem tercihini girdi nesnesini mutate etmeden
 * güncelleyip yeni `DayPlanPreview` üretir (`REC-02`).
 */
export function applyPreviewItemOverride(
  previewInput: DayPlanPreviewInput,
  itemIdOrKey: string,
  action: DayPlanAction,
): DayPlanPreview {
  const nextOverrides: Record<string, DayPlanAction> = {
    ...(previewInput.itemOverrides ?? {}),
    [itemIdOrKey]: action,
  };
  return buildDayPlanPreview({
    ...previewInput,
    itemOverrides: nextOverrides,
  });
}

/**
 * Adım 7 (`REC-04`): Uygulama (`commit`) öncesinde önizlemenin hâlâ taze ve
 * çakışmasız olup olmadığını doğrular.
 *
 * - `currentLocalDayKey !== preview.localDayKey` -> `reason: 'day_changed'`
 * - `nowIso > preview.expiresAtIso` -> `reason: 'expired'`
 * - Herhangi bir korunan veya değiştirilen öğenin `expectedVersion` / `expectedFingerprint`
 *   değeri güncel veriden farklıysa -> `staleItemIds` içinde tam öğe kimliği döner.
 */
export function evaluatePreviewFreshness(
  preview: DayPlanPreview,
  current: PreviewFreshnessInput,
): PreviewFreshnessResult {
  const taskMap = new Map<string, Task>();
  for (const t of current.tasks) {
    taskMap.set(t.id, t);
  }

  const habitMap = new Map<string, Habit>();
  for (const h of current.habits) {
    habitMap.set(h.id, h);
  }

  const recoveryMap = new Map<string, RecoveryPlan>();
  for (const rp of current.recoveryPlans ?? []) {
    recoveryMap.set(rp.id, rp);
  }

  const currentLogsByHabit =
    current.todayLogs !== undefined
      ? selectRepresentativeTodayLogs(current.todayLogs, preview.localDayKey)
      : null;

  const staleSet = new Set<string>();
  const orderedStaleIds: string[] = [];
  const pushStale = (id: string): void => {
    if (!staleSet.has(id)) {
      staleSet.add(id);
      orderedStaleIds.push(id);
    }
  };

  const inspectVersionedItem = (item: {
    readonly sourceRef: DayPlanSourceRef;
    readonly expectedVersion: string | null;
    readonly expectedFingerprint: string;
    readonly expectedLogFingerprint?: string | null;
  }): void => {
    const { entity, id } = item.sourceRef;
    if (entity === 'task') {
      const curTask = taskMap.get(id);
      if (!curTask) {
        pushStale(id);
        return;
      }
      const curVersion = curTask.updated_at ?? null;
      if (
        curVersion !== item.expectedVersion ||
        taskFingerprint(curTask) !== item.expectedFingerprint
      ) {
        pushStale(id);
      }
      return;
    }

    if (entity === 'habit') {
      const curHabit = habitMap.get(id);
      if (!curHabit || habitFingerprint(curHabit) !== item.expectedFingerprint) {
        pushStale(id);
        return;
      }
      if (
        currentLogsByHabit !== null &&
        item.expectedLogFingerprint !== undefined &&
        item.expectedLogFingerprint !== null
      ) {
        const curLogFp = todayLogFingerprint(currentLogsByHabit.get(id));
        if (curLogFp !== item.expectedLogFingerprint) {
          pushStale(id);
        }
      }
      return;
    }

    if (entity === 'recovery_plan') {
      const curPlan = recoveryMap.get(id);
      if (!curPlan || recoveryPlanFingerprint(curPlan) !== item.expectedFingerprint) {
        pushStale(id);
      }
    }
  };

  for (const pItem of preview.protectedItems) {
    inspectVersionedItem(pItem);
  }
  for (const change of preview.changes) {
    inspectVersionedItem(change);
  }

  if (
    parseLocalDate(current.currentLocalDayKey) === null ||
    current.currentLocalDayKey !== preview.localDayKey
  ) {
    return {
      fresh: false,
      staleItemIds: orderedStaleIds,
      reason: 'day_changed',
    };
  }

  const nowMs = Date.parse(current.nowIso);
  const expiresMs = Date.parse(preview.expiresAtIso);
  if (Number.isNaN(nowMs) || Number.isNaN(expiresMs) || nowMs > expiresMs) {
    return {
      fresh: false,
      staleItemIds: orderedStaleIds,
      reason: 'expired',
    };
  }

  if (orderedStaleIds.length > 0) {
    return {
      fresh: false,
      staleItemIds: orderedStaleIds,
      reason: 'version_conflict',
    };
  }

  return {
    fresh: true,
    staleItemIds: [],
    reason: null,
  };
}
