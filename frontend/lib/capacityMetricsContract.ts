/**
 * E10 + E09 — Kapasite ölçümlerinin ayrıştırılması ve alışkanlık geri alma (undo) etkisi.
 *
 * Saf domain modülü: I/O, Supabase istemcisi, Zustand store veya saat okuma içermez.
 *
 * Dört ayrı, birbirine dönüştürülemeyen eksen (E10):
 *   1. `DailyLoadResult` (`0..100` günlük planlama yükü tahmini — «Bugün ne kadarı sığar?»)
 *   2. `WillpowerBudgetSnapshot` (atomik `spend_willpower` günlük rutin etkinleştirme bütçesi)
 *   3. `XpLedgerSummary` (birikimli Kintsugi XP defteri — harcanan bir bakiye değildir)
 *   4. `FocusPointsBalance` (koç/ekonomi kredisi — planlama yükünü veya XP'yi değiştirmez)
 *
 * Alışkanlık kaydı geri alımı (E09 / DEC-OD20):
 *   - İlgili günün log ve seri görünümü güncellenir.
 *   - Açık sayı-tabanlı dönemlerde (`haftada 3` için `2/3 -> 1/3`) boş günler «kaçırıldı» sayılmaz.
 *   - Kintsugi XP defterinde silinen kaydın XP'si `purged_xp` olarak korunur; `xp_drift` üretilmez.
 */
import {
  CAPACITY_CEILING_DEFAULT,
  type DailyLoadResult,
  type LoadBandKey,
} from './capacity';
import { addDaysLocal, parseLocalDate, ymd, type Ymd } from './date';
import {
  isCountBasedSchedule,
  isMissedOn,
  periodStatus,
  streakBroken,
  type PeriodStatus,
} from './habitSchedule';
import type { Habit, HabitLog } from './supabase';

export type { DailyLoadResult, LoadBandKey };

export const CAPACITY_FRAMING_QUESTION = 'Bugün ne kadarı sığar?' as const;

export type CapacityMetricAxis =
  | 'daily_load'
  | 'willpower_budget'
  | 'xp_ledger'
  | 'focus_points';

export type PlanningLoadSnapshot = {
  readonly kind: 'daily_load';
  readonly result: DailyLoadResult;
  readonly ceiling: number;
  /** Önerilen tavana (`ceiling`) kadar kalan planlama payı (`max(ceiling - normalised, 0)`). */
  readonly headroom: number;
};

export type WillpowerBudgetSnapshot = {
  readonly kind: 'willpower_budget';
  readonly stateDate: Ymd;
  readonly used: number;
  readonly dailyBudget: number;
  readonly remaining: number;
  readonly activeCount: number;
  readonly focusCapacity: number;
};

export type XpLedgerSummary = {
  readonly kind: 'xp_ledger';
  /** `activeLogsXp + purgedXp` toplamına eşit birikimli XP. */
  readonly totalXp: number;
  /** Aktif `habit_logs.xp` toplamı. */
  readonly activeLogsXp: number;
  /** Silinen kayıtlardan Kintsugi kuralıyla korunan `profiles.purged_xp` toplamı. */
  readonly purgedXp: number;
  /** Pazartesi başlangıçlı yerel haftanın XP toplamı (`weekly_xp.xp_earned`). */
  readonly weeklyXp: number;
  readonly level: number;
  /** `totalXp === activeLogsXp + purgedXp` değişmezi (`xp_drift() = 0`). */
  readonly driftFree: boolean;
};

export type FocusPointsBalance = {
  readonly kind: 'focus_points';
  readonly balance: number;
  readonly updatedAtIso: string | null;
};

export type SeparatedCapacityView = {
  readonly dailyLoad: PlanningLoadSnapshot;
  readonly willpowerBudget: WillpowerBudgetSnapshot;
  readonly xpLedger: XpLedgerSummary;
  readonly focusPoints: FocusPointsBalance;
};

function safeNonNegative(n: number): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

