import type { Habit, HabitLog } from '../../lib/supabase';
import { nextActionable, primaryAction, type NextAction } from '../../lib/todayNext';
import type { Task } from '../../lib/taskTypes';

export type PlaybookBehaviorCohort = 'start_blocked' | 'midday_derailed';
export type PlaybookSetupSubgroup = 'self_planner' | 'routine_starter';

export type FixedAppointmentBlock = {
  id: string;
  user_id: string;
  title: string;
  local_day: string;
  start_time: string;
  end_time: string;
  locked: true;
  source: 'internal_fixed' | 'external_busy';
};

export type StarterPackCandidate = {
  packId: string;
  title: string;
  firstStepTitle: string;
  estimatedMinutes: number;
};

export type StartScenarioFixture = {
  scenario: 'start';
  localDayKey: string;
  nowIso: string;
  userId: string;
  cohorts: readonly PlaybookBehaviorCohort[];
  setupSubgroup: PlaybookSetupSubgroup;
  tasks: Task[];
  habits: Habit[];
  todayLogs: HabitLog[];
  actionHistory: readonly string[];
  starterCandidates: StarterPackCandidate[];
  fixedBlocks: FixedAppointmentBlock[];
  fixedBlockIds: string[];
  missingEstimateTaskIds: string[];
  firstAction: NextAction | null;
  primaryCta: ReturnType<typeof primaryAction>;
  firstActionCandidateIds: string[];
};

export type RecoveryScenarioFixture = {
  scenario: 'recovery';
  localDayKey: string;
  nowIso: string;
  nowLocalTime: string;
  userId: string;
  cohorts: readonly PlaybookBehaviorCohort[];
  setupSubgroup: PlaybookSetupSubgroup;
  fixedBlocks: FixedAppointmentBlock[];
  fixedBlockIds: string[];
  tasks: Task[];
  habits: Habit[];
  todayLogs: HabitLog[];
  measurableDeficits: {
    habitId: string;
    targetValue: number;
    loggedValue: number;
    remainingValue: number;
    unit: string;
  }[];
  missingEstimateTaskIds: string[];
  firstAction: NextAction | null;
  primaryCta: ReturnType<typeof primaryAction>;
  firstActionCandidateIds: string[];
};

/**
 * F0 (§3.3 & P02) — Canonical synthetic "Başlama" fixture:
 * «Teklifi hazırla», one open parent task without an explicit duration estimate,
 * empty action history, supporting both `self_planner` and `routine_starter` adults.
 */
export function buildStartFixture(options?: {
  localDayKey?: string;
  userId?: string;
  setupSubgroup?: PlaybookSetupSubgroup;
  cohorts?: readonly PlaybookBehaviorCohort[];
}): StartScenarioFixture {
  const localDayKey = options?.localDayKey ?? '2026-11-24';
  const userId = options?.userId ?? 'u-synth-start';
  const setupSubgroup = options?.setupSubgroup ?? 'self_planner';
  const cohorts = options?.cohorts ?? (['start_blocked'] as const);

  const proposalTask: Task = {
    id: 'task-start-proposal',
    user_id: userId,
    title: 'Teklifi hazırla',
    description: 'Müşteri kapsam ve teslim takvimi taslağı',
    status: 'pending',
    priority: 'high',
    due_date: localDayKey,
    estimated_minutes: null,
    parent_task_id: null,
    is_subtask: false,
    list_type: 'inbox',
    completed: false,
    created_at: `${localDayKey}T06:00:00.000Z`,
    updated_at: `${localDayKey}T06:00:00.000Z`,
  };

  const tasks: Task[] = [proposalTask];
  const starterCandidates: StarterPackCandidate[] =
    setupSubgroup === 'routine_starter'
      ? [
          {
            packId: 'workday-kickoff',
            title: 'İş gününe sakin başlangıç',
            firstStepTitle: 'Masayı aç ve ilk başlığı yaz',
            estimatedMinutes: 5,
          },
        ]
      : [];

  const firstAction = nextActionable({
    focus: { status: 'idle' },
    routine: null,
    recoveryToday: [],
    overdueTasks: [],
    habitsToDo: [],
    tasksToday: tasks.map((t) => ({ id: t.id, title: t.title })),
  });

  const missingEstimateTaskIds = tasks
    .filter((t) => t.estimated_minutes === null || t.estimated_minutes === undefined)
    .map((t) => t.id);

  const firstActionCandidateIds = [
    ...tasks.map((t) => t.id),
    ...starterCandidates.map((c) => c.packId),
  ];

  return {
    scenario: 'start',
    localDayKey,
    nowIso: `${localDayKey}T09:00:00.000Z`,
    userId,
    cohorts,
    setupSubgroup,
    tasks,
    habits: [],
    todayLogs: [],
    actionHistory: [],
    starterCandidates,
    fixedBlocks: [],
    fixedBlockIds: [],
    missingEstimateTaskIds,
    firstAction,
    primaryCta: primaryAction(firstAction),
    firstActionCandidateIds,
  };
}

/**
 * F0 (§3.3 & P02) — Canonical synthetic "Toparlanma" fixture:
 * 16:00 fixed appointment, two open tasks due today (one time-blocked, one missing duration),
 * one incomplete measurable habit (0.5 / 1.5 L logged), and one older overdue task.
 */
