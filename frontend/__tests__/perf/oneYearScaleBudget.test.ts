/**
 * E12 (Phase F5) — 1-Year Synthetic Scale & Performance Budget Suite (`oneYearScaleBudget.test.ts`).
 *
 * Verifies deterministic output parity, input immutability, CI-safe p50/p95 latency budgets
 * across 20 warm iterations on a realistic 1-year user dataset (12 active habits, 4,380 HabitLogs,
 * 160 Tasks including 25 overdue, 60 RecoveryPlans), and large-queue outbox crash/low-disk resilience.
 */
import { performance } from 'perf_hooks';
import { evaluateActionSuggestion, type ActionSuggestion } from '../../lib/actionSuggestion';
import { dailyLoad, habitsInRangeOn, type DailyLoadResult } from '../../lib/capacity';
import { addDaysLocal, parseLocalDate, ymd } from '../../lib/date';
import {
  buildDayPlanPreview,
  type DayPlanPreview,
  type FixedPlanBlock,
} from '../../lib/dayPlanPreview';
import { scheduleKind } from '../../lib/habitSchedule';
import {
  percentile,
  runOutboxResilienceProbe,
  type OutboxResilienceProbeOptions,
  type OutboxResilienceReport,
} from '../../lib/outboxBench';
import type { FrequencyConfig, Habit, HabitLog, RecoveryPlan } from '../../lib/supabase';
import type { ListType, Task, TaskEstimateSource, TaskPriority } from '../../lib/taskTypes';
import {
  selectTodayHabits,
  setAsideIds,
  summarizeTodayHabits,
  type TodayHabitSummary,
} from '../../lib/todaySelectors';
import { readSource, stripComments } from '../helpers/sourceText';

/** Generous per-pass p95 budget (ms) so shared Node CI runners never flake while O(N^2) regressions fail immediately. */
export const CI_PURE_PASS_P95_BUDGET_MS = 150;
export const WARM_BENCHMARK_ITERATIONS = 20;
const WARMUP_PASSES = 3;

/** Alias matching Playbook E05/E12 wording over `lib/outboxBench.ts`. */
export const runOutboxBenchmark = (
  options?: OutboxResilienceProbeOptions,
): Promise<OutboxResilienceReport> => runOutboxResilienceProbe(options);

export type OneYearSyntheticDataset = {
  readonly seed: number;
  readonly userId: string;
  readonly startDayKey: string;
  readonly localDayKey: string;
  readonly nowLocalMinutes: number;
  readonly generatedAtIso: string;
  readonly habits: Habit[];
  readonly habitLogs: HabitLog[];
  readonly todayLogs: HabitLog[];
  readonly tasks: Task[];
  readonly recoveryPlans: RecoveryPlan[];
  readonly fixedBlocks: FixedPlanBlock[];
};

export type LatencyBenchmarkResult<T> = {
  readonly iterations: number;
  readonly samplesMs: number[];
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly firstOutput: T;
  readonly lastOutput: T;
};

/** Pure 32-bit Mulberry32 PRNG — deterministic across platforms, zero `Math.random()`. */
function createSeededPrng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickFrom<T>(rng: () => number, items: readonly T[]): T {
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[index];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== null && typeof child === 'object') {
        deepFreeze(child);
      }
    }
  }
  return value;
}

type HabitBlueprint = {
  readonly id: string;
  readonly name: string;
  readonly trackingType: 'boolean' | 'numeric' | 'duration';
  readonly dailyGoal: number | null;
  readonly unit: string | null;
  readonly difficulty: 1 | 3 | 5;
  readonly estimatedMinutes: number;
  readonly impactLevel: Habit['impact_level'];
  readonly frequencyConfig: FrequencyConfig;
  readonly todayTerminalState: HabitLog['state'];
  readonly todayPartialValue: number | null;
};

