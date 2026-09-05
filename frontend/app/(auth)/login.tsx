import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors, space, radius, font, shadow, fontFamily } from '../../lib/tokens';
import { Button } from '../../components/ui';
import FloatingLabelInput from '../../components/ui/FloatingLabelInput';
import { useNotionSessionStore } from '../../store/notionSessionStore';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {/* Marka */}
          <View style={s.brand}>
            <View style={s.mark}>
              <Text style={s.markLetter}>a</Text>
              <View style={s.markDot} />
            </View>
            <Text style={s.wordmark}>Aderyth</Text>
            <Text style={s.tagline}>Alışkanlıklarını taşı, iradeni yönet.</Text>
          </View>

          {/* Form */}
          <View style={s.form}>
            <Button label="Notion ile Giriş" onPress={handleNotionLogin} loading={loading} size="lg" style={{ marginBottom: space.xs }} />

            <View style={s.dividerRow}>
              <View style={s.dividerLine} />
              <Text style={s.dividerText}>veya e-posta ile</Text>
              <View style={s.dividerLine} />
            </View>

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

            <Button label="Giriş Yap" onPress={handleLogin} loading={loading} size="lg" style={{ marginTop: space.sm }} />

            <Link href="/(auth)/register" asChild>
              <TouchableOpacity style={s.linkBtn}>
                <Text style={s.linkText}>Hesabın yok mu? <Text style={s.linkHighlight}>Kayıt ol</Text></Text>
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
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 40 },

  brand: { alignItems: 'center', marginBottom: 44 },
  mark: {
    width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.lg, ...shadow.sm,
  },
  markLetter: { fontFamily: fontFamily.serif, fontSize: 34, fontStyle: 'italic', color: colors.primary, lineHeight: 40 },
  markDot: { position: 'absolute', top: 12, right: 12, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary },
  wordmark: { ...font.display, color: colors.text, marginBottom: 8 },
  tagline: { ...font.body, color: colors.textDim, textAlign: 'center' },

  form: { gap: space.md },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: space.xs },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textFaint, fontSize: 12 },

  forgotBtn: { alignSelf: 'flex-end', marginTop: -4 },
  forgotText: { color: colors.primaryBright, fontSize: 13, fontWeight: '600' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  errorText: { color: colors.error, fontSize: 13, flex: 1 },

  linkBtn: { marginTop: space.lg, alignItems: 'center' },
  linkText: { color: colors.textDim, fontSize: 14 },
  linkHighlight: { color: colors.primaryBright, fontWeight: '700' },
});
