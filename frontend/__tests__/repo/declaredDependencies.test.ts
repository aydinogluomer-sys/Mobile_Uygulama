import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { builtinModules } from 'module';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');

const BUILTINS: ReadonlySet<string> = new Set(
  builtinModules.flatMap((m) => [m, m.replace(/^node:/, '')]),
);

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

export function undeclaredRequires(source: string, declared: ReadonlySet<string>): string[] {
  const code = stripComments(source);
  const found = new Set<string>();

  const requireRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of code.matchAll(requireRe)) {
    const pkg = packageNameFromSpecifier(match[1]);
    if (pkg && !declared.has(pkg)) found.add(pkg);
  }

  const importFromRe = /(?:^|[;\n])\s*import\s+(?:type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(importFromRe)) {
    const pkg = packageNameFromSpecifier(match[1]);
    if (pkg && !declared.has(pkg)) found.add(pkg);
  }

  const sideEffectImportRe = /(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(sideEffectImportRe)) {
    const pkg = packageNameFromSpecifier(match[1]);
    if (pkg && !declared.has(pkg)) found.add(pkg);
  }

  return [...found].sort();
}

function walkScriptFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkScriptFiles(full, out);
    } else if (/\.(?:c|m)?js$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('BLD-09 — all tooling/config imports and tsconfig types are explicitly declared in package.json', () => {
  const pkgJson = JSON.parse(readFileSync(join(FRONTEND, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = new Set<string>([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.devDependencies ?? {}),
  ]);

  const rootToolingFiles = [
    'metro.config.js',
    'eslint.config.js',
    'jest.config.js',
    'jest.setup.js',
    'jest.globalSetup.js',
    'run-tests.js',
  ].map((f) => join(FRONTEND, f));

  const scriptFiles = walkScriptFiles(join(FRONTEND, 'scripts'));
  const allTargets = [...rootToolingFiles, ...scriptFiles].filter((f) => existsSync(f));

  it('(+) scans all expected root config and script files', () => {
    expect(allTargets.length).toBeGreaterThanOrEqual(6);
  });

  it('(+) every require/import in root config files and scripts/ is declared in dependencies or devDependencies', () => {
    const missingByFile: Record<string, string[]> = {};
    for (const file of allTargets) {
      const missing = undeclaredRequires(readFileSync(file, 'utf8'), declared);
      if (missing.length > 0) {
        const rel = file.slice(FRONTEND.length + 1).replace(/\\/g, '/');
        missingByFile[rel] = missing;
      }
    }
    expect(missingByFile).toEqual({});
  });

  it('(+) tsconfig.json compilerOptions.types entries have matching @types/* declarations', () => {
    const tsconfig = JSON.parse(readFileSync(join(FRONTEND, 'tsconfig.json'), 'utf8')) as {
      compilerOptions?: { types?: string[] };
    };
    const types = tsconfig.compilerOptions?.types ?? [];
    expect(types.length).toBeGreaterThan(0);

    const missingTypes = types
      .map((t) => (t.startsWith('@types/') ? t : `@types/${t}`))
      .filter((typePkg) => !declared.has(typePkg));
    expect(missingTypes).toEqual([]);
  });

  it('(+) @babel/runtime required by jest.config.js modulePaths bridge is declared', () => {
    const jestCfg = readFileSync(join(FRONTEND, 'jest.config.js'), 'utf8');
    if (jestCfg.includes('modulePaths')) {
      expect(declared.has('@babel/runtime')).toBe(true);
    }
  });

  it('(-) undeclaredRequires() catches synthetic undeclared bare and scoped packages while ignoring builtins and relatives', () => {
    const synthetic = [
      "const fs = require('fs');",
      "const p = require('node:path');",
      "const local = require('./local-helper');",
      "const a = require('undeclared-pkg');",
      "const b = require('@undeclared/scoped/subpath');",
      "import something from 'another-undeclared/deep';",
      "// require('commented-out-pkg')",
    ].join('\n');
    expect(undeclaredRequires(synthetic, declared)).toEqual([
      '@undeclared/scoped',
      'another-undeclared',
      'undeclared-pkg',
    ]);
  });
});
