import { colors } from '../lib/tokens';
import { useTaskStore } from '../store/taskStore';
import { useProjectStore } from '../store/projectStore';
import { useHabitStore } from '../store/habitStore';
import { useLogStore } from '../store/logStore';
import { useWillpowerStore } from '../store/willpowerStore';
import { useFocusStore } from '../store/focusStore';
import { useRecoveryStore } from '../store/recoveryStore';
import { useJournalStore } from '../store/journalStore';
import { supabase } from './supabase';
import { ymd } from './date';

type SeedSummary = {
  projects: number;
  tasks: number;
  habits: number;
  logs: number;
  focusTasks: number;
  recoveryPlans: number;
  journalEntries: number;
};


function plusDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * May the demo seeder run in this build?
 *
 * `seedDemoData` writes fabricated projects, tasks, habits, logs, recovery
 * plans and journal entries into whichever account is signed in. There is no
 * marker distinguishing them from the user's own records afterwards, so in a
 * release build one tap silently contaminates real data.
 *
 * `__DEV__` is the same mechanism the subscription mock uses (subscriptionStore.ts,
 * task 1D-010), so there is one answer to "is this a development build".
 *
 * Exported so the UI can hide the entry point instead of offering a control
 * that always fails -- DEMO-001B. The source guard below is the one that
 * actually holds; the UI check is only there so nothing is offered that cannot
 * work.
 */
