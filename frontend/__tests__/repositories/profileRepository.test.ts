/**
 * F09 (DB1-11, DB1-12, DB1-04): client-side profile & leaderboard repository contract.
 *
 * - `updateUsername` strips ASCII C0/C1 control characters and `<` / `>`, trims,
 *   caps at 24 Unicode characters (preserving Turkish letters without Unicode
 *   normalisation), rejects 1-2 character names with calm Turkish copy before
 *   calling PostgREST, and maps empty input to `null` (clearing the name).
 * - `fetchOrCreateProfile` writes only `{ id, email }` (matching the narrowed
 *   column-level INSERT grant on `public.profiles`).
 * - `fetchLeaderboard` clamps `limit_val` to `1..100` for both scopes.
 * - `fetchMyRank` queries only the caller's own `target_user_id`.
 */
const mockUpdateCalls: Record<string, unknown>[] = [];
const mockInsertCalls: Record<string, unknown>[] = [];
const mockRpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

const mockState: {
  userId: string | null;
  email: string | null;
  existingProfile: Record<string, unknown> | null;
  existingError: { message: string } | null;
  createdProfile: Record<string, unknown> | null;
  createdError: { message: string } | null;
  updatedProfile: Record<string, unknown> | null;
  updateError: { message: string } | null;
  rpcData: unknown;
  rpcError: { message: string } | null;
} = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'ayse@aderyth.app',
  existingProfile: null,
  existingError: null,
  createdProfile: { id: '11111111-1111-4111-8111-111111111111', email: 'ayse@aderyth.app', username: null },
  createdError: null,
  updatedProfile: { id: '11111111-1111-4111-8111-111111111111', username: 'Ayşe_K' },
  updateError: null,
  rpcData: [],
  rpcError: null,
};

jest.mock('../../lib/session', () => ({
  currentUser: async () =>
    mockState.userId ? { id: mockState.userId, email: mockState.email } : null,
}));

jest.mock('../../repositories/shared', () => ({
  currentUserId: async () =>
    mockState.userId
      ? { ok: true, userId: mockState.userId }
      : { ok: false, error: 'Oturum açık değil.' },
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: mockState.existingProfile,
              error: mockState.existingError,
            }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          mockInsertCalls.push(payload);
          return {
            select: () => ({
              single: async () => ({
                data: mockState.createdProfile,
                error: mockState.createdError,
              }),
            }),
          };
        },
        update: (payload: Record<string, unknown>) => {
          mockUpdateCalls.push(payload);
          return {
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: mockState.updatedProfile,
                  error: mockState.updateError,
                }),
              }),
            }),
          };
        },
      };
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mockRpcCalls.push({ fn, args });
      return { data: mockState.rpcData, error: mockState.rpcError };
    },
  },
}));

import {
  fetchLeaderboard,
  fetchMyRank,
  fetchOrCreateProfile,
  updateUsername,
} from '../../repositories/profileRepository';

