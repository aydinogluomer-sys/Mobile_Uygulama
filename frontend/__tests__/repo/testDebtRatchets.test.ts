import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, sep } from 'path';
import { ACT_WARNING_DEBT } from '../helpers/actWarningDebt';
import { stripComments } from '../helpers/sourceText';

export type DebtMeasurements = {
  reactTestRendererImporters: string[];
  rawReadFileSyncTests: string[];
  testEnvBranchFiles: string[];
  workItemTitles: string[];
  turkishCopyAssertions: string[];
  exactCountAssertions: string[];
};

export type StoredTestDebtBaseline = DebtMeasurements & {
  actWarningDebtCount: number;
};

const FRONTEND_ROOT = join(__dirname, '..', '..');
const BASELINE_PATH = join(__dirname, '..', 'fixtures', 'testDebt.baseline.json');
const SELF_REL_PATH = '__tests__/repo/testDebtRatchets.test.ts';

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'coverage' && entry.name !== '.expo' && entry.name !== 'dist') {
        out.push(...walkFiles(full));
      }
    } else {
      out.push(full);
    }
  }
  return out;
}

const RTR_PKG = ['react', 'test', 'renderer'].join('-');
const RTR_IMPORT_RE = new RegExp(`(?:from\\s+|require\\s*\\(\\s*)['"]${RTR_PKG}['"]`);
const RAW_READ_FILE_RE = /\breadFileSync\s*\(/;
const SOURCE_TEXT_HELPER_RE = /helpers\/sourceText\b/;
const TEST_ENV_BRANCH_RE =
  /\bIS_TEST\b|\bJEST_WORKER_ID\b|NODE_ENV\s*===\s*['"]test['"]|\b_isMockFunction\b/;
const WORK_ITEM_TITLE_RE = new RegExp(
  `\\b(?:describe|it|test)(?:\\.each\\([^)]*\\))?\\s*\\(\\s*['"\`]${'Item'}\\s+#\\d+`,
);
const TURKISH_COPY_ASSERT_RE = /\.to(?:Contain|Match)\(\s*(?:['"`/][^'"`/\n]*[çğıöşüÇĞİÖŞÜ])/;
const EXACT_COUNT_ASSERT_RE = /\.match\([^)]+\)\s*\?\?\s*\[\]\)\.length\)\.toBe\(\d+\)/;

const PROD_DIRS = ['app', 'components', 'lib', 'services', 'store', 'repositories', 'hooks'] as const;

export function measureDebt(root: string): DebtMeasurements {
  const reactTestRendererImporters: string[] = [];
  const rawReadFileSyncTests: string[] = [];
  const testEnvBranchFiles: string[] = [];
  const workItemTitles: string[] = [];
  const turkishCopyAssertions: string[] = [];
  const exactCountAssertions: string[] = [];

  const testFiles = walkFiles(join(root, '__tests__'))
    .filter((f) => /\.test\.(ts|tsx)$/.test(f))
    .sort();

  for (const full of testFiles) {
    const rel = toPosix(relative(root, full));
    if (rel === SELF_REL_PATH) continue;
    const raw = readFileSync(full, 'utf8');
    const code = stripComments(raw);

    if (RTR_IMPORT_RE.test(code)) {
      reactTestRendererImporters.push(rel);
    }
    if (RAW_READ_FILE_RE.test(code) && !SOURCE_TEXT_HELPER_RE.test(code)) {
      rawReadFileSyncTests.push(rel);
    }
    if (WORK_ITEM_TITLE_RE.test(code)) {
      workItemTitles.push(rel);
    }
    if (
      /^__tests__\/(?:repo|ui|edge)\//.test(rel) &&
      TURKISH_COPY_ASSERT_RE.test(code)
    ) {
      turkishCopyAssertions.push(rel);
    }
    if (EXACT_COUNT_ASSERT_RE.test(code)) {
      exactCountAssertions.push(rel);
    }
  }

  for (const dir of PROD_DIRS) {
    for (const full of walkFiles(join(root, dir))) {
      if (!/\.(ts|tsx)$/.test(full) || full.endsWith('.d.ts')) continue;
      const rel = toPosix(relative(root, full));
      const code = stripComments(readFileSync(full, 'utf8'));
      if (TEST_ENV_BRANCH_RE.test(code)) {
        testEnvBranchFiles.push(rel);
      }
    }
  }

  return {
    reactTestRendererImporters: reactTestRendererImporters.sort(),
    rawReadFileSyncTests: rawReadFileSyncTests.sort(),
    testEnvBranchFiles: testEnvBranchFiles.sort(),
    workItemTitles: workItemTitles.sort(),
    turkishCopyAssertions: turkishCopyAssertions.sort(),
    exactCountAssertions: exactCountAssertions.sort(),
  };
}

export function diffRatchetList(
  metricName: string,
  measured: readonly string[],
  baseline: readonly string[],
): string | null {
  const baseSet = new Set(baseline);
  const measSet = new Set(measured);
  const added = measured.filter((x) => !baseSet.has(x));
  if (added.length > 0) {
    return `${metricName} increased (${baseline.length} -> ${measured.length}); new entries:\n  + ${added.join('\n  + ')}`;
  }
  const removed = baseline.filter((x) => !measSet.has(x));
  if (removed.length > 0) {
    return `${metricName} decreased (${baseline.length} -> ${measured.length}); lower the baseline via UPDATE_TEST_DEBT=1:\n  - ${removed.join('\n  - ')}`;
  }
  return null;
}

describe('F48 C1/C4/C7/C9 — Downward Test Debt Ratchets', () => {
  it('(+) all six debt counters and ACT_WARNING_DEBT match testDebt.baseline.json with zero workItemTitles', () => {
    const measured = measureDebt(FRONTEND_ROOT);
    expect(measured.workItemTitles).toEqual([]);

    if (process.env.UPDATE_TEST_DEBT === '1') {
      mkdirSync(dirname(BASELINE_PATH), { recursive: true });
      const nextBaseline: StoredTestDebtBaseline = {
        ...measured,
        actWarningDebtCount: ACT_WARNING_DEBT.length,
      };
      writeFileSync(BASELINE_PATH, `${JSON.stringify(nextBaseline, null, 2)}\n`, 'utf8');
    }

    expect(existsSync(BASELINE_PATH)).toBe(true);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as StoredTestDebtBaseline;

    const errors: string[] = [];
    for (const key of [
      'reactTestRendererImporters',
      'rawReadFileSyncTests',
      'testEnvBranchFiles',
      'workItemTitles',
      'turkishCopyAssertions',
      'exactCountAssertions',
    ] as const) {
      const msg = diffRatchetList(key, measured[key], baseline[key]);
      if (msg) errors.push(msg);
    }

    if (ACT_WARNING_DEBT.length > baseline.actWarningDebtCount) {
      errors.push(
        `ACT_WARNING_DEBT grew (${baseline.actWarningDebtCount} -> ${ACT_WARNING_DEBT.length})`,
      );
    } else if (ACT_WARNING_DEBT.length < baseline.actWarningDebtCount) {
      errors.push(
        `ACT_WARNING_DEBT shrank (${baseline.actWarningDebtCount} -> ${ACT_WARNING_DEBT.length}); lower baseline via UPDATE_TEST_DEBT=1`,
      );
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n\n'));
    }
  });

  it('(+) every ACT_WARNING_DEBT entry exists on disk, is unique/sorted, and excludes migrated TodayScreen', () => {
    const sortedUnique = [...new Set(ACT_WARNING_DEBT)].sort();
    expect([...ACT_WARNING_DEBT]).toEqual(sortedUnique);
    expect(ACT_WARNING_DEBT).not.toContain('__tests__/ui/todayScreen.test.tsx');
    for (const rel of ACT_WARNING_DEBT) {
      expect({ rel, exists: existsSync(join(FRONTEND_ROOT, rel)) }).toEqual({
        rel,
        exists: true,
      });
    }
  });

  it('(-) catches new RTR importer, new production IS_TEST branch, and un-lowered shrinking debt on synthetic roots', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'debt-ratchet-'));
    try {
      mkdirSync(join(tmp, '__tests__', 'ui'), { recursive: true });
      mkdirSync(join(tmp, 'components'), { recursive: true });

      writeFileSync(
        join(tmp, '__tests__', 'ui', 'legacy.test.tsx'),
        `import R from '${RTR_PKG}';\nvoid R;\n`,
        'utf8',
      );
      writeFileSync(
        join(tmp, 'components', 'Banner.tsx'),
        `const ${['IS', 'TEST'].join('_')} = true;\nexport default ${['IS', 'TEST'].join('_')};\n`,
        'utf8',
      );

      const m = measureDebt(tmp);
      expect(m.reactTestRendererImporters).toEqual(['__tests__/ui/legacy.test.tsx']);
      expect(m.testEnvBranchFiles).toEqual(['components/Banner.tsx']);

      // (-) Adding a new RTR importer fails upward check
      expect(
        diffRatchetList('reactTestRendererImporters', m.reactTestRendererImporters, []),
      ).toMatch(/increased/);

      // (-) Migrating a file without updating baseline fails downward ratchet ("UPDATE_TEST_DEBT=1")
      expect(
        diffRatchetList('reactTestRendererImporters', [], ['__tests__/ui/legacy.test.tsx']),
      ).toMatch(/UPDATE_TEST_DEBT=1/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
