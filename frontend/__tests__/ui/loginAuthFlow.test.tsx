import React from 'react';
import { TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

let mockCurrentUrl: string | null = null;
jest.mock('expo-linking', () => ({
  createURL: (p: string) => `atlas:///${p}`,
  useURL: () => mockCurrentUrl,
}));

const mockSignInWithPassword = jest.fn();
const mockResend = jest.fn();
const mockSetSession = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...a: unknown[]) => mockSignInWithPassword(...a),
      resend: (...a: unknown[]) => mockResend(...a),
      setSession: (...a: unknown[]) => mockSetSession(...a),
    },
  },
}));

import LoginScreen from '../../app/(auth)/login';
import { resetResendCooldowns } from '../../hooks/useResendCooldown';

type Json = TestRenderer.ReactTestRendererJSON;

jest.setTimeout(30_000);
jest.useFakeTimers();

const mounted: TestRenderer.ReactTestRenderer[] = [];

async function render(el: React.ReactElement): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(el); });
  mounted.push(tree);
  return tree;
}

function textOf(tree: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: Json | string | null): void => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    (n.children ?? []).forEach(walk);
  };
  const json = tree.toJSON();
  (Array.isArray(json) ? json : [json]).forEach(walk);
  return out.join(' ');
}

function pressable(tree: TestRenderer.ReactTestRenderer, label: string) {
  const hits = tree.root.findAll(
    (n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function',
    { deep: true },
  );
  if (hits.length === 0) throw new Error(`"${label}" etiketli basılabilir düğüm yok`);
  return hits[0];
}

async function fillAndLogin(tree: TestRenderer.ReactTestRenderer, email: string, password: string) {
  const inputs = tree.root.findAllByType(TextInput);
  expect(inputs.length).toBeGreaterThanOrEqual(2);
  await act(async () => { inputs[0].props.onChangeText(email); });
  await act(async () => { inputs[1].props.onChangeText(password); });
  await act(async () => { pressable(tree, 'Giriş Yap').props.onPress(); });
}

beforeEach(() => {
  mockCurrentUrl = null;
  mockPush.mockReset();
  mockReplace.mockReset();
  mockSignInWithPassword.mockReset();
  mockResend.mockReset();
  mockSetSession.mockReset();
  resetResendCooldowns();
});

afterEach(async () => {
  await act(async () => { mounted.splice(0).forEach((t) => t.unmount()); });
});

describe('loginAuthFlow — giriş hata dili, doğrulanmamış hesap çıkışı ve onay bağlantısı (NAV-05, NAV-07)', () => {
  it('(+) Invalid login credentials Türkçe ileti ve 44pt Şifremi unuttum bağlantısı gösterir; İngilizce metin yoktur', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const tree = await render(<LoginScreen />);
    await fillAndLogin(tree, 'kisi@ornek.com', 'yanlis123');

    const shown = textOf(tree);
    expect(shown).toContain('E-posta veya şifre hatalı.');
    expect(shown).not.toContain('Invalid login credentials');

    const alerts = tree.root.findAll((n) => n.props?.accessibilityRole === 'alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);

    const forgotAction = tree.root.findAll(
      (n) => n.props?.accessibilityLabel === 'Şifremi unuttum' && typeof n.props?.onPress === 'function',
    )[0];
    expect(forgotAction).toBeDefined();
    const style = Object.assign({}, ...[forgotAction.props.style].flat(3).filter(Boolean));
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    await act(async () => { forgotAction.props.onPress(); });
    expect(mockPush).toHaveBeenCalledWith('/(auth)/forgot-password');
  });

  it('(+) Email not confirmed formu kaldırır, SignupPending unconfirmed gösterir, tekrar gönderir ve Düzelt ile dolu forma döner', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: { message: 'Email not confirmed' } });
    mockResend.mockResolvedValue({ error: null });

    const tree = await render(<LoginScreen />);
    await fillAndLogin(tree, '  onaysiz@ornek.com  ', 'dogrusifre');

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'onaysiz@ornek.com',
      password: 'dogrusifre',
    });

    // Form kalktı, unconfirmed varyantı geldi
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
    const shown = textOf(tree);
    expect(shown).toContain('E-POSTA DOĞRULANMADI');
    expect(shown).toContain('onaysiz@ornek.com');
    expect(shown).not.toContain('Email not confirmed');

    // Giriş ekranına gelişte bekleme henüz başlamamıştır: hemen gönderilebilir
    const resendBtn = pressable(tree, 'Doğrulama postasını tekrar gönder');
    expect(resendBtn.props.accessibilityState.disabled).toBe(false);

    await act(async () => { resendBtn.props.onPress(); });
    expect(mockResend).toHaveBeenCalledTimes(1);
    expect(mockResend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'onaysiz@ornek.com',
      options: { emailRedirectTo: 'atlas:///login' },
    });

    const lockedBtn = pressable(tree, 'Tekrar gönder (60)');
    expect(lockedBtn.props.accessibilityState.disabled).toBe(true);
    expect(textOf(tree)).toContain('Doğrulama postası yeniden gönderildi.');

    // Cooldown sürerken ikinci basış resend çağırmaz
    await act(async () => { lockedBtn.props.onPress?.(); });
    expect(mockResend).toHaveBeenCalledTimes(1);

    // "Düzelt" forma döndürür ve alanlar dolu kalır
    const changeBtn = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && n.findAll((c) => c.children?.includes?.('Düzelt')).length > 0,
    )[0];
    await act(async () => { changeBtn.props.onPress(); });

    const inputsAfter = tree.root.findAllByType(TextInput);
    expect(inputsAfter.length).toBeGreaterThanOrEqual(2);
    expect(inputsAfter[0].props.value).toBe('  onaysiz@ornek.com  ');
    expect(inputsAfter[1].props.value).toBe('dogrusifre');
  });

  it('(+) resend hız sınırı hatası Türkçe gösterilir', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: { message: 'Email not confirmed' } });
    mockResend.mockResolvedValue({ error: { message: 'email rate limit exceeded' } });

    const tree = await render(<LoginScreen />);
    await fillAndLogin(tree, 'limit@ornek.com', 'sifre123');
    await act(async () => { pressable(tree, 'Doğrulama postasını tekrar gönder').props.onPress(); });

    expect(textOf(tree)).toContain('Çok fazla e-posta gönderildi');
  });

  it('(+) kayıt onayı bağlantısı (type=signup) başarı bildirimi gösterir ve setSession çağırmaz', async () => {
    mockCurrentUrl = 'atlas:///login#access_token=a&refresh_token=b&type=signup';
    const tree = await render(<LoginScreen />);

    expect(textOf(tree)).toContain('E-postan doğrulandı. Şimdi giriş yapabilirsin.');
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('(-) yanlış parola ve ağ hatası ASLA SignupPending açmaz; tanınmayan hata ham metinle korunur', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
    const tree = await render(<LoginScreen />);
    await fillAndLogin(tree, 'kisi@ornek.com', 'yanlis');
    expect(tree.root.findAllByType(TextInput).length).toBeGreaterThanOrEqual(2);
    expect(textOf(tree)).not.toContain('E-POSTA DOĞRULANMADI');
    expect(mockResend).not.toHaveBeenCalled();

    mockSignInWithPassword.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } });
    await act(async () => { pressable(tree, 'Giriş Yap').props.onPress(); });
    expect(tree.root.findAllByType(TextInput).length).toBeGreaterThanOrEqual(2);
    expect(textOf(tree)).toContain('Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.');

    mockSignInWithPassword.mockResolvedValueOnce({ error: { message: 'Unmapped custom upstream message' } });
    await act(async () => { pressable(tree, 'Giriş Yap').props.onPress(); });
    expect(textOf(tree)).toContain('Unmapped custom upstream message');
  });

  it('(-) type=recovery bağlantısı login ekranında kayıt onayı bildirimi üretmez; süresi dolmuş bağlantı Türkçe gösterilir', async () => {
    mockCurrentUrl = 'atlas:///login#access_token=a&refresh_token=b&type=recovery';
    const recoveryTree = await render(<LoginScreen />);
    expect(textOf(recoveryTree)).not.toContain('E-postan doğrulandı');

    mockCurrentUrl = 'atlas:///login#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    const expiredTree = await render(<LoginScreen />);
    const shown = textOf(expiredTree);
    expect(shown).toContain('Bağlantının süresi dolmuş');
    expect(shown).not.toContain('Email link is invalid');
  });
});
