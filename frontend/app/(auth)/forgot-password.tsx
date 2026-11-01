import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '../../lib/supabase';
import { colors, space, radius, font, shadow, fontFamily } from '../../lib/tokens';
import {
  AtmosphericScreenCanvas,
  Button,
  EmbeddedFiligree,
  EmblemMedallion,
} from '../../components/ui';
import { CANVASES, DECOR, ONBOARDING_ART, TEXTURES } from '../../lib/visualAssets';
import FloatingLabelInput from '../../components/ui/FloatingLabelInput';

type Step = 'email' | 'code';

function buildResetRedirectUrl() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}/reset-password`;
  }
  return Linking.createURL('reset-password');
}

function recoveryError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('expired') || lower.includes('invalid') || lower.includes('token')) {
    return 'Kod geçersiz veya süresi dolmuş. Yeni bir kod isteyip tekrar deneyin.';
  }
  if (lower.includes('security purposes') || lower.includes('rate limit') || lower.includes('too many')) {
    return 'Çok sık kod istendi. Lütfen kısa bir süre bekleyip tekrar deneyin.';
  }
  return message;
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const normalizedEmail = email.trim().toLowerCase();

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  async function handleSendCode() {
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError('Geçerli bir e-posta adresi girin.');
      return;
    }
    if (resendCooldown > 0) {
      setError(`Yeni kod istemek için ${resendCooldown} saniye bekleyin.`);
      return;
    }

    setError('');
    setInfo('');
    setLoading(true);
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: buildResetRedirectUrl(),
    });
    setLoading(false);

    if (sendError) {
      setError(recoveryError(sendError.message));
      return;
    }

    setStep('code');
    setResendCooldown(60);
    setInfo('Hesap bu adresle eşleşiyorsa 6 haneli doğrulama kodu gönderildi. Yeni mesajı ve Spam klasörünü kontrol et.');
  }

  async function handleVerifyCode() {
    const normalizedCode = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError('E-postadaki 6 haneli kodu girin.');
      return;
    }

    setError('');
    setLoading(true);
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: normalizedCode,
      type: 'recovery',
    });
    setLoading(false);

    if (verifyError || !data.session) {
      setError(recoveryError(verifyError?.message ?? 'Doğrulama oturumu oluşturulamadı.'));
      return;
    }

    router.replace('/(auth)/reset-password');
  }

  function changeEmail() {
    setStep('email');
    setCode('');
    setError('');
    setInfo('');
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
            <Text style={s.wordmark}>{step === 'email' ? 'Hesabını Kurtar' : 'Kodunu Gir'}</Text>
            <Text style={s.tagline}>
              {step === 'email'
                ? 'Hesabına bağlı e-posta adresini yaz; sana tek kullanımlık bir kod gönderelim.'
                : `${normalizedEmail} adresine gönderilen kodu doğrula.`}
            </Text>
          </View>

          <View style={s.panel}>
            <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.11} />
            <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" opacity={0.16} size={110} />
            <View style={s.stepRow} accessibilityLabel={`Adım ${step === 'email' ? '1' : '2'} / 3`}>
              {[1, 2, 3].map((item) => (
                <View key={item} style={[s.stepDot, item <= (step === 'email' ? 1 : 2) && s.stepDotActive]} />
              ))}
            </View>
            <Text style={s.eyebrow}>ŞİFRE KURTARMA · {step === 'email' ? '1/3' : '2/3'}</Text>
            <Text style={s.title}>{step === 'email' ? 'E-posta adresini doğrula' : 'E-postadaki kodu gir'}</Text>
            <Text style={s.subtitle}>
              {step === 'email'
                ? 'Gmail veya diğer e-posta adresini kullanabilirsin.'
                : 'Kod kısa süreli ve yalnızca bir kez kullanılabilir.'}
            </Text>

            {step === 'email' ? (
              <FloatingLabelInput
                label="E-posta adresi"
                icon="mail-outline"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={(text) => { setEmail(text); setError(''); }}
                onSubmitEditing={handleSendCode}
              />
            ) : (
              <>
                <FloatingLabelInput
                  label="6 haneli kod"
                  icon="keypad-outline"
                  keyboardType="number-pad"
                  autoCapitalize="none"
                  value={code}
                  onChangeText={(text) => { setCode(text.replace(/\D/g, '').slice(0, 6)); setError(''); }}
                  onSubmitEditing={handleVerifyCode}
                />
                <TouchableOpacity onPress={changeEmail} style={s.changeButton} accessibilityRole="button">
                  <Text style={s.changeText}>E-posta adresini değiştir</Text>
                </TouchableOpacity>
              </>
            )}

            {!!error && (
              <View style={s.messageRow} accessibilityRole="alert">
                <Ionicons name="alert-circle" size={16} color={colors.error} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}
            {!!info && (
              <View style={[s.messageRow, s.infoRow]}>
                <Ionicons name="mail-open-outline" size={16} color={colors.success} />
                <Text style={s.infoText}>{info}</Text>
              </View>
            )}

            <Button
              label={step === 'email' ? 'Kodu Gönder' : 'Kodu Doğrula'}
              onPress={step === 'email' ? handleSendCode : handleVerifyCode}
              loading={loading}
              size="lg"
              style={{ marginTop: space.sm }}
            />

            {step === 'code' && (
              <TouchableOpacity onPress={handleSendCode} disabled={loading || resendCooldown > 0} style={s.resendButton} accessibilityRole="button">
                <Text style={[s.resendText, resendCooldown > 0 && s.resendTextDisabled]}>
                  {resendCooldown > 0 ? `Yeniden gönder · ${resendCooldown}s` : 'Kod gelmedi mi? Yeniden gönder'}
                </Text>
              </TouchableOpacity>
            )}

            <Link href="/(auth)/login" asChild>
              <TouchableOpacity style={s.backBtn} accessibilityRole="link">
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
    width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    marginBottom: space.lg, ...shadow.sm,
  },
  markLetter: { fontFamily: fontFamily.serif, fontSize: 34, fontStyle: 'italic', color: colors.primary, lineHeight: 40 },
  markDot: { position: 'absolute', top: 12, right: 12, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary },
  wordmark: { ...font.display, color: colors.text, marginBottom: 8, textAlign: 'center' },
  tagline: { ...font.body, color: colors.textDim, textAlign: 'center', maxWidth: 380, lineHeight: 22 },
  panel: {
    backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    padding: 20, gap: space.md, overflow: 'hidden', position: 'relative', ...shadow.md,
  },
  stepRow: { flexDirection: 'row', gap: 6, marginBottom: 2 },
  stepDot: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.border },
  stepDotActive: { backgroundColor: colors.primary },
  eyebrow: { ...font.overline, color: colors.primaryBright },
  title: { ...font.title, color: colors.text },
  subtitle: { ...font.body, color: colors.textDim, lineHeight: 22 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: 'rgba(199,106,106,0.08)' },
  infoRow: { backgroundColor: 'rgba(135,166,120,0.08)' },
  errorText: { color: colors.error, fontSize: 13, flex: 1, lineHeight: 19 },
  infoText: { color: colors.success, fontSize: 13, flex: 1, lineHeight: 19 },
  changeButton: { alignSelf: 'flex-start', marginTop: -4 },
  changeText: { ...font.caption, color: colors.primaryBright },
  resendButton: { alignItems: 'center', paddingVertical: space.xs },
  resendText: { ...font.bodySm, color: colors.primaryBright, fontWeight: '600' },
  resendTextDisabled: { color: colors.textGhost },
  backBtn: { marginTop: space.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  backText: { color: colors.textDim, fontSize: 14 },
});
