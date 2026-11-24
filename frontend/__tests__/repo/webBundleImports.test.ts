import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { isActiveStep, loadWorkflow, parseWorkflow, runText } from '../helpers/ciWorkflow';
import { readSource, stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');
const PROD_DIRS = ['app', 'components', 'hooks', 'lib', 'services', 'store', 'repositories'] as const;

export type NativeImportReview = {
  pkg: string;
  file: string;
  guard: 'platform-check' | 'web-stub' | 'web-supported';
  reason: string;
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function collectPackageImporters(
  files: Record<string, string>,
  packages: readonly string[],
): { pkg: string; file: string }[] {
  const found: { pkg: string; file: string }[] = [];
  for (const [file, raw] of Object.entries(files)) {
    const code = stripComments(raw);
    for (const pkg of packages) {
      const esc = escapeRe(pkg);
      const importRe = new RegExp(
        `(?:^|[;\\n])\\s*import\\s+(?!type\\b)[\\s\\S]*?from\\s*['"]${esc}(?:\\/[^'"]*)?['"]`,
      );
      const sideRe = new RegExp(`(?:^|[;\\n])\\s*import\\s*['"]${esc}(?:\\/[^'"]*)?['"]`);
      const reqRe = new RegExp(`\\b(?:require|import)\\(\\s*['"]${esc}(?:\\/[^'"]*)?['"]\\s*\\)`);
      if (importRe.test(code) || sideRe.test(code) || reqRe.test(code)) {
        found.push({ pkg, file });
      }
    }
  }
  return found.sort((a, b) => a.pkg.localeCompare(b.pkg) || a.file.localeCompare(b.file));
}

export function platformFilePairs(
  listing: readonly string[],
): { base: string; web: string; native?: string; generic?: string }[] {
  const byBase = new Map<string, { web?: string; native?: string; generic?: string }>();
  for (const raw of listing) {
    const norm = raw.replace(/\\/g, '/');
    const mWeb = /^(.+)\.web\.(tsx?)$/.exec(norm);
    if (mWeb) {
      const cur = byBase.get(mWeb[1]) ?? {};
      cur.web = norm;
      byBase.set(mWeb[1], cur);
      continue;
    }
    const mNat = /^(.+)\.native\.(tsx?)$/.exec(norm);
    if (mNat) {
      const cur = byBase.get(mNat[1]) ?? {};
      cur.native = norm;
      byBase.set(mNat[1], cur);
      continue;
    }
    const mGen = /^(.+)\.(tsx?)$/.exec(norm);
    if (mGen && !mGen[1].endsWith('.d')) {
      const cur = byBase.get(mGen[1]) ?? {};
      cur.generic = norm;
      byBase.set(mGen[1], cur);
    }
  }

  const out: { base: string; web: string; native?: string; generic?: string }[] = [];
  for (const [base, entry] of [...byBase.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (entry.web) {
      out.push({
        base,
        web: entry.web,
        ...(entry.native ? { native: entry.native } : {}),
        ...(entry.generic ? { generic: entry.generic } : {}),
      });
    }
  }
  return out;
}

export function exportedNamesOf(source: string): string[] {
  const code = stripComments(source);
  const names = new Set<string>();
  for (const m of code.matchAll(/\bexport\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]);
  }
  for (const m of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const cleaned = part.trim();
      if (!cleaned || cleaned.startsWith('type ')) continue;
      const alias = cleaned.split(/\s+as\s+/);
      names.add((alias[1] ?? alias[0]).trim());
    }
  }
  return [...names].sort();
}

function walkProdFiles(relDir: string): string[] {
  const abs = join(FRONTEND, relDir);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
    const childRel = `${relDir}/${entry}`;
    const childAbs = join(FRONTEND, childRel);
    if (statSync(childAbs).isDirectory()) {
      out.push(...walkProdFiles(childRel));
    } else if (/\.(?:ts|tsx|js|jsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(childRel);
    }
  }
  return out;
}

describe('F49 (GAP2-12, GAP2-04) — web bundle native-import review, platform pairs & CI wiring', () => {
  const appJson = JSON.parse(readSource('app.json')) as {
    expo: {
      web?: { bundler?: string; output?: string; lang?: string };
      plugins?: (string | [string, unknown])[];
    };
  };
  const pkgJson = JSON.parse(readSource('package.json')) as {
    dependencies?: Record<string, string>;
  };
  const reviews = JSON.parse(
    readSource('__tests__/repo/fixtures/webImportReview.json'),
  ) as NativeImportReview[];

  const pluginPackages = (appJson.expo.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
  const trackedPackages = [...new Set([...pluginPackages, 'expo-sqlite', 'expo-secure-store'])];

  const prodListing = PROD_DIRS.flatMap((d) => walkProdFiles(d));
  const prodSources: Record<string, string> = {};
  for (const rel of prodListing) {
    prodSources[rel] = readSource(rel);
  }

  it('(+) reviews every app.json plugin + expo-sqlite/expo-secure-store importer and enforces platform-check guards', () => {
    const actual = collectPackageImporters(prodSources, trackedPackages);
    expect(actual.length).toBeGreaterThan(10);

    const reviewByKey = new Map(reviews.map((r) => [`${r.pkg}::${r.file}`, r]));
    const unreviewed = actual
      .filter((imp) => !reviewByKey.has(`${imp.pkg}::${imp.file}`))
      .map((imp) => `${imp.pkg} in ${imp.file}`);
    expect(unreviewed).toEqual([]);

    for (const r of reviews) {
      expect(r.reason.trim().length).toBeGreaterThan(5);
      if (r.guard === 'platform-check') {
        const src = prodSources[r.file];
        expect(src).toBeDefined();
        const code = stripComments(src);
        expect({
          file: r.file,
          guarded:
            /\bPlatform\.OS\b/.test(code) ||
            /\bisNativePlatform\s*\(/.test(code) ||
            /\bREMINDERS_SUPPORTED\b/.test(code),
        }).toEqual({ file: r.file, guarded: true });
      }
    }
  });

  it('(+) configures app.json web (metro, single, lang="tr"), declares react-dom + react-native-web, and verifies platform pairs', () => {
    expect(appJson.expo.web?.bundler).toBe('metro');
    expect(appJson.expo.web?.output).toBe('single');
    expect(appJson.expo.web?.lang).toBe('tr');

    expect(pkgJson.dependencies?.['react-dom']).toBeDefined();
    expect(pkgJson.dependencies?.['react-native-web']).toBeDefined();

    const pairs = platformFilePairs(prodListing);
    for (const pair of pairs) {
      const peer = pair.native ?? pair.generic;
      expect(peer).toBeDefined();
      expect(exportedNamesOf(prodSources[pair.web])).toEqual(
        exportedNamesOf(prodSources[peer!]),
      );
    }

    // Synthetic positive & negative check for .web.ts <-> .native.ts export parity
    const synPairs = platformFilePairs(['lib/foo.web.ts', 'lib/foo.native.ts']);
    expect(synPairs).toEqual([{ base: 'lib/foo', web: 'lib/foo.web.ts', native: 'lib/foo.native.ts' }]);
    expect(exportedNamesOf('export function a() {} export const b = 1;')).toEqual(['a', 'b']);
    expect(exportedNamesOf('export function a() {}')).not.toEqual(['a', 'b']);
  });

  it('(+) verifies active --platform web step in verify job and active playwright test step in web-e2e job', () => {
    const wf = loadWorkflow('.github/workflows/ci.yml');
    expect(runText(wf.jobs.verify)).toContain('npx expo export --platform web');
    expect(runText(wf.jobs['web-e2e'])).toContain('npx playwright test -c e2e/playwright.config.ts');
  });

  it('(-) catches unreviewed expo-sqlite importer and rejects continue-on-error web-e2e job', () => {
    const withUnreviewed = collectPackageImporters(
      { ...prodSources, 'lib/rogueSqlite.ts': "import * as Sqlite from 'expo-sqlite';\nexport const x = Sqlite;" },
      trackedPackages,
    );
    const reviewKeys = new Set(reviews.map((r) => `${r.pkg}::${r.file}`));
    const missing = withUnreviewed.filter((i) => !reviewKeys.has(`${i.pkg}::${i.file}`));
    expect(missing).toEqual([{ pkg: 'expo-sqlite', file: 'lib/rogueSqlite.ts' }]);

    const softWf = parseWorkflow(
      [
        'jobs:',
        '  web-e2e:',
        '    continue-on-error: true',
        '    steps:',
        '      - run: npx playwright test -c e2e/playwright.config.ts',
      ].join('\n'),
    );
    const step = softWf.jobs['web-e2e'].steps![0];
    expect(isActiveStep(step, softWf.jobs['web-e2e'])).toBe(false);
    expect(runText(softWf.jobs['web-e2e'])).toBe('');
  });
});