export function buildWillpowerBudgetSnapshot(row: {
  readonly state_date: Ymd;
  readonly used: number;
  readonly daily_budget: number;
  readonly active_count: number;
  readonly focus_capacity: number;
}): WillpowerBudgetSnapshot {
  const used = safeNonNegative(row.used);
  const dailyBudget = safeNonNegative(row.daily_budget);
  return {
    kind: 'willpower_budget',
    stateDate: row.state_date,
    used,
    dailyBudget,
    remaining: Math.max(dailyBudget - used, 0),
    activeCount: Math.floor(safeNonNegative(row.active_count)),
    focusCapacity: Math.floor(safeNonNegative(row.focus_capacity)),
  };
}

export function buildXpLedgerSummary(input: {
  readonly totalXp: number;
  readonly activeLogsXp: number;
  readonly purgedXp?: number;
  readonly weeklyXp?: number;
  readonly level?: number;
}): XpLedgerSummary {
  const totalXp = Math.floor(safeNonNegative(input.totalXp));
  const activeLogsXp = Math.floor(safeNonNegative(input.activeLogsXp));
  const purgedXp = Math.floor(safeNonNegative(input.purgedXp ?? 0));
  const weeklyXp = Math.floor(safeNonNegative(input.weeklyXp ?? 0));
  const level = Math.max(1, Math.floor(safeNonNegative(input.level ?? 1)));

  return {
    kind: 'xp_ledger',
    totalXp,
    activeLogsXp,
    purgedXp,
    weeklyXp,
    level,
    driftFree: totalXp === activeLogsXp + purgedXp,
  };
}

export function buildFocusPointsBalance(input: {
  readonly balance: number;
  readonly updatedAtIso?: string | null;
}): FocusPointsBalance {
  return {
    kind: 'focus_points',
    balance: Math.floor(safeNonNegative(input.balance)),
    updatedAtIso: input.updatedAtIso ?? null,
  };
}

export function buildSeparatedCapacityView(params: {
  readonly load: DailyLoadResult;
  readonly ceiling?: number;
  readonly willpowerBudget: WillpowerBudgetSnapshot;
  readonly xpLedger: XpLedgerSummary;
  readonly focusPoints: FocusPointsBalance;
}): SeparatedCapacityView {
  const ceiling =
    typeof params.ceiling === 'number' && Number.isFinite(params.ceiling)
      ? Math.max(0, Math.min(100, Math.round(params.ceiling)))
      : CAPACITY_CEILING_DEFAULT;

  return {
    dailyLoad: {
      kind: 'daily_load',
      result: params.load,
      ceiling,
      headroom: Math.max(ceiling - params.load.normalised, 0),
    },
    willpowerBudget: params.willpowerBudget,
    xpLedger: params.xpLedger,
    focusPoints: params.focusPoints,
  };
}

export type CapacityDomainEvent =
  | { readonly type: 'task_planned'; readonly estimatedMinutes: number }
  | { readonly type: 'focus_session_logged'; readonly focusMinutes: number }
  | {
      readonly type: 'habit_activated';
      readonly willpowerCost: number;
      readonly projectedLoadPoints: number;
    }
  | {
      readonly type: 'habit_paused_same_day';
      readonly willpowerRefund: number;
      readonly releasedLoadPoints: number;
    }
  | { readonly type: 'habit_logged'; readonly awardedXp: number }
  | { readonly type: 'coach_credits_spent'; readonly credits: number };

export type CapacityEventEffect = {
  readonly eventType: CapacityDomainEvent['type'];
  /** Günlük planlama yükü tahmini (`dailyLoad`) yeniden hesaplanır mı? */
  readonly recomputesDailyLoad: boolean;
  /** Atomik `spend_willpower` günlük bütçesine uygulanan net değişim (`< 0` harcama, `> 0` iade, `0` dokunmaz). */
  readonly willpowerBudgetDelta: number;
  /** Birikimli XP defterine uygulanan net değişim (`>= 0`). */
  readonly xpLedgerDelta: number;
  /** Focus Points koç/ekonomi bakiyesine uygulanan net değişim (`<= 0`). */
  readonly focusPointsDelta: number;
  /** Hangi eksenlerin güncellendiğinin açık listesi; gizli çift düşümü denetler. */
  readonly touchedAxes: readonly CapacityMetricAxis[];
  /** Aynı eylemde birden fazla harcama bütçesinden (`willpower_budget` + `focus_points`) düşüm yapılmadığının kanıtı. */
  readonly singleSpendDeduction: true;
};

