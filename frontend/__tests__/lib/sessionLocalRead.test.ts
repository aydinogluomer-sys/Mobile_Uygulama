/**
 * "Am I signed in" costs nothing.
 *
 * `supabase.auth.getUser()` issues `GET /auth/v1/user` on every call — it is
 * a network round trip, not a property read. Eleven UI call sites used it for
 * a render guard, three of them in `weekly-review.tsx` alone. Measured
 * against the live project while fixing the same thing in the repository
 * layer: three calls cost three auth requests and 373 ms; three `getSession()`
 * reads cost none.
 *
 * Two tests, of two different kinds. The behaviour tests say `currentUser`
 * reads locally and never throws. The source gate says nobody quietly goes
 * back to `getUser()` — which is the actual failure mode, because the code
 * that does it looks completely ordinary.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const mockGetSession = jest.fn();
const mockGetUser = jest.fn();

jest.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: (...a: unknown[]) => mockGetSession(...a), getUser: (...a: unknown[]) => mockGetUser(...a) } },
}));

import { currentUser, isSignedIn } from '../../lib/session';

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetUser.mockReset();
});

describe('currentUser reads the local session', () => {
  it('returns the id and email without touching getUser', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1', email: 'a@b.c' } } } });

    await expect(currentUser()).resolves.toEqual({ id: 'u1', email: 'a@b.c' });
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('a missing email is null, not undefined', async () => {
    // It reaches `setEmail(u?.email ?? '')` in the settings modal; undefined
    // and null behave the same there, but the type says which one it is.
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    await expect(currentUser()).resolves.toEqual({ id: 'u1', email: null });
  });

  it('no session is null', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(currentUser()).resolves.toBeNull();
  });

  it('a session without a user id is null, not a half-built object', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: {} } } });
    await expect(currentUser()).resolves.toBeNull();
  });

  it('a thrown storage read is null, not an exception into a render path', async () => {
    mockGetSession.mockRejectedValue(new Error('AsyncStorage unavailable'));
    await expect(currentUser()).resolves.toBeNull();
  });

  it('isSignedIn follows it', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    await expect(isSignedIn()).resolves.toBe(true);
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(isSignedIn()).resolves.toBe(false);
  });

  it('one call is one local read, not a round trip per caller', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    await Promise.all([currentUser(), currentUser(), currentUser()]);
    expect(mockGetSession).toHaveBeenCalledTimes(3);
    expect(mockGetUser).toHaveBeenCalledTimes(0);
  });
});

describe('nothing in the UI goes back to getUser()', () => {
  const ROOT = join(__dirname, '..', '..');
  const files: { rel: string; code: string }[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (e.name === '__tests__') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(`${dir}/${e.name}`, r); continue; }
      if (/\.tsx?$/.test(e.name)) files.push({ rel: `${dir}/${e.name}`, code: stripComments(readFileSync(join(ROOT, dir, e.name), 'utf8')) });
    }
  };
  walk('app', ''); walk('components', ''); walk('store', ''); walk('repositories', ''); walk('services', '');

  it('finds the source (scanner sanity)', () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it('no screen, component, store, repository or service calls it', () => {
    const offenders = files.filter((f) => /auth\s*\.\s*getUser\s*\(/.test(f.code));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it('lib/session.ts is the one place that answers the question', () => {
    const code = stripComments(readFileSync(join(ROOT, 'lib', 'session.ts'), 'utf8'));
    expect(code).toContain('supabase.auth.getSession()');
    expect(code).not.toMatch(/auth\s*\.\s*getUser\s*\(/);
  });
});
