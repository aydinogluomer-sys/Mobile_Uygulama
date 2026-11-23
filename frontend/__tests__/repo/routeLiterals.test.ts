import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { readSource, stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');

export type RouteTable = {
  patterns: RegExp[];
};

export type RouteLiteral = {
  file: string;
  line: number;
  literal: string;
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildRouteTable(appFiles: readonly string[]): RouteTable {
  const regexStrings = new Set<string>();

  for (const rawFile of appFiles) {
    const norm = rawFile.replace(/\\/g, '/').replace(/^app\//, '');
    if (!/\.(?:tsx|ts|jsx|js)$/.test(norm)) continue;
    const withoutExt = norm.replace(/\.(?:tsx|ts|jsx|js)$/, '');
    const segments = withoutExt.split('/').filter(Boolean);
    if (segments.length === 0) continue;
    const last = segments[segments.length - 1];
    if (last === '_layout' || last === '+html') continue;
    if (last === '+not-found') continue;

    // Each `(group)` segment can be omitted OR written explicitly in expo-router
    let variants: string[][] = [[]];
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (i === segments.length - 1 && seg === 'index') {
        continue;
      }
      if (/^\([^)]+\)$/.test(seg)) {
        variants = variants.flatMap((v) => [v, [...v, escapeRe(seg)]]);
      } else if (/^\[\.\.\.[^\]]+\]$/.test(seg)) {
        variants = variants.map((v) => [...v, '.+']);
      } else if (/^\[[^\]]+\]$/.test(seg)) {
        variants = variants.map((v) => [...v, '[^/]+']);
      } else {
        variants = variants.map((v) => [...v, escapeRe(seg)]);
      }
    }

    for (const v of variants) {
      const pattern = v.length === 0 ? '^/$' : `^/${v.join('/')}/?$`;
      regexStrings.add(pattern);
    }
  }

  return {
    patterns: [...regexStrings].map((s) => new RegExp(s)),
  };
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

export function extractRouteLiterals(source: string, file: string): RouteLiteral[] {
  const code = stripComments(source);
  const out: RouteLiteral[] = [];

  const patterns: RegExp[] = [
    /\brouter\.(?:push|replace|navigate)\(\s*(['"`])(\/[^'"`]*)\1/g,
    /\bpathname\s*:\s*(['"`])(\/[^'"`]*)\1/g,
    /<(?:Link|Redirect)\b[^>]*?\bhref=\{\s*(['"`])(\/[^'"`]*)\1\s*\}/g,
    /<(?:Link|Redirect)\b[^>]*?\bhref=(['"])(\/[^'"]*)\1/g,
  ];

  for (const re of patterns) {
    for (const m of code.matchAll(re)) {
      const literal = m[2];
      if (literal) {
        out.push({
          file,
          line: lineNumberAt(code, m.index ?? 0),
          literal,
        });
      }
    }
  }

  return out;
}

export function routeResolves(table: RouteTable, literal: string): boolean {
  const noHash = literal.split('#')[0] ?? '';
  const noQuery = noHash.split('?')[0] ?? '';
  if (!noQuery.startsWith('/')) return false;

  // Template string with `${...}`: substitute dynamic segment placeholder and verify static prefix resolves
  if (noQuery.includes('${')) {
    const substituted = noQuery.replace(/\$\{[^}]+\}/g, '__dyn__');
    if (table.patterns.some((re) => re.test(substituted))) return true;
    const prefix = noQuery.slice(0, noQuery.indexOf('${'));
    if (prefix.length > 1 && prefix.endsWith('/')) {
      const escapedPrefix = `^${escapeRe(prefix)}`;
      return table.patterns.some((re) => re.source.replace(/\\\//g, '/').startsWith(escapedPrefix));
    }
    return false;
  }

  return table.patterns.some((re) => re.test(noQuery));
}

function walkRelFiles(relDir: string): string[] {
  const abs = join(FRONTEND, relDir);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
    const childRel = `${relDir}/${entry}`;
    const childAbs = join(FRONTEND, childRel);
    if (statSync(childAbs).isDirectory()) {
      out.push(...walkRelFiles(childRel));
    } else if (/\.(?:ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(childRel);
    }
  }
  return out;
}

describe('F49 (BLD-19) — static and template route literals resolve under app/', () => {
  const appFiles = walkRelFiles('app');
  const table = buildRouteTable(appFiles);
  const scanDirs = ['app', 'components', 'hooks', 'lib', 'services', 'store', 'constants'];
  const allCodeFiles = scanDirs.flatMap((d) => walkRelFiles(d));

  it('(+) all production route literals (>= 60) resolve to existing app/ route files', () => {
    const allLiterals = allCodeFiles.flatMap((rel) =>
      extractRouteLiterals(readSource(rel), rel),
    );
    expect(allLiterals.length).toBeGreaterThanOrEqual(60);

    const unresolved = allLiterals
      .filter((r) => !routeResolves(table, r.literal))
      .map((r) => `${r.file}:${r.line} -> ${r.literal}`);
    expect(unresolved).toEqual([]);
  });

  it('(+) resolves query/hash suffixes, (auth) group syntax, and dynamic [id] routes', () => {
    const synTable = buildRouteTable([
      'app/tabs/today.tsx',
      'app/(auth)/login.tsx',
      'app/screens/item/[id].tsx',
    ]);
    expect(routeResolves(synTable, '/tabs/today?tab=a#x')).toBe(true);
    expect(routeResolves(synTable, '/login')).toBe(true);
    expect(routeResolves(synTable, '/(auth)/login')).toBe(true);
    expect(routeResolves(synTable, '/screens/item/abc-123')).toBe(true);
    expect(routeResolves(synTable, '/screens/item/${id}')).toBe(true);
  });

  it('(-) rejects missing static routes, broken template prefixes, and renamed route files', () => {
    expect(routeResolves(table, '/tabs/yok')).toBe(false);
    expect(routeResolves(table, '/screens/yok/${id}')).toBe(false);

    const withoutNotes = buildRouteTable(appFiles.filter((f) => f !== 'app/screens/notes.tsx'));
    expect(routeResolves(withoutNotes, '/screens/notes')).toBe(false);
  });
});
