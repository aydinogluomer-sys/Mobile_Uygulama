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

export interface Webhook {
  _id?: string;
  url: string;
  event_types: string[];
  headers?: Record<string, string>;
  enabled: boolean;
  created_at: string;
}

export interface BadHabit {
  _id?: string;
  name: string;
  description?: string;
  quit_date: string;
  cost_per_day: number;
  time_wasted_per_day: number;
  created_at: string;
}

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
