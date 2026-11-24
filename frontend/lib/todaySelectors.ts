/**
 * F27 (PRF-14, PS-16) — Pure selectors and part-of-day grouping for Today.
 *
 * Strictly pure: zero React, React Native, store, service, or repository imports.
 * Part-of-day reads ONLY `habits.frequency_config.part_of_day` (never any legacy DB column).
 */
import { startOfWeekLocal, ymd } from './date';
import { isPausedOn } from './habitPauses';
import { isCountBasedSchedule, isEligibleOn, periodStatus, scheduleKind } from './habitSchedule';
import { parseBlockTime } from './nextBlock';
import type { Habit, HabitLog } from './supabase';

export type PeriodLogRow = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>;

export type PartOfDay = 'morning' | 'afternoon' | 'evening';
export type PartGroupKey = PartOfDay | 'anytime';

export const PART_GROUP_ORDER: readonly PartGroupKey[] = ['morning', 'afternoon', 'evening', 'anytime'];

export const PART_GROUP_LABEL: Readonly<Record<PartGroupKey, string>> = {
  morning: 'Sabah',
  afternoon: 'Öğleden sonra',
  evening: 'Akşam',
  anytime: 'Her an',
};

/** 05:00-11:59 sabah, 12:00-17:59 öğleden sonra, kalanı (gece dahil) akşam. */
export function currentPartOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/**
 * Tam olarak TEK geçerli `part_of_day` değeri varsa o dilim;
 * yok, boş, 2+ değer ya da bozuk veri: `'anytime'` (fail-open).
 */
export function partGroupOf(habit: Pick<Habit, 'frequency_config'>): PartGroupKey {
  const raw = habit.frequency_config?.part_of_day;
  if (!Array.isArray(raw) || raw.length !== 1) return 'anytime';
  const slot = raw[0];
  if (slot === 'morning' || slot === 'afternoon' || slot === 'evening') return slot;
  return 'anytime';
}

export type HabitGroup = {
  key: PartGroupKey;
  label: string;
  habits: Habit[];
  doneCount: number;
  open: boolean;
};

/**
 * Boş gruplar atlanır. `open = şimdiki dilim || 'anytime' || expanded.has(key)`.
 * Tek grup kalıyorsa o grup açıktır (başlıksız düz liste = mevcut davranış).
 */
export function groupHabitsByPartOfDay(args: {
  habits: readonly Habit[];
  isDone: (habitId: string) => boolean;
  hour: number;
  expanded: ReadonlySet<PartGroupKey>;
}): HabitGroup[] {
  const buckets: Record<PartGroupKey, Habit[]> = {
    morning: [],
    afternoon: [],
    evening: [],
    anytime: [],
  };
  for (const h of args.habits) {
    buckets[partGroupOf(h)].push(h);
  }
  const nonEmptyKeys = PART_GROUP_ORDER.filter((k) => buckets[k].length > 0);
  const activePart = currentPartOfDay(args.hour);
  const singleGroup = nonEmptyKeys.length === 1;

  return nonEmptyKeys.map((key) => {
    const groupHabits = buckets[key];
    let doneCount = 0;
    for (const h of groupHabits) {
      if (args.isDone(h.id)) doneCount += 1;
    }
    const open =
      singleGroup ||
      key === activePart ||
      key === 'anytime' ||
      args.expanded.has(key);
    return {
      key,
      label: PART_GROUP_LABEL[key],
      habits: groupHabits,
      doneCount,
      open,
    };
  });
}

/**
 * Sıradaki adım önerisi için: şimdiki dilim, sonra `'anytime'`, sonra kalan dilimler
 * saat sırasıyla (`morning -> afternoon -> evening`, kararlı sıralama).
 */
export function orderForNextStep(habits: readonly Habit[], hour: number): Habit[] {
  const cur = currentPartOfDay(hour);
  const rest = (['morning', 'afternoon', 'evening'] as const).filter((p) => p !== cur);
  const order: PartGroupKey[] = [cur, 'anytime', ...rest];
  const buckets: Record<PartGroupKey, Habit[]> = {
    morning: [],
    afternoon: [],
    evening: [],
    anytime: [],
  };
  for (const h of habits) {
    buckets[partGroupOf(h)].push(h);
  }
  return order.flatMap((k) => buckets[k]);
}

