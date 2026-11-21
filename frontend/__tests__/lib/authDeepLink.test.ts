import { Platform } from 'react-native';

let mockCurrentUrl: string | null = null;
jest.mock('expo-linking', () => ({
  createURL: (p: string) => `atlas:///${p}`,
  useURL: () => mockCurrentUrl,
}));

import {
  authLinkErrorMessage,
  confirmationRedirectUrl,
  establishSessionFromAuthUrl,
  parseAuthUrl,
  recoveryRedirectUrl,
  stripAuthParamsFromWebUrl,
  type AuthClientLike,
} from '../../lib/authDeepLink';

function makeAuthMock(): {
  auth: AuthClientLike;
  setSession: jest.Mock;
  exchangeCodeForSession: jest.Mock;
  verifyOtp: jest.Mock;
} {
  const setSession = jest.fn(async () => ({ error: null }));
  const exchangeCodeForSession = jest.fn(async () => ({ error: null }));
  const verifyOtp = jest.fn(async () => ({ error: null }));
  return {
    auth: { setSession, exchangeCodeForSession, verifyOtp },
    setSession,
    exchangeCodeForSession,
    verifyOtp,
  };
}

const REAL_OS = Platform.OS;

afterEach(() => {
  mockCurrentUrl = null;
  (Platform as { OS: typeof REAL_OS }).OS = REAL_OS;
});

