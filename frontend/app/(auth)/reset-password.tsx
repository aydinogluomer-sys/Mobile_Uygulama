import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '../../lib/supabase';
import { signOutLocal } from '../../services/accountService';
import { colors, space, radius, font, shadow, fontFamily } from '../../lib/tokens';
import { Button, EmblemMedallion } from '../../components/ui';
import { AtmosphericScreenCanvas, EmbeddedFiligree } from '../../components/spatial';
import { CANVASES, DECOR, ONBOARDING_ART, TEXTURES } from '../../lib/visualAssets';
import FloatingLabelInput from '../../components/ui/FloatingLabelInput';
import PasswordToggle from '../../components/auth/PasswordToggle';
import { recoveryErrorMessage } from '../../lib/authErrors';
import { establishSessionFromAuthUrl, useAuthLinkUrl } from '../../lib/authDeepLink';

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
  const linkUrl = useAuthLinkUrl();

  useEffect(() => {
    let mounted = true;

    // F22 (NAV-07, GAP2-08): every platform spends the link through lib/authDeepLink.ts.
    // On a native cold start `useURL` is still null on the first render, so the initial URL
    // is asked for directly -- otherwise "verify the code first" would flash for a user who
    // did open a valid link. Repeats of the same URL share one request.
    async function initializeRecoverySession() {
      let initError = '';
      let url = linkUrl;
      if (!url && Platform.OS !== 'web') {
        url = await Linking.getInitialURL().catch(() => null);
      }

      const result = await establishSessionFromAuthUrl(url, supabase.auth, { expect: 'recovery' });
      if (result.ok || result.reason === 'empty' || result.reason === 'no_auth_params') {
        // No link (the 6-digit code path) or a link just spent: the session decides.
        const { data } = await supabase.auth.getSession();
        if (!data.session) initError = 'Önce e-postana gönderilen kodu doğrula.';
      } else {
        initError = result.message;
      }

      if (!mounted) return;

      if (initError) {
        setInfo('');
        setError(initError);
        setSessionReady(false);
        return;
      }

      setError('');
      setSessionReady(true);
      setInfo('Kod doğrulandı. Şimdi yeni şifreni belirleyebilirsin.');
    }

    void initializeRecoverySession();

    return () => {
      mounted = false;
    };
  }, [linkUrl]);

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
      setError(recoveryErrorMessage(error.message));
      return;
    }

    // F04: the recovery session ends through the same door as any sign-out, so memory and the
    // read cache are cleared too; a failed sign-out is shown, not hidden behind a redirect.
    const out = await signOutLocal();
    if (!out.ok) { setError(out.error); return; }
    router.replace('/(auth)/login');
  }

  return (
    <SafeAreaView style={s.safe}>
      <AtmosphericScreenCanvas
        source={CANVASES.authPoster}
        textureSource={TEXTURES.linen}
        scrim={0.62}
        tintColor={colors.primary}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.brand}>
            <View style={s.mark}>
              <Text style={s.markLetter}>a</Text>
              <View style={s.markDot} />
            </View>
            <View style={{ marginBottom: space.md }}>
              <EmblemMedallion
                source={ONBOARDING_ART.authKeySeal}
                size={56}
                unlocked
                accentColor={colors.primary}
              />
            </View>
            <Text style={s.wordmark}>Yeni Şifre Belirle</Text>
            <Text style={s.tagline}>Hesabına erişimi geri almak için yeni bir şifre oluştur.</Text>
          </View>

          <View style={s.panel}>
            <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.11} />
            <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" opacity={0.16} size={110} />
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
              autoComplete="new-password"
              textContentType="newPassword"
              autoCapitalize="none"
              autoCorrect={false}
              value={password}
              onChangeText={(text) => { setPassword(text); setError(''); setInfo(''); }}
              rightElement={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((value) => !value)} />}
            />

            <FloatingLabelInput
              label="Şifre tekrar"
              icon="shield-checkmark-outline"
              secureTextEntry={!showConfirmPassword}
              autoComplete="new-password"
              textContentType="newPassword"
              autoCapitalize="none"
              autoCorrect={false}
              value={confirmPassword}
              onChangeText={(text) => { setConfirmPassword(text); setError(''); setInfo(''); }}
              onSubmitEditing={handleResetPassword}
              rightElement={(
                <PasswordToggle
                  visible={showConfirmPassword}
                  onToggle={() => setShowConfirmPassword((value) => !value)}
                  showLabel="Şifre tekrarını göster"
                  hideLabel="Şifre tekrarını gizle"
                />
              )}
            />

            {!!error && (
              <View style={s.errorRow} accessibilityRole="alert">
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
              <TouchableOpacity style={s.backBtn} accessibilityRole="link" accessibilityLabel="Giriş ekranına dön">
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
    overflow: 'hidden',
    position: 'relative',
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
  backBtn: { marginTop: space.sm, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  backText: { color: colors.textDim, fontSize: 14 },
});
