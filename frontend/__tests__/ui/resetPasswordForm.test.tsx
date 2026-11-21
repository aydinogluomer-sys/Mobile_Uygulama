import React from 'react';
import { TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ replace: mockReplace }),
}));

let mockCurrentUrl: string | null = null;
const mockGetInitialURL = jest.fn<Promise<string | null>, []>(async () => null);
jest.mock('expo-linking', () => ({
  createURL: (p: string) => `atlas:///${p}`,
  useURL: () => mockCurrentUrl,
  getInitialURL: () => mockGetInitialURL(),
}));

const mockSetSession = jest.fn();
const mockGetSession = jest.fn();
const mockUpdateUser = jest.fn();
const mockSignOut = jest.fn();
const mockExchangeCode = jest.fn();
const mockVerifyOtp = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: (...a: unknown[]) => mockSetSession(...a),
      getSession: (...a: unknown[]) => mockGetSession(...a),
      updateUser: (...a: unknown[]) => mockUpdateUser(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
      exchangeCodeForSession: (...a: unknown[]) => mockExchangeCode(...a),
      verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
    },
  },
}));

import ResetPasswordScreen from '../../app/(auth)/reset-password';

type Json = TestRenderer.ReactTestRendererJSON;

jest.setTimeout(30_000);

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

let urlSeq = 0;
const uniqueRecoveryUrl = () => {
  urlSeq += 1;
  return `atlas:///reset-password#access_token=at_${urlSeq}&refresh_token=rt_${urlSeq}&type=recovery`;
};

beforeEach(() => {
  mockCurrentUrl = null;
  mockGetInitialURL.mockReset();
  mockGetInitialURL.mockResolvedValue(null);
  mockReplace.mockReset();
  mockSetSession.mockReset();
  mockGetSession.mockReset();
  mockUpdateUser.mockReset();
  mockSignOut.mockReset();
  mockExchangeCode.mockReset();
  mockVerifyOtp.mockReset();

  mockSetSession.mockResolvedValue({ error: null });
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1', email: 'u1@ornek.com' } } }, error: null });
  mockUpdateUser.mockResolvedValue({ error: null });
  mockSignOut.mockResolvedValue({ error: null });
});

afterEach(async () => {
  await act(async () => { mounted.splice(0).forEach((t) => t.unmount()); });
});

