/**
 * Outbound webhook delivery.
 *
 * The legacy dispatcher was:
 *
 *     webhooks = await db.webhooks.find({"enabled": True, "event_types": event_type})
 *
 * with no owner filter, on a service with no authentication — so one user
 * completing a habit POSTed that habit's name to every OTHER user's
 * endpoint. The owner scoping now lives in RLS and in the repository; what
 * these tests pin is the behaviour around it, which is where a side channel
 * gets dangerous: it must never fail the completion that triggered it, and
 * it must never outlive the account that registered it.
 */
import { Platform } from 'react-native';
import { hmacSha256Hex } from '../../lib/hmacSha256';
import {
  targetsFor, payloadFor, deliver, dispatch, validateWebhookUrl, classifyHost,
  SIGNING_SECRET_KEY, readSigningSecret, registerWebhook, resetWebhookCache,
  type WebhookRow,
} from '../../services/webhookService';

/** F05: `deliver` retries with real 1 s / 4 s waits; these tests skip the waits, not the retries. */
const noSleep = () => Promise.resolve();

const listed: { value: { ok: boolean; data?: WebhookRow[]; error?: string } } = {
  value: { ok: true, data: [] },
};
const fetchCalls = { n: 0 };

jest.mock('../../repositories/webhookRepository', () => ({
  fetchWebhooks: jest.fn(async () => {
    fetchCalls.n++;
    return listed.value;
  }),
  insertWebhook: jest.fn(async () => ({ ok: true, data: {} })),
  deleteWebhook: jest.fn(async () => ({ ok: true, data: true })),
  setWebhookEnabled: jest.fn(async () => ({ ok: true, data: {} })),
}));

const hook = (over: Partial<WebhookRow> = {}): WebhookRow => ({
  id: 'w1', user_id: 'u1', url: 'https://ok.example/hook',
  event_types: ['habit_completed', 'task_completed'],
  headers: null, enabled: true, created_at: '2026-08-30T00:00:00Z',
  ...over,
});

beforeEach(() => {
  resetWebhookCache();
  fetchCalls.n = 0;
  listed.value = { ok: true, data: [] };
});

describe('url validation mirrors the database CHECK', () => {
  it('refuses http:// with a reason a user can act on', () => {
    const r = validateWebhookUrl('http://example.com/hook');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('https://');
  });

  it.each(['', '   ', 'ftp://x/y', 'https://has space/x', 'example.com/hook'])(
    'refuses %p', (bad) => { expect(validateWebhookUrl(bad).ok).toBe(false); },
  );

  it('accepts https and trims it', () => {
    const r = validateWebhookUrl('  https://ok.example/hook  ');
    expect(r).toEqual({ ok: true, url: 'https://ok.example/hook' });
  });
});

describe('targeting', () => {
  it('skips disabled registrations', () => {
    const rows = [hook({ id: 'a' }), hook({ id: 'b', enabled: false })];
    expect(targetsFor(rows, 'habit_completed').map((w) => w.id)).toEqual(['a']);
  });

  it('skips registrations not subscribed to the event', () => {
    const rows = [hook({ id: 'a', event_types: ['task_completed'] }), hook({ id: 'b' })];
    expect(targetsFor(rows, 'habit_completed').map((w) => w.id)).toEqual(['b']);
  });
});

describe('payload compatibility with the retired service', () => {
  it('keeps the exact envelope so existing n8n flows still parse', () => {
    const body = payloadFor('habit_completed', { habit_id: 'h1' }, new Date('2026-08-30T10:00:00Z'));
    expect(body).toEqual({
      event: 'habit_completed',
      timestamp: '2026-08-30T10:00:00.000Z',
      data: { habit_id: 'h1' },
    });
  });
});

