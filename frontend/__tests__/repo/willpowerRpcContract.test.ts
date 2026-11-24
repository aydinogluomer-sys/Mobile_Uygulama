/**
 * F14 static contract for `spend_willpower` RPC wiring, repository boundary,
 * generated types, and `WILLPOWER_CONTRACT` copy.
 * (REP-08, REP-09, STO-15, INT-05)
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(FRONTEND, rel), 'utf8').replace(/\r\n?/g, '\n');

function walkProdTs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry === '.expo' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkProdTs(full, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      acc.push(relative(FRONTEND, full).replace(/\\/g, '/'));
    }
  }
  return acc;
}

export function checkCapacityServiceContract(src: string): string[] {
  const code = stripComments(src);
  const issues: string[] = [];
  if (!code.includes('spendWillpower(')) issues.push('missing_spendWillpower_call');
  if (!code.includes('export const WILLPOWER_CONTRACT')) issues.push('missing_WILLPOWER_CONTRACT');
  if (!code.includes("case 'write_failed':")) issues.push('missing_write_failed_explanation');
  if (code.includes('irade geri kazan')) issues.push('stale_irade_geri_kazan_copy');
  // Absolute RMW `used: state.used + cost` is only allowed inside the missing_rpc fallback
  const outsideFallback = code.replace(/if\s*\(\s*\w+\.kind\s*===\s*'missing_rpc'\s*\)\s*\{[\s\S]*?\}/g, '');
  if (/used:\s*state\.used/.test(outsideFallback) || /active_count:\s*state\.active_count/.test(outsideFallback)) {
    issues.push('unconditional_rmw_outside_missing_rpc_fallback');
  }
  return issues;
}

describe('F14 willpower RPC & contract wiring', () => {
  it('willpowerRepository uses ignoreDuplicates upsert, explicit columns, spendWillpower RPC, and accountScope reset', () => {
    const repo = stripComments(read('repositories/willpowerRepository.ts'));
    expect(repo).toContain("onConflict: 'user_id,state_date'");
    expect(repo).toContain('ignoreDuplicates: true');
    expect(repo).toContain('WILLPOWER_STATE_COLUMNS');
    expect(repo).toContain("rpc('spend_willpower'");
    expect(repo).toContain('export function resetWillpowerRepositoryMemory');
    expect(repo).toContain('registerAccountScoped(');
  });

  it('spend_willpower RPC is called ONLY from repositories/willpowerRepository.ts', () => {
    const callers = walkProdTs(FRONTEND).filter((rel) =>
      stripComments(read(rel)).includes("rpc('spend_willpower'"),
    );
    expect(callers).toEqual(['repositories/willpowerRepository.ts']);
  });

  it('database.types.ts declares spend_willpower at 6-space indent with @source migration:042', () => {
    const dts = read('lib/database.types.ts');
    expect(dts).toContain('      // @source migration:042\n      spend_willpower: {');
    expect(dts).toContain('Args: { p_day: string; p_amount: number; p_active_delta?: number | null; p_clamp?: boolean };');
  });

  it('capacityService routes through spendWillpower, keeps missing_rpc fallback only, and removes "irade geri kazan"', () => {
    const cap = read('services/capacityService.ts');
    expect(checkCapacityServiceContract(cap)).toEqual([]);
  });

  it('negative control: checkCapacityServiceContract rejects unconditional RMW or "irade geri kazan" copy', () => {
    const badRmw = `
      export const WILLPOWER_CONTRACT = {};
      function explain() { switch (x) { case 'write_failed': return 1; } }
      export async function spend(state) {
        spendWillpower({});
        return updateWillpowerState(state.state_date, { used: state.used + 1, active_count: state.active_count + 1 });
      }
    `;
    expect(checkCapacityServiceContract(badRmw)).toContain('unconditional_rmw_outside_missing_rpc_fallback');
    expect(checkCapacityServiceContract(`${badRmw}\nconst s = 'irade geri kazan';`)).toContain(
      'stale_irade_geri_kazan_copy',
    );
  });
});
