/**
 * R05 / F34 runner — migration 030 written (not applied), the runner is
 * separate from AI routine proposals, the screen keeps the session's promises,
 * and F34 clock/picker/robustness contracts stay wired.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const raw = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => stripComments(raw(p));

describe('migration 030', () => {
  const sql = raw('../supabase/migrations/030_routine_runner.sql');
  it('templates, immutable versions and sessions, RLS on all three', () => {
    for (const t of ['routine_templates', 'routine_template_versions', 'routine_sessions']) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`));
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`));
    }
    expect(sql).toMatch(/UNIQUE \(template_id, version\)/);
    expect(sql).not.toMatch(/CREATE POLICY routine_template_versions_update/);
  });
  it('is recorded as NOT applied', () => {
    expect(sql).toMatch(/STATUS: WRITTEN, NOT APPLIED/);
    expect(raw('../supabase/migrations/README.md')).toMatch(/\| 030 \| `030_routine_runner\.sql` \| \*\*NOT APPLIED\*\*/);
  });
});

describe('the runner is not the AI proposal store', () => {
  it('runner code never touches routines / routine_items', () => {
    for (const p of [
      'lib/routineRunner.ts',
      'store/routineRunnerStore.ts',
      'app/screens/routine-runner.tsx',
      'components/routineRunner/RunnerClock.tsx',
      'components/routineRunner/ActiveRoutinePicker.tsx',
    ]) {
      expect(code(p)).not.toMatch(/routineRepository|routineStore'|routine_items|from\('routines'\)/);
    }
  });
});

describe('the screen keeps the promises', () => {
  const screen = raw('app/screens/routine-runner.tsx');
  const screenCode = code('app/screens/routine-runner.tsx');

  it('time up is not completion', () => {
    expect(screen).toMatch(/Süre doldu\. Tamamlamak sana kalmış/);
    expect(screenCode).not.toMatch(/if \(up\)[^}]*complete\(/);
  });

  it('skip says it is not done; finish says unmarked stays unmarked', () => {
    expect(screen).toMatch(/accessibilityLabel="Adımı geç; yapılmış sayılmaz"/);
    expect(screen).toMatch(/İşaretlenmemiş adımlar işaretlenmemiş kalır\./);
  });

  it('session edits are for this session; applying to the template is separate', () => {
    expect(screen).toMatch(/Bu değişiklikler yalnız bu oturum için/);
    expect(screen).toMatch(/st\.applyToTemplate\(\)/);
  });

  it('no spoken output (expo-speech is stop point S13); the screen reader is told', () => {
    for (const p of [
      'app/screens/routine-runner.tsx',
      'components/routineRunner/RunnerClock.tsx',
      'components/routineRunner/ActiveRoutinePicker.tsx',
      'lib/routineRunner.ts',
    ]) {
      expect(code(p)).not.toMatch(/from 'expo-speech'|require\('expo-speech'\)/);
    }
    expect(screen).toMatch(/AccessibilityInfo\.announceForAccessibility\(`Sıradaki adım: \$\{step\.title\}`\)/);
  });

  it('Today has the entry', () => {
    expect(code('app/tabs/today.tsx')).toMatch(/router\.push\('\/screens\/routine-runner'(?:\s+as\s+any)?\)/);
    expect(code('app/tabs/today.tsx')).toMatch(/suggestTemplate\(/);
  });

  it('F34 (+) screen mounts RunnerClock and ActiveRoutinePicker and removes 1s setTick', () => {
    expect(screen).toMatch(/<RunnerClock\b/);
    expect(screen).toMatch(/<ActiveRoutinePicker\b/);
    expect(screenCode).not.toMatch(/\bsetTick\b/);
  });

  it('F34 (-) routineRunner.ts never dereferences latestVersion(t). without optional chaining', () => {
    expect(code('lib/routineRunner.ts')).not.toMatch(/latestVersion\([^)]*\)\./);
  });
});