describe('resetPasswordForm — native/web kurtarma bağlantısı, OTP uyumu ve DSA-03 erişilebilirlik', () => {
  it('(+) native kurtarma bağlantısı ile setSession bir kez çağrılır, form açılır, kaydetme sonrası signOut ve login yönlendirmesi çalışır', async () => {
    mockCurrentUrl = uniqueRecoveryUrl();
    const tree = await render(<ResetPasswordScreen />);

    expect(mockSetSession).toHaveBeenCalledTimes(1);
    const saveBtn = pressable(tree, 'Yeni Şifreyi Kaydet');
    expect(saveBtn.props.accessibilityState.disabled).toBe(false);

    const inputs = tree.root.findAllByType(TextInput);
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input.props.autoComplete).toBe('new-password');
      expect(input.props.textContentType).toBe('newPassword');
    }

    // İki göster/gizle düğmesi: rol, etiket ve 44x44 dokunma alanı
    const firstToggle = pressable(tree, 'Şifreyi göster');
    const secondToggle = pressable(tree, 'Şifre tekrarını göster');
    for (const btn of [firstToggle, secondToggle]) {
      expect(btn.props.accessibilityRole).toBe('button');
      const st = Object.assign({}, ...[btn.props.style].flat(3).filter(Boolean));
      expect(st.minWidth).toBeGreaterThanOrEqual(44);
      expect(st.minHeight).toBeGreaterThanOrEqual(44);
    }

    await act(async () => { firstToggle.props.onPress(); });
    expect(pressable(tree, 'Şifreyi gizle')).toBeDefined();
    await act(async () => { secondToggle.props.onPress(); });
    expect(pressable(tree, 'Şifre tekrarını gizle')).toBeDefined();

    // Kaydetme akışı
    await act(async () => { inputs[0].props.onChangeText('yenisifre123'); });
    await act(async () => { inputs[1].props.onChangeText('yenisifre123'); });
    await act(async () => { pressable(tree, 'Yeni Şifreyi Kaydet').props.onPress(); });

    expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'yenisifre123' });
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('(+) URL yokken ve getSession oturum döndürüyorsa (6 haneli OTP yolu) form açık kalır ve setSession çağrılmaz', async () => {
    mockCurrentUrl = null;
    mockGetInitialURL.mockResolvedValue(null);
    const tree = await render(<ResetPasswordScreen />);

    expect(mockSetSession).not.toHaveBeenCalled();
    expect(pressable(tree, 'Yeni Şifreyi Kaydet').props.accessibilityState.disabled).toBe(false);
    expect(textOf(tree)).toContain('Kod doğrulandı. Şimdi yeni şifreni belirleyebilirsin.');
  });

  it('(+) soğuk başlangıçta useURL null iken Linking.getInitialURL kurtarma bağlantısını yakalar', async () => {
    mockCurrentUrl = null;
    mockGetInitialURL.mockResolvedValue(uniqueRecoveryUrl());
    const tree = await render(<ResetPasswordScreen />);

    expect(mockSetSession).toHaveBeenCalledTimes(1);
    expect(pressable(tree, 'Yeni Şifreyi Kaydet').props.accessibilityState.disabled).toBe(false);
  });

  it('(-) URL yok ve oturum yoksa form kapalı kalır ve uyarı gösterir', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const tree = await render(<ResetPasswordScreen />);

    expect(textOf(tree)).toContain('Önce e-postana gönderilen kodu doğrula.');
    expect(pressable(tree, 'Yeni Şifreyi Kaydet').props.accessibilityState.disabled).toBe(true);
  });

  it('(-) süresi dolmuş bağlantı Türkçe ileti gösterir, formu kapatır ve setSession çağırmaz', async () => {
    mockCurrentUrl = 'atlas:///reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    const tree = await render(<ResetPasswordScreen />);

    const shown = textOf(tree);
    expect(shown).toContain('Bağlantının süresi dolmuş');
    expect(shown).not.toContain('Email link is invalid');
    expect(pressable(tree, 'Yeni Şifreyi Kaydet').props.accessibilityState.disabled).toBe(true);
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('(-) type=signup bağlantısı wrong_kind iletisi verir ve formu kapalı tutar', async () => {
    mockCurrentUrl = 'atlas:///reset-password#access_token=s1&refresh_token=s2&type=signup';
    const tree = await render(<ResetPasswordScreen />);

    expect(textOf(tree)).toContain('Bu bağlantı şifre sıfırlama bağlantısı değil. Giriş ekranından devam et.');
    expect(pressable(tree, 'Yeni Şifreyi Kaydet').props.accessibilityState.disabled).toBe(true);
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('(-) updateUser aynı parola hatası Türkçe gösterilir ve kısa parola updateUser çağırmaz', async () => {
    mockCurrentUrl = uniqueRecoveryUrl();
    mockUpdateUser.mockResolvedValueOnce({
      error: { message: 'New password should be different from the old password.' },
    });
    const tree = await render(<ResetPasswordScreen />);
    const inputs = tree.root.findAllByType(TextInput);

    // Kısa parola (5 karakter) sunucuya gitmez
    await act(async () => { inputs[0].props.onChangeText('12345'); });
    await act(async () => { inputs[1].props.onChangeText('12345'); });
    await act(async () => { pressable(tree, 'Yeni Şifreyi Kaydet').props.onPress(); });
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain('Şifre en az 6 karakter olmalıdır.');

    // Aynı parola sunucudan Türkçe çevrilir
    await act(async () => { inputs[0].props.onChangeText('eskisifre'); });
    await act(async () => { inputs[1].props.onChangeText('eskisifre'); });
    await act(async () => { pressable(tree, 'Yeni Şifreyi Kaydet').props.onPress(); });
    expect(mockUpdateUser).toHaveBeenCalledTimes(1);
    expect(textOf(tree)).toContain('Yeni şifre eskisinden farklı olmalı.');
  });

  it('(-) aynı URL ile yeniden render (çift efekt) setSession çağrısını ikiye katlamaz', async () => {
    mockCurrentUrl = uniqueRecoveryUrl();
    const tree = await render(<ResetPasswordScreen />);
    await act(async () => { tree.update(<ResetPasswordScreen />); });
    const secondTree = await render(<ResetPasswordScreen />);
    expect(secondTree).toBeDefined();
    expect(mockSetSession).toHaveBeenCalledTimes(1);
  });
});
