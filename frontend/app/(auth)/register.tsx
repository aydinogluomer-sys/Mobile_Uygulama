import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors, space, radius, font, shadow, fontFamily, hexA, alphaHex } from '../../lib/tokens';
import {
  AtmosphericScreenCanvas,
  Button,
  EditorialBanner,
  EmbeddedFiligree,
  TexturedSurface,
} from '../../components/ui';
import { CANVASES, DECOR, ONBOARDING_ART, TEXTURES } from '../../lib/visualAssets';
import FloatingLabelInput from '../../components/ui/FloatingLabelInput';
import SignupPending from '../../components/auth/SignupPending';

const decorativeA11y =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as Record<string, unknown>)
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

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
  const { width } = useWindowDimensions();
  const isSplit = width >= 860;
  const [phase, setPhase] = useState<Phase>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  /**
   * Two error slots, not one.
   *
   * A rejected address belongs ON the address field -- that is where the user
   * has to look and what they have to change. A server refusal ("Dogrulama
   * e-postasi su anda gonderilemiyor") belongs to the form: no single field is
   * wrong, and attaching it to one would tell the user to edit something that
   * is fine.
   */
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
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
    setEmailError('');
    setPasswordError('');
    setError('');

    if (!address) { setEmailError('E-posta adresi girin.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(address)) { setEmailError('Geçerli bir e-posta adresi girin.'); return; }
    if (!password) { setPasswordError('Şifre girin.'); return; }
    if (password.length < 6) { setPasswordError('Şifre en az 6 karakter olmalıdır.'); return; }

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
    setEmailError('');
    setPasswordError('');
    setError('');
    setResendNotice('');
    setResendError('');
  }

  const innerContent = phase === 'pending' ? (
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
      {/*
        Register answers a different question from Login. Login is
        "let me back in" and stays compact; this screen has to earn the
        account, so it leads with what the product does before it asks
        for anything.
      */}
      {!isSplit ? (
        <EditorialBanner
          source={ONBOARDING_ART.authSanctuary}
          textureSource={TEXTURES.linen}
          eyebrow="YENİ BAŞLANGIÇ"
          title="Kişisel Sığınağın"
          subtitle="Gürültüsüz, reklamsız ve sürdürülebilir ritim mimarisi."
          accentColor={colors.primary}
          minHeight={94}
          style={{ marginBottom: space.lg }}
        />
      ) : null}
      <View style={s.brand}>
        <View style={s.mark}>
          <Text style={s.markLetter}>a</Text>
          <View style={s.markDot} />
        </View>
        <Text style={s.brandName}>Aderyth</Text>
        <Text style={s.wordmark}>Hesabını oluştur</Text>
        <Text style={s.promise}>Ritmini kur. İlerlemeni gör.</Text>
      </View>

      <Text style={s.pitch}>
        Sana uygun alışkanlıklar oluştur, sürdürülebilir bir rutin kur ve
        neyin gerçekten işe yaradığını gör.
      </Text>

      <View style={s.formCard}>
        <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" opacity={0.14} size={112} />
        <FloatingLabelInput
          label="E-posta"
          icon="mail-outline"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          value={email}
          error={emailError}
          onChangeText={(t) => { setEmail(t); setEmailError(''); setError(''); }}
        />

        <FloatingLabelInput
          label="Şifre (en az 6 karakter)"
          icon="lock-closed-outline"
          secureTextEntry={!showPw}
          autoComplete="new-password"
          textContentType="newPassword"
          value={password}
          error={passwordError}
          onChangeText={(t) => { setPassword(t); setPasswordError(''); setError(''); }}
          onSubmitEditing={handleRegister}
          rightElement={(
            <TouchableOpacity
              onPress={() => setShowPw((v) => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={showPw ? 'Şifreyi gizle' : 'Şifreyi göster'}
            >
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

        <Button label="Hesabımı oluştur" onPress={handleRegister} loading={loading} size="lg" style={{ marginTop: space.md }} />

        {/*
          Plain text, not links. There is no terms or privacy
          destination in this app or its config, and a tappable phrase
          that goes nowhere is worse than one that does not invite the
          tap. When those pages exist, this becomes two links.
        */}
        <Text style={s.legal}>
          Hesap oluşturarak Kullanım Koşulları ve Gizlilik Politikasını kabul
          etmiş olursun.
        </Text>

        <Link href="/(auth)/login" asChild>
          <TouchableOpacity style={s.linkBtn} accessibilityRole="link">
            <Text style={s.linkText}>Zaten hesabın var mı? <Text style={s.linkHighlight}>Giriş yap</Text></Text>
          </TouchableOpacity>
        </Link>
      </View>
    </>
  );

  if (isSplit) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.splitRoot}>
          <View style={s.posterColumn}>
            <View style={StyleSheet.absoluteFill} pointerEvents="none" {...decorativeA11y}>
              <Image
                source={CANVASES.authPoster}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
              <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bgSunk, 0.44) }]} />
              <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="top-right" opacity={0.22} size={160} />
              <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-left" opacity={0.18} size={150} />
            </View>

            <View style={s.posterTopRow}>
              <View style={s.posterPill}>
                <Text style={s.posterPillText}>YENİ BAŞLANGIÇ · ADERYTH</Text>
              </View>
            </View>

            <View style={s.posterBottomBlock}>
              <Text style={s.posterHeadline}>Kendi ritmini{'\n'}tasarla.</Text>
              <Text style={s.posterLead}>
                Aderyth reklam göstermez, verini satmaz ve seni tükenmişliğe itmez. Gerçek kapasitene saygı duyan sakin alışkanlık mimarisi.
              </Text>
            </View>
          </View>

          <KeyboardAvoidingView style={s.atelierColumn} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TexturedSurface source={TEXTURES.linen} textureOpacity={0.05} overlayOnly />
            <ScrollView contentContainerStyle={s.atelierScroll} keyboardShouldPersistTaps="handled">
              {innerContent}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </SafeAreaView>
    );
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
          {innerContent}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 36 },

  splitRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  posterColumn: {
    flex: 52,
    justifyContent: 'space-between',
    padding: 40,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    position: 'relative',
    overflow: 'hidden',
  },
  posterTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  posterPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: hexA(colors.bgSunk, 0.72),
    borderWidth: 1,
    borderColor: alphaHex(colors.primary, '40'),
  },
  posterPillText: {
    ...font.overline,
    color: colors.primaryBright,
    fontSize: 10,
  },
  posterBottomBlock: {
    gap: 14,
    maxWidth: 440,
  },
  posterHeadline: {
    fontFamily: fontFamily.serif,
    fontSize: 40,
    lineHeight: 46,
    color: colors.text,
  },
  posterLead: {
    ...font.body,
    color: colors.textDim,
    lineHeight: 23,
  },

  atelierColumn: {
    flex: 48,
    backgroundColor: colors.bg,
    position: 'relative',
  },
  atelierScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 36,
    paddingVertical: 40,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },

  brand: { alignItems: 'center', marginBottom: space.lg },
  mark: {
    width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.lg, ...shadow.sm,
  },
  markLetter: { fontFamily: fontFamily.serif, fontSize: 34, fontStyle: 'italic', color: colors.primary, lineHeight: 40 },
  markDot: { position: 'absolute', top: 12, right: 12, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary },
  brandName: { ...font.overline, color: colors.primary, marginBottom: space.sm },
  wordmark: { ...font.display, color: colors.text, marginBottom: 8, textAlign: 'center' },
  promise: { ...font.h3, color: colors.primaryBright, textAlign: 'center' },
  pitch: {
    ...font.body, color: colors.textDim, textAlign: 'center',
    lineHeight: 23, marginBottom: space.xl, paddingHorizontal: space.sm,
  },

  formCard: {
    gap: space.xl,
    backgroundColor: alphaHex(colors.surface, '92'),
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    overflow: 'hidden',
    position: 'relative',
    ...shadow.md,
  },
  legal: {
    ...font.caption, color: colors.textFaint, textAlign: 'center',
    lineHeight: 18, marginTop: space.xs,
  },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  errorText: { color: colors.error, fontSize: 13, flex: 1 },

  linkBtn: { marginTop: space.sm, alignItems: 'center' },
  linkText: { color: colors.textDim, fontSize: 14 },
  linkHighlight: { color: colors.primaryBright, fontWeight: '700' },

  primaryLinkBtn: {
    marginTop: space.xxl, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  primaryLinkText: { color: colors.primaryBright, fontSize: 15, fontWeight: '700' },
});