const HABIT_BLUEPRINTS: readonly HabitBlueprint[] = [
  // 1..3: daily (boolean, numeric, duration)
  {
    id: 'hab-01-daily-bool',
    name: 'Sabah su ve nefes',
    trackingType: 'boolean',
    dailyGoal: null,
    unit: null,
    difficulty: 1,
    estimatedMinutes: 5,
    impactLevel: 'medium',
    frequencyConfig: { kind: 'daily', part_of_day: ['morning'], created_day: '2025-11-01' },
    todayTerminalState: 'done',
    todayPartialValue: null,
  },
  {
    id: 'hab-02-daily-num',
    name: 'Su tüketimi',
    trackingType: 'numeric',
    dailyGoal: 1.5,
    unit: 'L',
    difficulty: 1,
    estimatedMinutes: 5,
    impactLevel: 'high',
    frequencyConfig: { kind: 'daily', created_day: '2025-11-01' },
    todayTerminalState: 'partial',
    todayPartialValue: 0.5,
  },
  {
    id: 'hab-03-daily-dur',
    name: 'Odaklı kitap okuma',
    trackingType: 'duration',
    dailyGoal: 30,
    unit: 'dk',
    difficulty: 3,
    estimatedMinutes: 30,
    impactLevel: 'medium',
    frequencyConfig: { kind: 'daily', part_of_day: ['evening'], created_day: '2025-11-01' },
    todayTerminalState: 'partial',
    todayPartialValue: 10,
  },
  // 4..6: weekly_days (boolean, numeric, duration)
  {
    id: 'hab-04-wdays-bool',
    name: 'Sabah esneme serisi',
    trackingType: 'boolean',
    dailyGoal: null,
    unit: null,
    difficulty: 1,
    estimatedMinutes: 10,
    impactLevel: 'low',
    frequencyConfig: { kind: 'weekly', days: [0, 1, 3, 5], part_of_day: ['morning'], created_day: '2025-11-01' },
    todayTerminalState: 'done',
    todayPartialValue: null,
  },
  {
    id: 'hab-05-wdays-num',
    name: 'Teknik terim tekrarı',
    trackingType: 'numeric',
    dailyGoal: 20,
    unit: 'terim',
    difficulty: 3,
    estimatedMinutes: 15,
    impactLevel: 'medium',
    frequencyConfig: { kind: 'weekly', days: [1, 2, 4], part_of_day: ['afternoon'], created_day: '2025-11-01' },
    todayTerminalState: 'miss',
    todayPartialValue: null,
  },
  {
    id: 'hab-06-wdays-dur',
    name: 'Tempolu açık hava yürüyüşü',
    trackingType: 'duration',
    dailyGoal: 40,
    unit: 'dk',
    difficulty: 3,
    estimatedMinutes: 40,
    impactLevel: 'high',
    frequencyConfig: { kind: 'weekly', days: [1, 4, 6], created_day: '2025-11-01' },
    todayTerminalState: 'skip',
    todayPartialValue: null,
  },
  // 7..9: weekly_count (boolean, numeric, duration)
  {
    id: 'hab-07-wcount-bool',
    name: 'Kuvvet antrenmanı',
    trackingType: 'boolean',
    dailyGoal: null,
    unit: null,
    difficulty: 5,
    estimatedMinutes: 45,
    impactLevel: 'critical',
    frequencyConfig: { kind: 'weekly', count: 3, created_day: '2025-11-01' },
    todayTerminalState: 'miss',
    todayPartialValue: null,
  },
  {
    id: 'hab-08-wcount-num',
    name: 'Araştırma makalesi özeti',
    trackingType: 'numeric',
    dailyGoal: 2,
    unit: 'makale',
    difficulty: 3,
    estimatedMinutes: 25,
    impactLevel: 'medium',
    frequencyConfig: { kind: 'weekly', count: 4, part_of_day: ['afternoon'], created_day: '2025-11-01' },
    todayTerminalState: 'partial',
    todayPartialValue: 1,
  },
  {
    id: 'hab-09-wcount-dur',
    name: 'Derin mimari inceleme',
    trackingType: 'duration',
    dailyGoal: 45,
    unit: 'dk',
    difficulty: 5,
    estimatedMinutes: 45,
    impactLevel: 'high',
    frequencyConfig: { kind: 'weekly', count: 3, created_day: '2025-11-01' },
    todayTerminalState: 'done',
    todayPartialValue: null,
  },
  // 10..12: every_n_days (boolean, numeric, duration)
  {
    id: 'hab-10-every-bool',
    name: 'Çalışma masası sıfırlama',
    trackingType: 'boolean',
    dailyGoal: null,
    unit: null,
    difficulty: 1,
    estimatedMinutes: 10,
    impactLevel: 'low',
    frequencyConfig: { kind: 'daily', interval_days: 2, created_day: '2025-11-24' },
    todayTerminalState: 'miss',
    todayPartialValue: null,
  },
  {
    id: 'hab-11-every-num',
    name: 'Sırt ve omuz mobilite seti',
    trackingType: 'numeric',
    dailyGoal: 12,
    unit: 'tekrar',
    difficulty: 3,
    estimatedMinutes: 15,
    impactLevel: 'medium',
    frequencyConfig: { kind: 'daily', interval_days: 3, created_day: '2025-11-23' },
    todayTerminalState: 'partial',
    todayPartialValue: 6,
  },
  {
    id: 'hab-12-every-dur',
    name: 'Enstrüman pratiği',
    trackingType: 'duration',
    dailyGoal: 25,
    unit: 'dk',
    difficulty: 3,
    estimatedMinutes: 25,
    impactLevel: 'low',
    frequencyConfig: { kind: 'daily', interval_days: 2, part_of_day: ['evening'], created_day: '2025-11-24' },
    todayTerminalState: 'skip',
    todayPartialValue: null,
  },
];

/**
 * Reusable, deterministic 1-year synthetic dataset generator (`E12`):
 * - `12` active habits (`daily`, `weekly_days`, `weekly_count`, `every_n_days` × `boolean`, `numeric`, `duration`)
 * - `365` days × `12` habits = `4,380` `HabitLog` rows (`done`, `partial`, `skip`, `miss`)
 * - `160` `Task` rows (completed, due today with `estimated_minutes` & `time_block_start`, inbox, someday, `25` overdue)
 * - `60` `RecoveryPlan` rows (`planned`, `completed`, `expired`, `cancelled`)
 */