describe('delivery cannot break the completion that triggered it', () => {
  const body = payloadFor('habit_completed', {});

  it('a rejected fetch is a value, not a throw', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('Network request failed'); }) as unknown as typeof fetch;
    // F05: a lost connection is retried (1 s, then 4 s); the waits are skipped here, the outcome is the same
    await expect(deliver(hook(), body, fetchImpl, { sleep: noSleep })).resolves.toEqual({ ok: false, error: 'Network request failed' });
  });

  it('a non-2xx response is reported, not treated as delivered', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    await expect(deliver(hook(), body, fetchImpl, { sleep: noSleep })).resolves.toEqual({ ok: false, error: 'HTTP 500' });
  });

  it('sends the configured headers, and always Content-Type', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    await deliver(hook({ headers: { Authorization: 'Bearer x' } }), body, fetchImpl);
    const init = (fetchImpl as unknown as jest.Mock).mock.calls[0][1];
    expect(init.headers).toEqual({ Authorization: 'Bearer x', 'Content-Type': 'application/json' });
    expect(init.signal).toBeDefined(); // the timeout is wired, not just declared
  });

  it('one dead endpoint does not stop the others', async () => {
    listed.value = { ok: true, data: [hook({ id: 'a', url: 'https://a.example/h' }), hook({ id: 'b', url: 'https://b.example/h' })] };
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('a.example')) throw new Error('down');
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;

    const report = await dispatch('habit_completed', { habit_id: 'h1' }, { fetchImpl, sleep: noSleep });
    expect(report.attempted).toBe(2);
    expect(report.delivered).toBe(1);
    expect(report.failed).toEqual([{ url: 'https://a.example/h', reason: 'down' }]);
  });

  it('a failed registration read sends nothing and reports nothing', async () => {
    listed.value = { ok: false, error: 'PostgREST down' };
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    const report = await dispatch('habit_completed', {}, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(report).toEqual({ attempted: 0, delivered: 0, failed: [] });
  });
});

describe('the registration cache', () => {
  it('does not re-read the table on every completion', async () => {
    listed.value = { ok: true, data: [hook()] };
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;

    await dispatch('habit_completed', {}, { fetchImpl });
    await dispatch('habit_completed', {}, { fetchImpl });
    await dispatch('task_completed', {}, { fetchImpl });

    expect(fetchCalls.n).toBe(1);
    expect((fetchImpl as unknown as jest.Mock).mock.calls).toHaveLength(3);
  });

  it('an account change drops it, so B never posts to A endpoint', async () => {
    // The cache is what makes dispatch cheap; it is also the thing that
    // could carry one account's endpoints into another's session. The reset
    // is wired to onAuthStateChange in app/_layout.tsx.
    listed.value = { ok: true, data: [hook({ url: 'https://user-a.example/h' })] };
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    await dispatch('habit_completed', {}, { fetchImpl });

    resetWebhookCache();
    listed.value = { ok: true, data: [] }; // B has none
    const report = await dispatch('habit_completed', {}, { fetchImpl });

    expect(report.attempted).toBe(0);
    expect((fetchImpl as unknown as jest.Mock).mock.calls.map((c) => c[0])).toEqual(['https://user-a.example/h']);
  });

  it('an empty list is not cached as a hit that skips later reads', async () => {
    // `if (cache)` on an empty ARRAY would be truthy; on null it is not.
    // Registering a first webhook must take effect without a restart.
    listed.value = { ok: true, data: [] };
    await dispatch('habit_completed', {}, { fetchImpl: jest.fn() as unknown as typeof fetch });
    resetWebhookCache();
    listed.value = { ok: true, data: [hook()] };
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    const report = await dispatch('habit_completed', {}, { fetchImpl });
    expect(report.attempted).toBe(1);
  });
});