describe('parseAuthUrl — Hermes-güvenli elle URL ayrıştırma (NAV-07, GAP2-08)', () => {
  it('(+) fragment içindeki access_token ve refresh_token çiftini ayrıştırır', () => {
    expect(parseAuthUrl('atlas:///reset-password#access_token=A&refresh_token=B&type=recovery')).toEqual({
      ok: true,
      kind: 'recovery',
      method: 'tokens',
      accessToken: 'A',
      refreshToken: 'B',
    });
  });

  it('(+) PKCE ?code= parametresini ayrıştırır', () => {
    expect(parseAuthUrl('atlas:///reset-password?code=C&type=recovery')).toEqual({
      ok: true,
      kind: 'recovery',
      method: 'code',
      code: 'C',
    });
  });

  it('(+) ?token_hash= ve geçerli OtpLinkType çiftini ayrıştırır', () => {
    expect(parseAuthUrl('atlas:///reset-password?token_hash=H&type=recovery')).toEqual({
      ok: true,
      kind: 'recovery',
      method: 'token_hash',
      tokenHash: 'H',
      otpType: 'recovery',
    });
  });

  it('(+) fragment parametresi aynı adlı sorgu parametresini ezer ve tokens > code > token_hash önceliği korunur', () => {
    expect(
      parseAuthUrl('atlas:///reset-password?access_token=OLD_A&refresh_token=OLD_B&code=C#access_token=NEW_A&refresh_token=NEW_B&type=signup'),
    ).toEqual({
      ok: true,
      kind: 'signup',
      method: 'tokens',
      accessToken: 'NEW_A',
      refreshToken: 'NEW_B',
    });
  });

  it('(+) + karakterini boşluğa, %C3%BC dizisini ü harfine çözer', () => {
    const res = parseAuthUrl('atlas:///login#error=access_denied&error_description=S%C3%BCre+doldu');
    expect(res).toEqual({
      ok: false,
      reason: 'link_error',
      description: 'Süre doldu',
    });
  });

  it('(+) hata taşıyan bağlantıyı link_error olarak işaretler', () => {
    expect(
      parseAuthUrl('atlas:///reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'),
    ).toEqual({
      ok: false,
      reason: 'link_error',
      description: 'Email link is invalid or has expired',
    });
  });

  it('(-) null, undefined ve boş dizeler empty döner', () => {
    expect(parseAuthUrl(null)).toEqual({ ok: false, reason: 'empty' });
    expect(parseAuthUrl(undefined)).toEqual({ ok: false, reason: 'empty' });
    expect(parseAuthUrl('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseAuthUrl('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('(-) parametresiz URL veya tek başına access_token (refresh_token olmadan) no_auth_params döner', () => {
    expect(parseAuthUrl('atlas:///reset-password')).toEqual({ ok: false, reason: 'no_auth_params' });
    expect(parseAuthUrl('atlas:///reset-password#access_token=ONLY_ONE&type=recovery')).toEqual({
      ok: false,
      reason: 'no_auth_params',
    });
    expect(parseAuthUrl('atlas:///reset-password?token_hash=H&type=unknown_kind')).toEqual({
      ok: false,
      reason: 'no_auth_params',
    });
  });

  it('(-) bozuk yüzde kodlaması (%E0%A4%A) istisna fırlatmaz', () => {
    expect(() => parseAuthUrl('atlas:///reset-password?code=%E0%A4%A&type=recovery')).not.toThrow();
    const res = parseAuthUrl('atlas:///reset-password?code=%E0%A4%A&type=recovery');
    expect(res).toEqual({
      ok: true,
      kind: 'recovery',
      method: 'code',
      code: '%E0%A4%A',
    });
  });
});

describe('establishSessionFromAuthUrl — tek tüketici ve de-dup garantisi', () => {
  it('(+) tokens için setSession tam bir kez çağrılır', async () => {
    const { auth, setSession, exchangeCodeForSession, verifyOtp } = makeAuthMock();
    const res = await establishSessionFromAuthUrl(
      'atlas:///reset-password#access_token=AT_1&refresh_token=RT_1&type=recovery',
      auth,
      { expect: 'recovery' },
    );
    expect(res).toEqual({ ok: true, kind: 'recovery' });
    expect(setSession).toHaveBeenCalledTimes(1);
    expect(setSession).toHaveBeenCalledWith({ access_token: 'AT_1', refresh_token: 'RT_1' });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('(+) code için exchangeCodeForSession ve token_hash için verifyOtp birer kez çağrılır', async () => {
    const m1 = makeAuthMock();
    await expect(
      establishSessionFromAuthUrl('atlas:///reset-password?code=PKCE_1&type=recovery', m1.auth, { expect: 'recovery' }),
    ).resolves.toEqual({ ok: true, kind: 'recovery' });
    expect(m1.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(m1.exchangeCodeForSession).toHaveBeenCalledWith('PKCE_1');

    const m2 = makeAuthMock();
    await expect(
      establishSessionFromAuthUrl('atlas:///reset-password?token_hash=TH_1&type=recovery', m2.auth, { expect: 'recovery' }),
    ).resolves.toEqual({ ok: true, kind: 'recovery' });
    expect(m2.verifyOtp).toHaveBeenCalledTimes(1);
    expect(m2.verifyOtp).toHaveBeenCalledWith({ token_hash: 'TH_1', type: 'recovery' });
  });

  it('(+) aynı URL için eşzamanlı iki çağrı tek auth isteği paylaşır', async () => {
    const { auth, exchangeCodeForSession } = makeAuthMock();
    let resolveExchange!: (v: { error: null }) => void;
    exchangeCodeForSession.mockImplementation(
      () => new Promise<{ error: null }>((r) => { resolveExchange = r; }),
    );
    const url = 'atlas:///reset-password?code=CONCURRENT_CODE&type=recovery';
    const p1 = establishSessionFromAuthUrl(url, auth, { expect: 'recovery' });
    const p2 = establishSessionFromAuthUrl(url, auth, { expect: 'recovery' });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    resolveExchange({ error: null });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ ok: true, kind: 'recovery' });
    expect(r2).toEqual({ ok: true, kind: 'recovery' });
    // Başarı sonrası aynı URL ile yeniden render da ikinci istek yapmaz
    await establishSessionFromAuthUrl(url, auth, { expect: 'recovery' });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it('(+) başarısız çağrıdan sonra kayıt silinir ve aynı URL yeniden denenebilir', async () => {
    const { auth, setSession } = makeAuthMock();
    setSession
      .mockResolvedValueOnce({ error: { message: 'Network request failed' } } as never)
      .mockResolvedValueOnce({ error: null });

    const url = 'atlas:///reset-password#access_token=RETRY_A&refresh_token=RETRY_B&type=recovery';
    const first = await establishSessionFromAuthUrl(url, auth, { expect: 'recovery' });
    expect(first.ok).toBe(false);

    const second = await establishSessionFromAuthUrl(url, auth, { expect: 'recovery' });
    expect(second).toEqual({ ok: true, kind: 'recovery' });
    expect(setSession).toHaveBeenCalledTimes(2);
  });

  it('(-) boş veya parametresiz URL auth istemcisini hiç çağırmaz', async () => {
    const { auth, setSession, exchangeCodeForSession, verifyOtp } = makeAuthMock();
    await expect(establishSessionFromAuthUrl(null, auth)).resolves.toEqual({
      ok: false,
      reason: 'empty',
      message: '',
    });
    await expect(establishSessionFromAuthUrl('atlas:///reset-password', auth)).resolves.toEqual({
      ok: false,
      reason: 'no_auth_params',
      message: '',
    });
    expect(setSession).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('(-) expect: recovery iken signup bağlantısı wrong_kind döner ve auth çağrısı yapmaz', async () => {
    const { auth, setSession } = makeAuthMock();
    const res = await establishSessionFromAuthUrl(
      'atlas:///reset-password#access_token=SIGN_A&refresh_token=SIGN_B&type=signup',
      auth,
      { expect: 'recovery' },
    );
    expect(res).toEqual({
      ok: false,
      reason: 'wrong_kind',
      message: 'Bu bağlantı şifre sıfırlama bağlantısı değil. Giriş ekranından devam et.',
    });
    expect(setSession).not.toHaveBeenCalled();
  });

  it('(-) setSession hatasında rejected döner ve ileti jeton değerini veya İngilizce metni ASLA içermez', async () => {
    const { auth, setSession } = makeAuthMock();
    setSession.mockResolvedValueOnce({
      error: { message: 'Invalid token SECRET_TOKEN_ALPHA SECRET_TOKEN_BETA' },
    } as never);

    const res = await establishSessionFromAuthUrl(
      'atlas:///reset-password#access_token=SECRET_TOKEN_ALPHA&refresh_token=SECRET_TOKEN_BETA&type=recovery',
      auth,
      { expect: 'recovery' },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('rejected');
      expect(res.message).not.toMatch(/SECRET_TOKEN_ALPHA|SECRET_TOKEN_BETA|Invalid token/i);
      expect(res.message).toContain('Bağlantının süresi dolmuş');
    }
  });

  it('(-) link_error ham İngilizce error_description metnini ASLA göstermez', async () => {
    const { auth, setSession } = makeAuthMock();
    const rawDesc = 'Email link is invalid or has expired';
    const msg = authLinkErrorMessage(rawDesc);
    expect(msg).not.toContain(rawDesc);
    expect(msg).toBe('Bağlantının süresi dolmuş ya da daha önce kullanılmış. Yeni bir kod isteyip tekrar dene.');

    const res = await establishSessionFromAuthUrl(
      'atlas:///reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      auth,
      { expect: 'recovery' },
    );
    expect(res).toEqual({
      ok: false,
      reason: 'link_error',
      message: 'Bağlantının süresi dolmuş ya da daha önce kullanılmış. Yeni bir kod isteyip tekrar dene.',
    });
    expect(setSession).not.toHaveBeenCalled();
  });
});

describe('yönlendirme URL üreticileri ve web adres çubuğu temizliği', () => {
  it('(+) native ortamda Linking.createURL ile hedef üretir', () => {
    (Platform as { OS: string }).OS = 'ios';
    expect(recoveryRedirectUrl()).toBe('atlas:///reset-password');
    expect(confirmationRedirectUrl()).toBe('atlas:///login');
  });

  it('(+) web ortamında window.location.origin tabanlı hedef üretir ve stripAuthParamsFromWebUrl sorgu/fragment siler', () => {
    (Platform as { OS: string }).OS = 'web';
    const replaceState = jest.fn();
    const prevWindow = (globalThis as { window?: unknown }).window;
    const prevDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { window: unknown }).window = {
      location: { origin: 'https://app.example.test', pathname: '/reset-password', href: 'https://app.example.test/reset-password#access_token=X' },
      history: { replaceState },
    };
    (globalThis as { document: unknown }).document = { title: 'Aderyth' };

    try {
      expect(recoveryRedirectUrl()).toBe('https://app.example.test/reset-password');
      expect(confirmationRedirectUrl()).toBe('https://app.example.test/login');
      stripAuthParamsFromWebUrl();
      expect(replaceState).toHaveBeenCalledWith({}, 'Aderyth', 'https://app.example.test/reset-password');
    } finally {
      if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window: unknown }).window = prevWindow;
      if (prevDocument === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document: unknown }).document = prevDocument;
    }
  });
});