export function isSeedingAllowed(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

export async function seedDemoData(): Promise<SeedSummary> {
  // Fail closed, and fail FIRST: before the auth lookup, before any insert.
  // A guard that refuses after the first write has prevented nothing.
  if (!isSeedingAllowed()) {
    throw new Error('Demo veri yükleyici yalnızca geliştirme (__DEV__) derlemelerinde çalışır.');
  }

  const summary: SeedSummary = {
    projects: 0,
    tasks: 0,
    habits: 0,
    logs: 0,
    focusTasks: 0,
    recoveryPlans: 0,
    journalEntries: 0,
  };

  const today = new Date();
  const todayStr = ymd(today);
  const nowIso = new Date().toISOString();

  let user = null;
  try {
    const res = await supabase.auth.getUser();
    user = res?.data?.user ?? null;
  } catch {
    user = null;
  }

  // Supabase auth yoksa UI testi icin local demo veri bas.
  if (!user) {
    const demoUserId = 'demo-local-user';

    const localProjects = [
      {
        id: 'demo-project-1',
        user_id: demoUserId,
        name: 'Demo: Aderyth Yol Haritasi',
        color: colors.accent,
        description: 'Uygulama test projesi',
        status: 'active',
        created_at: nowIso,
      },
      {
        id: 'demo-project-2',
        user_id: demoUserId,
        name: 'Demo: Saglik ve Enerji',
        color: colors.success,
        description: 'Rutin ve enerji takibi',
        status: 'active',
        created_at: nowIso,
      },
    ];

    const localHabits = [
      {
        id: 'demo-habit-1',
        user_id: demoUserId,
        name: 'Demo: 30 dk yuruyus',
        icon: 'walk-outline',
        color: colors.success,
        behavior_type: 'positive',
        tracking_type: 'boolean',
        unit: null,
        daily_goal: null,
        target_direction: null,
        frequency_config: { kind: 'daily' },
        willpower_cost: 2,
        status: 'active',
        impact_level: 'medium',
        urgency: 'not_urgent',
        difficulty: 2,
        estimated_minutes: 30,
        reminders: { time: '08:30', enabled: true },
        cue_habit_id: null,
        cue_note: 'Kahvaltidan sonra',
        life_area: 'health',
        end_condition: null,
        created_at: nowIso,
      },
      {
        id: 'demo-habit-2',
        user_id: demoUserId,
        name: 'Demo: 2 L su',
        icon: 'water-outline',
        color: '#6DAEDB',
        behavior_type: 'positive',
        tracking_type: 'numeric',
        unit: 'ml',
        daily_goal: 2000,
        target_direction: 'at_least',
        frequency_config: { kind: 'daily' },
        willpower_cost: 1,
        status: 'active',
        impact_level: 'high',
        urgency: 'urgent',
        difficulty: 1,
        estimated_minutes: 10,
        reminders: { time: '10:00', enabled: true },
        cue_habit_id: null,
        cue_note: null,
        life_area: 'health',
        end_condition: null,
        created_at: nowIso,
      },
      {
        id: 'demo-habit-3',
        user_id: demoUserId,
        name: 'Demo: 15 dk okuma',
        icon: 'book-outline',
        color: colors.warning,
        behavior_type: 'positive',
        tracking_type: 'numeric',
        unit: 'dk',
        daily_goal: 15,
        target_direction: 'at_least',
        frequency_config: { kind: 'daily' },
        willpower_cost: 2,
        status: 'active',
        impact_level: 'medium',
        urgency: 'not_urgent',
        difficulty: 2,
        estimated_minutes: 15,
        reminders: { time: '21:30', enabled: false },
        cue_habit_id: null,
        cue_note: 'Yatmadan once',
        life_area: 'learning',
        end_condition: null,
        created_at: nowIso,
      },
    ];

    const localTasks = [
      {
        id: 'demo-task-1',
        user_id: demoUserId,
        title: 'Demo: Haftalik plani gozden gecir',
        description: 'Bu hafta icin kritik odaklari sec',
        status: 'pending',
        priority: 'high',
        due_date: todayStr,
        project_id: 'demo-project-1',
        list_type: 'this_week',
        notes_text: null,
        completed: false,
        completed_at: null,
        quadrant: null,
        created_at: nowIso,
        updated_at: nowIso,
      },
      {
        id: 'demo-task-2',
        user_id: demoUserId,
        title: 'Demo: Inbox temizligi',
        description: 'Geciken maddeleri toparla',
        status: 'pending',
        priority: 'medium',
        due_date: ymd(plusDays(today, -1)),
        project_id: 'demo-project-1',
        list_type: 'inbox',
        notes_text: null,
        completed: false,
        completed_at: null,
        quadrant: null,
        created_at: nowIso,
        updated_at: nowIso,
      },
      {
        id: 'demo-task-3',
        user_id: demoUserId,
        title: 'Demo: Yeni hedef fikirleri',
        description: 'Uzun vadeli fikir havuzu',
        status: 'pending',
        priority: 'low',
        due_date: ymd(plusDays(today, 3)),
        project_id: null,
        list_type: 'someday',
        notes_text: null,
        completed: false,
        completed_at: null,
        quadrant: null,
        created_at: nowIso,
        updated_at: nowIso,
      },
      {
        id: 'demo-task-4',
        user_id: demoUserId,
        title: 'Demo: Pomodoro oturumu planla',
        description: 'En az iki derin calisma blogu',
        status: 'pending',
        priority: 'high',
        due_date: ymd(plusDays(today, 1)),
        project_id: 'demo-project-1',
        list_type: 'inbox',
        notes_text: null,
        completed: false,
        completed_at: null,
        quadrant: null,
        created_at: nowIso,
        updated_at: nowIso,
      },
    ];

    const localLogs = [
      {
        id: 'demo-log-1',
        habit_id: 'demo-habit-1',
        user_id: demoUserId,
        completed_at: todayStr,
        value: null,
        is_completed: true,
        state: 'done',
        xp: 35,
        created_at: nowIso,
      },
      {
        id: 'demo-log-2',
        habit_id: 'demo-habit-2',
        user_id: demoUserId,
        completed_at: todayStr,
        value: 1200,
        is_completed: false,
        state: 'partial',
        xp: 18,
        created_at: nowIso,
      },
      {
        id: 'demo-log-3',
        habit_id: 'demo-habit-3',
        user_id: demoUserId,
        completed_at: ymd(plusDays(today, -1)),
        value: 20,
        is_completed: true,
        state: 'done',
        xp: 28,
        created_at: nowIso,
      },
    ];

    useProjectStore.setState({ projects: localProjects as any, loading: false });
    useHabitStore.setState({ habits: localHabits as any, loading: false });
    useTaskStore.setState({ tasks: localTasks as any, loading: false });
    useLogStore.setState({ logs: localLogs as any, loading: false });
    useFocusStore.setState({
      focusTasks: [
        {
          id: 'demo-focus-1',
          user_id: demoUserId,
          title: 'Demo: Derin calisma - Rapor yazimi',
          completed: false,
          selected: false,
          estimated_pomodoros: 2,
          completed_pomodoros: 1,
          total_focus_seconds: 1500,
          color: colors.accent,
          created_at: nowIso,
        },
        {
          id: 'demo-focus-2',
          user_id: demoUserId,
          title: 'Demo: Derin calisma - Kod duzenleme',
          completed: false,
          selected: true,
          estimated_pomodoros: 3,
          completed_pomodoros: 0,
          total_focus_seconds: 0,
          color: colors.success,
          created_at: nowIso,
        },
      ] as any,
      sessionsCompleted: 3,
      selectedTaskId: 'demo-focus-2',
      loadingTasks: false,
    });
    useRecoveryStore.setState({
      plans: [
        {
          id: 'demo-recovery-1',
          user_id: demoUserId,
          habit_id: 'demo-habit-1',
          source_date: ymd(plusDays(today, -1)),
          target_date: ymd(plusDays(today, 1)),
          strategy: 'complete_today',
          note: 'Demo telafi plani',
          reminder_time: '19:00',
          status: 'planned',
          created_at: nowIso,
        },
      ] as any,
      loading: false,
    });
    useWillpowerStore.setState({
      state: {
        user_id: demoUserId,
        state_date: todayStr,
        daily_budget: 15,
        used: 6,
        focus_capacity: 3,
        active_count: 2,
      },
      loading: false,
    });
    useJournalStore.setState({
      entries: [
        {
          id: 'demo-journal-1',
          user_id: demoUserId,
          date: todayStr,
          content: 'Bugun odaklandigim temel konu: enerjiyi dagitmadan ilerlemek. Notion ve takvim akislarimi netlestirdim.',
          mood: 4,
          ai_summary: true,
          created_at: nowIso,
        },
        {
          id: 'demo-journal-2',
          user_id: demoUserId,
          date: ymd(plusDays(today, -1)),
          content: 'Dun rutinde zorlansam da aksam toparladim. Yarin icin tek oncelik: sabah ilk 90 dakika derin calisma.',
          mood: 3,
          ai_summary: true,
          created_at: nowIso,
        },
      ] as any,
      loading: false,
    });

    summary.projects = localProjects.length;
    summary.tasks = localTasks.length;
    summary.habits = localHabits.length;
    summary.logs = localLogs.length;
    summary.focusTasks = 2;
    summary.recoveryPlans = 1;
    summary.journalEntries = 2;

    return summary;
  }

  const projectStore = useProjectStore.getState();
  const taskStore = useTaskStore.getState();
  const habitStore = useHabitStore.getState();
  const logStore = useLogStore.getState();
  const willpowerStore = useWillpowerStore.getState();
  const focusStore = useFocusStore.getState();
  const recoveryStore = useRecoveryStore.getState();
  const journalStore = useJournalStore.getState();

  await Promise.all([
    projectStore.fetchProjects(),
    taskStore.fetchTasks(),
    habitStore.fetchHabits(),
    logStore.fetchLogsForDate(today),
    willpowerStore.fetchToday(),
    focusStore.fetchFocusTasks(),
    recoveryStore.fetchPlans(),
    journalStore.fetchEntries(),
  ]);

  const demoProjects = [
    { name: 'Demo: Aderyth Yol Haritasi', color: colors.accent, description: 'Uygulama test projesi' },
    { name: 'Demo: Saglik ve Enerji', color: colors.success, description: 'Rutin ve enerji takibi' },
  ];

  for (const p of demoProjects) {
    const exists = useProjectStore.getState().projects.some((x) => x.name === p.name);
    if (!exists) {
      const created = await useProjectStore.getState().addProject(p);
      if (created) summary.projects += 1;
    }
  }

  await useProjectStore.getState().fetchProjects();
  const primaryProject = useProjectStore.getState().projects.find((p) => p.name === 'Demo: Aderyth Yol Haritasi') ?? null;

  const demoHabits = [
    {
      name: 'Demo: 30 dk yuruyus',
      icon: 'walk-outline',
      color: colors.success,
      behavior_type: 'positive' as const,
      tracking_type: 'boolean' as const,
      unit: null,
      daily_goal: null,
      target_direction: null,
      frequency_config: { kind: 'daily' as const },
      willpower_cost: 2,
      status: 'active' as const,
      impact_level: 'medium' as const,
      urgency: 'not_urgent' as const,
      difficulty: 2,
      estimated_minutes: 30,
      reminders: { time: '08:30', enabled: true },
      cue_habit_id: null,
      cue_note: 'Kahvaltidan sonra',
      life_area: 'health',
      end_condition: null,
    },
    {
      name: 'Demo: 2 L su',
      icon: 'water-outline',
      color: '#6DAEDB',
      behavior_type: 'positive' as const,
      tracking_type: 'numeric' as const,
      unit: 'ml',
      daily_goal: 2000,
      target_direction: 'at_least' as const,
      frequency_config: { kind: 'daily' as const },
      willpower_cost: 1,
      status: 'active' as const,
      impact_level: 'high' as const,
      urgency: 'urgent' as const,
      difficulty: 1,
      estimated_minutes: 10,
      reminders: { time: '10:00', enabled: true },
      cue_habit_id: null,
      cue_note: null,
      life_area: 'health',
      end_condition: null,
    },
    {
      name: 'Demo: 15 dk okuma',
      icon: 'book-outline',
      color: colors.warning,
      behavior_type: 'positive' as const,
      tracking_type: 'numeric' as const,
      unit: 'dk',
      daily_goal: 15,
      target_direction: 'at_least' as const,
      frequency_config: { kind: 'daily' as const },
      willpower_cost: 2,
      status: 'active' as const,
      impact_level: 'medium' as const,
      urgency: 'not_urgent' as const,
      difficulty: 2,
      estimated_minutes: 15,
      reminders: { time: '21:30', enabled: false },
      cue_habit_id: null,
      cue_note: 'Yatmadan once',
      life_area: 'learning',
      end_condition: null,
    },
  ];

  for (const h of demoHabits) {
    const exists = useHabitStore.getState().habits.some((x) => x.name === h.name);
    if (!exists) {
      const created = await useHabitStore.getState().addHabit(h);
      if (created) summary.habits += 1;
    }
  }

  await useHabitStore.getState().fetchHabits();
  const habits = useHabitStore.getState().habits;

  const walkHabit = habits.find((h) => h.name === 'Demo: 30 dk yuruyus');
  const waterHabit = habits.find((h) => h.name === 'Demo: 2 L su');
  const readHabit = habits.find((h) => h.name === 'Demo: 15 dk okuma');

  if (walkHabit) {
    const existing = useLogStore.getState().getLogForHabit(walkHabit.id, today);
    if (!existing) {
      await useLogStore.getState().logHabit({
        habitId: walkHabit.id,
        date: today,
        state: 'done',
        baseXp: 35,
      });
      summary.logs += 1;
    }
  }

  if (waterHabit) {
    const existing = useLogStore.getState().getLogForHabit(waterHabit.id, today);
    if (!existing) {
      await useLogStore.getState().logHabit({
        habitId: waterHabit.id,
        date: today,
        state: 'partial',
        value: 1200,
        targetValue: 2000,
        baseXp: 30,
      });
      summary.logs += 1;
    }
  }

  if (readHabit) {
    const existing = useLogStore.getState().getLogForHabit(readHabit.id, plusDays(today, -1));
    if (!existing) {
      await useLogStore.getState().logHabit({
        habitId: readHabit.id,
        date: plusDays(today, -1),
        state: 'done',
        value: 20,
        targetValue: 15,
        baseXp: 28,
      });
      summary.logs += 1;
    }
  }

  const demoTasks = [
    {
      title: 'Demo: Haftalik plani gozden gecir',
      priority: 'high' as const,
      list_type: 'this_week' as const,
      due_date: todayStr,
      project_id: primaryProject?.id ?? null,
      description: 'Bu hafta icin kritik odaklari sec',
    },
    {
      title: 'Demo: Inbox temizligi',
      priority: 'medium' as const,
      list_type: 'inbox' as const,
      due_date: ymd(plusDays(today, -1)),
      project_id: primaryProject?.id ?? null,
      description: 'Geciken maddeleri toparla',
    },
    {
      title: 'Demo: Yeni hedef fikirleri',
      priority: 'low' as const,
      list_type: 'someday' as const,
      due_date: ymd(plusDays(today, 3)),
      project_id: null,
      description: 'Uzun vadeli fikir havuzu',
    },
    {
      title: 'Demo: Pomodoro oturumu planla',
      priority: 'high' as const,
      list_type: 'inbox' as const,
      due_date: ymd(plusDays(today, 1)),
      project_id: primaryProject?.id ?? null,
      description: 'En az iki derin calisma blogu',
    },
  ];

  for (const t of demoTasks) {
    const exists = useTaskStore.getState().tasks.some((x) => x.title === t.title);
    if (!exists) {
      const created = await useTaskStore.getState().addTask(t);
      if (created) summary.tasks += 1;
    }
  }

  const focusTitles = ['Demo: Derin calisma - Rapor yazimi', 'Demo: Derin calisma - Kod duzenleme'];
  for (const title of focusTitles) {
    const exists = useFocusStore.getState().focusTasks.some((x) => x.title === title);
    if (!exists) {
      await useFocusStore.getState().addFocusTask(title, 2);
      summary.focusTasks += 1;
    }
  }

  if (walkHabit) {
    const hasRecovery = useRecoveryStore
      .getState()
      .plans
      .some((p) => p.habit_id === walkHabit.id && p.target_date === ymd(plusDays(today, 1)));

    if (!hasRecovery) {
      const plan = await useRecoveryStore.getState().addPlan({
        habitId: walkHabit.id,
        habitName: walkHabit.name,
        sourceDate: ymd(plusDays(today, -1)),
        targetDate: ymd(plusDays(today, 1)),
        strategy: 'complete_today',
        note: 'Demo telafi plani',
        reminderTime: '19:00',
      });
      if (plan) summary.recoveryPlans += 1;
    }
  }

  const wp = useWillpowerStore.getState();
  if (!wp.state) {
    await useWillpowerStore.getState().fetchToday();
  }
  if (useWillpowerStore.getState().canActivate(3)) {
    await useWillpowerStore.getState().spend(3);
  }

  const journalSeeds = [
    {
      date: todayStr,
      content: 'Bugun odaklandigim temel konu: enerjiyi dagitmadan ilerlemek. Notion ve takvim akislarimi netlestirdim.',
      mood: 4,
    },
    {
      date: ymd(plusDays(today, -1)),
      content: 'Dun rutinde zorlansam da aksam toparladim. Yarin icin tek oncelik: sabah ilk 90 dakika derin calisma.',
      mood: 3,
    },
  ];

  for (const j of journalSeeds) {
    const exists = useJournalStore.getState().entries.some((e) => e.date === j.date && e.content.includes('Bugun odaklandigim temel konu'));
    if (!exists) {
      await useJournalStore.getState().saveEntry(j.date, j.content, j.mood);
      summary.journalEntries += 1;
    }
  }

  await Promise.all([
    useTaskStore.getState().fetchTasks(),
    useHabitStore.getState().fetchHabits(),
    useLogStore.getState().fetchLogsForDate(today),
    useProjectStore.getState().fetchProjects(),
    useFocusStore.getState().fetchFocusTasks(),
    useRecoveryStore.getState().fetchPlans(),
    useJournalStore.getState().fetchEntries(),
    useWillpowerStore.getState().fetchToday(),
  ]);

  return summary;
}
