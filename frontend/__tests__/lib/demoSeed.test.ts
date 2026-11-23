/**
 * L1 tests for the demo seeder guard.  (tasks DEMO-001A / DEMO-001B)
 *
 * AC-S01  isSeedingAllowed() follows __DEV__
 * AC-S02  seedDemoData() refuses in a release build
 * AC-S03  the refusal happens BEFORE any database call
 * AC-S04  the guard still permits seeding in development
 * AC-S05  app/** exposes no seeder entry point that is not itself guarded
 *
 * seedDemoData() writes 630 lines' worth of fabricated projects, tasks,
 * habits, logs, recovery plans and journal entries into whatever account is
 * signed in. Settings offered it as an ordinary row with no gate, so in a
 * release build one tap contaminates a real user's data with demo records that
 * are indistinguishable from their own.
 *
 * AC-S03 is the one that matters. A guard that refuses after issuing the first
 * insert has not prevented anything, so the test asserts the supabase client
 * was never touched -- not merely that the call reported failure.
 *
 * Written BEFORE the fix and observed to fail, per R-01.
 */
const mockSupabaseCalls: string[] = [];

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async function (this: any) {
        // The repository layer resolves the user id from the LOCAL session
        // rather than paying a network round trip per query. Derived from
        // this mock's own getUser so both stay in step.
        const r = await this.getUser();
        return { data: { session: r.data.user ? { user: r.data.user, access_token: 'test-jwt' } : null } };
      },
      getUser: jest.fn(async () => {
        mockSupabaseCalls.push('auth.getUser');
        return { data: { user: { id: 'u1' } } };
      }),
    },
    from: (table: string) => {
      mockSupabaseCalls.push(`from:${table}`);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'order', 'limit']) {
        chain[m] = () => chain;
      }
      chain.then = (onOk: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(onOk);
      chain.single = async () => ({ data: null, error: null });
      chain.maybeSingle = async () => ({ data: null, error: null });
      return chain;
    },
  },
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import { rendersKey } from '../helpers/catalog';
import { isSeedingAllowed, seedDemoData } from '../../lib/demoSeed';

declare const global: { __DEV__: boolean };

const REAL_DEV = global.__DEV__;

beforeEach(() => { mockSupabaseCalls.length = 0; });
afterEach(() => { global.__DEV__ = REAL_DEV; });

describe('AC-S01 -- the predicate follows __DEV__', () => {
  it('allows seeding in a development build', () => {
    global.__DEV__ = true;
    expect(isSeedingAllowed()).toBe(true);
  });

  it('refuses in a release build', () => {
    global.__DEV__ = false;
    expect(isSeedingAllowed()).toBe(false);
  });
});

describe('AC-S02/S03 -- a release build cannot reach the database', () => {
  it('rejects rather than seeding', async () => {
    global.__DEV__ = false;
    await expect(seedDemoData()).rejects.toThrow(/geliştirme|development|__DEV__/i);
  });

  it('touches the supabase client zero times', async () => {
    global.__DEV__ = false;
    await seedDemoData().catch(() => undefined);
    expect(mockSupabaseCalls).toEqual([]);
  });
});

describe('AC-S04 -- development is unaffected', () => {
  it('proceeds far enough to talk to supabase', async () => {
    global.__DEV__ = true;
    await seedDemoData().catch(() => undefined);
    expect(mockSupabaseCalls.length).toBeGreaterThan(0);
  });
});

describe('AC-S05 -- the UI entry point is guarded too', () => {
  it('renders the Settings seeder row only under a __DEV__ check', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'app', 'tabs', 'settings.tsx'), 'utf8');

    // The row exists; it must not be reachable unconditionally.
    expect(rendersKey(src, 'settings.dev.seed.label', 'Demo verileri doldur')).toBe(true);

    const guardIdx = src.indexOf('isSeedingAllowed()');
    const rowIdx = src.indexOf("'settings.dev.seed.label'");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(rowIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(rowIdx);
  });
});
