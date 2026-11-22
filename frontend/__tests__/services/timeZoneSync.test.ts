/**
 * F15 (DB2-11 client half): silent profile time-zone sync service, repository RPC wrapper,
 * `isValidTimeZone`, account-scope reset registration, `_layout.tsx` foreground/boot hook,
 * and `privacy.tsx` disclosure.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const mockRpc = jest.fn();

jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { user: { id: 'u1' }, access_token: 'tok' } },
        error: null,
      })),
    },
  },
}));

import { isValidTimeZone } from '../../lib/date';
import { registeredAccountScopes, resetAccountMemory } from '../../lib/accountScope';
import { setProfileTimeZone } from '../../repositories/profileRepository';
import {
  resetTimeZoneSyncMemory,
  syncProfileTimeZone,
  type TimeZoneSyncDeps,
} from '../../services/timeZoneSyncService';

const FRONTEND = join(__dirname, '..', '..');

beforeEach(() => {
  mockRpc.mockReset();
  resetTimeZoneSyncMemory();
});

describe('isValidTimeZone (lib/date.ts)', () => {
  it('(+) accepts canonical IANA time zones within 1..64 chars', () => {
    for (const z of ['Europe/Istanbul', 'America/New_York', 'Pacific/Auckland', 'UTC']) {
      expect(isValidTimeZone(z)).toBe(true);
    }
  });

  it('(-) rejects null, empty, whitespace, unknown names, and >64-char strings', () => {
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('   ')).toBe(false);
    expect(isValidTimeZone('Mars/Phobos')).toBe(false);
    expect(isValidTimeZone('A'.repeat(65))).toBe(false);
  });
});

describe('setProfileTimeZone (repositories/profileRepository.ts)', () => {
  it('(+) calls set_profile_time_zone RPC and reports stored boolean', async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null, status: 200 });
    await expect(setProfileTimeZone('Europe/Istanbul')).resolves.toEqual({
      ok: true,
      data: { stored: true },
    });
    expect(mockRpc).toHaveBeenCalledWith('set_profile_time_zone', {
      p_time_zone: 'Europe/Istanbul',
    });

    mockRpc.mockResolvedValueOnce({ data: false, error: null, status: 200 });
    await expect(setProfileTimeZone('Europe/Istanbul')).resolves.toEqual({
      ok: true,
      data: { stored: false },
    });
  });

  it('(-) maps PostgREST / SQLSTATE / transport failures to typed kinds', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Could not find the function', code: 'PGRST202' },
      status: 404,
    });
    expect(await setProfileTimeZone('UTC')).toMatchObject({ ok: false, kind: 'missing_rpc' });

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'function does not exist', code: '42883' },
      status: 400,
    });
    expect(await setProfileTimeZone('UTC')).toMatchObject({ ok: false, kind: 'missing_rpc' });

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'time_zone_invalid', code: '22023' },
      status: 400,
    });
    expect(await setProfileTimeZone('PST')).toMatchObject({ ok: false, kind: 'invalid' });

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'authentication required', code: '42501' },
      status: 401,
    });
    expect(await setProfileTimeZone('UTC')).toMatchObject({ ok: false, kind: 'unauthenticated' });

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Network request failed', code: '' },
      status: 0,
    });
    expect(await setProfileTimeZone('UTC')).toMatchObject({ ok: false, kind: 'offline' });
  });
});

describe('syncProfileTimeZone (services/timeZoneSyncService.ts)', () => {
  function makeDeps(overrides: Partial<TimeZoneSyncDeps> = {}): TimeZoneSyncDeps & { pushMock: jest.Mock } {
    const pushMock = jest.fn(async () => ({ ok: true as const, data: { stored: true } }));
    return {
      deviceZone: () => 'Europe/Istanbul',
      currentUserId: async () => ({ ok: true, userId: 'user-a' }),
      push: pushMock,
      pushMock,
      ...overrides,
    };
  }

  it('(+) syncs on first call, skips unchanged (user, zone), and re-syncs when zone changes (travel)', async () => {
    let zone = 'Europe/Istanbul';
    const deps = makeDeps({ deviceZone: () => zone });

    await expect(syncProfileTimeZone(deps)).resolves.toEqual({
      status: 'synced',
      zone: 'Europe/Istanbul',
    });
    await expect(syncProfileTimeZone(deps)).resolves.toEqual({
      status: 'unchanged',
      zone: 'Europe/Istanbul',
    });
    expect(deps.pushMock).toHaveBeenCalledTimes(1);

    zone = 'America/New_York';
    await expect(syncProfileTimeZone(deps)).resolves.toEqual({
      status: 'synced',
      zone: 'America/New_York',
    });
    expect(deps.pushMock).toHaveBeenCalledTimes(2);
  });

  it('(+) coalesces two concurrent calls into a single RPC', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pushMock = jest.fn(async () => {
      await gate;
      return { ok: true as const, data: { stored: true } };
    });
    const deps = makeDeps({ push: pushMock });

    const p1 = syncProfileTimeZone(deps);
    const p2 = syncProfileTimeZone(deps);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ status: 'synced', zone: 'Europe/Istanbul' });
    expect(r2).toEqual({ status: 'skipped', reason: 'in_flight' });
  });

  it('(-) skips cleanly for no_zone, invalid_zone, and no_session without calling RPC', async () => {
    const d1 = makeDeps({ deviceZone: () => null });
    await expect(syncProfileTimeZone(d1)).resolves.toEqual({ status: 'skipped', reason: 'no_zone' });
    expect(d1.pushMock).not.toHaveBeenCalled();

    const d2 = makeDeps({ deviceZone: () => 'Mars/Phobos' });
    await expect(syncProfileTimeZone(d2)).resolves.toEqual({ status: 'skipped', reason: 'invalid_zone' });
    expect(d2.pushMock).not.toHaveBeenCalled();

    const d3 = makeDeps({ currentUserId: async () => ({ ok: false, error: 'Oturum bulunamadı.' }) });
    await expect(syncProfileTimeZone(d3)).resolves.toEqual({ status: 'skipped', reason: 'no_session' });
    expect(d3.pushMock).not.toHaveBeenCalled();
  });

  it('(-) remembers missing_rpc for the rest of the session and stops calling push', async () => {
    const pushMock = jest.fn(async () => ({
      ok: false as const,
      error: 'PGRST202',
      kind: 'missing_rpc' as const,
    }));
    const deps = makeDeps({ push: pushMock });

    await expect(syncProfileTimeZone(deps)).resolves.toEqual({ status: 'skipped', reason: 'rpc_missing' });
    await expect(syncProfileTimeZone(deps)).resolves.toEqual({ status: 'skipped', reason: 'rpc_missing' });
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('(-) does not memoize offline, invalid, or stored:false so the next foreground retries', async () => {
    const pushMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'offline', kind: 'offline' })
      .mockResolvedValueOnce({ ok: false, error: 'bad', kind: 'invalid' })
      .mockResolvedValueOnce({ ok: true, data: { stored: false } })
      .mockResolvedValueOnce({ ok: true, data: { stored: true } });
    const deps = makeDeps({ push: pushMock });

    await expect(syncProfileTimeZone(deps)).resolves.toEqual({ status: 'skipped', reason: 'offline' });
    await expect(syncProfileTimeZone(deps)).resolves.toEqual({ status: 'skipped', reason: 'rejected' });
    await expect(syncProfileTimeZone(deps)).resolves.toEqual({ status: 'skipped', reason: 'rejected' });
    await expect(syncProfileTimeZone(deps)).resolves.toEqual({ status: 'synced', zone: 'Europe/Istanbul' });
    expect(pushMock).toHaveBeenCalledTimes(4);
  });

  it('(+) registers in accountScope and clears memory on account reset so account B pushes its zone', async () => {
    expect(registeredAccountScopes()).toContain('profileTimeZoneSync');

    let uid = 'user-a';
    const deps = makeDeps({ currentUserId: async () => ({ ok: true, userId: uid }) });
    await expect(syncProfileTimeZone(deps)).resolves.toEqual({ status: 'synced', zone: 'Europe/Istanbul' });

    resetAccountMemory('signed_out');
    uid = 'user-b';
    await expect(syncProfileTimeZone(deps)).resolves.toEqual({ status: 'synced', zone: 'Europe/Istanbul' });
    expect(deps.pushMock).toHaveBeenCalledTimes(2);
  });

  it('(-) never throws even when collaborators throw unexpectedly', async () => {
    await expect(
      syncProfileTimeZone({
        deviceZone: () => {
          throw new Error('Intl exploded');
        },
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'no_zone' });

    await expect(
      syncProfileTimeZone({
        deviceZone: () => 'UTC',
        currentUserId: async () => ({ ok: true, userId: 'u1' }),
        push: async () => {
          throw new Error('boom');
        },
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'rejected' });
  });
});

describe('Wiring in app/_layout.tsx and app/screens/privacy.tsx', () => {
  it('wires syncProfileTimeZone in _layout.tsx and documents IANA zone in privacy.tsx while preserving Anthropic disclosure', () => {
    const layout = readFileSync(join(FRONTEND, 'app', '_layout.tsx'), 'utf8');
    expect(layout).toContain('syncProfileTimeZone');

    const privacy = readFileSync(join(FRONTEND, 'app', 'screens', 'privacy.tsx'), 'utf8');
    expect(privacy).toContain(
      'Gün ve hafta sınırlarını senin saatine göre hesaplamak için cihazının saat diliminin adı (örneğin Europe/Istanbul) hesabına kaydedilir; bu bir konum bilgisi değildir.',
    );
    expect(privacy).toContain('Anthropic');
  });
});
