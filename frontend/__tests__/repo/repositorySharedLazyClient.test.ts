/**
 * F00 (BLD-01 / SYN-12 / TST-21): `repositories/shared.ts` resolves the
 * supabase client on EVERY call.
 *
 * Tests swap `lib/supabase` through a getter (`get supabase() { return mock; }`)
 * and assign the mock AFTER `repositories/shared` has been required (jest.mock
 * is hoisted, the `let` assignment is not). A module-level capture such as
 * `const dynamicClient = supabase as unknown as SupabaseClient` therefore
 * freezes whatever the getter returned at load time — `undefined` — and every
 * repository call fails with "Cannot read properties of undefined (reading
 * 'from')". That is exactly how an uncommitted edit turned 22 tests red.
 *
 * Two independent proofs live here: a runtime one (the client is swapped
 * between two calls and the second call must see the new client) and a
 * source one (no module-level binding captures `supabase`, and
 * `dynamicClient` is only ever called). The source rules are pure functions
 * exercised against synthetic text as well, so a regex that silently matches
 * nothing cannot pass for a guard.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createMockDb, makeSupabaseMock, type MockDb } from '../helpers/supabaseMock';
import { stripComments } from '../helpers/sourceText';

let mockClient: ReturnType<typeof makeSupabaseMock> | undefined;

jest.mock('../../lib/supabase', () => ({
  get supabase() { return mockClient; },
}));

import { fetchOwnedRow } from '../../repositories/shared';

const MESSAGE =
  'repositories/shared.ts her çağrıda lib/supabase istemcisini çözmeli (testler istemciyi getter ile değiştirir)';

/** Module-level (column 0) bindings that capture `supabase` eagerly. */
const findEagerClientCaptures = (source: string): string[] =>
  source.match(/^(?:export\s+)?(?:const|let|var)\s+[\w$]+[^=\n]*=\s*\(?\s*supabase\b.*$/gm) ?? [];

/** `dynamicClient` tokens that are not immediately called (the declaration is one). */
const countNonCallDynamicClientTokens = (source: string): number =>
  (source.match(/\bdynamicClient\b(?!\s*\()/g) ?? []).length;

/** `dynamicClient()` call sites. */
const countDynamicClientCalls = (source: string): number =>
  (source.match(/\bdynamicClient\s*\(\)/g) ?? []).length;

const SHARED_PATH = join(__dirname, '..', '..', 'repositories', 'shared.ts');
const sharedSource = (): string => stripComments(readFileSync(SHARED_PATH, 'utf8'));

function dbWithNote(title: string): MockDb {
  const db = createMockDb();
  db.rows.notes = [{ id: 'n1', user_id: 'u1', title }];
  return db;
}

describe('repositories/shared.ts resolves the client on every call (runtime)', () => {
  afterEach(() => {
    mockClient = undefined;
  });

  it('reads from whichever client the getter returns at call time', async () => {
    mockClient = makeSupabaseMock(dbWithNote('A'));
    const first = await fetchOwnedRow<{ id: string; title: string }>({ table: 'notes', id: 'n1', columns: 'id,title' });

    mockClient = makeSupabaseMock(dbWithNote('B'));
    const second = await fetchOwnedRow<{ id: string; title: string }>({ table: 'notes', id: 'n1', columns: 'id,title' });

    expect({ first, message: MESSAGE }).toEqual({
      first: { ok: true, data: expect.objectContaining({ id: 'n1', title: 'A' }) },
      message: MESSAGE,
    });
    expect({ second, message: MESSAGE }).toEqual({
      second: { ok: true, data: expect.objectContaining({ id: 'n1', title: 'B' }) },
      message: MESSAGE,
    });
  });

  it('a row that is missing in the current client is reported as null, not served from the previous client', async () => {
    mockClient = makeSupabaseMock(dbWithNote('A'));
    await fetchOwnedRow({ table: 'notes', id: 'n1', columns: 'id,title' });

    mockClient = makeSupabaseMock(createMockDb());
    const afterSwap = await fetchOwnedRow({ table: 'notes', id: 'n1', columns: 'id,title' });

    expect(afterSwap).toEqual({ ok: true, data: null });
  });
});

describe('repositories/shared.ts source contract', () => {
  it('has no module-level binding that captures supabase', () => {
    expect({ captures: findEagerClientCaptures(sharedSource()), message: MESSAGE })
      .toEqual({ captures: [], message: MESSAGE });
  });

  it('declares dynamicClient once and only ever calls it', () => {
    const src = sharedSource();
    expect({ nonCallTokens: countNonCallDynamicClientTokens(src), message: MESSAGE })
      .toEqual({ nonCallTokens: 1, message: MESSAGE });
    expect(countDynamicClientCalls(src)).toBeGreaterThanOrEqual(1);
  });

  it('the contract comment above the declaration does not trigger a false alarm once comments are stripped', () => {
    const raw = readFileSync(SHARED_PATH, 'utf8');
    expect(raw).toMatch(/CONTRACT \(F00/);
    expect(findEagerClientCaptures(stripComments(raw))).toEqual([]);
  });
});

describe('source rules catch the regression they exist for (synthetic text)', () => {
  it('flags the eager capture that broke the suite', () => {
    expect(findEagerClientCaptures('const dynamicClient = supabase as unknown as SupabaseClient;\n')).toHaveLength(1);
  });

  it('flags other eager module-level captures', () => {
    expect(findEagerClientCaptures('const c = supabase;\n')).toHaveLength(1);
    expect(findEagerClientCaptures('export const db = supabase.from;\n')).toHaveLength(1);
    expect(findEagerClientCaptures('const typed: SupabaseClient = supabase as never;\n')).toHaveLength(1);
  });

  it('does not flag the lazy accessor, in either spelling', () => {
    expect(findEagerClientCaptures('const dynamicClient = () => supabase as unknown as SupabaseClient;\n')).toEqual([]);
    expect(findEagerClientCaptures('const dynamicClient = (): SupabaseClient => supabase as unknown as SupabaseClient;\n')).toEqual([]);
  });

  it('does not flag a commented-out eager capture after comments are stripped', () => {
    expect(findEagerClientCaptures(stripComments('// const dynamicClient = supabase as unknown as SupabaseClient;\n'))).toEqual([]);
  });

  it('counts a use of dynamicClient that is not called', () => {
    const src = 'const dynamicClient = () => supabase;\nconst q = dynamicClient.from(\'x\');\n';
    expect(countNonCallDynamicClientTokens(src)).toBeGreaterThan(1);
    expect(countDynamicClientCalls(src)).toBe(0);
  });

  it('counts only the declaration when every use is a call', () => {
    const src = 'const dynamicClient = () => supabase;\nconst q = dynamicClient().from(\'x\');\n';
    expect(countNonCallDynamicClientTokens(src)).toBe(1);
    expect(countDynamicClientCalls(src)).toBe(1);
  });
});
