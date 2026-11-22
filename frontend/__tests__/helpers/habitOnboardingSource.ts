import { readFileSync } from 'fs';
import { join } from 'path';

export const HABIT_ONBOARDING_FILES: readonly string[] = [
  'components/habitOnboarding/constants.ts',
  'components/habitOnboarding/types.ts',
  'components/habitOnboarding/HabitOnboardingModal.tsx',
  'hooks/useHabitForm.ts',
  'components/habitOnboarding/StepName.tsx',
  'components/habitOnboarding/StepMeasure.tsx',
  'components/habitOnboarding/StepFrequency.tsx',
  'components/habitOnboarding/StepPriority.tsx',
  'components/habitOnboarding/StepEffort.tsx',
  'components/habitOnboarding/StepAppearance.tsx',
  'components/habitOnboarding/StepSummary.tsx',
];

export function readHabitOnboardingSource(frontendRoot: string): string {
  return HABIT_ONBOARDING_FILES.map((rel) =>
    readFileSync(join(frontendRoot, rel), 'utf8').replace(/\r\n?/g, '\n'),
  ).join('\n');
}
