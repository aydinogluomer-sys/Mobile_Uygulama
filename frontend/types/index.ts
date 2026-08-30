export interface Habit {
  _id?: string;
  name: string;
  description?: string;
  category: string;
  frequency: string;
  target_days: number[];
  strength_score: number;
  streak_current: number;
  streak_best: number;
  color: string;
  icon: string;
  created_at: string;
  is_active: boolean;
  
  // Habit Sequencing
  impact: number;  // 1-5
  difficulty: number;  // 1-5
  priority: string;  // urgent_important, important_not_urgent, etc.
  status: string;  // active, queued, paused
  focus_score: number;
  activated_at?: string;
}

export interface Task {
  _id?: string;
  title: string;
  description?: string;
  category: string;
  due_date?: string;
  time_block_start?: string;
  time_block_end?: string;
  completed: boolean;
  completed_at?: string;
  is_subtask: boolean;
  parent_task_id?: string;
  created_at: string;
}

export interface Completion {
  _id?: string;
  habit_id: string;
  completed_at: string;
  notes?: string;
  mood?: number;
}

// `Webhook` and `BadHabit` used to live here, shaped by the FastAPI service
// (`_id`, snake_case). Both features are on Supabase now and their row types
// come from their repositories, so the shape is defined once, next to the
// query that produces it: `repositories/webhookRepository.ts` and
// `repositories/badHabitRepository.ts`.

export interface HeatmapData {
  [date: string]: number;
}

export interface Stats {
  total_habits: number;
  active_tasks: number;
  completed_tasks: number;
  total_completions: number;
  today_completions: number;
}

export interface UserProfile {
  _id?: string;
  user_id: string;
  level: number;
  total_xp: number;
  current_level_xp: number;
  next_level_xp: number;
  progress_percent: number;
  willpower_rank: string;
  achievements: string[];
  streak_record: number;
  total_completions: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  requirement: string;
  unlocked: boolean;
}
