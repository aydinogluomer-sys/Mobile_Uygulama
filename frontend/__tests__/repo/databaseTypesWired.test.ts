import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const REPO_DIR = join(ROOT, 'repositories');

describe('Canonical Supabase <Database> typing & hardware auth storage wiring', () => {
  const supabaseSrc = stripComments(readFileSync(join(ROOT, 'lib', 'supabase.ts'), 'utf8'));
  const dbTypesSrc = readFileSync(join(ROOT, 'lib', 'database.types.ts'), 'utf8');

  it('wires createClient<Database> and encrypted authStorage in lib/supabase.ts', () => {
    expect(supabaseSrc).toMatch(/createClient<Database>\s*\(/);
    expect(supabaseSrc).toMatch(/storage:\s*authStorage\b/);
    expect(supabaseSrc).not.toMatch(/storage:\s*AsyncStorage\b/);
  });

  it('defines every table referenced across frontend/repositories/*.ts in Database.public.Tables', () => {
    const tablesBlock = dbTypesSrc.split('Tables: {')[1]?.split('Views:')[0] ?? '';
    const definedTables = new Set(
      [...tablesBlock.matchAll(/^\s{6}([a-z0-9_]+):\s*\{/gm)].map((m) => m[1]),
    );
    expect(definedTables.size).toBeGreaterThanOrEqual(34);

    const referencedTables = new Set<string>();
    for (const file of readdirSync(REPO_DIR).filter((f) => f.endsWith('.ts'))) {
      const src = stripComments(readFileSync(join(REPO_DIR, file), 'utf8'));
      for (const m of src.matchAll(/\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)/g)) {
        referencedTables.add(m[1]);
      }
      for (const m of src.matchAll(/table:\s*['"]([a-z0-9_]+)['"]/g)) {
        referencedTables.add(m[1]);
      }
      for (const m of src.matchAll(
        /(?:insertOwnedWithId|updateOwned|updateOwnedVersioned|deleteOwned|deleteOwnedIfPresent|fetchOwnedRow)(?:<[\s\S]*?>)?\(\s*['"]([a-z0-9_]+)['"]/g,
      )) {
        referencedTables.add(m[1]);
      }
    }

    const missing = [...referencedTables].filter((t) => !definedTables.has(t));
    expect(missing).toEqual([]);
  });

  it('defines every RPC referenced across frontend/repositories/*.ts in Database.public.Functions', () => {
    const fnsBlock = dbTypesSrc.split('Functions: {')[1]?.split('Enums:')[0] ?? '';
    const definedFns = new Set(
      [...fnsBlock.matchAll(/^\s{6}([a-z0-9_]+):\s*\{/gm)].map((m) => m[1]),
    );

    const referencedFns = new Set<string>();
    for (const file of readdirSync(REPO_DIR).filter((f) => f.endsWith('.ts'))) {
      const src = stripComments(readFileSync(join(REPO_DIR, file), 'utf8'));
      for (const m of src.matchAll(/\.rpc\(\s*['"]([a-z0-9_]+)['"]/g)) {
        referencedFns.add(m[1]);
      }
    }

    const missing = [...referencedFns].filter((fn) => !definedFns.has(fn));
    expect(missing).toEqual([]);
  });

  it('names the real drift guard and carries a provenance tag on every table and RPC', () => {
    const header = dbTypesSrc.split('export type Json')[0] ?? '';
    expect(header).toContain('databaseTypesDrift.test.ts');

    const tablesBlock = dbTypesSrc.split('Tables: {')[1]?.split('Views:')[0] ?? '';
    const fnsBlock = dbTypesSrc.split('Functions: {')[1]?.split('Enums:')[0] ?? '';
    const definedTables = [...tablesBlock.matchAll(/^\s{6}([a-z0-9_]+):\s*\{/gm)];
    const definedFns = [...fnsBlock.matchAll(/^\s{6}([a-z0-9_]+):\s*\{/gm)];
    const memberTags = [
      ...tablesBlock.matchAll(/^\s{6}\/\/\s*@source\s+(?:live|migration:\d{3})\s*$/gm),
      ...fnsBlock.matchAll(/^\s{6}\/\/\s*@source\s+(?:live|migration:\d{3})\s*$/gm),
    ];

    expect(memberTags.length).toBeGreaterThanOrEqual(77);
    expect(memberTags.length).toBe(definedTables.length + definedFns.length);
  });
});

