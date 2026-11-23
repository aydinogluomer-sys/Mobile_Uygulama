import {
  TODAY_BOOTSTRAP_KEYS,
  type TodayBootstrapKey,
} from '../../repositories/todayBootstrapRepository';

export function buildTodayBootstrapFixture(
  today = '2026-10-31',
): Record<TodayBootstrapKey, unknown> {
  const fixture: Record<TodayBootstrapKey, unknown> = {
    today,
    habits: [
      {
        id: 'h1',
        user_id: 'u1',
        name: 'Sabah Koşusu',
        status: 'active',
        behavior_type: 'positive',
        tracking_type: 'boolean',
        frequency_config: { kind: 'daily' },
        willpower_cost: 2,
        difficulty: 2,
        estimated_minutes: 20,
        created_at: '2026-10-01T08:00:00Z',
      },
    ],
    today_logs: [
      {
        id: 'l1',
        habit_id: 'h1',
        user_id: 'u1',
        completed_at: today,
        state: 'done',
        value: 1,
        xp: 10,
        is_completed: true,
      },
    ],
    period_logs: [{ habit_id: 'h1', completed_at: today, state: 'done', value: 1 }],
    tasks: [
      {
        id: 't1',
        user_id: 'u1',
        title: 'Mimari raporu tamamla',
        status: 'pending',
        priority: 'high',
        list_type: 'inbox',
        due_date: today,
        completed: false,
        created_at: '2026-10-31T09:00:00Z',
      },
    ],
    willpower: {
      user_id: 'u1',
      state_date: today,
      daily_budget: 15,
      used: 3,
      focus_capacity: 3,
      active_count: 1,
    },
    recovery_plans: [
      {
        id: 'rp1',
        user_id: 'u1',
        habit_id: 'h1',
        source_date: '2026-10-30',
        target_date: today,
        strategy: 'micro_version',
        status: 'planned',
        created_at: '2026-10-30T21:00:00Z',
      },
    ],
    time_off_available: true,
    pauses: [
      {
        id: 'p1',
        habit_id: 'h1',
        kind: 'pause',
        start_date: '2026-11-05',
        end_date: '2026-11-07',
      },
    ],
    goal_versions: [],
    checklist_available: true,
    checklist_items: [
      {
        id: 'ci1',
        habit_id: 'h1',
        title: 'Su iç',
        required: true,
        position: 0,
        created_at: '2026-10-01',
        archived_at: null,
      },
    ],
    checklist_checks: [],
  };
  void TODAY_BOOTSTRAP_KEYS;
  return fixture;
}