export function buildOneYearSyntheticDataset(seed = 20261124): OneYearSyntheticDataset {
  const rng = createSeededPrng(seed);
  const userId = `u-scale-1yr-${seed >>> 0}`;
  const startDayKey = '2025-11-25';
  const startDate = parseLocalDate(startDayKey)!;
  const dayKeys: string[] = [];
  for (let d = 0; d < 365; d += 1) {
    dayKeys.push(ymd(addDaysLocal(startDate, d)));
  }
  const localDayKey = dayKeys[dayKeys.length - 1];
  const nowLocalMinutes = 14 * 60 + 30; // 14:30 local wall clock
  const generatedAtIso = `${localDayKey}T11:30:00.000Z`;

  // 1. 12 active habits
  const habits: Habit[] = HABIT_BLUEPRINTS.map((bp, idx) => ({
    id: bp.id,
    user_id: userId,
    name: bp.name,
    icon: null,
    color: null,
    behavior_type: 'positive',
    tracking_type: bp.trackingType,
    unit: bp.unit,
    daily_goal: bp.dailyGoal,
    target_direction: bp.dailyGoal !== null ? 'at_least' : null,
    frequency_config: {
      ...bp.frequencyConfig,
      ...(bp.frequencyConfig.days ? { days: [...bp.frequencyConfig.days] } : {}),
      ...(bp.frequencyConfig.part_of_day ? { part_of_day: [...bp.frequencyConfig.part_of_day] } : {}),
    },
    willpower_cost: bp.difficulty === 5 ? 3 : bp.difficulty === 3 ? 2 : 1,
    status: 'active',
    impact_level: bp.impactLevel,
    urgency: idx % 3 === 0 ? 'urgent' : 'not_urgent',
    difficulty: bp.difficulty,
    estimated_minutes: bp.estimatedMinutes,
    reminders: { time: `${String(8 + (idx % 12)).padStart(2, '0')}:00`, enabled: idx % 2 === 0 },
    cue_habit_id: null,
    cue_note: null,
    life_area: pickFrom(rng, ['health', 'career', 'learning', 'mindfulness'] as const),
    end_condition: null,
    created_at: '2025-11-01T08:00:00.000Z',
    current_streak: 2 + Math.floor(rng() * 14),
    best_streak: 16 + Math.floor(rng() * 30),
  }));

  // 2. 365 days × 12 habits = 4,380 HabitLog rows
  const habitLogs: HabitLog[] = [];
  for (let dayIdx = 0; dayIdx < dayKeys.length; dayIdx += 1) {
    const dayKey = dayKeys[dayIdx];
    const isToday = dayIdx === dayKeys.length - 1;

    for (let hIdx = 0; hIdx < habits.length; hIdx += 1) {
      const habit = habits[hIdx];
      const bp = HABIT_BLUEPRINTS[hIdx];
      const roll = rng();

      let state: HabitLog['state'];
      if (isToday) {
        state = bp.todayTerminalState;
      } else if (roll < 0.56) {
        state = 'done';
      } else if (roll < 0.74) {
        state = 'partial';
      } else if (roll < 0.87) {
        state = 'skip';
      } else {
        state = 'miss';
      }

      let value: number | null = null;
      if (habit.daily_goal !== null) {
        if (state === 'done') {
          value = habit.daily_goal;
        } else if (state === 'partial') {
          if (isToday && bp.todayPartialValue !== null) {
            value = bp.todayPartialValue;
          } else {
            const rawHalf = Math.round(habit.daily_goal * (0.3 + rng() * 0.4) * 10) / 10;
            value = Math.max(0.1, Math.min(habit.daily_goal - 0.1, rawHalf));
          }
        } else {
          value = 0;
        }
      }

      const hour = String(7 + ((hIdx + dayIdx) % 13)).padStart(2, '0');
      habitLogs.push({
        id: `hlog-${dayIdx}-${hIdx}`,
        habit_id: habit.id,
        user_id: userId,
        completed_at: dayKey,
        value,
        is_completed: state === 'done',
        state,
        xp: state === 'done' ? 10 : 0,
        created_at: `${dayKey}T${hour}:15:00.000Z`,
        tz: 'Europe/Istanbul',
      });
    }
  }

  const todayLogs = habitLogs.filter((l) => l.completed_at === localDayKey);

  // 3. 160 Task rows:
  //    - 25 overdue open tasks (due_date < localDayKey)
  //    - 18 due-today open tasks (due_date === localDayKey, with estimated_minutes & time_block_start)
  //    - 52 completed tasks (today + historical)
  //    - 25 inbox / future this_week open tasks (due_date > localDayKey)
  //    - 40 someday open tasks (list_type: 'someday', due_date: null)
  const tasks: Task[] = [];
  const priorities: readonly TaskPriority[] = ['high', 'medium', 'low', 'none'];
  const estimatePool = [5, 10, 15, 20, 25, 30, 45, 60] as const;
  const estimateSources: readonly TaskEstimateSource[] = ['user', 'ai', 'block', 'default'];

  // 3a. 25 overdue tasks (exact count = 25)
  for (let i = 0; i < 25; i += 1) {
    const daysBack = 1 + (i % 21);
    const dueKey = dayKeys[364 - daysBack];
    const hasEstimate = i % 5 !== 0;
    const estMin = hasEstimate ? pickFrom(rng, estimatePool) : null;
    tasks.push({
      id: `task-overdue-${String(i + 1).padStart(3, '0')}`,
      user_id: userId,
      title: `Gecikmiş proje adımı ${i + 1} — müşteri teslim kontrolü`,
      description: null,
      status: i % 4 === 0 ? 'in_progress' : 'pending',
      priority: priorities[i % 3],
      due_date: dueKey,
      time_block_start: null,
      time_block_end: null,
      estimated_minutes: estMin,
      estimate_source: hasEstimate ? pickFrom(rng, estimateSources) : null,
      parent_task_id: null,
      is_subtask: false,
      project_id: null,
      list_type: i % 2 === 0 ? 'this_week' : 'inbox',
      notes_text: null,
      completed: false,
      completed_at: null,
      quadrant: 'UI',
      created_at: `${dueKey}T08:00:00.000Z`,
      updated_at: `${dueKey}T08:30:00.000Z`,
    });
  }

  // 3b. 18 due-today open tasks (with time_block_start, estimated_minutes, and fixed-block overlap coverage)
  for (let i = 0; i < 18; i += 1) {
    const hasBlock = i < 12;
    const startHour = 9 + (i % 10); // includes 10:xx and 16:xx to exercise fixed-block overlap
    const startMinute = (i % 2) * 30;
    const durationMin = i >= 15 ? null : estimatePool[i % estimatePool.length];
    const blockSpan = durationMin ?? 30;
    const totalEndMin = startHour * 60 + startMinute + blockSpan;
    const endHour = Math.min(23, Math.floor(totalEndMin / 60));
    const endMin = totalEndMin % 60;

    tasks.push({
      id: `task-today-${String(i + 1).padStart(3, '0')}`,
      user_id: userId,
      title: `Bugünkü odak görevi ${i + 1} — teknik kapsam belgesi`,
      description: null,
      status: i === 0 ? 'in_progress' : 'pending',
      priority: priorities[i % priorities.length],
      due_date: localDayKey,
      time_block_start: hasBlock
        ? `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`
        : null,
      time_block_end: hasBlock
        ? `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`
        : null,
      estimated_minutes: durationMin,
      estimate_source: durationMin !== null ? (hasBlock ? 'block' : 'user') : null,
      parent_task_id: null,
      is_subtask: false,
      project_id: null,
      list_type: i % 2 === 0 ? 'this_week' : 'inbox',
      notes_text: null,
      completed: false,
      completed_at: null,
      quadrant: i < 6 ? 'UI' : 'NI',
      created_at: `${localDayKey}T06:${String(i).padStart(2, '0')}:00.000Z`,
      updated_at: `${localDayKey}T07:${String(i).padStart(2, '0')}:00.000Z`,
    });
  }

  // 3c. 52 completed tasks across the year (including 6 completed today)
  for (let i = 0; i < 52; i += 1) {
    const completedDay = i < 6 ? localDayKey : dayKeys[(i * 7) % 360];
    const listType: ListType = i % 3 === 0 ? 'this_week' : 'inbox';
    tasks.push({
      id: `task-done-${String(i + 1).padStart(3, '0')}`,
      user_id: userId,
      title: `Tamamlanan iş paketi ${i + 1}`,
      description: null,
      status: 'completed',
      priority: priorities[i % priorities.length],
      due_date: completedDay,
      time_block_start: i < 4 ? `0${8 + i}:00` : null,
      time_block_end: i < 4 ? `0${8 + i}:30` : null,
      estimated_minutes: pickFrom(rng, estimatePool),
      estimate_source: 'user',
      parent_task_id: null,
      is_subtask: false,
      project_id: null,
      list_type: listType,
      notes_text: null,
      completed: true,
      completed_at: `${completedDay}T10:00:00.000Z`,
      quadrant: null,
      created_at: `${completedDay}T07:00:00.000Z`,
      updated_at: `${completedDay}T10:00:00.000Z`,
    });
  }

  // 3d. 25 future inbox / this_week open tasks (due_date > localDayKey)
  for (let i = 0; i < 25; i += 1) {
    const futureDay = ymd(addDaysLocal(parseLocalDate(localDayKey)!, 1 + (i % 14)));
    tasks.push({
      id: `task-inbox-${String(i + 1).padStart(3, '0')}`,
      user_id: userId,
      title: `Gelen kutusu plan taslağı ${i + 1}`,
      description: null,
      status: 'pending',
      priority: priorities[i % priorities.length],
      due_date: futureDay,
      time_block_start: null,
      time_block_end: null,
      estimated_minutes: i % 3 === 0 ? null : pickFrom(rng, estimatePool),
      estimate_source: i % 3 === 0 ? null : 'user',
      parent_task_id: null,
      is_subtask: false,
      project_id: null,
      list_type: i % 2 === 0 ? 'inbox' : 'this_week',
      notes_text: null,
      completed: false,
      completed_at: null,
      quadrant: null,
      created_at: `${localDayKey}T05:00:00.000Z`,
      updated_at: `${localDayKey}T05:00:00.000Z`,
    });
  }

  // 3e. 40 someday open tasks (due_date: null, list_type: 'someday')
  for (let i = 0; i < 40; i += 1) {
    const createdDay = dayKeys[(i * 9) % 364];
    tasks.push({
      id: `task-someday-${String(i + 1).padStart(3, '0')}`,
      user_id: userId,
      title: `Bir gün okunacak mimari not ${i + 1}`,
      description: null,
      status: 'pending',
      priority: 'low',
      due_date: null,
      time_block_start: null,
      time_block_end: null,
      estimated_minutes: pickFrom(rng, estimatePool),
      estimate_source: 'default',
      parent_task_id: null,
      is_subtask: false,
      project_id: null,
      list_type: 'someday',
      notes_text: null,
      completed: false,
      completed_at: null,
      quadrant: 'NN',
      created_at: `${createdDay}T09:00:00.000Z`,
      updated_at: `${createdDay}T09:00:00.000Z`,
    });
  }

  // 4. 60 RecoveryPlan rows across the year (8 planned for today, 28 completed, 14 expired, 10 cancelled)
  const recoveryPlans: RecoveryPlan[] = [];
  const tomorrowKey = ymd(addDaysLocal(parseLocalDate(localDayKey)!, 1));
  const yesterdayKey = dayKeys[363];

  for (let i = 0; i < 60; i += 1) {
    const linkedHabit = habits[i % habits.length];
    const isMeasurable = linkedHabit.daily_goal !== null;
    const isPlannedToday = i < 8;
    const status: RecoveryPlan['status'] = isPlannedToday
      ? 'planned'
      : i < 36
        ? 'completed'
        : i < 50
          ? 'expired'
          : 'cancelled';

    const sourceDay = isPlannedToday ? yesterdayKey : dayKeys[(i * 5) % 355];
    const targetDay = isPlannedToday
      ? localDayKey
      : ymd(addDaysLocal(parseLocalDate(sourceDay)!, 1));
    const strategy: RecoveryPlan['strategy'] =
      i % 4 === 0
        ? 'split_two_days'
        : i % 3 === 0
          ? 'push_tomorrow'
          : 'complete_today';
    const deficitVal = isMeasurable ? Math.max(0.5, (linkedHabit.daily_goal ?? 1) * 0.5) : 1;

    recoveryPlans.push({
      id: `rec-plan-${String(i + 1).padStart(3, '0')}`,
      user_id: userId,
      habit_id: linkedHabit.id,
      source_log_id: `hlog-${Math.min(363, (i * 5) % 355)}-${i % habits.length}`,
      source_date: sourceDay,
      target_date: targetDay,
      deficit_type: isMeasurable ? 'numeric' : 'binary',
      deficit_value: deficitVal,
      strategy,
      distributed_days:
        strategy === 'split_two_days'
          ? [
              { date: targetDay, value: Math.round((deficitVal / 2) * 10) / 10 },
              {
                date: isPlannedToday
                  ? tomorrowKey
                  : ymd(addDaysLocal(parseLocalDate(targetDay)!, 1)),
                value: Math.round((deficitVal / 2) * 10) / 10,
              },
            ]
          : null,
      note: null,
      reminder_time: i % 2 === 0 ? '18:30' : null,
      status,
      completed_at: status === 'completed' ? `${targetDay}T19:00:00.000Z` : null,
      created_at: `${sourceDay}T21:00:00.000Z`,
    });
  }

  const fixedBlocks: FixedPlanBlock[] = [
    {
      id: 'appt-scale-1000',
      user_id: userId,
      title: 'Haftalık ekip senkronu',
      local_day: localDayKey,
      start_time: '10:00',
      end_time: '11:00',
      locked: true,
      source: 'internal_fixed',
    },
    {
      id: 'appt-scale-1600',
      user_id: userId,
      title: 'Müşteri değerlendirme toplantısı',
      local_day: localDayKey,
      start_time: '16:00',
      end_time: '17:00',
      locked: true,
      source: 'internal_fixed',
    },
  ];

  return {
    seed,
    userId,
    startDayKey,
    localDayKey,
    nowLocalMinutes,
    generatedAtIso,
    habits,
    habitLogs,
    todayLogs,
    tasks,
    recoveryPlans,
    fixedBlocks,
  };
}

