import { colors } from '../lib/tokens';
import { eachDayOfInterval, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns';
import { type Habit, type HabitLog } from './supabase';
import { type FocusSessionRow } from './focusReport';
import { isEligibleOn, scheduleKind, scheduledCompletionRate } from './habitSchedule';
import { dayCredit, isCompletedState, judgeDay, type DayHabit, type DayLog } from './completionMetric';
import { parseLocalDate, ymd } from './date';
import { habitCreatedDay } from './habitCreatedDay';
// R05.06 — the one seconds->minutes rule for focus time.
import { secondsToMinutes } from './focusDuration';

export { isCompletedState } from './completionMetric';

export type ReportRange = 'week' | 'month';
export type ReportBadge = {
  level: 'bronze' | 'silver' | 'gold';
  label: string;
  emoji: string;
  color: string;
};

export type HabitProgressRow = {
  id: string;
  name: string;
  color: string;
  percent: number;
  completedDays: number;
  possibleDays: number;
};

function listDateStrings(start: string, end: string): string[] {
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  return eachDayOfInterval({ start: from, end: to }).map((date) => ymd(date));
}

const habitLogPercent = (habit: DayHabit, log: DayLog): number => dayCredit(habit, log) * 100;

export function getWeekBounds(anchor: Date = new Date()): { start: string; end: string } {
  return {
    start: ymd(startOfWeek(anchor, { weekStartsOn: 1 })),
    end: ymd(endOfWeek(anchor, { weekStartsOn: 1 })),
  };
}

export function getMonthBounds(anchor: Date = new Date()): { start: string; end: string } {
  return {
    start: ymd(startOfMonth(anchor)),
    end: ymd(endOfMonth(anchor)),
  };
}

export function habitAveragePercent(params: {
  habits: Pick<Habit, 'id' | 'status' | 'tracking_type' | 'daily_goal'
    | 'target_direction' | 'frequency_config' | 'behavior_type'
    | 'created_at' | 'end_condition'>[];
  logs: Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>[];
  start: string;
  end: string;
  asOf?: Date;
}): number | null {
  // AC-H09 — `status` bugünkü durumdur, o dönemde geçerli olan değil.
  // Buradan filtrelemek, bugün bir alışkanlığı duraklatmanın GEÇEN AYIN
  // raporunu değiştirmesi demekti. Rapor edilmiş bir sayı sonradan değişmemeli.
  const habits = params.habits;
  if (habits.length === 0) return null;

  const days = listDateStrings(params.start, params.end);
  if (days.length === 0) return null;

  const asOfYmd = params.asOf ? ymd(params.asOf) : null;

  const logMap = new Map<string, Pick<HabitLog, 'state' | 'value'>>();
  for (const log of params.logs) {
    logMap.set(`${log.habit_id}|${log.completed_at.slice(0, 10)}`, { state: log.state, value: log.value });
  }

  // AC-H04 — payda DUE günlerdir, takvim günleri değil.
  let total = 0;
  let dueCount = 0;
  for (const habit of habits) {
    // R01.02-b — count-based schedules ("3 a week", "10 a month") have no due
    // DAYS; walking days through `isDueOn` scored them on weekdays the user
    // never chose. Their denominator is the period target and their numerator
    // the unique done/partial days (AC-H07/H08), both from the canonical
    // evaluator via `scheduledCompletionRate`, at 100 per counted day.
    if (isCountBased(habit)) {
      const effectiveEnd = asOfYmd && params.end > asOfYmd ? asOfYmd : params.end;
      if (effectiveEnd >= params.start) {
        const r = countBasedProgress(habit, params.logs, params.start, effectiveEnd);
        if (r) { dueCount += r.dueDays; total += r.doneDays * 100; }
      }
      continue;
    }
    for (const day of days) {
      const dateObj = parseLocalDate(day);
      if (!dateObj) continue;
      // R01.02-c — day lane: `isCountBased` returned above. `isEligibleOn` = `isDueOn` for daily/weekly_days; it adds the every_n_days interval. The date range is not a mode: it is the lifetime envelope (`withinLifetime`) both read.
      if (!isEligibleOn(habit as Habit, dateObj)) continue;
      const v = judgeDay({ habit, dayYmd: day, asOfYmd, log: logMap.get(`${habit.id}|${day}`) });
      if (v.kind !== 'credit') continue;
      dueCount += 1;
      total += v.credit * 100;
    }
  }

  if (dueCount === 0) return null;
  return Math.round(total / dueCount);
}

type ScheduleHabit = Pick<Habit, 'id' | 'frequency_config' | 'created_at' | 'end_condition' | 'behavior_type'>;

function isCountBased(habit: ScheduleHabit): boolean {
  const kind = scheduleKind(habit as Habit).kind;
  return kind === 'weekly_count' || kind === 'monthly_count';
}

/**
 * Period-unit progress for a count-based habit over `[start, end]`: `dueDays`
 * is the (edge-prorated) target sum, `doneDays` the unique completed days.
 * `since` is the habit's creation day so a habit born mid-period is not
 * charged for the days before it existed. `null` when the range is invalid.
 */
function countBasedProgress(
  habit: ScheduleHabit,
  logs: Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'>[],
  start: string,
  end: string,
): { dueDays: number; doneDays: number } | null {
  const from = parseLocalDate(start);
  const to = parseLocalDate(end);
  if (!from || !to) return null;
  const createdYmd = habitCreatedDay(habit);
  const since = createdYmd ? parseLocalDate(createdYmd) : null;
  const r = scheduledCompletionRate(habit as Habit, logs, { from, to, since });
  return { dueDays: r.dueDays, doneDays: r.doneDays };
}

export function calculateHabitCompletionRate(
  habits: Pick<Habit, 'id' | 'status' | 'tracking_type' | 'daily_goal'
    | 'target_direction' | 'frequency_config' | 'behavior_type'
    | 'created_at' | 'end_condition'>[],
  logs: Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>[],
  start: string,
  end: string,
  opts?: { asOf?: Date },
): number | null {
  return habitAveragePercent({ habits, logs, start, end, asOf: opts?.asOf });
}

export function summarizeHabitProgress(
  habits: Habit[],
  logs: Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>[],
  start: string,
  end: string,
  opts?: { asOf?: Date },
): HabitProgressRow[] {
  // AC-H09 — bugünkü `status`a göre filtrelemek geçmişi yeniden yazar.
  const activeHabits = habits;
  const days = listDateStrings(start, end);
  const asOfYmd = opts?.asOf ? ymd(opts.asOf) : null;
  const logMap = new Map<string, Pick<HabitLog, 'state' | 'value'>>();

  for (const log of logs) {
    logMap.set(`${log.habit_id}|${log.completed_at.slice(0, 10)}`, { state: log.state, value: log.value });
  }

  return activeHabits
    .map((habit) => {
      // R01.02-b — `possibleDays` is the same denominator the aggregate uses:
      // due days for day-based schedules (skip, pending and unlogged-negative
      // days excluded via `judgeDay`), the period target for count-based ones.
      if (isCountBased(habit)) {
        const effectiveEnd = asOfYmd && end > asOfYmd ? asOfYmd : end;
        const r = effectiveEnd >= start ? countBasedProgress(habit, logs, start, effectiveEnd) : null;
        const possible = r ? Math.round(r.dueDays) : 0;
        const completed = r ? Math.round(r.doneDays) : 0;
        return {
          id: habit.id,
          name: habit.name,
          color: habit.color ?? colors.accent,
          percent: r && r.dueDays > 0 ? Math.round((r.doneDays / r.dueDays) * 100) : 0,
          completedDays: completed,
          possibleDays: possible,
        };
      }

      let completedDays = 0;
      let scoreTotal = 0;
      let possibleDays = 0;

      for (const day of days) {
        const dateObj = parseLocalDate(day);
        if (!dateObj) continue;
        // R01.02-c — day lane: `isCountBased` returned above. `isEligibleOn` = `isDueOn` for daily/weekly_days; it adds the every_n_days interval. The date range is not a mode: it is the lifetime envelope (`withinLifetime`) both read.
        if (!isEligibleOn(habit, dateObj)) continue;
        const log = logMap.get(`${habit.id}|${day}`);
        const v = judgeDay({ habit, dayYmd: day, asOfYmd, log });
        if (v.kind !== 'credit') continue;
        possibleDays += 1;
        if (!log) continue;
        if (isCompletedState(log.state)) completedDays += 1;
        scoreTotal += habitLogPercent(habit, log);
      }

      return {
        id: habit.id,
        name: habit.name,
        color: habit.color ?? colors.accent,
        percent: possibleDays > 0 ? Math.round(scoreTotal / possibleDays) : 0,
        completedDays,
        possibleDays,
      };
    })
    .sort((left, right) => right.percent - left.percent);
}

export function focusMinutesFromSessions(sessions: Pick<FocusSessionRow, 'completed_seconds'>[]): number {
  const totalSeconds = sessions.reduce((sum, session) => sum + (session.completed_seconds || 0), 0);
  return secondsToMinutes(totalSeconds);
}

export function reportBadge(params: {
  habitRate: number | null;
  focusMinutes: number;
  completedTasks: number;
}): ReportBadge {
  const rate = params.habitRate ?? 0;
  if (rate >= 85 && params.focusMinutes >= 180 && params.completedTasks >= 8) {
    return { level: 'gold', label: 'Altın Rapor Rozeti', emoji: '🏆', color: colors.warning };
  }

  if (rate >= 65 && params.focusMinutes >= 90 && params.completedTasks >= 4) {
    return { level: 'silver', label: 'Gümüş Rapor Rozeti', emoji: '🥈', color: colors.textDim };
  }

  if (rate > 0 || params.focusMinutes > 0 || params.completedTasks > 0) {
    return { level: 'bronze', label: 'Bronz Rapor Rozeti', emoji: '🥉', color: colors.error };
  }

  return { level: 'bronze', label: 'Başlangıç Rapor Rozeti', emoji: '✨', color: colors.success };
}

export function buildArchiveReflection(params: {
  sourceLabel: string;
  periodLabel: string;
  start: string;
  end: string;
  answers: Record<string, string>;
  metrics: {
    taskCount: number;
    habitRate: number | null;
    focusMinutes: number;
    badge: ReportBadge;
  };
}): string {
  const habitRateLine =
    params.metrics.habitRate === null
      ? 'Alışkanlık ortalaması: veri yok'
      : `Alışkanlık ortalaması: %${params.metrics.habitRate}`;

  return [
    `[${params.sourceLabel}]`,
    `Dönem: ${params.periodLabel}`,
    `Aralık: ${params.start} - ${params.end}`,
    `Görev tamamlandı: ${params.metrics.taskCount}`,
    habitRateLine,
    `Toplam odak: ${params.metrics.focusMinutes} dk`,
    `Rozet: ${params.metrics.badge.emoji} ${params.metrics.badge.label}`,
    '',
    'Kazanımlar:',
    params.answers.wins?.trim() || '-',
    '',
    'Zorluklar / Öğrendiklerim:',
    (params.answers.challenges ?? params.answers.lessons ?? '').trim() || '-',
    '',
    'Sonraki odak:',
    (params.answers.next_week ?? params.answers.next_month ?? '').trim() || '-',
  ].join('\n');
}