describe('profileRepository — F09 username shape, narrow profile insert & leaderboard bounds', () => {
  beforeEach(() => {
    mockUpdateCalls.length = 0;
    mockInsertCalls.length = 0;
    mockRpcCalls.length = 0;
    mockState.userId = '11111111-1111-4111-8111-111111111111';
    mockState.email = 'ayse@aderyth.app';
    mockState.existingProfile = null;
    mockState.existingError = null;
    mockState.createdProfile = { id: '11111111-1111-4111-8111-111111111111', email: 'ayse@aderyth.app', username: null };
    mockState.createdError = null;
    mockState.updatedProfile = { id: '11111111-1111-4111-8111-111111111111', username: 'Ayşe_K' };
    mockState.updateError = null;
    mockState.rpcData = [];
    mockState.rpcError = null;
  });

  describe('updateUsername (DB1-11)', () => {
    it('rejects 1-2 character usernames after cleaning without calling PostgREST', async () => {
      for (const short of ['a', 'ab', '  xy  ', '<a>x', '\u0001ab\u007f', '😀a']) {
        const res = await updateUsername(short);
        expect(res).toEqual({ ok: false, error: 'Kullanıcı adı en az 3 karakter olmalı.' });
      }
      expect(mockUpdateCalls).toEqual([]);
    });

    it('maps empty, whitespace-only or control/angle-only input to null (clearing the username)', async () => {
      for (const blank of ['', '   ', '<>', '\u0000\u001f\u007f\u009f', '  <\n\t>  ']) {
        mockUpdateCalls.length = 0;
        const res = await updateUsername(blank);
        expect(res.ok).toBe(true);
        expect(mockUpdateCalls).toEqual([{ username: null }]);
      }
    });

    it('strips C0/C1 control characters and angle brackets, preserves Turkish letters, and caps at 24 characters', async () => {
      const res1 = await updateUsername('  <\u0001Çağrı_Şahin_İĞÜÖ\u0085>  ');
      expect(res1.ok).toBe(true);
      expect(mockUpdateCalls[0]).toEqual({ username: 'Çağrı_Şahin_İĞÜÖ' });

      const long = 'ÇalışkanSavaşçı_1234567890_ekstra';
      await updateUsername(long);
      const sent = mockUpdateCalls[1].username as string;
      expect(Array.from(sent).length).toBe(24);
      expect(sent).toBe('ÇalışkanSavaşçı_12345678');
    });

    it('re-trims after slicing so a space at position 24 never violates btrim(username) on the server', async () => {
      await updateUsername(`abc${' '.repeat(21)}z`);
      expect(mockUpdateCalls[0]).toEqual({ username: 'abc' });

      const tooShortAfterSlice = await updateUsername(`ab${' '.repeat(22)}z`);
      expect(tooShortAfterSlice).toEqual({ ok: false, error: 'Kullanıcı adı en az 3 karakter olmalı.' });
      expect(mockUpdateCalls).toHaveLength(1);
    });

    it('fails closed when signed out or when no profile row exists', async () => {
      mockState.userId = null;
      const signedOut = await updateUsername('Ayşe_K');
      expect(signedOut.ok).toBe(false);
      expect(mockUpdateCalls).toEqual([]);

      mockState.userId = '11111111-1111-4111-8111-111111111111';
      mockState.updatedProfile = null;
      const missing = await updateUsername('Ayşe_K');
      expect(missing).toEqual({ ok: false, error: 'Profil bulunamadı.' });
    });
  });

  describe('fetchOrCreateProfile (DB1-12)', () => {
    it('inserts only id and email when the profile row is missing', async () => {
      const res = await fetchOrCreateProfile();
      expect(res.ok).toBe(true);
      expect(mockInsertCalls).toEqual([
        { id: '11111111-1111-4111-8111-111111111111', email: 'ayse@aderyth.app' },
      ]);
    });
  });

  describe('fetchLeaderboard & fetchMyRank (DB1-04 / DB2-05 / REP-03)', () => {
    it('clamps leaderboard limit into 1..100 for both global and weekly scopes', async () => {
      await fetchLeaderboard('global', 0);
      await fetchLeaderboard('weekly', 5000);
      await fetchLeaderboard('global');
      expect(mockRpcCalls).toEqual([
        { fn: 'get_global_leaderboard', args: { limit_val: 1 } },
        { fn: 'get_weekly_leaderboard', args: { limit_val: 100 } },
        { fn: 'get_global_leaderboard', args: { limit_val: 50 } },
      ]);
    });

    it('passes the signed-in caller userId to get_user_rank and handles empty rows', async () => {
      mockState.rpcData = [];
      const unranked = await fetchMyRank();
      expect(unranked).toEqual({ ok: true, data: null });
      expect(mockRpcCalls[0]).toEqual({
        fn: 'get_user_rank',
        args: { target_user_id: '11111111-1111-4111-8111-111111111111' },
      });

      mockState.rpcData = [{ rank: 7, total_xp: 120, level: 2 }];
      const ranked = await fetchMyRank();
      expect(ranked).toEqual({ ok: true, data: 7 });
    });
  });
});