/**
 * E10 — Her kullanıcı işleminin dört metrik üzerindeki etkisini tek tabloda sınıflandırır:
 * - Görev eklemek veya odak oturumu kaydetmek yalnız `daily_load` tahminini günceller;
 *   `willpower_budget` veya `focus_points` bakiyesini ASLA düşürmez.
 * - Alışkanlık etkinleştirmek `willpower_budget` bütçesinden yalnız BİR KEZ düşer ve
 *   aktif rutin listesi üzerinden `daily_load` projeksiyonunu yeniler (`focus_points` / `xp_ledger` değişmez).
 * - Alışkanlık kaydı (`habit_logged`) yalnız `xp_ledger` ve dönem ilerlemesini günceller; irade bütçesi harcamaz.
 * - Koç işlemi yalnız `focus_points` kredisini düşürür.
 */
export function classifyCapacityEventImpact(event: CapacityDomainEvent): CapacityEventEffect {
  switch (event.type) {
    case 'task_planned':
    case 'focus_session_logged':
      return {
        eventType: event.type,
        recomputesDailyLoad: true,
        willpowerBudgetDelta: 0,
        xpLedgerDelta: 0,
        focusPointsDelta: 0,
        touchedAxes: ['daily_load'],
        singleSpendDeduction: true,
      };
    case 'habit_activated': {
      const cost = safeNonNegative(event.willpowerCost);
      return {
        eventType: event.type,
        recomputesDailyLoad: true,
        willpowerBudgetDelta: cost === 0 ? 0 : -cost,
        xpLedgerDelta: 0,
        focusPointsDelta: 0,
        touchedAxes: cost > 0 ? ['willpower_budget', 'daily_load'] : ['daily_load'],
        singleSpendDeduction: true,
      };
    }
    case 'habit_paused_same_day': {
      const refund = safeNonNegative(event.willpowerRefund);
      return {
        eventType: event.type,
        recomputesDailyLoad: true,
        willpowerBudgetDelta: refund,
        xpLedgerDelta: 0,
        focusPointsDelta: 0,
        touchedAxes: refund > 0 ? ['willpower_budget', 'daily_load'] : ['daily_load'],
        singleSpendDeduction: true,
      };
    }
    case 'habit_logged': {
      const xp = Math.floor(safeNonNegative(event.awardedXp));
      return {
        eventType: event.type,
        recomputesDailyLoad: false,
        willpowerBudgetDelta: 0,
        xpLedgerDelta: xp,
        focusPointsDelta: 0,
        touchedAxes: xp > 0 ? ['xp_ledger'] : [],
        singleSpendDeduction: true,
      };
    }
    case 'coach_credits_spent': {
      const credits = Math.floor(safeNonNegative(event.credits));
      return {
        eventType: event.type,
        recomputesDailyLoad: false,
        willpowerBudgetDelta: 0,
        xpLedgerDelta: 0,
        focusPointsDelta: credits === 0 ? 0 : -credits,
        touchedAxes: credits > 0 ? ['focus_points'] : [],
        singleSpendDeduction: true,
      };
    }
  }
}

export type LoadVsBudgetGuidance =
  | 'fits_comfortably'
  | 'pace_gently'
  | 'lighten_day'
  | 'budget_full';

export type LoadVsBudgetExplanation = {
  readonly framingQuestion: typeof CAPACITY_FRAMING_QUESTION;
  readonly guidance: LoadVsBudgetGuidance;
  readonly loadHeadline: string;
  readonly loadSummary: string;
  readonly budgetSummary: string;
  readonly separationSummary: string;
};

const BAND_LABELS_TR: Readonly<Record<LoadBandKey, string>> = {
  dusuk: 'düşük yoğunluk',
  dengeli: 'dengeli yoğunluk',
  yuksek: 'yüksek yoğunluk',
  asiri: 'aşırı yoğunluk',
};