// ISO hafta numarası (1–53)
export function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function isScheduleAmbiguous(habit: Habit): boolean {
  const sk = scheduleKind(habit);
  if (sk.kind === 'weekly_count' || sk.kind === 'monthly_count') return sk.count <= 0;
  if (sk.kind === 'weekly_days') {
    return !sk.days.some((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  }
  return false;
}

export function isPeriodDoneBefore(habit: Habit, date: Date, periodLogs: readonly PeriodLogRow[]): boolean {
  if (!isCountBasedSchedule(habit)) return false;
  const ds = ymd(date);
  const before = periodLogs.filter((l) => l.habit_id === habit.id && l.completed_at.slice(0, 10) < ds);
  return periodStatus(habit, before, date, { asOf: date }).status === 'satisfied';
}

const NO_IDS: ReadonlySet<string> = new Set<string>();

export function selectTodayHabits(
  habits: Habit[],
  date: Date,
  periodLogs: readonly PeriodLogRow[] | null = null,
  setAside: ReadonlySet<string> = NO_IDS,
): Habit[] {
  return habits.filter(
    (h) => h.status === 'active'
      && !isPausedOn(h, date)
      && (isEligibleOn(h, date) || isScheduleAmbiguous(h))
      && !(periodLogs && isPeriodDoneBefore(h, date, periodLogs))
      && !setAside.has(h.id),
  );
}

export function selectOnBreakHabits(habits: Habit[], date: Date): Habit[] {
  return habits.filter((h) => h.status === 'active' && isPausedOn(h, date));
}

export function setAsideIds(habits: Habit[], todayStateOf: (habitId: string) => string | undefined): Set<string> {
  return new Set(habits.filter((h) => todayStateOf(h.id) === 'skip').map((h) => h.id));
}

export function selectSetAsideHabits(
  habits: Habit[],
  date: Date,
  periodLogs: readonly PeriodLogRow[] | null,
  setAside: ReadonlySet<string> = NO_IDS,
): Habit[] {
  return selectTodayHabits(habits, date, periodLogs).filter((h) => setAside.has(h.id));
}

export function periodDoneLabel(habit: Habit): string {
  return scheduleKind(habit).kind === 'monthly_count' ? 'bu ay tamam' : 'bu hafta tamam';
}

export function selectPeriodDoneHabits(habits: Habit[], date: Date, periodLogs: readonly PeriodLogRow[] | null): Habit[] {
  if (!periodLogs) return [];
  return habits.filter(
    (h) => h.status === 'active' && isEligibleOn(h, date) && isPeriodDoneBefore(h, date, periodLogs),
  );
}

export function periodWindowStart(date: Date): string {
  const week = startOfWeekLocal(date);
  const month = new Date(date.getFullYear(), date.getMonth(), 1);
  return ymd(week < month ? week : month);
}

export type TodayHabitSummary = { total: number; completed: number; remaining: number; pct: number };

export function summarizeTodayHabits(todayHabits: Habit[], completedHabits: Habit[]): TodayHabitSummary {
  const total = todayHabits.length;
  const doneIds = new Set(completedHabits.map((h) => h.id));
  const completed = todayHabits.filter((h) => doneIds.has(h.id)).length;
  return { total, completed, remaining: total - completed, pct: total > 0 ? completed / total : 0 };
}

export function todayHabitCopy(summary: TodayHabitSummary, activeCount: number): { metricSub: string; ringSub: string } {
  if (activeCount === 0) return { metricSub: 'ilk ritüelini oluştur', ringSub: 'Henüz aktif bir ritüel yok' };
  if (summary.total === 0) return { metricSub: 'bugün planlı ritüel yok', ringSub: 'Bugün planlı ritüel yok' };
  if (summary.remaining === 0) return { metricSub: 'günlük seri tamam', ringSub: 'Günlük seri tamamlandı' };
  return {
    metricSub: `${summary.remaining} adım kaldı`,
    ringSub: `${summary.completed}/${summary.total} tamamlandı`,
  };
}

/** F36 — Saatli bugünkü görevde Sırada çipi 'HH:mm', geçersiz/saatsiz ise 'bugün'. */
export function todayTaskDueLabel(timeBlockStart: string | null | undefined): string {
  const parsed = parseBlockTime(timeBlockStart);
  if (!parsed) return 'bugün';
  return `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
}
