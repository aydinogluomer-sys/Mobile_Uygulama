import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors, space, radius, font, shadow, fontFamily } from '../../lib/tokens';
import { Button } from '../../components/ui';
import FloatingLabelInput from '../../components/ui/FloatingLabelInput';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function initializeRecoverySession() {
      let initError = '';

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        const queryParams = url.searchParams;
        const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '');
        const accessToken = hashParams.get('access_token') ?? queryParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token') ?? queryParams.get('refresh_token');
        const authCode = queryParams.get('code');
        const tokenHash = queryParams.get('token_hash');
        const linkType = queryParams.get('type') ?? hashParams.get('type');

        if (accessToken && refreshToken) {
          const { error: setSessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (setSessionError) initError = setSessionError.message;
        } else if (authCode) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(authCode);
          if (exchangeError) initError = exchangeError.message;
        } else if (tokenHash && linkType === 'recovery') {
          const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
          if (verifyError) initError = verifyError.message;
        }
      }

      if (!initError) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) initError = 'Önce e-postana gönderilen kodu doğrula.';
      }

      if (!mounted) return;

      if (initError) {
        setError(initError);
        setSessionReady(false);
        return;
      }

      setSessionReady(true);
      setInfo('Kod doğrulandı. Şimdi yeni şifreni belirleyebilirsin.');

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const cleanUrl = `${window.location.origin}${window.location.pathname}`;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    }

    initializeRecoverySession();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleResetPassword() {
    if (!sessionReady) {
      setInfo('');
      setError('Geçerli bir doğrulama oturumu bulunamadı. Kodu yeniden doğrulayın.');
      return;
    }

    if (!password || !confirmPassword) {
      setInfo('');
      setError('Yeni şifreyi ve tekrarını giriniz.');
      return;
    }
    if (password.length < 6) {
      setInfo('');
      setError('Şifre en az 6 karakter olmalıdır.');
      return;
    }
    if (password !== confirmPassword) {
      setInfo('');
      setError('Şifreler eşleşmiyor.');
      return;
    }

    setError('');
    setInfo('');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      if (error.message.toLowerCase().includes('auth session missing')) {
        setError('Sıfırlama oturumu bulunamadı. Kodu yeniden doğrulayıp tekrar deneyin.');
      } else {
        setError(error.message);
      }
      return;
    }

    await supabase.auth.signOut({ scope: 'local' });
    router.replace('/(auth)/login');
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.brand}>
            <View style={s.mark}>
              <Text style={s.markLetter}>a</Text>
              <View style={s.markDot} />
            </View>
            <Text style={s.wordmark}>Yeni Şifre Belirle</Text>
            <Text style={s.tagline}>Hesabına erişimi geri almak için yeni bir şifre oluştur.</Text>
          </View>

          <View style={s.panel}>
            <View style={s.stepRow} accessibilityLabel="Adım 3 / 3">
              {[1, 2, 3].map((item) => <View key={item} style={[s.stepDot, s.stepDotActive]} />)}
            </View>
            <Text style={s.eyebrow}>ŞİFRE SIFIRLAMA · 3/3</Text>
            <Text style={s.title}>Güçlü bir şifre seç</Text>
            <Text style={s.subtitle}>Yeni şifren en az 6 karakter olmalı. Kaydettikten sonra giriş ekranına döneceksin.</Text>

            <FloatingLabelInput
              label="Yeni şifre"
              icon="lock-closed-outline"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={(text) => { setPassword(text); setError(''); setInfo(''); }}
              rightElement={(
                <TouchableOpacity onPress={() => setShowPassword((value) => !value)}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textFaint} />
                </TouchableOpacity>
              )}
            />

            <FloatingLabelInput
              label="Şifre tekrar"
              icon="shield-checkmark-outline"
              secureTextEntry={!showConfirmPassword}
              value={confirmPassword}
              onChangeText={(text) => { setConfirmPassword(text); setError(''); setInfo(''); }}
              onSubmitEditing={handleResetPassword}
              rightElement={(
                <TouchableOpacity onPress={() => setShowConfirmPassword((value) => !value)}>
                  <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textFaint} />
                </TouchableOpacity>
              )}
            />

            {!!error && (
              <View style={s.errorRow}>
                <Ionicons name="alert-circle" size={15} color={colors.error} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            {!!info && (
              <View style={s.infoRow}>
                <Ionicons name="checkmark-circle" size={15} color={colors.success} />
                <Text style={s.infoText}>{info}</Text>
              </View>
            )}

            <Button label="Yeni Şifreyi Kaydet" onPress={handleResetPassword} loading={loading} disabled={!sessionReady} size="lg" style={{ marginTop: space.sm }} />

            <Link href="/(auth)/login" asChild>
              <TouchableOpacity style={s.backBtn}>
                <Ionicons name="arrow-back" size={14} color={colors.textDim} />
                <Text style={s.backText}>Giriş ekranına dön</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 28, paddingVertical: 40 },
  brand: { alignItems: 'center', marginBottom: 28 },
  mark: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
    ...shadow.sm,
  },
  markLetter: { fontFamily: fontFamily.serif, fontSize: 34, fontStyle: 'italic', color: colors.primary, lineHeight: 40 },
  markDot: { position: 'absolute', top: 12, right: 12, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary },
  wordmark: { ...font.display, color: colors.text, marginBottom: 8, textAlign: 'center' },
  tagline: { ...font.body, color: colors.textDim, textAlign: 'center', maxWidth: 360 },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: space.md,
    ...shadow.md,
  },
  stepRow: { flexDirection: 'row', gap: 6, marginBottom: 2 },
  stepDot: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.border },
  stepDotActive: { backgroundColor: colors.primary },
  eyebrow: { ...font.overline, color: colors.primaryBright },
  title: { ...font.title, color: colors.text },
  subtitle: { ...font.body, color: colors.textDim, lineHeight: 22 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  errorText: { color: colors.error, fontSize: 13, flex: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  infoText: { color: colors.success, fontSize: 13, flex: 1, lineHeight: 18 },
  backBtn: { marginTop: space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  backText: { color: colors.textDim, fontSize: 14 },
});
