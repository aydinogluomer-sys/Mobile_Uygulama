import { colors } from '../../lib/tokens';
import type { Habit } from '../../lib/supabase';

export type HabitFormData = Omit<Habit, 'id' | 'created_at' | 'user_id'>;

export const COLORS = [
  colors.accent,
  colors.success,
  '#3b82f6',
  colors.warning,
  colors.error,
  '#ec4899',
  colors.teal,
  '#8b5cf6',
];

export const ICONS = [
  'fitness-outline',
  'book-outline',
  'briefcase-outline',
  'water-outline',
  'bed-outline',
  'bicycle-outline',
  'leaf-outline',
  'heart-outline',
  'star-outline',
  'flame-outline',
  'musical-notes-outline',
  'code-slash-outline',
];

export const PART_OF_DAY = [
  { id: 'morning', label: 'Sabah', icon: '🌅' },
  { id: 'afternoon', label: 'Öğle', icon: '☀️' },
  { id: 'evening', label: 'Akşam', icon: '🌙' },
];

export const DEFAULT_FORM: HabitFormData = {
  name: '',
  icon: 'star-outline',
  color: colors.accent,
  behavior_type: 'positive',
  tracking_type: 'boolean',
  unit: null,
  daily_goal: null,
  target_direction: null,
  frequency_config: { kind: 'daily' },
  willpower_cost: 3,
  status: 'waiting',
  impact_level: 'medium',
  urgency: 'not_urgent',
  difficulty: 3,
  estimated_minutes: 0,
  reminders: null,
  cue_habit_id: null,
  cue_note: null,
  life_area: null,
  end_condition: null,
};

export const TOTAL_STEPS = 7;
