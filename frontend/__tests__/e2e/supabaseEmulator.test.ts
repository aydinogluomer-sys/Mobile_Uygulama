import { BOOTSTRAP_KEYS, FIXED_NOW, USER_A, USER_B, seedFor } from '../../e2e/support/fixtures';
import { createSupabaseEmulator, fakeJwt } from '../../e2e/support/supabaseEmulator';
import { TODAY_BOOTSTRAP_KEYS } from '../../repositories/todayBootstrapRepository';

function authHeaderFor(user: { id: string; email: string }, nowMs: number): Record<string, string> {
  const jwt = fakeJwt({
    sub: user.id,
    email: user.email,
    expSeconds: Math.floor(nowMs / 1000) + 3600,
  });
  return {
    authorization: `Bearer ${jwt}`,
    apikey: 'e2e-anon-key',
    'content-type': 'application/json',
  };
}

describe('F49 — Supabase in-memory emulator contract', () => {
  const nowMs = FIXED_NOW.getTime();

  it('(+) issues a valid JWT on matching password and decodes claims cleanly', () => {
    const emu = createSupabaseEmulator(seedFor('missing'), () => nowMs);
    const res = emu.handle({
      method: 'POST',
      url: 'http://127.0.0.1:54321/auth/v1/token?grant_type=password',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: USER_A.email, password: USER_A.password }),
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as { access_token: string; user: { id: string } };
    expect(parsed.user.id).toBe(USER_A.id);

    const parts = parsed.access_token.split('.');
    expect(parts).toHaveLength(3);
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      sub: string;
      email: string;
    };
    expect(claims.sub).toBe(USER_A.id);
    expect(claims.email).toBe(USER_A.email);
  });

  it('(+) enforces per-user RLS on habits reads and records POST habit_logs writes', () => {
    const emu = createSupabaseEmulator(seedFor('missing'), () => nowMs);
    const getA = emu.handle({
      method: 'GET',
      url: 'http://127.0.0.1:54321/rest/v1/habits?select=*',
      headers: authHeaderFor(USER_A, nowMs),
      body: null,
    });
    expect(getA.status).toBe(200);
    const rowsA = JSON.parse(getA.body) as { name: string }[];
    expect(rowsA.map((r) => r.name)).toEqual(['Su iç', 'Yürüyüş']);

    const postLog = emu.handle({
      method: 'POST',
      url: 'http://127.0.0.1:54321/rest/v1/habit_logs?on_conflict=habit_id,completed_at',
      headers: {
        ...authHeaderFor(USER_A, nowMs),
        prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({
        habit_id: 'hab-a-1',
        completed_at: '2026-11-04',
        state: 'done',
      }),
    });
    expect(postLog.status).toBe(201);
    expect(emu.writes('habit_logs')).toHaveLength(1);
    expect(emu.rows('habit_logs', USER_A.id)).toHaveLength(1);
    expect(emu.unhandled()).toEqual([]);
  });

  it('(+) BOOTSTRAP_KEYS matches F48 TODAY_BOOTSTRAP_KEYS and present mode returns all 13 keys', () => {
    expect([...BOOTSTRAP_KEYS].sort()).toEqual([...TODAY_BOOTSTRAP_KEYS].sort());

    const emu = createSupabaseEmulator(seedFor('present'), () => nowMs);
    const rpcRes = emu.handle({
      method: 'POST',
      url: 'http://127.0.0.1:54321/rest/v1/rpc/get_today_bootstrap',
      headers: authHeaderFor(USER_A, nowMs),
      body: JSON.stringify({ p_today: '2026-11-04' }),
    });
    expect(rpcRes.status).toBe(200);
    const body = JSON.parse(rpcRes.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...TODAY_BOOTSTRAP_KEYS].sort());
  });

  it('(-) rejects wrong password with 400 invalid_grant', () => {
    const emu = createSupabaseEmulator(seedFor('missing'), () => nowMs);
    const res = emu.handle({
      method: 'POST',
      url: 'http://127.0.0.1:54321/auth/v1/token?grant_type=password',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: USER_A.email, password: 'wrong-password' }),
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'invalid_grant' });
  });

  it('(-) isolates USER_B from USER_A rows and rejects cross-tenant POST with 403 42501', () => {
    const emu = createSupabaseEmulator(seedFor('missing'), () => nowMs);
    const getB = emu.handle({
      method: 'GET',
      url: 'http://127.0.0.1:54321/rest/v1/habits?id=eq.hab-a-1',
      headers: authHeaderFor(USER_B, nowMs),
      body: null,
    });
    expect(getB.status).toBe(200);
    expect(JSON.parse(getB.body)).toEqual([]);

    const spoof = emu.handle({
      method: 'POST',
      url: 'http://127.0.0.1:54321/rest/v1/habit_logs',
      headers: authHeaderFor(USER_B, nowMs),
      body: JSON.stringify({
        user_id: USER_A.id,
        habit_id: 'hab-a-1',
        completed_at: '2026-11-04',
        state: 'done',
      }),
    });
    expect(spoof.status).toBe(403);
    expect(JSON.parse(spoof.body)).toMatchObject({ code: '42501' });
  });

  it('(-) flags unsupported filter operators with 501 + unhandled() and returns 404 PGRST202 on unknown RPC', () => {
    const emu = createSupabaseEmulator(seedFor('missing'), () => nowMs);
    const badFilter = emu.handle({
      method: 'GET',
      url: 'http://127.0.0.1:54321/rest/v1/habits?name=fts.su',
      headers: authHeaderFor(USER_A, nowMs),
      body: null,
    });
    expect(badFilter.status).toBe(501);
    expect(emu.unhandled()).toHaveLength(1);

    const missingRpc = emu.handle({
      method: 'POST',
      url: 'http://127.0.0.1:54321/rest/v1/rpc/get_today_bootstrap',
      headers: authHeaderFor(USER_A, nowMs),
      body: '{}',
    });
    expect(missingRpc.status).toBe(404);
    expect(JSON.parse(missingRpc.body)).toMatchObject({ code: 'PGRST202' });
  });
});
