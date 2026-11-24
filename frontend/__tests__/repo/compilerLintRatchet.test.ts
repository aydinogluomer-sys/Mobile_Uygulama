import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ESLint, type Linter } from 'eslint';
import { stripComments } from '../helpers/sourceText';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const eslintFlatConfig = require('../../eslint.config.js') as Linter.Config[];

const FRONTEND_ROOT = join(__dirname, '..', '..');
const SUPPRESSIONS_PATH = join(FRONTEND_ROOT, 'eslint-suppressions.json');

const COMPILER_HOOK_RULES = [
  'react-hooks/refs',
  'react-hooks/set-state-in-effect',
  'react-hooks/preserve-manual-memoization',
  'react-hooks/purity',
] as const;

/**
 * Locked at zero after clearing all 192 legacy React Compiler hook findings across Shards A–E.
 * Only decreases via `npx eslint . --ext .ts,.tsx --prune-suppressions`.
 */
export const BASELINE_TOTAL = 0;

type SuppressionsFile = Record<string, Record<string, { count: number }>>;

export function summarizeSuppressions(suppressions: SuppressionsFile): {
  total: number;
  unexpectedRules: string[];
  missingFiles: string[];
} {
  let total = 0;
  const allowed = new Set<string>(COMPILER_HOOK_RULES);
  const unexpected = new Set<string>();
  const missingFiles: string[] = [];

  for (const [relFile, ruleMap] of Object.entries(suppressions)) {
    if (!existsSync(join(FRONTEND_ROOT, relFile))) {
      missingFiles.push(relFile);
    }
    for (const [ruleId, entry] of Object.entries(ruleMap)) {
      if (!allowed.has(ruleId)) {
        unexpected.add(ruleId);
      }
      total += entry?.count ?? 0;
    }
  }

  return {
    total,
    unexpectedRules: [...unexpected].sort(),
    missingFiles: missingFiles.sort(),
  };
}

function makeEslint(): ESLint {
  return new ESLint({
    cwd: FRONTEND_ROOT,
    overrideConfigFile: true,
    overrideConfig: eslintFlatConfig,
  });
}

describe('F48 C8 (BLD-15) — React Compiler Hook Rules Lint Ratchet', () => {
  jest.setTimeout(30_000);

  it('(+) eslint.config.js sets all four React Compiler hook rules to error (2) for app/ and components/ without enabling reactCompiler', async () => {
    const appJson = JSON.parse(readFileSync(join(FRONTEND_ROOT, 'app.json'), 'utf8')) as {
      expo?: { experiments?: { reactCompiler?: boolean } };
    };
    expect(appJson.expo?.experiments?.reactCompiler).not.toBe(true);

    const cfgCode = stripComments(readFileSync(join(FRONTEND_ROOT, 'eslint.config.js'), 'utf8'));
    for (const r of COMPILER_HOOK_RULES) {
      expect(cfgCode).not.toContain(`'${r}': 'off'`);
    }

    const eslint = makeEslint();
    for (const target of ['app/_layout.tsx', 'components/ui/Button.tsx']) {
      const cfg = (await eslint.calculateConfigForFile(join(FRONTEND_ROOT, target))) as {
        rules?: Record<string, unknown>;
      };
      for (const ruleId of COMPILER_HOOK_RULES) {
        const entry = cfg.rules?.[ruleId];
        const severity = Array.isArray(entry) ? entry[0] : entry;
        expect({ target, ruleId, severity }).toEqual({ target, ruleId, severity: 2 });
      }
    }
  });

  it('(+) synthetic component fixture triggers set-state-in-effect, refs, and purity errors under ESLint API', async () => {
    const eslint = makeEslint();
    const fixtureCode = [
      "import React, { useEffect, useRef, useState } from 'react';",
      "import { Text } from 'react-native';",
      'export default function RatchetProbe({ next }: { next: number }) {',
      '  const [val, setVal] = useState(0);',
      '  const box = useRef(1);',
      '  useEffect(() => {',
      '    setVal(next);',
      '  }, [next]);',
      '  const now = Date.now();',
      '  return <Text>{`${val}-${box.current}-${now}`}</Text>;',
      '}',
      '',
    ].join('\n');

    const [res] = await eslint.lintText(fixtureCode, {
      filePath: join(FRONTEND_ROOT, 'components', '__ratchet_fixture__.tsx'),
    });
    const ruleIds = res.messages.map((m) => m.ruleId);
    expect(ruleIds).toContain('react-hooks/set-state-in-effect');
    expect(ruleIds).toContain('react-hooks/refs');
    expect(ruleIds).toContain('react-hooks/purity');
  });

  it('(+) eslint-suppressions.json exists, contains only the 4 compiler hook rules, references existing files, and stays <= BASELINE_TOTAL', () => {
    expect(existsSync(SUPPRESSIONS_PATH)).toBe(true);
    const raw = JSON.parse(readFileSync(SUPPRESSIONS_PATH, 'utf8')) as SuppressionsFile;
    const summary = summarizeSuppressions(raw);

    expect(summary.unexpectedRules).toEqual([]);
    expect(summary.missingFiles).toEqual([]);
    expect(summary.total).toBe(0);
    expect(summary.total).toBeLessThanOrEqual(BASELINE_TOTAL);
  });

  it('(-) ESLint CLI exits 1 on an unsuppressed violation in app/__ratchet_fixture__.tsx', () => {
    const eslintPkg = require.resolve('eslint/package.json', { paths: [FRONTEND_ROOT] });
    const eslintBin = join(dirname(eslintPkg), 'bin', 'eslint.js');

    const badSource = [
      "import React, { useEffect, useState } from 'react';",
      "import { Text } from 'react-native';",
      'export default function BadScreen({ input }: { input: number }) {',
      '  const [count, setCount] = useState(0);',
      '  useEffect(() => { setCount(input); }, [input]);',
      '  return <Text>{String(count)}</Text>;',
      '}',
      '',
    ].join('\n');

    const run = spawnSync(
      process.execPath,
      [
        eslintBin,
        '--stdin',
        '--stdin-filename',
        'app/__ratchet_fixture__.tsx',
        '--format',
        'json',
      ],
      {
        cwd: FRONTEND_ROOT,
        input: badSource,
        encoding: 'utf8',
      },
    );

    expect(run.status).toBe(1);
    const parsed = JSON.parse(run.stdout) as { messages: { ruleId: string }[] }[];
    expect(parsed[0].messages.map((m) => m.ruleId)).toContain('react-hooks/set-state-in-effect');
  });
});
