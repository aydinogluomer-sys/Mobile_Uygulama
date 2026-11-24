import type React from 'react';
import type { Habit, WillpowerState } from '../../lib/supabase';
import type { ImpactLevel, Triage, Urgency } from '../../lib/triage';
import type { CueMode, GoalField, HabitFormData } from '../../hooks/useHabitForm';

export interface HabitOnboardingProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (habitData: HabitFormData) => void;
  willpowerState?: WillpowerState | null;
}

export type DestinationMeta = {
  color: string;
  icon: string;
  label: string;
  room: string;
};

export type LifeAreaOption = {
  key: NonNullable<Habit['life_area']>;
  label: string;
  color: string;
};

export type HabitOnboardingContext = {
  form: HabitFormData;
  setForm: React.Dispatch<React.SetStateAction<HabitFormData>>;
  patch: (partial: Partial<HabitFormData>) => void;
  applyAndRecost: (partial: Partial<HabitFormData>) => void;
  setImpact: (level: ImpactLevel) => void;
  setUrgency: (u: Urgency) => void;
  setDifficulty: (d: number) => void;
  setMinutes: (m: number) => void;
  goal: GoalField;
  setGoalText: (text: string) => void;
  cueMode: CueMode;
  setCueMode: (m: CueMode) => void;
  existingHabits: Habit[];
  activeHabits: Habit[];
  lifeAreas: readonly LifeAreaOption[];
  willpowerState?: WillpowerState | null;
  canActivateNow: boolean;
  plannedTriage: Triage;
  plannedStatus: Habit['status'];
  DEST: DestinationMeta;
  wpScore: number | null;
};

export type StepProps = {
  ctx: HabitOnboardingContext;
};
