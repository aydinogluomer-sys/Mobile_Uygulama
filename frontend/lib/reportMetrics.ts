import { eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';
import { type Habit, type HabitLog } from './supabase';
import { type FocusSessionRow } from './focusReport';
import { isDueOn } from './habitSchedule';
import { isMeasurableTracking, completionRatio, type HabitLogState } from './habitEngine';
import { parseLocalDate, ymd } from './date';

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


function listDateStrings(start: string, end: string): string[] {
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  return eachDayOfInterval({ start: from, end: to }).map((date) => ymd(date));
}

/** `done`/`partial` sayılır; `miss`/`skip` sayılmaz (AC-H07, AC-H08). */
export function isCompletedState(state: HabitLog['state']): boolean {
  return state === 'done' || state === 'partial';
}

function habitLogPercent(
  habit: Pick<Habit, 'tracking_type' | 'daily_goal' | 'target_direction'>,
  log: Pick<HabitLog, 'state' | 'value'>,
): number {
  // Kaçırılan/atlanan bir gün hiçbir zaman puan üretmez, sayısal olsa bile.
  if (!isCompletedState(log.state)) return 0;

  // Süreli alışkanlık da sayısal bir hedef taşır (dakika); burada 'numeric'
  // ile birebir karşılaştırmak onun kaydedilmiş dakikalarını çöpe atardı.
  if (isMeasurableTracking(habit.tracking_type)) {
    // AC-H05 / AC-H06 — yön önemli. `at_most` bir ÜST SINIRDIR ("günde en
    // fazla 5 sigara"); ham value/goal oranı ödülü TERSE çevirir.
    //
    // Bu mantık eskiden BURADA, elle yazılmıştı ve `lib/habitEngine.ts`'teki
    // `completionRatio` yönü hiç bilmiyordu. Yani aynı gün iki farklı yerde
    // iki farklı puan alıyordu: rapor doğru, motor (ve dolayısıyla XP ile
    // durum türetme) yanlış. Tek kaynak artık motor.
    if (typeof log.value === 'number' && habit.daily_goal != null && habit.daily_goal >= 0) {
      const ratio = completionRatio({
        trackingType: habit.tracking_type === 'duration' ? 'duration' : 'numeric',
        state: log.state as HabitLogState,
        value: log.value,
        target: habit.daily_goal,
        direction: habit.target_direction,
      });
      return clamp(ratio * 100, 0, 100);
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
  habits: Array<Pick<Habit, 'id' | 'status' | 'tracking_type' | 'daily_goal'
    | 'target_direction' | 'frequency_config' | 'behavior_type'
    | 'created_at' | 'end_condition'>>;
  logs: Array<Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>>;
  start: string;
  end: string;
}): number {
  // AC-H09 — `status` bugünkü durumdur, o dönemde geçerli olan değil.
  // Buradan filtrelemek, bugün bir alışkanlığı duraklatmanın GEÇEN AYIN
  // raporunu değiştirmesi demekti. Rapor edilmiş bir sayı sonradan değişmemeli.
  const habits = params.habits;
  if (habits.length === 0) return 0;

  const days = listDateStrings(params.start, params.end);
  if (days.length === 0) return 0;

  const logMap = new Map<string, Pick<HabitLog, 'state' | 'value'>>();
  for (const log of params.logs) {
    logMap.set(`${log.habit_id}|${log.completed_at.slice(0, 10)}`, { state: log.state, value: log.value });
  }

  // AC-H04 — payda DUE günlerdir, takvim günleri değil.
  // Pzt/Çar/Cum alışkanlığını 7'ye bölmek, üç günün üçünü de yapan birini
  // %43'e mahkûm ediyordu: mükemmel uyum, başarısız görünen skor.
  let total = 0;
  let dueCount = 0;
  for (const habit of habits) {
    for (const day of days) {
      const dateObj = parseLocalDate(day);
      if (!dateObj) continue;
      if (!isDueOn(habit as Habit, dateObj)) continue;
      dueCount += 1;
      const log = logMap.get(`${habit.id}|${day}`);
      total += log ? habitLogPercent(habit, log) : 0;
    }
  }

  if (dueCount === 0) return 0;
  return Math.round(total / dueCount);
}

export function calculateHabitCompletionRate(
  habits: Array<Pick<Habit, 'id' | 'status' | 'tracking_type' | 'daily_goal'
    | 'target_direction' | 'frequency_config' | 'behavior_type'
    | 'created_at' | 'end_condition'>>,
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
  // AC-H09 — bugünkü `status`a göre filtrelemek geçmişi yeniden yazar.
  const activeHabits = habits;
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
        // AC-H07 / AC-H08 — bir satırın VAR OLMASI tamamlandığı anlamına gelmez.
        // `miss` ve `skip` de satır yazar; bunları saymak "kaçırdım" demeyi
        // "yaptım" saymaktı.
        if (isCompletedState(log.state)) completedDays += 1;
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
