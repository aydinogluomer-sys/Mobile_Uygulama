import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { stripComments } from '../helpers/sourceText';

const REPO = join(__dirname, '..', '..', '..');
const FUNCTIONS_DIR = join(REPO, 'supabase', 'functions');
const DENO_JSON_PATH = join(FUNCTIONS_DIR, 'deno.json');
const DENO_LOCK_PATH = join(FUNCTIONS_DIR, 'deno.lock');
const FRONTEND_SB_PKG = join(REPO, 'frontend', 'node_modules', '@supabase', 'supabase-js', 'package.json');

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out.sort();
}

const IMPORT_RE = /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

export function findUnpinnedSpecifiers(source: string, allowedBareKeys: ReadonlySet<string>): string[] {
  const code = stripComments(source);
  const bad: string[] = [];
  for (const m of code.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? '';
    if (!spec) continue;
    if (
      spec.includes('esm.sh') ||
      spec.includes('deno.land/std') ||
      /^https?:\/\//i.test(spec) ||
      /^jsr:/i.test(spec) ||
      /^npm:/i.test(spec)
    ) {
      bad.push(`forbidden-inline:${spec}`);
      continue;
    }
    if (!spec.startsWith('./') && !spec.startsWith('../')) {
      if (!allowedBareKeys.has(spec)) {
        bad.push(`undeclared-bare:${spec}`);
      }
    }
  }
  return bad;
}

export function findRangePins(importsMap: Record<string, string>): string[] {
  const bad: string[] = [];
  for (const [key, target] of Object.entries(importsMap)) {
    if (!/^(?:jsr|npm):.+@\d+\.\d+\.\d+$/.test(target)) {
      bad.push(`${key}->${target}`);
    }
  }
  return bad;
}

describe('F21 (EDG-10, BLD-06) — Edge Function imports pinned via deno.json + deno.lock', () => {
  it('(+) deno.json and deno.lock exist, parse cleanly, pin exact semver, and match frontend @supabase/supabase-js', () => {
    expect(existsSync(DENO_JSON_PATH)).toBe(true);
    expect(existsSync(DENO_LOCK_PATH)).toBe(true);

    const denoConfig = JSON.parse(readFileSync(DENO_JSON_PATH, 'utf8')) as {
      imports?: Record<string, string>;
      tasks?: Record<string, string>;
      lock?: { path?: string };
    };
    const lockJson = JSON.parse(readFileSync(DENO_LOCK_PATH, 'utf8')) as Record<string, unknown>;
    expect(typeof lockJson.version).toBe('string');

    const imports = denoConfig.imports ?? {};
    expect(Object.keys(imports).length).toBeGreaterThanOrEqual(2);
    expect(findRangePins(imports)).toEqual([]);

    const frontendSbVersion = (JSON.parse(readFileSync(FRONTEND_SB_PKG, 'utf8')) as { version: string }).version;
    expect(imports['@supabase/supabase-js']).toBe(`jsr:@supabase/supabase-js@${frontendSbVersion}`);
    expect(imports['@anthropic-ai/sdk']).toMatch(/^npm:@anthropic-ai\/sdk@\d+\.\d+\.\d+$/);
  });

  it('(+) every .ts file under supabase/functions (including _test.ts) uses only relative or deno.json bare specifiers', () => {
    const denoConfig = JSON.parse(readFileSync(DENO_JSON_PATH, 'utf8')) as { imports: Record<string, string> };
    const allowedBare = new Set(Object.keys(denoConfig.imports));
    const files = walkTs(FUNCTIONS_DIR);
    expect(files.length).toBeGreaterThanOrEqual(16);

    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(FUNCTIONS_DIR, file).split(sep).join('/');
      const raw = readFileSync(file, 'utf8');
      const code = stripComments(raw);
      for (const problem of findUnpinnedSpecifiers(raw, allowedBare)) {
        violations.push(`${rel}: ${problem}`);
      }
      if (/esm\.sh|deno\.land\/std/.test(code)) {
        violations.push(`${rel}: forbidden-cdn-host`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('(-) scanner catches deno.land/std, esm.sh, inline jsr:/npm:, undeclared bare imports, and caret/major range pins', () => {
    const allowed = new Set(['@supabase/supabase-js', '@anthropic-ai/sdk']);
    const legacySample = [
      "import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';",
      "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';",
      "import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';",
      "import { foo } from 'undeclared-pkg';",
    ].join('\n');

    expect(findUnpinnedSpecifiers(legacySample, allowed)).toEqual([
      'forbidden-inline:https://deno.land/std@0.168.0/http/server.ts',
      'forbidden-inline:https://esm.sh/@supabase/supabase-js@2',
      'forbidden-inline:npm:@anthropic-ai/sdk@0.39.0',
      'undeclared-bare:undeclared-pkg',
    ]);

    expect(
      findRangePins({
        '@supabase/supabase-js': 'jsr:@supabase/supabase-js@^2.119.2',
        '@anthropic-ai/sdk': 'npm:@anthropic-ai/sdk@2',
      }),
    ).toEqual([
      '@supabase/supabase-js->jsr:@supabase/supabase-js@^2.119.2',
      '@anthropic-ai/sdk->npm:@anthropic-ai/sdk@2',
    ]);
  });
});
