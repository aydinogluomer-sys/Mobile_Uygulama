import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');

export function patchesNodeModules(scriptText: string): boolean {
  const code = stripComments(scriptText);
  if (!code.includes('node_modules')) return false;
  return /\b(writeFileSync|writeFile|appendFileSync|appendFile|copyFileSync|renameSync|rmSync|unlinkSync)\b/.test(
    code,
  );
}

function walkScripts(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkScripts(full, out);
    } else if (/\.(?:c|m)?js$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('BLD-08 — no install-time node_modules patching or expo-module-scripts shim', () => {
  const pkg = JSON.parse(readFileSync(join(FRONTEND, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it('(+) package.json has no custom postinstall script (only absent or patch-package allowed)', () => {
    const postinstall = pkg.scripts?.postinstall;
    if (postinstall !== undefined) {
      expect(postinstall.trim()).toBe('patch-package');
    } else {
      expect(postinstall).toBeUndefined();
    }
  });

  it('(+) scripts/fix-expo-tsconfig.js, scripts/reset-project.js and expo-module-scripts are gone', () => {
    expect(existsSync(join(FRONTEND, 'scripts', 'fix-expo-tsconfig.js'))).toBe(false);
    expect(existsSync(join(FRONTEND, 'scripts', 'reset-project.js'))).toBe(false);
    expect(pkg.scripts?.['reset-project']).toBeUndefined();
    expect(pkg.dependencies?.['expo-module-scripts']).toBeUndefined();
    expect(pkg.devDependencies?.['expo-module-scripts']).toBeUndefined();
  });

  it('(+) no script in frontend/scripts mutates files inside node_modules', () => {
    const offenders = walkScripts(join(FRONTEND, 'scripts'))
      .filter((f) => patchesNodeModules(readFileSync(f, 'utf8')))
      .map((f) => f.slice(FRONTEND.length + 1).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });

  it('(-) patchesNodeModules() detects synthetic node_modules mutation scripts', () => {
    const bad = [
      "const fs = require('fs');",
      "fs.writeFileSync('../node_modules/some-pkg/tsconfig.json', '{}');",
    ].join('\n');
    expect(patchesNodeModules(bad)).toBe(true);

    const benign = [
      "// Mentions node_modules in a comment only",
      "const fs = require('fs');",
      "fs.readFileSync('package.json', 'utf8');",
    ].join('\n');
    expect(patchesNodeModules(benign)).toBe(false);
  });
});
