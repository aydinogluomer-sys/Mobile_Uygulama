import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');
const REPO = join(FRONTEND, '..');
const read = (rel: string) =>
  readFileSync(join(FRONTEND, rel), 'utf8').replace(/\r\n?/g, '\n');
const code = (rel: string) => stripComments(read(rel));

const F33_MODULES = [
  'lib/focusRitual.ts',
  'hooks/useTimeoutRef.ts',
  'hooks/useFlowKeyboard.ts',
  'hooks/useFocusFlowFeed.ts',
  'store/lowEnergyStore.ts',
  'components/focusFlow/FocusFlowPager.tsx',
  'components/focusFlow/FocusFlowPage.tsx',
  'components/focusFlow/FlowClosurePage.tsx',
  'components/focus/FocusIntentSheet.tsx',
  'components/focus/InterruptionPrompt.tsx',
] as const;

describe('F33 wiring & privacy/schema invariants', () => {
  it('(+) wires FocusIntentSheet, InterruptionPrompt, FocusFlow virtualization, lowEnergyStore & useTimeoutRef while keeping focus.tsx smallStep guard', () => {
    const focusScreen = code('app/tabs/focus.tsx');
    expect(focusScreen).toContain('FocusIntentSheet');
    expect(focusScreen).toContain('InterruptionPrompt');
    expect(focusScreen).toContain('{FLOW_COPY.');
    expect(focusScreen).toContain(
      "if (phase === 'work' && !selectedTaskId && !smallStep) {",
    );

    const flowViewRaw = read('components/FocusFlowView.tsx');
    const flowViewCode = code('components/FocusFlowView.tsx');
    expect(flowViewRaw.split('\n').length).toBeLessThan(500);
    expect(flowViewCode).toContain('useFocusFlowFeed');
    expect(flowViewCode).toContain('useFlowKeyboard');
    expect(flowViewCode).toContain('useTimeoutRef');
    expect(flowViewCode).toContain('FocusFlowPager');
    expect(flowViewCode).toContain('FlowClosurePage');
    expect(flowViewCode).toContain('useIsFocused');

    expect(code('hooks/useFocusFlowFeed.ts')).toContain('useLowEnergyStore');
    // Coordinator enables after wiring today.tsx at Wave 10 merge gate
    // expect(code('app/tabs/today.tsx')).toContain('useLowEnergyStore');

    expect(code('components/Drawer.tsx')).toContain('useTimeoutRef');
    expect(code('components/Drawer.tsx')).not.toMatch(/\bsetTimeout\s*\(/);
    expect(code('components/hub/ExploreView.tsx')).toContain('useTimeoutRef');
    expect(code('components/hub/ExploreView.tsx')).not.toMatch(/\bsetTimeout\s*\(/);
  });

  it('(-) keeps FocusFlowView free of hardcoded lowEnergy:false, isolates ritual/feed from analytics & Speech, leaves focus_sessions schema untouched, and uses zero Math.random', () => {
    expect(code('components/FocusFlowView.tsx')).not.toMatch(/lowEnergy\s*:\s*false/);

    for (const rel of [
      'lib/focusRitual.ts',
      'components/focus/FocusIntentSheet.tsx',
      'components/focus/InterruptionPrompt.tsx',
      'hooks/useFocusFlowFeed.ts',
      'components/focusFlow/FlowClosurePage.tsx',
    ]) {
      const src = code(rel);
      expect(src).not.toMatch(/lib\/analytics|\bemitEvent\b|\bbuildEvent\b/);
    }

    const migrationsDir = join(REPO, 'supabase', 'migrations');
    const sqlFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    expect(sqlFiles.length).toBeGreaterThan(20);
    for (const file of sqlFiles) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      expect(sql).not.toMatch(/ALTER\s+TABLE[\s\S]{0,120}focus_sessions[\s\S]{0,120}\bintent\b/i);
    }

    for (const rel of F33_MODULES) {
      const src = code(rel);
      expect({ rel, hasRandom: /\bMath\.random\b/.test(src) }).toEqual({
        rel,
        hasRandom: false,
      });
      if (rel !== 'components/focusFlow/FocusFlowPage.tsx') {
        expect({ rel, hasSpeech: /expo-speech/.test(src) }).toEqual({
          rel,
          hasSpeech: false,
        });
      }
    }
  });
});
