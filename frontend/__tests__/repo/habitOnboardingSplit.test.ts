/**
 * F14 structural & pure-hook guard for the `HabitOnboarding` decomposition.
 * (PRF-16)
 *
 * Enforces:
 *  - `components/HabitOnboarding.tsx` is a <= 5-line re-export shim
 *  - `components/habitOnboarding/HabitOnboardingModal.tsx` <= 250 lines
 *  - every file under `components/habitOnboarding/` <= 260 lines
 *  - step components (`Step*.tsx`) never import from `store/`
 *  - `hooks/useHabitForm.ts` exports pure `isStepComplete` + `useHabitForm` and never imports `store/`
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_FORM } from '../../components/habitOnboarding/constants';
import { isStepComplete } from '../../hooks/useHabitForm';
import { stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(FRONTEND, rel), 'utf8').replace(/\r\n?/g, '\n');
const lineCount = (text: string): number => text.replace(/\n$/, '').split('\n').length;

const STEP_FILES = [
  'StepName.tsx',
  'StepMeasure.tsx',
  'StepFrequency.tsx',
  'StepPriority.tsx',
  'StepEffort.tsx',
  'StepAppearance.tsx',
  'StepSummary.tsx',
] as const;

export function validateSplitShape(params: {
  shimText: string;
  dirFiles: Record<string, string>;
  hookText: string;
}): string[] {
  const issues: string[] = [];
  if (lineCount(params.shimText) > 5) issues.push('shim_too_long');
  if (!/export\s+\{\s*default\s*\}\s+from\s+'\.\/habitOnboarding\/HabitOnboardingModal'/.test(params.shimText)) {
    issues.push('shim_missing_reexport');
  }

  const modal = params.dirFiles['HabitOnboardingModal.tsx'];
  if (!modal) issues.push('missing_modal_shell');
  else if (lineCount(modal) > 250) issues.push('modal_exceeds_250_lines');

  for (const [name, content] of Object.entries(params.dirFiles)) {
    if (lineCount(content) > 260) issues.push(`file_exceeds_260_lines:${name}`);
  }

  for (const step of STEP_FILES) {
    const src = params.dirFiles[step];
    if (!src) {
      issues.push(`missing_step:${step}`);
      continue;
    }
    if (/\bfrom\s+['"][^'"]*store\//.test(stripComments(src))) {
      issues.push(`step_imports_store:${step}`);
    }
  }

  const hookCode = stripComments(params.hookText);
  if (!/export\s+function\s+isStepComplete\b/.test(hookCode)) {
    issues.push('hook_missing_isStepComplete');
  }
  if (!/export\s+function\s+useHabitForm\b/.test(hookCode)) {
    issues.push('hook_missing_useHabitForm');
  }
  if (/\bfrom\s+['"][^'"]*store\//.test(hookCode)) {
    issues.push('hook_imports_store');
  }

  return issues;
}

describe('HabitOnboarding split contract (PRF-16)', () => {
  it('HabitOnboarding.tsx is <= 5 lines, every split file obeys line & layer budgets, and useHabitForm exports isStepComplete', () => {
    const dirPath = join(FRONTEND, 'components', 'habitOnboarding');
    const hookPath = join(FRONTEND, 'hooks', 'useHabitForm.ts');
    expect(existsSync(dirPath)).toBe(true);
    expect(existsSync(hookPath)).toBe(true);

    const dirFiles: Record<string, string> = {};
    for (const f of readdirSync(dirPath).filter((x) => /\.(ts|tsx)$/.test(x))) {
      dirFiles[f] = read(`components/habitOnboarding/${f}`);
    }

    const issues = validateSplitShape({
      shimText: read('components/HabitOnboarding.tsx'),
      dirFiles,
      hookText: read('hooks/useHabitForm.ts'),
    });
    expect(issues).toEqual([]);

    // Pure step completeness logic check
    expect(isStepComplete(1, { ...DEFAULT_FORM, name: '   ' })).toBe(false);
    expect(isStepComplete(1, { ...DEFAULT_FORM, name: 'Su' })).toBe(true);
    expect(
      isStepComplete(2, {
        ...DEFAULT_FORM,
        tracking_type: 'numeric',
        unit: 'fincan',
        daily_goal: 0,
        target_direction: 'at_most',
      }),
    ).toBe(true);
    expect(
      isStepComplete(2, {
        ...DEFAULT_FORM,
        tracking_type: 'numeric',
        unit: 'L',
        daily_goal: 0,
        target_direction: 'at_least',
      }),
    ).toBe(false);
  });

  it('negative control: validateSplitShape catches oversized files, missing re-export, and store imports in steps', () => {
    const validStep = "export default function StepX() { return null; }\n";
    const baseDir: Record<string, string> = {
      'HabitOnboardingModal.tsx': 'export default function HabitOnboardingModal() { return null; }\n',
      'StepName.tsx': validStep,
      'StepMeasure.tsx': validStep,
      'StepFrequency.tsx': validStep,
      'StepPriority.tsx': validStep,
      'StepEffort.tsx': validStep,
      'StepAppearance.tsx': validStep,
      'StepSummary.tsx': validStep,
    };
    const validShim = "// Re-export\nexport { default } from './habitOnboarding/HabitOnboardingModal';\n";
    const validHook = 'export function isStepComplete() { return true; }\nexport function useHabitForm() { return {}; }\n';

    expect(validateSplitShape({ shimText: validShim, dirFiles: baseDir, hookText: validHook })).toEqual([]);
    expect(
      validateSplitShape({
        shimText: `${validShim}\n\n\n\n\n`,
        dirFiles: baseDir,
        hookText: validHook,
      }),
    ).toContain('shim_too_long');
    expect(
      validateSplitShape({
        shimText: validShim,
        dirFiles: { ...baseDir, 'HabitOnboardingModal.tsx': 'x\n'.repeat(251) },
        hookText: validHook,
      }),
    ).toContain('modal_exceeds_250_lines');
    expect(
      validateSplitShape({
        shimText: validShim,
        dirFiles: { ...baseDir, 'StepName.tsx': "import { useHabitStore } from '../../store/habitStore';\n" },
        hookText: validHook,
      }),
    ).toContain('step_imports_store:StepName.tsx');
  });
});
