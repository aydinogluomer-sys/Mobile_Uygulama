import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors, space, radius, font, shadow, fontFamily } from '../../lib/tokens';
import { Button } from '../../components/ui';
import FloatingLabelInput from '../../components/ui/FloatingLabelInput';
import SignupPending from '../../components/auth/SignupPending';

type Phase = 'form' | 'pending';

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Supabase answers in English, and the two answers that matter most here are
 * the two a user can do nothing about unless they are told what they are.
 *
 * Anything unrecognised is passed through untouched rather than flattened into
 * "bir hata oluştu" — an unmapped message is still a real one, and hiding it
 * would cost the next person the only clue they had.
 */
export function signupErrorMessage(raw: string): string {
  const m = raw.toLowerCase();

  if (m.includes('error sending confirmation') || m.includes('error sending email')) {
    return 'Doğrulama e-postası şu anda gönderilemiyor. Hesabın oluşturulmadı; birazdan tekrar dene.';
  }
  if (m.includes('email rate limit') || m.includes('over_email_send_rate_limit')) {
    return 'Çok fazla e-posta gönderildi. Bir süre bekleyip tekrar dene.';
  }
  if (m.includes('for security purposes') || m.includes('rate limit') || m.includes('too many')) {
    return 'Çok sık denendi. Kısa bir süre bekleyip tekrar dene.';
  }
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'Bu e-posta zaten kayıtlı. Giriş yapmayı dene.';
  }
  if (m.includes('password') && (m.includes('at least') || m.includes('should be'))) {
    return 'Şifre en az 6 karakter olmalıdır.';
  }
  if (m.includes('unable to validate email') || m.includes('invalid format') || m.includes('invalid email')) {
    return 'E-posta adresi geçerli görünmüyor. Kontrol edip tekrar dene.';
  }
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) {
    return 'Yeni kayıtlar şu anda kapalı.';
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.';
  }
  return raw;
}

export default function RegisterScreen() {
  const [phase, setPhase] = useState<Phase>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Pending-state only.
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendNotice, setResendNotice] = useState('');
  const [resendError, setResendError] = useState('');

  // Autocomplete and the iOS keyboard both like to leave a trailing space, and
  // GoTrue does not trim before it validates — so the address is trimmed here.
  // Case is left alone: the server lowercases for matching, and echoing the
  // address back in a different case than it was typed reads like a typo.
  const address = email.trim();

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  async function handleRegister() {
    if (!address || !password) { setError('E-posta ve şifre giriniz.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(address)) { setError('Geçerli bir e-posta adresi girin.'); return; }
    if (password.length < 6) { setError('Şifre en az 6 karakter olmalıdır.'); return; }

    setError('');
    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({ email: address, password });
    setLoading(false);

    if (signUpError) {
      setError(signupErrorMessage(signUpError.message));
      return;
    }

    // A session here means the project does not require confirmation, so the
    // account is already usable — `onAuthStateChange` in the root layout has
    // the redirect and this screen has nothing left to say.
    if (data.session) return;

    // No session: confirmation is required. Note that this branch is also
    // where a REPEAT signup lands, because the server answers that case
    // identically on purpose. Reading `data.user.identities` would tell the
    // two apart and would equally tell an attacker which addresses have
    // accounts, so it is not read.
    setSubmittedEmail(address);
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    setResendNotice('');
    setResendError('');
    setPhase('pending');
  }

  async function handleResend() {
    if (resendCooldown > 0 || resending) return;

    setResendNotice('');
    setResendError('');
    setResending(true);
    const { error: resendErr } = await supabase.auth.resend({ type: 'signup', email: submittedEmail });
    setResending(false);

    if (resendErr) {
      setResendError(signupErrorMessage(resendErr.message));
      return;
    }
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    setResendNotice('Doğrulama postası yeniden gönderildi.');
  }

  function handleChangeEmail() {
    setPhase('form');
    setError('');
    setResendNotice('');
    setResendError('');
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {phase === 'pending' ? (
            <>
              <SignupPending
                email={submittedEmail}
                onResend={handleResend}
                onChangeEmail={handleChangeEmail}
                resendCooldown={resendCooldown}
                resending={resending}
                notice={resendNotice}
                error={resendError}
              />
              <Link href="/(auth)/login" asChild>
                <TouchableOpacity style={s.primaryLinkBtn}>
                  <Text style={s.primaryLinkText}>Girişe dön</Text>
                  <Ionicons name="arrow-forward" size={16} color={colors.primaryBright} />
                </TouchableOpacity>
              </Link>
            </>
          ) : (
            <>
              <View style={s.brand}>
                <View style={s.mark}>
                  <Text style={s.markLetter}>a</Text>
                  <View style={s.markDot} />
                </View>
                <Text style={s.wordmark}>Hesap Oluştur</Text>
                <Text style={s.tagline}>Aderyth ile alışkanlık yolculuğuna başla.</Text>
              </View>

              <View style={s.form}>
                <FloatingLabelInput
                  label="E-posta"
                  icon="mail-outline"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={email}
                  onChangeText={(t) => { setEmail(t); setError(''); }}
                />

                <FloatingLabelInput
                  label="Şifre (en az 6 karakter)"
                  icon="lock-closed-outline"
                  secureTextEntry={!showPw}
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(''); }}
                  onSubmitEditing={handleRegister}
                  rightElement={(
                    <TouchableOpacity onPress={() => setShowPw((v) => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textFaint} />
                    </TouchableOpacity>
                  )}
                />

                {!!error && (
                  <View style={s.errorRow}>
                    <Ionicons name="alert-circle" size={15} color={colors.error} />
                    <Text style={s.errorText}>{error}</Text>
                  </View>
                )}

                <Button label="Kayıt Ol" onPress={handleRegister} loading={loading} size="lg" style={{ marginTop: space.sm }} />

                <Link href="/(auth)/login" asChild>
                  <TouchableOpacity style={s.linkBtn}>
                    <Text style={s.linkText}>Zaten hesabın var mı? <Text style={s.linkHighlight}>Giriş yap</Text></Text>
                  </TouchableOpacity>
                </Link>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 40 },

  brand: { alignItems: 'center', marginBottom: 44 },
  mark: {
    width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.lg, ...shadow.sm,
  },
  markLetter: { fontFamily: fontFamily.serif, fontSize: 34, fontStyle: 'italic', color: colors.primary, lineHeight: 40 },
  markDot: { position: 'absolute', top: 12, right: 12, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary },
  wordmark: { ...font.title, color: colors.text, marginBottom: 6 },
  tagline: { ...font.body, color: colors.textDim, textAlign: 'center' },

  form: { gap: space.md },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  errorText: { color: colors.error, fontSize: 13, flex: 1 },

  linkBtn: { marginTop: space.lg, alignItems: 'center' },
  linkText: { color: colors.textDim, fontSize: 14 },
  linkHighlight: { color: colors.primaryBright, fontWeight: '700' },

  primaryLinkBtn: {
    marginTop: space.xxl, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  primaryLinkText: { color: colors.primaryBright, fontSize: 15, fontWeight: '700' },
});