export function buildRecoveryFixture(options?: {
  localDayKey?: string;
  userId?: string;
  setupSubgroup?: PlaybookSetupSubgroup;
  cohorts?: readonly PlaybookBehaviorCohort[];
}): RecoveryScenarioFixture {
  const localDayKey = options?.localDayKey ?? '2026-11-24';
  const userId = options?.userId ?? 'u-synth-recovery';
  const setupSubgroup = options?.setupSubgroup ?? 'self_planner';
  const cohorts = options?.cohorts ?? (['midday_derailed', 'start_blocked'] as const);

  const fixedAppointment: FixedAppointmentBlock = {
    id: 'appt-fixed-1600',
    user_id: userId,
    title: 'Müşteri değerlendirme toplantısı',
    local_day: localDayKey,
    start_time: '16:00',
    end_time: '17:00',
    locked: true,
    source: 'internal_fixed',
  };

  const blockedTask: Task = {
    id: 'task-rec-blocked',
    user_id: userId,
    title: 'Sunum taslağını güncelle',
    status: 'pending',
    priority: 'high',
    due_date: localDayKey,
    time_block_start: '15:00',
    time_block_end: '15:45',
    estimated_minutes: 45,
    list_type: 'this_week',
    completed: false,
    created_at: `${localDayKey}T06:30:00.000Z`,
    updated_at: `${localDayKey}T06:30:00.000Z`,
  };

  const unestimatedTask: Task = {
    id: 'task-rec-unestimated',
    user_id: userId,
    title: 'Fatura belgelerini topla',
    status: 'pending',
    priority: 'medium',
    due_date: localDayKey,
    estimated_minutes: null,
    list_type: 'inbox',
    completed: false,
    created_at: `${localDayKey}T07:00:00.000Z`,
    updated_at: `${localDayKey}T07:00:00.000Z`,
  };

  const overdueTask: Task = {
    id: 'task-rec-overdue',
    user_id: userId,
    title: 'Geçen hafta e-postasını yanıtla',
    status: 'pending',
    priority: 'low',
    due_date: '2026-11-21',
    estimated_minutes: 10,
    list_type: 'inbox',
    completed: false,
    created_at: '2026-11-21T08:00:00.000Z',
    updated_at: '2026-11-21T08:00:00.000Z',
  };

  const measurableHabit: Habit = {
    id: 'habit-rec-water',
    user_id: userId,
    name: 'Su tüketimi',
    icon: null,
    color: null,
    status: 'active',
    behavior_type: 'positive',
    tracking_type: 'numeric',
    daily_goal: 1.5,
    unit: 'L',
    target_direction: 'at_least',
    frequency_config: { kind: 'daily' },
    willpower_cost: 1,
    impact_level: 'medium',
    urgency: 'not_urgent',
    difficulty: 1,
    estimated_minutes: 5,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: 'health',
    end_condition: null,
    current_streak: 3,
    best_streak: 7,
    created_at: '2026-11-01T08:00:00.000Z',
  };

  const partialWaterLog: HabitLog = {
    id: 'log-rec-water-partial',
    habit_id: measurableHabit.id,
    user_id: userId,
    completed_at: localDayKey,
    state: 'partial',
    value: 0.5,
    xp: 0,
    is_completed: false,
    created_at: `${localDayKey}T09:15:00.000Z`,
  };

  const tasks: Task[] = [blockedTask, unestimatedTask, overdueTask];
  const habits: Habit[] = [measurableHabit];
  const todayLogs: HabitLog[] = [partialWaterLog];
  const fixedBlocks: FixedAppointmentBlock[] = [fixedAppointment];

  const todayTasks = tasks.filter((t) => t.due_date === localDayKey);
  const overdueTasks = tasks.filter((t) => Boolean(t.due_date && t.due_date < localDayKey));

  const firstAction = nextActionable({
    focus: { status: 'idle' },
    routine: null,
    recoveryToday: [],
    overdueTasks: overdueTasks.map((t) => ({
      id: t.id,
      title: t.title,
      minutes: t.estimated_minutes,
    })),
    habitsToDo: habits.map((h) => ({ id: h.id, name: h.name })),
    tasksToday: todayTasks.map((t) => ({ id: t.id, title: t.title })),
  });

  const missingEstimateTaskIds = tasks
    .filter((t) => t.estimated_minutes === null || t.estimated_minutes === undefined)
    .map((t) => t.id);

  return {
    scenario: 'recovery',
    localDayKey,
    nowIso: `${localDayKey}T11:30:00.000Z`,
    nowLocalTime: '14:30',
    userId,
    cohorts,
    setupSubgroup,
    fixedBlocks,
    fixedBlockIds: fixedBlocks.map((b) => b.id),
    tasks,
    habits,
    todayLogs,
    measurableDeficits: [
      {
        habitId: measurableHabit.id,
        targetValue: 1.5,
        loggedValue: 0.5,
        remainingValue: 1.0,
        unit: 'L',
      },
    ],
    missingEstimateTaskIds,
    firstAction,
    primaryCta: primaryAction(firstAction),
    firstActionCandidateIds: [
      overdueTask.id,
      measurableHabit.id,
      blockedTask.id,
      unestimatedTask.id,
    ],
  };
}
