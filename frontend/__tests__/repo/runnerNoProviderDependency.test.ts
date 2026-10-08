/**
 * R05.08 — "sağlayıcı/müzik bağlantısı temel runner'ın bağımlılığı olmasın."
 * The routine runner's whole local import graph (screen -> store -> lib)
 * reaches no music, AI-provider or OAuth module: the runner works with every
 * integration gate off and no network.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join, normalize, relative } from 'path';

const ROOT = join(__dirname, '..', '..');
const ENTRY = ['app/screens/routine-runner.tsx', 'store/routineRunnerStore.ts', 'lib/routineRunner.ts'];

function resolve(fromRel: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = normalize(join(dirname(join(ROOT, fromRel)), spec));
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) if (existsSync(base + ext)) return relative(ROOT, base + ext).replace(/\\/g, '/');
  return null;
}
function graph(): Set<string> {
  const seen = new Set<string>();
  const stack = [...ENTRY];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(join(ROOT, f), 'utf8');
    // `import x from '..'`, `export * from '..'` and a bare `import '..'`
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
      const r = resolve(f, m[1]);
      if (r) stack.push(r);
    }
  }
  return seen;
}

it('the runner reaches no music, AI-provider or OAuth module', () => {
  const g = [...graph()];
  expect(g.length).toBeGreaterThan(5);
  const bad = g.filter((f) => /spotify|music|notion|google|calendar|aiInvoke|aiCoach|generate|oauth|edgeCall/i.test(f));
  expect(bad).toEqual([]);
});