/**
 * E10 — Planlama yükü (`0..100`) ile günlük etkinleştirme bütçesini (`spend_willpower`)
 * sade, yargılamayan Türkçe ile ve «Bugün ne kadarı sığar?» çerçevesinde açıklar.
 * Kişisel/tıbbi puan dili kesinlikle kullanılmaz.
 */
export function explainLoadVsBudget(params: {
  readonly dailyLoad: DailyLoadResult;
  readonly willpowerBudget: Pick<WillpowerBudgetSnapshot, 'used' | 'dailyBudget' | 'remaining'>;
  readonly ceiling?: number;
}): LoadVsBudgetExplanation {
  const normalised = params.dailyLoad.normalised;
  const bandLabel = BAND_LABELS_TR[params.dailyLoad.band];
  const remainingBudget = Math.max(0, params.willpowerBudget.remaining);
  const totalBudget = Math.max(0, params.willpowerBudget.dailyBudget);
  const ceiling =
    typeof params.ceiling === 'number' && Number.isFinite(params.ceiling)
      ? Math.max(0, Math.min(100, Math.round(params.ceiling)))
      : CAPACITY_CEILING_DEFAULT;

  let guidance: LoadVsBudgetGuidance;
  let loadSummary: string;

  if (normalised > ceiling || params.dailyLoad.band === 'asiri') {
    guidance = 'lighten_day';
    loadSummary =
      'Bugünkü iş ve rutin listesi yoğun görünüyor; bir işi yarına taşımak veya küçük adımla başlamak günü rahatlatır.';
  } else if (params.dailyLoad.band === 'yuksek') {
    guidance = 'pace_gently';
    loadSummary =
      'Bugünün planı doluya yakın; mevcut işleri tamamlamaya odaklanmak yeni yük eklemekten daha sürdürülebilir olur.';
  } else if (remainingBudget <= 0 && totalBudget > 0) {
    guidance = 'budget_full';
    loadSummary =
      'Bugünkü iş planında yer var; ancak yeni rutin etkinleştirme bütçesi bugünlük doldu.';
  } else {
    guidance = 'fits_comfortably';
    loadSummary = 'Bugünkü rutin ve görevlerin güne rahatça sığıyor.';
  }

  const loadHeadline = `${CAPACITY_FRAMING_QUESTION} Günlük planlama tahmini ${normalised}/100 (${bandLabel}).`;
  const budgetSummary = `Yeni rutin etkinleştirme bütçesi: kalan ${remainingBudget}/${totalBudget} birim. Bu bütçe yalnız yeni bir alışkanlığı aktif odağa alırken kullanılır ve yarın yenilenir.`;
  const separationSummary =
    'Görev planlamak veya odak oturumu yapmak etkinleştirme bütçeni düşürmez; birikimli XP defterin ve koç kredilerin bu planlama tahmininden tamamen ayrıdır.';

  return {
    framingQuestion: CAPACITY_FRAMING_QUESTION,
    guidance,
    loadHeadline,
    loadSummary,
    budgetSummary,
    separationSummary,
  };
}

// ============================================================================
// E09 / DEC-OD20 — Alışkanlık kaydı geri alımı (undo) etki sözleşmesi
// ============================================================================

export type HabitLogWithOptionalXp = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'> & {
  readonly value?: number | null;
  readonly xp?: number | null;
};

export type HabitUndoImpactInput = {
  readonly habit: Habit;
  /** Geri alma (undo) ÖNCESİ kayıt listesi. */
  readonly logsBeforeUndo: readonly HabitLogWithOptionalXp[];
  /** Geri alınan yerel gün (`Date` veya `'YYYY-MM-DD'`). */
  readonly undoneDay: Date | Ymd;
  /** Değerlendirme anı (`periodStatus` için `asOf`). Verilmezse `undoneDay` kullanılır. */
  readonly asOf?: Date;
  /** Geri alma öncesi XP defteri özeti (isteğe bağlı, `xp_drift = 0` doğrulaması için). */
  readonly xpBefore?: {
    readonly totalXp: number;
    readonly purgedXp?: number;
  };
};

