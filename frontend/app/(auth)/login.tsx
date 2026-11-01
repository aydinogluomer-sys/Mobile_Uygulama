import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
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
import { useNotionSessionStore } from '../../store/notionSessionStore';
import { NOTION_INTEGRATION_ENABLED } from '../../lib/featureGates';
import { seedDemoData } from '../../lib/demoSeed';

const decorativeA11y =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as Record<string, unknown>)
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

const POSTER_PILLARS = [
  { num: '01', title: 'Sakin Akış Mimarisi', sub: 'Gürültüsüz, tek odaklı günlük ritim.' },
  { num: '02', title: 'Kintsugi Şefkatli Telafi', sub: 'Kırılan seriyi suçluluksuz onaran sistem.' },
  { num: '03', title: 'Tam Veri Egemenliği', sub: 'Sıfır reklam, sıfır izleme SDK’sı.' },
] as const;

export default function LoginScreen() {
  const { width } = useWindowDimensions();
  const isSplit = width >= 860;
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleBypassLogin() {
    setError('');
    setLoading(true);
    try {
      await seedDemoData();
    } catch {
      /* demo seed optional in dev */
    }
    useNotionSessionStore.setState({
      session: {
        workspaceName: 'Aderyth Demo',
        workspaceIcon: '⚡',
        workspaceId: 'demo-local',
        connectedAt: new Date().toISOString(),
      },
    });
    router.replace('/tabs/today');
    setLoading(false);
  }

  async function handleLogin() {
    if (!email || !password) {
      setError('E-posta ve şifre giriniz.');
      return;
    }
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
  }

  async function handleNotionLogin() {
    setError('');
    try {
      setLoading(true);
      const ok = await useNotionSessionStore.getState().login();
      if (!ok) throw new Error(useNotionSessionStore.getState().error ?? 'Notion bağlantısı kurulamadı');
      router.replace('/tabs/today');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const formContent = (
    <>
      {!isSplit ? (
        <EditorialBanner
          source={ONBOARDING_ART.authSanctuary}
          textureSource={TEXTURES.linen}
          eyebrow="GÜVENLİ SIĞINAK"
          title="Tekrar Hoş Geldin"
          subtitle="Sakin odak alanına ve günlük ritmine kaldığın yerden devam et."
          accentColor={colors.primary}
          minHeight={96}
          style={{ marginBottom: space.xl }}
        />
      ) : null}

      {/* Marka */}
      <View style={[s.brand, isSplit && s.brandSplit]}>
        <View style={s.mark}>
          <Text style={s.markLetter}>a</Text>
          <View style={s.markDot} />
        </View>
        <Text style={s.wordmark}>Aderyth</Text>
        <Text style={s.tagline}>Alışkanlıklarını taşı, iradeni yönet.</Text>
      </View>

      {/* Form */}
      <View style={s.formCard}>
        <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" opacity={0.14} size={112} />
        {/* Signing in with Notion goes through the same `notion-auth` edge
            function as the Notion integration, and that function is not
            deployed in this release (see lib/featureGates.ts). Leaving the
            button here would put a guaranteed failure on the first screen
            of the app, which is a worse place to find one than Settings.
            The divider goes with it -- "or with e-mail" reads as an
            orphan when there is nothing above it to be an alternative to. */}
        {NOTION_INTEGRATION_ENABLED && (
          <>
            <Button label="Notion ile Giriş" onPress={handleNotionLogin} loading={loading} size="lg" style={{ marginBottom: space.xs }} />

            <View style={s.dividerRow}>
              <View style={s.dividerLine} />
              <Text style={s.dividerText}>veya e-posta ile</Text>
              <View style={s.dividerLine} />
            </View>
          </>
        )}

        <FloatingLabelInput
          label="E-posta"
          icon="mail-outline"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          value={email}
          onChangeText={(t) => { setEmail(t); setError(''); }}
        />

        <FloatingLabelInput
          label="Şifre"
          icon="lock-closed-outline"
          secureTextEntry={!showPw}
          autoComplete="current-password"
          textContentType="password"
          value={password}
          onChangeText={(t) => { setPassword(t); setError(''); }}
          onSubmitEditing={handleLogin}
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

        <Link href="/(auth)/forgot-password" asChild>
          <TouchableOpacity style={s.forgotBtn} disabled={loading}>
            <Text style={s.forgotText}>Şifremi unuttum</Text>
          </TouchableOpacity>
        </Link>

        {!!error && (
          <View style={s.errorRow}>
            <Ionicons name="alert-circle" size={15} color={colors.error} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <Button
          label="🚀 Girişi Geç (Demo Modu)"
          onPress={handleBypassLogin}
          loading={loading}
          size="lg"
          style={{ marginTop: space.sm, backgroundColor: colors.accent }}
        />

        <Button label="Giriş Yap" onPress={handleLogin} loading={loading} size="lg" variant="secondary" style={{ marginTop: space.xs }} />

        <Link href="/(auth)/register" asChild>
          <TouchableOpacity style={s.linkBtn}>
            <Text style={s.linkText}>Hesabın yok mu? <Text style={s.linkHighlight}>Kayıt ol</Text></Text>
          </TouchableOpacity>
        </Link>
      </View>
    </>
  );

  if (isSplit) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.splitRoot}>
          {/* Sol %52 Tam Boy Editoryal Poster Sütunu */}
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
                <Text style={s.posterPillText}>ADERYTH SANCTUARY · ATELIER</Text>
              </View>
            </View>

            <View style={s.posterBottomBlock}>
              <Text style={s.posterHeadline}>Sessiz odak,{'\n'}kalıcı ritim.</Text>
              <Text style={s.posterLead}>
                Sıcak bazalt ve keten dokulu kişisel çalışma sığınağına adım at. İradeni yormadan alışkanlıklarını inşa et.
              </Text>
              <View style={s.pillarList}>
                {POSTER_PILLARS.map((p) => (
                  <View key={p.num} style={s.pillarRow}>
                    <Text style={s.pillarNum}>{p.num}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.pillarTitle}>{p.title}</Text>
                      <Text style={s.pillarSub}>{p.sub}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* Sağ %48 Keten Dokulu Giriş Atölyesi */}
          <KeyboardAvoidingView style={s.atelierColumn} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TexturedSurface source={TEXTURES.linen} textureOpacity={0.05} overlayOnly />
            <ScrollView contentContainerStyle={s.atelierScroll} keyboardShouldPersistTaps="handled">
              {formContent}
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
          {formContent}
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
    gap: 16,
    maxWidth: 460,
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
  pillarList: {
    gap: 10,
    marginTop: 8,
  },
  pillarRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: hexA(colors.bgSunk, 0.66),
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 12,
  },
  pillarNum: {
    fontFamily: fontFamily.serif,
    fontSize: 18,
    color: colors.warning,
    marginTop: 1,
  },
  pillarTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  pillarSub: {
    fontSize: 12,
    color: colors.textFaint,
    marginTop: 2,
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

  brand: { alignItems: 'center', marginBottom: 32 },
  brandSplit: { marginBottom: 28 },
  mark: {
    width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.lg, ...shadow.sm,
  },
  markLetter: { fontFamily: fontFamily.serif, fontSize: 34, fontStyle: 'italic', color: colors.primary, lineHeight: 40 },
  markDot: { position: 'absolute', top: 12, right: 12, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary },
  wordmark: { ...font.display, color: colors.text, marginBottom: 8 },
  tagline: { ...font.body, color: colors.textDim, textAlign: 'center' },

  formCard: {
    gap: space.md,
    backgroundColor: alphaHex(colors.surface, '92'),
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    overflow: 'hidden',
    position: 'relative',
    ...shadow.md,
  },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: space.xs },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textFaint, fontSize: 12 },

  forgotBtn: { alignSelf: 'flex-end', marginTop: -4 },
  forgotText: { color: colors.primaryBright, fontSize: 13, fontWeight: '600' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  errorText: { color: colors.error, fontSize: 13, flex: 1 },

  linkBtn: { marginTop: space.md, alignItems: 'center' },
  linkText: { color: colors.textDim, fontSize: 14 },
  linkHighlight: { color: colors.primaryBright, fontWeight: '700' },
});