function measureWarmLatency<T>(
  iterations: number,
  compute: () => T,
): LatencyBenchmarkResult<T> {
  const baseline = compute();
  const baselineSerialized = JSON.stringify(baseline);

  for (let w = 1; w < WARMUP_PASSES; w += 1) {
    const warmOut = compute();
    if (JSON.stringify(warmOut) !== baselineSerialized) {
      throw new Error(`Non-deterministic warm-up output at warm pass ${w}`);
    }
  }

  const samplesMs: number[] = [];
  let lastOutput: T = baseline;
  for (let iter = 0; iter < iterations; iter += 1) {
    const t0 = performance.now();
    const out = compute();
    const elapsed = Math.max(0, performance.now() - t0);
    samplesMs.push(elapsed);
    if (JSON.stringify(out) !== baselineSerialized) {
      throw new Error(`Non-deterministic benchmark output at iteration ${iter}`);
    }
    lastOutput = out;
  }

  return {
    iterations,
    samplesMs,
    p50Ms: percentile(samplesMs, 50),
    p95Ms: percentile(samplesMs, 95),
    maxMs: percentile(samplesMs, 100),
    firstOutput: baseline,
    lastOutput,
  };
}

describe('E12 — 1-Year Synthetic Scale, Determinism & Latency Budget Suite', () => {
  const dataset = deepFreeze(buildOneYearSyntheticDataset(20261124));
  const targetDate = parseLocalDate(dataset.localDayKey)!;

  it('(+) builds an exact, deterministic, pure-PRNG 1-year dataset (12 habits, 4,380 HabitLogs, 160 Tasks w/ 25 overdue, 60 RecoveryPlans)', () => {
    // Source-level guard: this suite itself never calls ambient PRNG
    const ownSource = stripComments(readSource('__tests__', 'perf', 'oneYearScaleBudget.test.ts'));
    const ambientRandomCall = ['Math', '.random('].join('');
    expect(ownSource).not.toContain(ambientRandomCall);

    // Query bounding companion gate: repository matrix stays 100% bounded with zero unpaged windows
    const matrixDoc = readSource('..', 'docs', 'QUERY_BOUNDING_MATRIX.md');
    expect(matrixDoc).toContain('**UNPAGED_WINDOW: 0**');
    expect(matrixDoc).toContain('**UNCLASSIFIED: 0**');

    // Exact row counts per E12 contract
    expect(dataset.habits).toHaveLength(12);
    expect(dataset.habits.every((h) => h.status === 'active')).toBe(true);
    expect(dataset.habitLogs).toHaveLength(4380);
    expect(dataset.tasks).toHaveLength(160);
    expect(dataset.recoveryPlans).toHaveLength(60);

    // Mix of schedule shapes: daily, weekly_days, weekly_count, every_n_days
    const scheduleShapes = new Set(dataset.habits.map((h) => scheduleKind(h).kind));
    expect(scheduleShapes).toEqual(
      new Set(['daily', 'weekly_days', 'weekly_count', 'every_n_days']),
    );

    // Mix of tracking types: boolean, numeric, duration
    const trackingTypes = new Set(dataset.habits.map((h) => h.tracking_type));
    expect(trackingTypes).toEqual(new Set(['boolean', 'numeric', 'duration']));

    // Mix of all 4 HabitLog states across 365 days × 12 habits
    const logStates = new Set(dataset.habitLogs.map((l) => l.state));
    expect(logStates).toEqual(new Set(['done', 'partial', 'skip', 'miss']));

    // Exact 25 overdue actionable tasks + mix of completed, due-today w/ time blocks & estimates, inbox, someday
    const overdueTasks = dataset.tasks.filter(
      (t) =>
        !t.completed &&
        t.status !== 'cancelled' &&
        typeof t.due_date === 'string' &&
        t.due_date < dataset.localDayKey,
    );
    const dueTodayOpenTasks = dataset.tasks.filter(
      (t) => !t.completed && t.status !== 'cancelled' && t.due_date === dataset.localDayKey,
    );
    const completedTasks = dataset.tasks.filter((t) => t.completed && t.status === 'completed');
    const somedayTasks = dataset.tasks.filter((t) => !t.completed && t.list_type === 'someday');
    const inboxTasks = dataset.tasks.filter((t) => !t.completed && t.list_type === 'inbox');

    expect(overdueTasks).toHaveLength(25);
    expect(dueTodayOpenTasks.length).toBeGreaterThanOrEqual(12);
    expect(
      dueTodayOpenTasks.some(
        (t) => t.estimated_minutes !== null && typeof t.time_block_start === 'string',
      ),
    ).toBe(true);
    expect(completedTasks.length).toBeGreaterThanOrEqual(40);
    expect(somedayTasks.length).toBeGreaterThanOrEqual(30);
    expect(inboxTasks.length).toBeGreaterThanOrEqual(15);

    // Deterministic parity across identical seeds, divergence across distinct seeds
    const twinDataset = buildOneYearSyntheticDataset(20261124);
    const differentSeedDataset = buildOneYearSyntheticDataset(99112233);
    expect(twinDataset).toEqual(dataset);
    expect(differentSeedDataset.userId).not.toBe(dataset.userId);
    expect(differentSeedDataset.habitLogs[42].state !== dataset.habitLogs[42].state || differentSeedDataset.habitLogs[7].state !== dataset.habitLogs[7].state).toBe(true);
  });

  it('(+) benchmarks 20 warm iterations of selectTodayHabits + summarizeTodayHabits within p95 budget and deterministic parity', () => {
    const todayStateByHabit = new Map<string, HabitLog>();
    for (const log of dataset.todayLogs) {
      todayStateByHabit.set(log.habit_id, log);
    }

    const bench = measureWarmLatency<{
      todayHabitIds: string[];
      summary: TodayHabitSummary;
    }>(WARM_BENCHMARK_ITERATIONS, () => {
      const setAside = setAsideIds(
        dataset.habits,
        (habitId) => todayStateByHabit.get(habitId)?.state,
      );
      const todayHabits = selectTodayHabits(
        dataset.habits,
        targetDate,
        dataset.habitLogs,
        setAside,
      );
      const completedHabits = todayHabits.filter((h) => {
        const log = todayStateByHabit.get(h.id);
        return log?.state === 'done' || log?.is_completed === true;
      });
      const summary = summarizeTodayHabits(todayHabits, completedHabits);
      return {
        todayHabitIds: todayHabits.map((h) => h.id),
        summary,
      };
    });

    expect(bench.samplesMs).toHaveLength(WARM_BENCHMARK_ITERATIONS);
    expect(bench.p50Ms).toBeGreaterThanOrEqual(0);
    expect(bench.p50Ms).toBeLessThanOrEqual(bench.p95Ms);
    expect(bench.p95Ms).toBeLessThan(CI_PURE_PASS_P95_BUDGET_MS);
    expect(bench.firstOutput).toEqual(bench.lastOutput);
    expect(bench.firstOutput.summary.total).toBeGreaterThan(0);
    expect(bench.firstOutput.summary.remaining).toBeGreaterThan(0);
    expect(bench.firstOutput.summary.completed + bench.firstOutput.summary.remaining).toBe(
      bench.firstOutput.summary.total,
    );
  });

  it('(+) benchmarks 20 warm iterations of dailyLoad capacity calculation within p95 budget and deterministic parity', () => {
    const bench = measureWarmLatency<DailyLoadResult>(WARM_BENCHMARK_ITERATIONS, () => {
      const activeInEnvelope = habitsInRangeOn(dataset.habits, targetDate);
      const dueTodayTasks = dataset.tasks.filter(
        (t) => !t.completed && t.status !== 'cancelled' && t.due_date === dataset.localDayKey,
      );
      const overdueCount = dataset.tasks.filter(
        (t) =>
          !t.completed &&
          t.status !== 'cancelled' &&
          typeof t.due_date === 'string' &&
          t.due_date < dataset.localDayKey,
      ).length;

      return dailyLoad({
        habits: activeInEnvelope,
        tasks: dueTodayTasks,
        focusMinutes: 50,
        overdueCount,
      });
    });

    expect(bench.samplesMs).toHaveLength(WARM_BENCHMARK_ITERATIONS);
    expect(bench.p50Ms).toBeLessThanOrEqual(bench.p95Ms);
    expect(bench.p95Ms).toBeLessThan(CI_PURE_PASS_P95_BUDGET_MS);
    expect(bench.firstOutput).toEqual(bench.lastOutput);
    expect(bench.firstOutput.normalised).toBeGreaterThanOrEqual(0);
    expect(bench.firstOutput.normalised).toBeLessThanOrEqual(100);
    expect(bench.firstOutput.raw).toBeGreaterThan(75); // 25 overdue × 3 pts + habits + due tasks
  });

  it('(+) benchmarks 20 warm iterations of evaluateActionSuggestion (F3 primary selector) within p95 budget and deterministic parity', () => {
    const plannedRecoveryInputs = dataset.recoveryPlans
      .filter((rp) => rp.status === 'planned' && rp.target_date === dataset.localDayKey)
      .map((rp) => {
        const habit = dataset.habits.find((h) => h.id === rp.habit_id);
        return {
          id: rp.id,
          habitName: habit?.name ?? 'Telafi planı',
          estimatedMinutes: habit?.estimated_minutes ?? 10,
        };
      });

    const bench = measureWarmLatency<{
      withRecovery: ActionSuggestion;
      calmOverdueMode: ActionSuggestion;
    }>(WARM_BENCHMARK_ITERATIONS, () => {
      const withRecovery = evaluateActionSuggestion({
        localDayKey: dataset.localDayKey,
        userId: dataset.userId,
        focus: { status: 'idle' },
        routine: null,
        recoveryToday: plannedRecoveryInputs,
        tasks: dataset.tasks,
        habits: dataset.habits,
        todayLogs: dataset.habitLogs,
        energyLevel: 'normal',
        loadState: { currentLoad: 88, ceiling: 70, isHighLoad: true },
      });

      // Also exercise the 160-task + 4,380-log overdue_calm_pick / due_habit branch without recovery short-circuit
      const calmOverdueMode = evaluateActionSuggestion({
        localDayKey: dataset.localDayKey,
        userId: dataset.userId,
        focus: { status: 'idle' },
        routine: null,
        recoveryToday: [],
        tasks: dataset.tasks,
        habits: dataset.habits,
        todayLogs: dataset.habitLogs,
        energyLevel: 'low',
        loadState: { currentLoad: 92, ceiling: 70, isHighLoad: true },
      });

      return { withRecovery, calmOverdueMode };
    });

    expect(bench.samplesMs).toHaveLength(WARM_BENCHMARK_ITERATIONS);
    expect(bench.p50Ms).toBeLessThanOrEqual(bench.p95Ms);
    expect(bench.p95Ms).toBeLessThan(CI_PURE_PASS_P95_BUDGET_MS);
    expect(bench.firstOutput).toEqual(bench.lastOutput);
    expect(bench.firstOutput.withRecovery.kind).toBe('recovery');
    expect(bench.firstOutput.withRecovery.completesParentOnFinish).toBe(false);
    expect(bench.firstOutput.calmOverdueMode.completesParentOnFinish).toBe(false);
    expect(['habit', 'task']).toContain(bench.firstOutput.calmOverdueMode.kind);
  });

  it('(+) benchmarks 20 warm iterations of buildDayPlanPreview (F4 full day replan preview) within p95 budget and deterministic parity', () => {
    const bench = measureWarmLatency<DayPlanPreview>(WARM_BENCHMARK_ITERATIONS, () =>
      buildDayPlanPreview({
        userId: dataset.userId,
        localDayKey: dataset.localDayKey,
        nowLocalMinutes: dataset.nowLocalMinutes,
        generatedAtIso: dataset.generatedAtIso,
        protectedRef: { entity: 'task', id: 'task-today-001' },
        fixedBlocks: dataset.fixedBlocks,
        tasks: dataset.tasks,
        habits: dataset.habits,
        todayLogs: dataset.habitLogs,
        recoveryPlans: dataset.recoveryPlans,
        remainingCapacityMinutes: 65,
      }),
    );

    expect(bench.samplesMs).toHaveLength(WARM_BENCHMARK_ITERATIONS);
    expect(bench.p50Ms).toBeLessThanOrEqual(bench.p95Ms);
    expect(bench.p95Ms).toBeLessThan(CI_PURE_PASS_P95_BUDGET_MS);
    expect(bench.firstOutput).toEqual(bench.lastOutput);

    const preview = bench.firstOutput;
    // Fixed blocks stay strictly locked and out of mutable changes
    expect(
      preview.lockedItems.filter((item) => item.kind === 'fixed_block').map((item) => item.id),
    ).toEqual(['appt-scale-1000', 'appt-scale-1600']);
    expect(preview.protectedItems).toHaveLength(1);
    expect(preview.protectedItems[0].sourceRef.id).toBe('task-today-001');
    expect(preview.changes.length).toBeGreaterThan(25);
    expect(preview.loadAfter).toBeLessThan(preview.loadBefore);

    // Partial measurable water habit (0.5 / 1.5 L -> 1.0 L deficit) is preserved accurately at 1-year scale
    const waterChange = preview.changes.find(
      (ch) => ch.sourceRef.entity === 'habit' && ch.sourceRef.id === 'hab-02-daily-num',
    );
    expect(waterChange).toBeDefined();
    expect(waterChange!.before).toMatchObject({
      habitState: 'partial',
      loggedValue: 0.5,
      targetValue: 1.5,
      deficitRemaining: 1.0,
      unit: 'L',
    });
  });

  it('(+) verifies runOutboxBenchmark (lib/outboxBench.ts) large-queue, simulated mid-delivery kill, low-disk refusal, and Account A/B isolation within budget', async () => {
    const report = await runOutboxBenchmark({
      queueSize: 200,
      iterations: WARM_BENCHMARK_ITERATIONS,
      userA: 'scale-user-A',
      userB: 'scale-user-B',
    });

    expect(report.allPassed).toBe(true);
    expect(report.largeQueue).toEqual({
      enqueuedCount: 200,
      deliveredUniqueCount: 200,
      lostCount: 0,
      duplicateDeliveryCount: 0,
      dedupedRepeatEnqueue: true,
      remainingPending: 0,
    });

    expect(report.crashRecovery).toEqual({
      inFlightBeforeCrash: 1,
      sendingAfterBoot: 0,
      readyAfterBoot: 200,
      lostAfterCrash: 0,
    });

    expect(report.lowDiskAndQuarantine).toEqual({
      writeFailureSurfacedAsUnsaved: true,
      inMemoryPreservedOnWriteFailure: true,
      corruptBlobQuarantined: true,
      corruptOverwriteRefusedWhenDiskFull: true,
    });

    expect(report.accountIsolation).toEqual({
      userACommandsOnDisk: 200,
      leakedToUserBCount: 0,
      foreignBlobRejected: true,
      crossAccountEnqueueRejected: true,
      userARetainedAfterSwitchBack: 200,
    });

    expect(report.latencyMs.writeP50Ms).toBeLessThanOrEqual(report.latencyMs.writeP95Ms);
    expect(report.latencyMs.readP50Ms).toBeLessThanOrEqual(report.latencyMs.readP95Ms);
    expect(report.latencyMs.writeP95Ms).toBeLessThan(CI_PURE_PASS_P95_BUDGET_MS);
    expect(report.latencyMs.readP95Ms).toBeLessThan(CI_PURE_PASS_P95_BUDGET_MS);
  });
});