export type HabitUndoXpAccounting = {
  readonly removedLogXp: number;
  readonly reclassifiedToPurgedXp: number;
  readonly activeLogsXpBefore: number;
  readonly activeLogsXpAfter: number;
  readonly purgedXpBefore: number;
  readonly purgedXpAfter: number;
  readonly totalXpBefore: number;
  readonly totalXpAfter: number;
  readonly xpDriftDelta: 0;
  readonly producesXpDrift: false;
};

export type HabitUndoImpact = {
  readonly undoneDayKey: Ymd;
  readonly logRemovedForDay: boolean;
  readonly isCountSchedule: boolean;
  readonly periodBefore: PeriodStatus;
  readonly periodAfter: PeriodStatus;
  /** Dönem içindeki kayıtsız (boş) günlerin listesi (`YYYY-MM-DD`). */
  readonly unloggedDaysInPeriod: readonly Ymd[];
  /** Açık sayı-tabanlı hedefte (`haftada 3` vb.) boş günler «kaçırıldı» sayıldı mı? */
  readonly otherEmptyDaysMarkedMissed: boolean;
  /** Geri alma sonrası `asOf` itibarıyla seri bozuldu mu? */
  readonly streakBrokenAfterUndo: boolean;
  readonly xpAccounting: HabitUndoXpAccounting;
  readonly dayAndStreakNote: string;
  readonly periodNote: string;
  readonly xpLedgerNote: string;
  readonly summary: string;
};

function resolveLocalDateArg(value: Date | Ymd): { date: Date; key: Ymd } {
  if (value instanceof Date) {
    const key = ymd(value);
    return { date: parseLocalDate(key) ?? new Date(1970, 0, 1), key };
  }
  const parsed = parseLocalDate(value);
  if (parsed) return { date: parsed, key: value };
  return { date: new Date(1970, 0, 1), key: '1970-01-01' };
}

/**
 * E09 — Bir alışkanlık kaydı geri alındığında (undo):
 * 1. O günün logu kaldırılır, dönem ilerlemesi ve seri durumu gerçek `habitSchedule` kurallarıyla güncellenir.
 * 2. Açık haftalık/aylık sayı hedeflerinde (`haftada 3` için `2/3 -> 1/3`) diğer boş günler «kaçırıldı» yapılmaz.
 * 3. Kintsugi XP defterinde (`016` / `038` `fn_habit_log_purge_on_delete`) silinen satırın XP değeri
 *    `purged_xp` sütununa aktarılır; `total_xp = sum(habit_logs.xp) + purged_xp` korunduğu için
 *    `xp_drift` üretilmez ve aynı gün tekrar işaretlenirse ikinci kez XP ödenmez.
 */
