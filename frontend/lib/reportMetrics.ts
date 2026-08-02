import { eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';
import { type Habit, type HabitLog } from './supabase';
import { type FocusSessionRow } from './focusReport';

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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ymd(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function listDateStrings(start: string, end: string): string[] {
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  return eachDayOfInterval({ start: from, end: to }).map((date) => ymd(date));
}

function habitLogPercent(
  habit: Pick<Habit, 'tracking_type' | 'daily_goal'>,
  log: Pick<HabitLog, 'state' | 'value'>,
): number {
  if (habit.tracking_type === 'numeric') {
    if (typeof log.value === 'number' && habit.daily_goal && habit.daily_goal > 0) {
      return clamp((log.value / habit.daily_goal) * 100, 0, 100);
    }
    if (log.state === 'done') return 100;
    if (log.state === 'partial') return 50;
    return 0;
  }

  if (log.state === 'done') return 100;
  if (log.state === 'partial') return 50;
  return 0;
}

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
  habits: Array<Pick<Habit, 'id' | 'status' | 'tracking_type' | 'daily_goal'>>;
  logs: Array<Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>>;
  start: string;
  end: string;
}): number {
  const activeHabits = params.habits.filter((habit) => habit.status === 'active');
  if (activeHabits.length === 0) return 0;

  const days = listDateStrings(params.start, params.end);
  if (days.length === 0) return 0;

  const logMap = new Map<string, Pick<HabitLog, 'state' | 'value'>>();
  for (const log of params.logs) {
    logMap.set(`${log.habit_id}|${log.completed_at.slice(0, 10)}`, { state: log.state, value: log.value });
  }

  let total = 0;
  for (const habit of activeHabits) {
    for (const day of days) {
      const log = logMap.get(`${habit.id}|${day}`);
      total += log ? habitLogPercent(habit, log) : 0;
    }
  }

  return Math.round(total / (activeHabits.length * days.length));
}

export function calculateHabitCompletionRate(
  habits: Array<Pick<Habit, 'id' | 'status' | 'tracking_type' | 'daily_goal'>>,
  logs: Array<Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>>,
  start: string,
  end: string,
): number {
  return habitAveragePercent({ habits, logs, start, end });
}

export function summarizeHabitProgress(
  habits: Habit[],
  logs: Array<Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>>,
  start: string,
  end: string,
): HabitProgressRow[] {
  const activeHabits = habits.filter((habit) => habit.status === 'active');
  const days = listDateStrings(start, end);
  const logMap = new Map<string, Pick<HabitLog, 'state' | 'value'>>();

  for (const log of logs) {
    logMap.set(`${log.habit_id}|${log.completed_at.slice(0, 10)}`, { state: log.state, value: log.value });
  }

  return activeHabits
    .map((habit) => {
      let completedDays = 0;
      let scoreTotal = 0;

      for (const day of days) {
        const log = logMap.get(`${habit.id}|${day}`);
        if (!log) continue;
        completedDays += 1;
        scoreTotal += habitLogPercent(habit, log);
      }

      return {
        id: habit.id,
        name: habit.name,
        color: habit.color ?? '#D97757',
        percent: days.length > 0 ? Math.round(scoreTotal / days.length) : 0,
        completedDays,
        possibleDays: days.length,
      };
    })
    .sort((left, right) => right.percent - left.percent);
}

export function focusMinutesFromSessions(sessions: Array<Pick<FocusSessionRow, 'completed_seconds'>>): number {
  const totalSeconds = sessions.reduce((sum, session) => sum + (session.completed_seconds || 0), 0);
  return Math.round(totalSeconds / 60);
}

export function reportBadge(params: {
  habitRate: number;
  focusMinutes: number;
  completedTasks: number;
}): ReportBadge {
  if (params.habitRate >= 85 && params.focusMinutes >= 180 && params.completedTasks >= 8) {
    return { level: 'gold', label: 'Altın Rapor Rozeti', emoji: '🏆', color: '#D4A84A' };
  }

  if (params.habitRate >= 65 && params.focusMinutes >= 90 && params.completedTasks >= 4) {
    return { level: 'silver', label: 'Gümüş Rapor Rozeti', emoji: '🥈', color: '#BFBBAE' };
  }

  if (params.habitRate > 0 || params.focusMinutes > 0 || params.completedTasks > 0) {
    return { level: 'bronze', label: 'Bronz Rapor Rozeti', emoji: '🥉', color: '#C76A6A' };
  }

  return { level: 'bronze', label: 'Başlangıç Rapor Rozeti', emoji: '✨', color: '#87A678' };
}

export function buildArchiveReflection(params: {
  sourceLabel: string;
  periodLabel: string;
  start: string;
  end: string;
  answers: Record<string, string>;
  metrics: {
    taskCount: number;
    habitRate: number;
    focusMinutes: number;
    badge: ReportBadge;
  };
}): string {
  return [
    `[${params.sourceLabel}]`,
    `Dönem: ${params.periodLabel}`,
    `Aralık: ${params.start} - ${params.end}`,
    `Görev tamamlandı: ${params.metrics.taskCount}`,
    `Alışkanlık ortalaması: %${params.metrics.habitRate}`,
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
