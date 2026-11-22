/**
 * F27 (PRF-01, STO-07) — Whole-store Zustand subscription ratchet.
 *
 * Enforces:
 *  (a) Positive: `HOT_FILES` (`today.tsx`, `useTodayModel.ts`, `HabitSection.tsx`,
 *      `FocusFlowView.tsx`) exist and hold ZERO selector-less `= useXStore();` calls.
 *  (c) Negative: `HOT_FILES` hold ZERO bare multi-field object selectors
 *      (`useXStore((s) => ({ ... }))`) without `useShallow`.
 *  (b) Repo-wide ceiling ratchet across `app/`, `components/`, `hooks/`: count of
 *      `= useXStore();` never exceeds `BASELINE`, and fails when lower so the
 *      ceiling is ratcheted downward monotonically.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');

export const HOT_FILES: readonly string[] = [
  'app/tabs/today.tsx',
  'hooks/useTodayModel.ts',
  'components/today/HabitSection.tsx',
  'components/FocusFlowView.tsx',
];

const SCAN_DIRS = ['app', 'components', 'hooks'] as const;

const WHOLE_STORE_RE = /=\s*use[A-Za-z]+Store\(\)\s*;/g;
const HOT_WHOLE_STORE_RE = /=\s*use(?:Focus|Log|Habit|Task|Willpower|Recovery|Disclosure|RoutineRunner|[A-Za-z]+)Store\(\)\s*;/g;
const UNSHALLOWED_OBJECT_SELECTOR_RE = /\buse[A-Za-z]+Store\s*\(\s*\([^)]*\)\s*=>\s*\(\s*\{/g;

// Pre-F27 baseline on f87818e1 was 93 (today.tsx: 6, FocusFlowView.tsx: 3, YearlyHeatmap.tsx: 1 in F31).
// Post-Wave-8B locked ceiling: 93 - 10 = 83.
export const BASELINE = 83;

function walkCodeFiles(relDir: string): string[] {
  const abs = join(ROOT, relDir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue;
    const rel = `${relDir}/${e.name}`;
    if (e.isDirectory()) out.push(...walkCodeFiles(rel));
    else if (/\.(?:ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

export function findWholeStoreCalls(strippedCode: string): string[] {
  return [...strippedCode.matchAll(WHOLE_STORE_RE)].map((m) => m[0].trim());
}

export function findUnshallowedObjectSelectors(strippedCode: string): string[] {
  return [...strippedCode.matchAll(UNSHALLOWED_OBJECT_SELECTOR_RE)].map((m) => m[0].trim());
}

export function checkRatchet(measured: number, ceiling: number): string | null {
  if (measured > ceiling) {
    return `measured ${measured} whole-store subscriptions exceeds BASELINE ${ceiling} (use field selectors or useShallow)`;
  }
  if (measured < ceiling) {
    return `measured ${measured} whole-store subscriptions is below BASELINE ${ceiling} (lower BASELINE to ${measured})`;
  }
  return null;
}

describe('F27 (PRF-01, STO-07) — wholeStoreSubscriptionRatchet', () => {
  it('(a) HOT_FILES exist and contain zero selector-less whole-store subscriptions', () => {
    const missing = HOT_FILES.filter((rel) => !existsSync(join(ROOT, rel)));
    expect(missing).toEqual([]);

    const offenders: string[] = [];
    for (const rel of HOT_FILES) {
      const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
      const hits = [...code.matchAll(HOT_WHOLE_STORE_RE)].map((m) => m[0].trim());
      if (hits.length > 0) offenders.push(`${rel}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('(b) repo-wide whole-store subscription count across app, components, hooks matches BASELINE (monotonic downward ratchet)', () => {
    const files = SCAN_DIRS.flatMap(walkCodeFiles);
    expect(files.length).toBeGreaterThan(150);

    let total = 0;
    for (const rel of files) {
      const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
      total += findWholeStoreCalls(code).length;
    }
    expect(checkRatchet(total, BASELINE)).toBeNull();
  });

  it('(c) HOT_FILES contain zero multi-field object selectors without useShallow', () => {
    const offenders: string[] = [];
    for (const rel of HOT_FILES) {
      if (!existsSync(join(ROOT, rel))) continue;
      const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
      const hits = findUnshallowedObjectSelectors(code);
      if (hits.length > 0) offenders.push(`${rel}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('(-) scanner sensitivity: catches whole-store calls, unshallowed object selectors, and ratchet drift', () => {
    expect(findWholeStoreCalls('const { status } = useFocusStore();')).toHaveLength(1);
    expect(findWholeStoreCalls('const status = useFocusStore((s) => s.status);')).toEqual([]);
    expect(
      findUnshallowedObjectSelectors('const x = useFocusStore((s) => ({ a: s.a, b: s.b }));'),
    ).toHaveLength(1);
    expect(
      findUnshallowedObjectSelectors('const x = useFocusStore(useShallow((s) => ({ a: s.a, b: s.b })));'),
    ).toEqual([]);
    expect(checkRatchet(85, 84)).toMatch(/exceeds BASELINE/);
    expect(checkRatchet(83, 84)).toMatch(/lower BASELINE to 83/);
    expect(checkRatchet(84, 84)).toBeNull();
  });
});
