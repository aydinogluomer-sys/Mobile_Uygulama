import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { stripComments } from '../helpers/sourceText';

type EscapeKind = 'asAny' | 'asUnknownAs' | 'asNever' | 'colonAny' | 'genericAny' | 'tsDirective' | 'eslintDisable';
type EscapeCounts = Record<EscapeKind, number>;

const PRODUCTION_DIRS = [
  'app',
  'components',
  'constants',
  'hooks',
  'lib',
  'repositories',
  'services',
  'store',
  'types',
] as const;

const PATTERNS: Readonly<Record<EscapeKind, RegExp>> = {
  asAny: /\bas any\b/g,
  asUnknownAs: /\bas unknown as\b/g,
  asNever: /\bas never\b/g,
  colonAny: /:\s*any\b/g,
  genericAny: /<any>/g,
  tsDirective: /@ts-(?:ignore|expect-error|nocheck)/g,
  eslintDisable: /eslint-disable/g, // counted on the RAW text: it only ever lives in comments
};

const ESCAPE_KINDS: readonly EscapeKind[] = [
  'asAny',
  'asUnknownAs',
  'asNever',
  'colonAny',
  'genericAny',
  'tsDirective',
  'eslintDisable',
];

function emptyCounts(): EscapeCounts {
  return {
    asAny: 0,
    asUnknownAs: 0,
    asNever: 0,
    colonAny: 0,
    genericAny: 0,
    tsDirective: 0,
    eslintDisable: 0,
  };
}

/** `eslintDisable` uses the raw text; every other kind uses stripComments(raw) (helpers/sourceText.ts). */
function countEscapes(raw: string): EscapeCounts {
  const stripped = stripComments(raw);
  const out = emptyCounts();
  for (const kind of ESCAPE_KINDS) {
    const target = kind === 'eslintDisable' ? raw : stripped;
    out[kind] = (target.match(PATTERNS[kind]) ?? []).length;
  }
  return out;
}

function walkTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTsFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function scanProduction(root: string): {
  files: number;
  total: EscapeCounts;
  byLayer: Record<string, EscapeCounts>;
} {
  let files = 0;
  const total = emptyCounts();
  const byLayer: Record<string, EscapeCounts> = {};

  for (const dir of PRODUCTION_DIRS) {
    const layerCounts = emptyCounts();
    byLayer[dir] = layerCounts;
    for (const file of walkTsFiles(join(root, dir))) {
      files += 1;
      const counts = countEscapes(readFileSync(file, 'utf8'));
      for (const kind of ESCAPE_KINDS) {
        total[kind] += counts[kind];
        layerCounts[kind] += counts[kind];
      }
    }
  }

  return { files, total, byLayer };
}

/** Returns human-readable problems: a count ABOVE its ceiling, or BELOW it ("lower the ceiling to N"). */
function ratchetProblems(
  measured: EscapeCounts,
  ceilings: Readonly<Partial<EscapeCounts>>,
  label: string,
): string[] {
  const problems: string[] = [];
  for (const kind of ESCAPE_KINDS) {
    const ceiling = ceilings[kind];
    if (ceiling === undefined) continue;
    const actual = measured[kind];
    if (actual > ceiling) {
      problems.push(`${label}.${kind}: measured ${actual} exceeds ceiling ${ceiling} (remove new type escape)`);
    } else if (actual < ceiling) {
      problems.push(`${label}.${kind}: measured ${actual} is below ceiling ${ceiling} (lower the ceiling to ${actual})`);
    }
  }
  return problems;
}

const ROOT = join(__dirname, '..', '..');

// Locked to exact post-Wave-3 production measurement (baseline: asAny 138 -> 135 after F20, asUnknownAs 62 -> 50, asNever 20 -> 17, colonAny 6 -> 5, genericAny 1, tsDirective 0, eslintDisable 14).
const CEILINGS: Readonly<EscapeCounts> = {
  asAny: 135,
  asUnknownAs: 50,
  asNever: 17,
  colonAny: 5,
  genericAny: 1,
  tsDirective: 0,
  eslintDisable: 14,
};

const LAYER_CEILINGS: Readonly<Record<'repositories' | 'store', Partial<EscapeCounts>>> = {
  repositories: {
    asUnknownAs: 46,
    asNever: 2,
  },
  store: {
    asAny: 0,
    asUnknownAs: 1,
    asNever: 0,
    colonAny: 0,
    genericAny: 1,
  },
};

describe('production type-escape ratchet', () => {
  const scan = scanProduction(ROOT);

  it('R1: scans at least 250 production TypeScript files', () => {
    expect(scan.files).toBeGreaterThanOrEqual(250);
  });

  it('R2: total escape counts match CEILINGS (ratchet only moves down)', () => {
    expect(ratchetProblems(scan.total, CEILINGS, 'total')).toEqual([]);
  });

  it('R3: repositories and store layer escape counts match LAYER_CEILINGS', () => {
    const problems = [
      ...ratchetProblems(scan.byLayer.repositories, LAYER_CEILINGS.repositories, 'repositories'),
      ...ratchetProblems(scan.byLayer.store, LAYER_CEILINGS.store, 'store'),
    ];
    expect(problems).toEqual([]);
  });

  it('R4: countEscapes strips code comments for TS escapes while counting eslint-disable in raw comments', () => {
    const sample = [
      '// const ghost = x as any; const g2 = y as unknown as Foo;',
      '/* const g3 = z as never; const g4: any = 1; */',
      '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
      'const a = foo as any;',
      'const b = bar as unknown as string;',
      'const c = baz as never;',
      'function fn(p: any): Promise<any> { return Promise.resolve(p); }',
    ].join('\n');

    expect(countEscapes(sample)).toEqual({
      asAny: 1,
      asUnknownAs: 1,
      asNever: 1,
      colonAny: 1,
      genericAny: 1,
      tsDirective: 0,
      eslintDisable: 1,
    });
  });

  it('R5: ratchetProblems fails both above (+1) and below (-1) the ceiling and reports measured value', () => {
    const base: EscapeCounts = {
      asAny: 10,
      asUnknownAs: 5,
      asNever: 2,
      colonAny: 1,
      genericAny: 0,
      tsDirective: 0,
      eslintDisable: 3,
    };
    const above = ratchetProblems({ ...base, asAny: 11 }, base, 'synthetic');
    expect(above).toHaveLength(1);
    expect(above[0]).toContain('11');

    const below = ratchetProblems({ ...base, asNever: 1 }, base, 'synthetic');
    expect(below).toHaveLength(1);
    expect(below[0]).toContain('lower the ceiling to 1');
  });

  it('R6: @ts-ignore / @ts-expect-error / @ts-nocheck ceiling is permanently zero', () => {
    expect(CEILINGS.tsDirective).toBe(0);
    expect(scan.total.tsDirective).toBe(0);
  });

  it('R7: the sole as-unknown-as in store/ is the named Node timer unref exception in willpowerStore.ts', () => {
    const hits: string[] = [];
    for (const file of walkTsFiles(join(ROOT, 'store'))) {
      const stripped = stripComments(readFileSync(file, 'utf8'));
      const lines = stripped.split('\n');
      lines.forEach((line, idx) => {
        if (/\bas unknown as\b/.test(line)) {
          const rel = relative(ROOT, file).split(sep).join('/');
          hits.push(`${rel}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/^store\/willpowerStore\.ts:\d+:.*unref/);
  });
});
