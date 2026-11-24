import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, resolve, sep } from 'path';
import { stripComments } from '../helpers/sourceText';

export type ProductionDir = 'lib' | 'services' | 'store' | 'repositories' | 'hooks';

const DEFAULT_PROD_DIRS: readonly ProductionDir[] = [
  'lib',
  'services',
  'store',
  'repositories',
  'hooks',
];

const FRONTEND_ROOT = join(__dirname, '..', '..');
const BASELINE_PATH = join(__dirname, '..', 'fixtures', 'untestedModules.baseline.json');

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '__tests__') {
        out.push(...walkFiles(full));
      }
    } else {
      out.push(full);
    }
  }
  return out;
}

export function listProductionModules(
  root: string,
  dirs: readonly ProductionDir[] = DEFAULT_PROD_DIRS,
): string[] {
  const modules: string[] = [];
  for (const d of dirs) {
    for (const full of walkFiles(join(root, d))) {
      if (!/\.(ts|tsx)$/.test(full)) continue;
      if (full.endsWith('.d.ts') || /\.test\.(ts|tsx)$/.test(full)) continue;
      modules.push(toPosix(relative(root, full)));
    }
  }
  return modules.sort();
}

function resolveImportTarget(fromFile: string, specifier: string, root: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = /\.(ts|tsx|js|jsx)$/.test(base)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        join(base, 'index.ts'),
        join(base, 'index.tsx'),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const rel = toPosix(relative(root, candidate));
      if (!rel.startsWith('..')) return rel;
    }
  }
  return null;
}

function extractDirectSpecifiers(code: string): string[] {
  const specs: string[] = [];

  // 1. Static runtime imports (exclude `import type ... from '...'`)
  const staticImportRe = /\bimport\s+(?!type\b)(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = staticImportRe.exec(code))) {
    specs.push(m[1]);
  }

  // 2. CommonJS require('...') (excludes jest.mock / jest.doMock)
  const requireRe = /(?:^|[^.\w])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireRe.exec(code))) {
    specs.push(m[1]);
  }

  // 3. jest.requireActual('...')
  const requireActualRe = /\bjest\.requireActual(?:\s*<[\s\S]*?>)?\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireActualRe.exec(code))) {
    specs.push(m[1]);
  }

  // 4. Dynamic import('...')
  const dynamicImportRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynamicImportRe.exec(code))) {
    specs.push(m[1]);
  }

  return specs;
}

export function directTestImports(root: string): Set<string> {
  const imported = new Set<string>();
  const testsRoot = join(root, '__tests__');
  for (const testFile of walkFiles(testsRoot)) {
    if (!/\.(ts|tsx|js|jsx)$/.test(testFile)) continue;
    const raw = readFileSync(testFile, 'utf8');
    const code = stripComments(raw);
    for (const spec of extractDirectSpecifiers(code)) {
      const target = resolveImportTarget(testFile, spec, root);
      if (target) {
        imported.add(target);
      }
    }
  }
  return imported;
}

export function untestedModules(
  modules: readonly string[],
  imported: ReadonlySet<string>,
): string[] {
  return modules.filter((m) => !imported.has(m)).sort();
}

describe('F48 C7 (TST-19) — Direct Module Test Import Coverage Map & Downward Ratchet', () => {
  it('(+) current untested module set matches untestedModules.baseline.json (two-sided ratchet)', () => {
    const prod = listProductionModules(FRONTEND_ROOT);
    const imported = directTestImports(FRONTEND_ROOT);
    const current = untestedModules(prod, imported);

    expect(prod.length).toBeGreaterThan(150);
    expect(imported.size).toBeGreaterThan(100);

    if (process.env.UPDATE_UNTESTED_BASELINE === '1') {
      mkdirSync(dirname(BASELINE_PATH), { recursive: true });
      writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    }

    expect(existsSync(BASELINE_PATH)).toBe(true);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as string[];

    const baselineSet = new Set(baseline);
    const currentSet = new Set(current);
    const newlyUntested = current.filter((m) => !baselineSet.has(m));
    const staleInBaseline = baseline.filter((m) => !currentSet.has(m));

    if (newlyUntested.length > 0) {
      throw new Error(
        `New production modules added without direct test imports:\n  - ${newlyUntested.join('\n  - ')}`,
      );
    }
    if (staleInBaseline.length > 0) {
      throw new Error(
        `Untested module debt decreased (modules now tested or removed). Run UPDATE_UNTESTED_BASELINE=1 npx jest __tests__/repo/moduleTestCoverageMap.test.ts to ratchet baseline down:\n  - ${staleInBaseline.join('\n  - ')}`,
      );
    }
    expect(current).toEqual(baseline);
  });

  it('(+) counts static import / require / requireActual as direct test imports while ignoring jest.mock', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cov-map-'));
    try {
      mkdirSync(join(tmp, 'lib'), { recursive: true });
      mkdirSync(join(tmp, 'services'), { recursive: true });
      mkdirSync(join(tmp, '__tests__', 'lib'), { recursive: true });

      writeFileSync(join(tmp, 'lib', 'tested.ts'), 'export const a = 1;\n', 'utf8');
      writeFileSync(join(tmp, 'lib', 'onlyMocked.ts'), 'export const b = 2;\n', 'utf8');
      writeFileSync(join(tmp, 'services', 'newUntested.ts'), 'export const c = 3;\n', 'utf8');
      writeFileSync(
        join(tmp, '__tests__', 'lib', 'sample.test.ts'),
        [
          "jest.mock('../../lib/onlyMocked', () => ({ b: 0 }));",
          "import { a } from '../../lib/tested';",
          'expect(a).toBe(1);',
        ].join('\n'),
        'utf8',
      );

      const mods = listProductionModules(tmp);
      const imp = directTestImports(tmp);
      expect(mods).toEqual(['lib/onlyMocked.ts', 'lib/tested.ts', 'services/newUntested.ts']);
      expect(imp.has('lib/tested.ts')).toBe(true);
      expect(imp.has('lib/onlyMocked.ts')).toBe(false);

      const current = untestedModules(mods, imp);
      expect(current).toEqual(['lib/onlyMocked.ts', 'services/newUntested.ts']);

      // (-) Adding a new untested module surfaces in newlyUntested
      const prevBaseline = new Set(['lib/onlyMocked.ts']);
      const newlyUntested = current.filter((m) => !prevBaseline.has(m));
      expect(newlyUntested).toEqual(['services/newUntested.ts']);

      // (-) Stale entry in baseline is caught
      const staleBaseline = ['lib/onlyMocked.ts', 'services/newUntested.ts', 'lib/deletedOld.ts'];
      const currentSet = new Set(current);
      expect(staleBaseline.filter((m) => !currentSet.has(m))).toEqual(['lib/deletedOld.ts']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
