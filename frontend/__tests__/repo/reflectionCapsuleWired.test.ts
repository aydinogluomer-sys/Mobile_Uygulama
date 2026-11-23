import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string): string => stripComments(read(rel));

function walkCodeFiles(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) {
      continue;
    }
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkCodeFiles(rel));
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

describe('F37 — reflection, energy suggestion, and time capsule repository wiring', () => {
  it('(+) today.tsx suggests low-energy mode without ever auto-enabling it, and preserves single skip write in confirmLightDay', () => {
    const todaySrc = code('app/tabs/today.tsx');

    expect(todaySrc).toContain('lowEnergySuggested');
    expect(todaySrc).not.toMatch(/setLowEnergyFilter\s*\(\s*true\b/);
    expect(todaySrc).not.toMatch(/setLowEnergy\s*\(\s*true\b/);

    const setCalls = [...todaySrc.matchAll(/\bsetLowEnergy(?:Filter)?\s*\(([^)]*)\)/g)].map((m) =>
      m[1].trim(),
    );
    expect(setCalls).toEqual(['!lowEnergyFilter, clock.today']);

    // Calm modes row keeps exact same two chips and adds zero new raw TouchableOpacity around it
    expect(todaySrc).toContain('accessibilityLabel="Düşük enerji filtresi: yalnız hafif alışkanlıkları öne çıkar"');
    expect(todaySrc).toContain('accessibilityLabel="Günü kapat: akşam kapanış ritüelini başlat"');
    const calmSlice = todaySrc.slice(
      todaySrc.indexOf('s.calmModesRow'),
      todaySrc.indexOf('<NextUpStrip'),
    );
    expect(calmSlice).not.toMatch(/<TouchableOpacity\b/);

    // confirmLightDay still writes state: 'skip' once and triggers capsuleMoment on success
    const fn = todaySrc.slice(
      todaySrc.indexOf('async function confirmLightDay('),
      todaySrc.indexOf('const closeRows'),
    );
    expect(fn.match(/state:\s*'/g)).toHaveLength(1);
    expect(fn).toContain('setCapsuleMoment(true)');
    expect(todaySrc).toContain('<TimeCapsuleCard');
  });

  it('(+) journal.tsx and recovery.tsx wire ReflectionTemplate, TimeCapsuleComposer, and TimeCapsuleCard cleanly', () => {
    const journalSrc = code('app/screens/journal.tsx');
    expect(journalSrc).toContain('ReflectionTemplate');
    expect(journalSrc).toContain('TimeCapsuleComposer');
    expect(journalSrc).toContain('appendBlock(content, text)');
    expect(journalSrc).toMatch(/function edit\(nextContent: string, nextMood: number \| null\)/);
    expect(journalSrc).toMatch(/async function handleSave\(\)/);

    const recoverySrc = code('app/screens/recovery.tsx');
    expect(recoverySrc).toContain('useTimeCapsules');
    expect(recoverySrc).toContain('<TimeCapsuleCard');
  });

  it('(-) enforces strict privacy boundaries and exact importer allowlist for lib/timeCapsule', () => {
    for (const pureLib of ['lib/timeCapsule.ts', 'lib/reflectionTemplate.ts']) {
      const src = code(pureLib);
      expect(src).not.toMatch(/supabase|repositories\/|analytics|coach|store\//);
    }

    const allFiles = ['app', 'components', 'hooks', 'lib', 'services', 'store', 'repositories'].flatMap(
      walkCodeFiles,
    );
    const capsuleImporters = allFiles
      .filter((f) => f !== 'lib/timeCapsule.ts')
      .filter((f) => /from\s+['"][^'"]*timeCapsule['"]/.test(code(f)))
      .sort();

    expect(capsuleImporters).toEqual([
      'components/journal/TimeCapsuleComposer.tsx',
      'components/recovery/TimeCapsuleCard.tsx',
      'hooks/useTimeCapsules.ts',
    ]);

    const f37Files = [
      'lib/timeCapsule.ts',
      'lib/reflectionTemplate.ts',
      'hooks/useTimeCapsules.ts',
      'components/journal/ReflectionTemplate.tsx',
      'components/journal/TimeCapsuleComposer.tsx',
      'components/recovery/TimeCapsuleCard.tsx',
    ];
    for (const rel of f37Files) {
      const src = code(rel);
      expect(src).not.toMatch(/\btrack\s*\(/);
      expect(src).not.toMatch(/\bconsole\.(?:log|warn|error|info|debug)\s*\(/);
      expect(src).not.toMatch(/\bnotify\s*\(/);
    }
  });

  it('(-) bans clinical/therapy/CBT terms in F37 file names and exported identifiers, and preserves moodStore.checkIn signature', () => {
    const bannedIdPattern = /clinic|klinik|therap|terapi|cbt|diagnos/i;
    const f37Files = [
      'lib/timeCapsule.ts',
      'lib/reflectionTemplate.ts',
      'hooks/useTimeCapsules.ts',
      'components/journal/ReflectionTemplate.tsx',
      'components/journal/TimeCapsuleComposer.tsx',
      'components/recovery/TimeCapsuleCard.tsx',
    ];

    for (const rel of f37Files) {
      expect(rel).not.toMatch(bannedIdPattern);
      const src = code(rel);
      const exportedNames = [
        ...src.matchAll(/\bexport\s+(?:const|function|type|interface)\s+([A-Za-z0-9_]+)/g),
      ].map((m) => m[1]);
      for (const id of exportedNames) {
        expect(id).not.toMatch(bannedIdPattern);
      }
    }

    const moodStoreSrc = code('store/moodStore.ts');
    expect(moodStoreSrc).toContain(
      'checkIn: (moodId: string, intensity: 1 | 2 | 3, note?: string) => boolean;',
    );
  });
});