describe('F46 (5.2-e) — SSRF / private-network URL validation & signed delivery', () => {
  const originalOs = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true });
  });

  const REJECTED_PRIVATE = [
    'https://localhost/x',
    'https://sub.localhost/x',
    'https://nas.local/x',
    'https://svc.internal/x',
    'https://box.lan/x',
    'https://0.0.0.1/x',
    'https://10.0.0.5/x',
    'https://172.20.1.1/x',
    'https://192.168.1.2/x',
    'https://169.254.169.254/x',
    'https://100.64.0.1/x',
    'https://127.0.0.1/x',
    'https://2130706433/x',
    'https://0x7f.1/x',
    'https://0177.0.0.1/x',
    'https://[::1]/x',
    'https://[fd00::1]/x',
    'https://[fe80::1]/x',
    'https://[::ffff:10.0.0.1]/x',
  ];

  it.each(REJECTED_PRIVATE)('(-) rejects private/loopback/link-local URL %s with calm Turkish guidance', (bad) => {
    const r = validateWebhookUrl(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(
        'Bu adres yalnızca kendi ağından erişilebilir. İnternetten ulaşılabilen bir https adresi gir.',
      );
    }
  });

  it.each([
    'https://u:p@example.com/x',
    'http://example.com/x',
    '',
    'https://example.com/ has space',
    `https://example.com/${'a'.repeat(2040)}`,
  ])('(-) rejects credentialed, non-https, whitespace, empty or >2048-char URL (%s)', (bad) => {
    expect(validateWebhookUrl(bad).ok).toBe(false);
  });

  it.each([
    'https://hooks.example.com/a',
    'https://example.com:8443/hook?x=1',
    'https://172.32.0.1/x',
    'https://[2606:4700::1111]/x',
  ])('(+) accepts public https URL %s', (good) => {
    expect(validateWebhookUrl(good)).toEqual({ ok: true, url: good });
  });

  it('(+) classifyHost distinguishes public vs private vs invalid hosts directly', () => {
    expect(classifyHost('hooks.example.com')).toBe('public');
    expect(classifyHost('172.32.0.1')).toBe('public');
    expect(classifyHost('172.16.0.1')).toBe('private');
    expect(classifyHost('172.31.255.255')).toBe('private');
    expect(classifyHost('999.1.1.1')).toBe('invalid');
  });

  it('(+) signs native deliveries with X-Aderyth-Signature: t=<unix>,v1=<hex>, strips SIGNING_SECRET_KEY, and omits custom headers on web', async () => {
    const secret = '0123456789abcdef'.repeat(4);
    const body = payloadFor('habit_completed', { habit_id: 'h1' }, new Date('2026-08-30T10:00:00Z'), 'wh1.habit_completed.h1|2026-08-30.w1');
    const w = hook({
      headers: {
        Authorization: 'Bearer pub',
        [SIGNING_SECRET_KEY]: secret,
      },
    });
    expect(readSigningSecret(w)).toBe(secret);

    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    let capturedInit: RequestInit | undefined;
    const nativeFetch = jest.fn(async (_u: string, init?: RequestInit) => {
      capturedInit = init;
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;

    const fixedMs = 1_756_548_000_999;
    const res = await deliver(w, body, nativeFetch, {
      attempts: 1,
      now: () => fixedMs,
      event: 'habit_completed',
      deliveryId: 'wh1.habit_completed.h1|2026-08-30.w1',
    });
    expect(res).toEqual({ ok: true });
    const hdrs = capturedInit?.headers as Record<string, string>;
    expect(hdrs[SIGNING_SECRET_KEY]).toBeUndefined();
    expect(hdrs.Authorization).toBe('Bearer pub');
    expect(hdrs['X-Aderyth-Event']).toBe('habit_completed');
    expect(hdrs['X-Aderyth-Delivery']).toBe('wh1.habit_completed.h1|2026-08-30.w1');

    const rawSent = String(capturedInit?.body);
    const expectedSig = `t=1756548000,v1=${hmacSha256Hex(secret, `1756548000.${rawSent}`)}`;
    expect(hdrs['X-Aderyth-Signature']).toBe(expectedSig);

    // Web: strips SIGNING_SECRET_KEY AND omits the three custom CORS-widening headers
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    let webInit: RequestInit | undefined;
    const webFetch = jest.fn(async (_u: string, init?: RequestInit) => {
      webInit = init;
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;
    await deliver(w, body, webFetch, {
      attempts: 1,
      now: () => fixedMs,
      event: 'habit_completed',
      deliveryId: 'wh1.habit_completed.h1|2026-08-30.w1',
    });
    const webHdrs = webInit?.headers as Record<string, string>;
    expect(webHdrs[SIGNING_SECRET_KEY]).toBeUndefined();
    expect(webHdrs['X-Aderyth-Event']).toBeUndefined();
    expect(webHdrs['X-Aderyth-Delivery']).toBeUndefined();
    expect(webHdrs['X-Aderyth-Signature']).toBeUndefined();
  });

  it('(+) parses Retry-After in seconds and caps at 15 minutes (900_000 ms); refuses redirects', async () => {
    const body = payloadFor('habit_completed', { habit_id: 'h1' });
    const f120 = jest.fn(async () => ({
      ok: false,
      status: 429,
      headers: { 'Retry-After': '120' },
    })) as unknown as typeof fetch;
    await expect(deliver(hook(), body, f120, { attempts: 1 })).resolves.toEqual({
      ok: false,
      error: 'HTTP 429',
      retryAfterMs: 120_000,
    });

    const fHuge = jest.fn(async () => ({
      ok: false,
      status: 503,
      headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? '99999' : null) },
    })) as unknown as typeof fetch;
    await expect(deliver(hook(), body, fHuge, { attempts: 1 })).resolves.toEqual({
      ok: false,
      error: 'HTTP 503',
      retryAfterMs: 900_000,
    });

    const fRedir = jest.fn(async () => ({
      ok: false,
      status: 302,
    })) as unknown as typeof fetch;
    await expect(deliver(hook(), body, fRedir, { attempts: 3, sleep: noSleep })).resolves.toEqual({
      ok: false,
      error: 'yönlendirme reddedildi',
    });
  });

  it('(+) registerWebhook generates a 64-hex signingSecret and stores it under SIGNING_SECRET_KEY', async () => {
    const reg = await registerWebhook({ url: 'https://hooks.example.com/in' });
    expect(reg.ok).toBe(true);
    if (reg.ok) {
      expect(reg.signingSecret).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
