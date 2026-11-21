/**
 * F08 (BLD-10, PRF-22) — every production dependency in `frontend/package.json` is either imported
 * by first-party source, declared as an `app.json` config plugin, or listed in the minimal Expo/RN
 * runtime peer allowlist; retired packages and unused font assets stay removed.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { builtinModules } from 'module';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');

const BUILTINS: ReadonlySet<string> = new Set(
  builtinModules.flatMap((m) => [m, m.replace(/^node:/, '')]),
);

/**
 * Runtime/peer packages required by Expo Router / React Native / Web entrypoints even when not
 * imported directly by application `.ts`/`.tsx` files (implementation.md F08 step 42).
 */
const PEER_ALLOWLIST: ReadonlySet<string> = new Set([
  'expo',
  'react',
  'react-native',
  'expo-constants',
  'react-native-screens',
  'expo-system-ui',
  'expo-status-bar',
  'expo-asset',
  'expo-font',
  'expo-splash-screen',
  'react-dom',
  'react-native-web',
  'expo-symbols',
]);

const RETIRED_DEPENDENCIES: readonly string[] = [
  'react-native-reanimated',
  'react-native-worklets',
  'react-native-gesture-handler',
  'react-native-gifted-charts',
  'expo-device',
  'react-native-dotenv',
  'react-native-animatable',
];

function packageNameFromSpecifier(specifier: string): string | null {
  const trimmed = specifier.trim();
  if (!trimmed || trimmed.startsWith('.') || trimmed.startsWith('/') || trimmed.startsWith('node:')) {
    return null;
  }
  if (trimmed.startsWith('@')) {
    const parts = trimmed.split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    const scoped = `${parts[0]}/${parts[1]}`;
    return BUILTINS.has(scoped) ? null : scoped;
  }
  const bare = trimmed.split('/')[0];
  if (!bare || BUILTINS.has(bare)) return null;
  return bare;
}

/** Extracts bare/scoped npm package names referenced via import/export-from/require in source files. */
export function usedPackages(files: readonly { path: string; text: string }[]): Set<string> {
  const used = new Set<string>();
  const fromRe = /(?:^|[;\n])\s*(?:import|export)\s+(?:type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g;
  const sideEffectRe = /(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g;
  const requireRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const dynamicImportRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const file of files) {
    const code = stripComments(file.text);
    for (const re of [fromRe, sideEffectRe, requireRe, dynamicImportRe]) {
      for (const m of code.matchAll(re)) {
        const pkg = packageNameFromSpecifier(m[1]);
        if (pkg) used.add(pkg);
      }
    }
  }
  return used;
}

function collectSourceFiles(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const dirs = ['app', 'components', 'constants', 'hooks', 'lib', 'repositories', 'services', 'store'];
  const walk = (dir: string, rel: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const abs = join(dir, entry);
      const nextRel = `${rel}/${entry}`;
      if (statSync(abs).isDirectory()) {
        walk(abs, nextRel);
      } else if (/\.(?:c|m)?[jt]sx?$/.test(entry)) {
        out.push({ path: nextRel, text: readFileSync(abs, 'utf8') });
      }
    }
  };
  for (const d of dirs) walk(join(FRONTEND, d), d);
  return out;
}

function unusedProductionDependencies(
  deps: readonly string[],
  used: ReadonlySet<string>,
  plugins: ReadonlySet<string>,
  allowlist: ReadonlySet<string>,
): string[] {
  return deps.filter((dep) => !used.has(dep) && !plugins.has(dep) && !allowlist.has(dep)).sort();
}

describe('BLD-10 / PRF-22 — no dead production dependencies or unused SpaceMono font', () => {
  const pkg = JSON.parse(readFileSync(join(FRONTEND, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const appJson = JSON.parse(readFileSync(join(FRONTEND, 'app.json'), 'utf8')) as {
    expo?: { plugins?: (string | [string, unknown])[] };
  };
  const plugins = new Set<string>(
    (appJson.expo?.plugins ?? [])
      .map((p) => (Array.isArray(p) ? p[0] : p))
      .map((s) => packageNameFromSpecifier(s))
      .filter((s): s is string => Boolean(s)),
  );
  const files = collectSourceFiles();
  const used = usedPackages(files);
  const prodDeps = Object.keys(pkg.dependencies ?? {});

  it('(+) scans the application source tree and finds real package imports', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(used.has('@supabase/supabase-js')).toBe(true);
    expect(used.has('zustand')).toBe(true);
  });

  it('(+) every package in dependencies is imported in source, registered in app.json plugins, or in the peer allowlist', () => {
    expect(unusedProductionDependencies(prodDeps, used, plugins, PEER_ALLOWLIST)).toEqual([]);
  });

  it('(+) retired packages are absent from dependencies and @expo/ngrok lives in devDependencies', () => {
    for (const retired of RETIRED_DEPENDENCIES) {
      expect(pkg.dependencies?.[retired]).toBeUndefined();
      expect(pkg.devDependencies?.[retired]).toBeUndefined();
    }
    expect(pkg.dependencies?.['@expo/ngrok']).toBeUndefined();
    expect(pkg.devDependencies?.['@expo/ngrok']).toBeDefined();
  });

  it('(+) unused SpaceMono-Regular.ttf font asset is removed', () => {
    expect(existsSync(join(FRONTEND, 'assets', 'fonts', 'SpaceMono-Regular.ttf'))).toBe(false);
  });

  it('(-) flags a synthetic unused dependency and ignores commented-out imports', () => {
    const synthUsed = usedPackages([
      {
        path: 'app/fake.tsx',
        text: [
          "// import Reanimated from 'react-native-reanimated';",
          "import { View } from 'react-native';",
          "const d = require('date-fns');",
        ].join('\n'),
      },
    ]);
    expect(synthUsed.has('react-native-reanimated')).toBe(false);
    expect(synthUsed.has('date-fns')).toBe(true);
    expect(
      unusedProductionDependencies(
        ['date-fns', 'synthetic-unused-pkg'],
        synthUsed,
        new Set(),
        PEER_ALLOWLIST,
      ),
    ).toEqual(['synthetic-unused-pkg']);
  });
});
