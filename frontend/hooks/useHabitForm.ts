import type React from 'react';
import { useState } from 'react';
import type { Habit } from '../lib/supabase';
import { computeWillpowerCost, type ImpactLevel, type Urgency } from '../lib/triage';
import { isFrequencyComplete } from '../lib/frequencyForm';
import { isNumberInputPending, parseLocaleNumber } from '../lib/localeNumber';
import { DEFAULT_FORM } from '../components/habitOnboarding/constants';

export type HabitFormData = Omit<Habit, 'id' | 'created_at' | 'user_id'>;
export type CueMode = 'none' | 'habit' | 'note';
export type GoalField = { text: string; value: number | null; error: string | null };

function evaluateGoalInput(
  rawText: string,
  trackingType: HabitFormData['tracking_type'],
  direction: HabitFormData['target_direction'],
): { value: number | null; error: string | null } {
  if (trackingType !== 'numeric' && trackingType !== 'duration') {
    return { value: null, error: null };
  }
  if (rawText.trim() === '') {
    return { value: null, error: null };
  }
  const isDuration = trackingType === 'duration';
  const parsed = parseLocaleNumber(rawText, { min: 0, integer: isDuration });
  if (parsed === null) {
    return {
      value: null,
      error: isNumberInputPending(rawText)
        ? null
        : isDuration
          ? 'Dakikayı tam sayı yaz, örn. 20'
          : 'Sayıyı rakamla yaz, örn. 2,5',
    };
  }
  if ((direction ?? 'at_least') !== 'at_most' && parsed <= 0) {
    return { value: parsed, error: "En az için hedef 0'dan büyük olmalı" };
  }
  return { value: parsed, error: null };
}

/** Pure step completeness check — single source of truth for `canProceed`. */
export function isStepComplete(step: number, form: HabitFormData): boolean {
  if (step === 1) return form.name.trim().length > 0;
  if (step === 2 && form.tracking_type === 'numeric') {
    const validGoal =
      form.daily_goal !== null &&
      (form.target_direction === 'at_most' ? form.daily_goal >= 0 : form.daily_goal > 0);
    return Boolean(form.unit?.trim()) && validGoal;
  }
  // Süre için birim sorulmaz — sabittir (DURATION_UNIT). Yalnız hedef dakika gerekir.
  if (step === 2 && form.tracking_type === 'duration') {
    return (
      form.daily_goal !== null &&
      (form.target_direction === 'at_most' ? form.daily_goal >= 0 : form.daily_goal > 0)
    );
  }
  // R01.02-e: a schedule with no target (weekly with no day, a count of 0)
  // cannot leave step 3 -- see lib/frequencyForm.isFrequencyComplete.
  if (step === 3) return isFrequencyComplete(form.frequency_config);
  return true;
}

export type UseHabitFormResult = {
  step: number;
  setStep: (next: number) => void;
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
  canProceed: () => boolean;
  reset: () => void;
};

export function useHabitForm(): UseHabitFormResult {
  const [step, setStep] = useState(1);
  const [form, setFormState] = useState<HabitFormData>(DEFAULT_FORM);
  const [goalText, setGoalTextState] = useState('');
  const [cueMode, setCueMode] = useState<CueMode>('none');

  const setForm: React.Dispatch<React.SetStateAction<HabitFormData>> = (action) => {
    setFormState((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      if (next.tracking_type !== prev.tracking_type) {
        setGoalTextState('');
      }
      return next;
    });
  };

  function patch(partial: Partial<HabitFormData>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function applyAndRecost(partial: Partial<HabitFormData>) {
    setForm((prev) => {
      const next = { ...prev, ...partial };
      next.willpower_cost = computeWillpowerCost(next);
      return next;
    });
  }

  function setImpact(level: ImpactLevel) {
    applyAndRecost({ impact_level: level });
  }

  function setUrgency(u: Urgency) {
    patch({ urgency: u });
  }

  function setDifficulty(d: number) {
    applyAndRecost({ difficulty: d });
  }

  function setMinutes(m: number) {
    applyAndRecost({ estimated_minutes: Math.max(0, m) });
  }

  function setGoalText(text: string) {
    setGoalTextState(text);
    setFormState((prev) => {
      const nextGoal = evaluateGoalInput(text, prev.tracking_type, prev.target_direction);
      return { ...prev, daily_goal: nextGoal.value };
    });
  }

  const evaluated = evaluateGoalInput(goalText, form.tracking_type, form.target_direction);
  const goal: GoalField = {
    text: goalText,
    value: evaluated.value,
    error: evaluated.error,
  };

  function canProceed(): boolean {
    if (step === 2 && evaluated.error !== null) return false;
    return isStepComplete(step, form);
  }

  function reset() {
    setStep(1);
    setFormState(DEFAULT_FORM);
    setGoalTextState('');
    setCueMode('none');
  }

  return {
    step,
    setStep,
    form,
    setForm,
    patch,
    applyAndRecost,
    setImpact,
    setUrgency,
    setDifficulty,
    setMinutes,
    goal,
    setGoalText,
    cueMode,
    setCueMode,
    canProceed,
    reset,
  };
}