export function describeHabitUndoImpact(input: HabitUndoImpactInput): HabitUndoImpact {
  const { date: undoneDate, key: undoneDayKey } = resolveLocalDateArg(input.undoneDay);
  const asOfDate = input.asOf ?? undoneDate;

  const matchingLogs = input.logsBeforeUndo.filter(
    (l) => l.habit_id === input.habit.id && l.completed_at.slice(0, 10) === undoneDayKey,
  );
  const logRemovedForDay = matchingLogs.length > 0;
  const logsAfterUndo = input.logsBeforeUndo.filter(
    (l) => !(l.habit_id === input.habit.id && l.completed_at.slice(0, 10) === undoneDayKey),
  );

  const periodBefore = periodStatus(input.habit, input.logsBeforeUndo, undoneDate, {
    asOf: asOfDate,
  });
  const periodAfter = periodStatus(input.habit, logsAfterUndo, undoneDate, {
    asOf: asOfDate,
  });

  const isCountSchedule = isCountBasedSchedule(input.habit);
  const loggedDaysAfter = new Set(
    logsAfterUndo
      .filter((l) => l.habit_id === input.habit.id)
      .map((l) => l.completed_at.slice(0, 10)),
  );

  const unloggedDaysInPeriod: Ymd[] = [];
  for (
    let cursor = periodAfter.periodStart;
    ymd(cursor) <= ymd(periodAfter.periodEnd);
    cursor = addDaysLocal(cursor, 1)
  ) {
    const key = ymd(cursor);
    if (!loggedDaysAfter.has(key)) {
      unloggedDaysInPeriod.push(key);
    }
  }

  // Sayı-tabanlı açık dönemlerde gün bazlı yükümlülük yoktur; boş günler kaçırılmış sayılmaz.
  // Gün-tabanlı modda ise yalnız değerlendirilen günün kendisi vardır (`other` boş gün yoktur)
  // ve negatif alışkanlıklarda kayıtsız gün de `isMissedOn` tarafından kaçırılmış sayılmaz.
  const otherEmptyDaysMarkedMissed = isCountSchedule
    ? false
    : unloggedDaysInPeriod
        .filter((d) => d !== undoneDayKey)
        .some((d) => d < ymd(asOfDate) && isMissedOn(input.habit, undefined));

  const streakBrokenAfterUndo = streakBroken(input.habit, logsAfterUndo, asOfDate);

  const activeLogsXpBefore = input.logsBeforeUndo.reduce(
    (sum, l) => sum + Math.floor(safeNonNegative(l.xp ?? 0)),
    0,
  );
  const removedLogXp = matchingLogs.reduce(
    (sum, l) => sum + Math.floor(safeNonNegative(l.xp ?? 0)),
    0,
  );
  const activeLogsXpAfter = Math.max(0, activeLogsXpBefore - removedLogXp);
  const purgedXpBefore = Math.floor(safeNonNegative(input.xpBefore?.purgedXp ?? 0));
  const reclassifiedToPurgedXp = removedLogXp;
  const purgedXpAfter = purgedXpBefore + reclassifiedToPurgedXp;
  const totalXpBefore =
    input.xpBefore !== undefined
      ? Math.floor(safeNonNegative(input.xpBefore.totalXp))
      : activeLogsXpBefore + purgedXpBefore;
  const totalXpAfter = totalXpBefore;

  const xpAccounting: HabitUndoXpAccounting = {
    removedLogXp,
    reclassifiedToPurgedXp,
    activeLogsXpBefore,
    activeLogsXpAfter,
    purgedXpBefore,
    purgedXpAfter,
    totalXpBefore,
    totalXpAfter,
    xpDriftDelta: 0,
    producesXpDrift: false,
  };

  const dayAndStreakNote = logRemovedForDay
    ? `${undoneDayKey} kaydı geri alındı; gün ve seri durumu güncellendi.`
    : `${undoneDayKey} için silinecek aktif kayıt bulunmadı; mevcut durum korundu.`;

  let periodNote: string;
  if (isCountSchedule && periodAfter.target > 0) {
    periodNote = `Dönem ilerlemesi ${periodBefore.counted}/${periodBefore.target} yerine ${periodAfter.counted}/${periodAfter.target} oldu; açık dönemdeki diğer boş günler «kaçırıldı» sayılmaz.`;
  } else if (periodAfter.status === 'not_started') {
    periodNote = 'Bugün hâlâ açık; kayıt geri alındığı için gün «henüz başlanmadı» durumuna döndü.';
  } else {
    periodNote = `Dönem durumu güncellendi (${periodAfter.counted}/${periodAfter.target}).`;
  }

  const xpLedgerNote =
    removedLogXp > 0
      ? `Kintsugi XP defterinde toplam XP korunur (${removedLogXp} XP silinen kayıt payına aktarılır, xp_drift oluşmaz; aynı gün yeniden işaretlenirse ikinci kez XP yazılmaz).`
      : 'Bu kayıtta taşınacak XP yoktu; Kintsugi XP defteri değişmedi (xp_drift oluşmaz).';

  return {
    undoneDayKey,
    logRemovedForDay,
    isCountSchedule,
    periodBefore,
    periodAfter,
    unloggedDaysInPeriod,
    otherEmptyDaysMarkedMissed,
    streakBrokenAfterUndo,
    xpAccounting,
    dayAndStreakNote,
    periodNote,
    xpLedgerNote,
    summary: `${dayAndStreakNote} ${periodNote} ${xpLedgerNote}`,
  };
}
