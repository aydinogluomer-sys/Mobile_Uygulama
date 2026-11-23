import type { Database } from '../../lib/database.types';
import type { EmulatorSeed, EmulatorUser } from './supabaseEmulator';

export const FIXED_NOW = new Date('2026-11-04T09:00:00+03:00');
const TODAY_YMD = '2026-11-04';
const CREATED_AT = '2026-10-01T08:00:00.000Z';

export const USER_A: EmulatorUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'ayse@ornek.local',
  password: 'Sakin-Parola-2026!',
};

export const USER_B: EmulatorUser = {
  id: '00000000-0000-4000-8000-000000000002',
  email: 'bora@ornek.local',
  password: 'Baska-Parola-2026!',
};

export const BOOTSTRAP_KEYS: readonly string[] = [
  'today',
  'habits',
  'today_logs',
  'period_logs',
  'tasks',
  'willpower',
  'recovery_plans',
  'time_off_available',
  'pauses',
  'goal_versions',
  'checklist_available',
  'checklist_items',
  'checklist_checks',
] as const;

type HabitRow = Database['public']['Tables']['habits']['Row'];
type OnboardingDbRow = Database['public']['Tables']['user_onboarding']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type WillpowerStateRow = Database['public']['Tables']['willpower_state']['Row'];

function makeHabit(
  id: string,
  userId: string,
  name: string,
  icon: string,
): HabitRow {
  return {
    id,
    user_id: userId,
    name,
    description: null,
    category: 'health',
    frequency: 'daily',
    target_days: null,
    color: '#D97757',
    icon,
    streak_current: 0,
    streak_best: 0,
    strength_score: 0,
    impact: 2,
    difficulty: 2,
    priority: 'medium',
    status: 'active',
    is_active: true,
    created_at: CREATED_AT,
    streak_goal: null,
    preferred_time_of_day: null,
    domain: null,
    reminders: [],
    goal_type: null,
    goal_date: null,
    goal_amount: null,
    goal_unit: null,
    behavior_type: 'positive',
    tracking_type: 'boolean',
    unit: null,
    daily_goal: 1,
    log_question: null,
    focus_score: null,
    habit_type: null,
    quit_date: null,
    cost_per_day: null,
    time_wasted_per_day: null,
    willpower_cost: 2,
    target_direction: 'at_least',
    frequency_config: { kind: 'daily' },
    end_condition: null,
    impact_level: null,
    urgency: null,
    estimated_minutes: 10,
    cue_habit_id: null,
    cue_note: null,
    life_area: null,
    install_id: null,
  } satisfies HabitRow;
}

function makeOnboarding(userId: string): OnboardingDbRow {
  return {
    user_id: userId,
    onboarding_version: 1,
    goals: ['consistency'],
    primary_barrier: 'starting',
    pace: 'gentle',
    preferred_dayparts: ['morning'],
    reminder_intent: false,
    status: 'completed',
    completed_at: CREATED_AT,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    install_id: null,
    install_expected_habits: null,
    install_return_status: null,
  } satisfies OnboardingDbRow;
}

function makeProfile(user: EmulatorUser): ProfileRow {
  return {
    id: user.id,
    email: user.email,
    username: user.id === USER_A.id ? 'Ayşe' : 'Bora',
    level: 2,
    total_xp: 120,
    current_level_xp: 20,
    next_level_xp: 100,
    willpower_rank: 'Bronz',
    streak_record: 0,
    created_at: CREATED_AT,
    makeup_credits: 2,
    last_credit_reset: null,
    push_token: null,
    ai_persona: null,
    last_ai_context: null,
    coins: 0,
    skill_points: 0,
    purged_xp: 0,
    time_zone: 'Europe/Istanbul',
  } satisfies ProfileRow;
}

function makeWillpower(userId: string): WillpowerStateRow {
  return {
    user_id: userId,
    state_date: TODAY_YMD,
    daily_budget: 15,
    used: 0,
    focus_capacity: 3,
    active_count: 2,
  } satisfies WillpowerStateRow;
}

export function seedFor(mode: 'missing' | 'present'): EmulatorSeed {
  const habitsA = [
    makeHabit('hab-a-1', USER_A.id, 'Su iç', 'water-outline'),
    makeHabit('hab-a-2', USER_A.id, 'Yürüyüş', 'walk-outline'),
  ];
  const habitsB = [makeHabit('hab-b-1', USER_B.id, 'Kitap oku', 'book-outline')];
  const willpowerA = makeWillpower(USER_A.id);
  const willpowerB = makeWillpower(USER_B.id);

  const tables: Record<string, readonly Record<string, unknown>[]> = {
    profiles: [makeProfile(USER_A), makeProfile(USER_B)],
    user_onboarding: [makeOnboarding(USER_A.id), makeOnboarding(USER_B.id)],
    habits: [...habitsA, ...habitsB],
    habit_logs: [],
    tasks: [],
    willpower_state: [willpowerA, willpowerB],
    recovery_plans: [],
    habit_pauses: [],
    habit_goal_versions: [],
    habit_checklist_items: [],
    habit_checklist_checks: [],
    webhooks: [],
    journal_entries: [],
    notes: [],
    projects: [],
    goals: [],
    reading_list: [],
    okr_objectives: [],
    key_results: [],
    life_area_logs: [],
    focus_sessions: [],
    monthly_reviews: [],
    user_subscriptions: [],
  };

  const rpc: EmulatorSeed['rpc'] = {
    set_profile_time_zone: () => ({ status: 204, body: null }),
    get_or_init_subscription: (_args, userId) => ({
      status: 200,
      body: {
        user_id: userId,
        tier: 'free',
        billing_period: null,
        status: 'active',
        focus_points: 3,
        monthly_grant: 3,
        credits_period_end: '2026-12-01T00:00:00.000Z',
        sub_period_end: null,
        provider: null,
        provider_ref: null,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      },
    }),
    ...(mode === 'present'
      ? {
          get_today_bootstrap: (_args, userId, ctx) => {
            const userHabits = ctx.rows('habits', userId);
            const todayLogs = ctx
              .rows('habit_logs', userId)
              .filter((r) => r.completed_at === TODAY_YMD);
            const wp = ctx.rows('willpower_state', userId)[0] ?? null;
            return {
              status: 200,
              body: {
                today: TODAY_YMD,
                habits: userHabits,
                today_logs: todayLogs,
                period_logs: [],
                tasks: [],
                willpower: wp,
                recovery_plans: [],
                time_off_available: true,
                pauses: [],
                goal_versions: [],
                checklist_available: true,
                checklist_items: [],
                checklist_checks: [],
              },
            };
          },
        }
      : {}),
  };

  return {
    users: [USER_A, USER_B],
    tables,
    rpc,
  };
}
