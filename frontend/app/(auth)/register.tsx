import { useState } from 'react';
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

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function handleRegister() {
    if (!email || !password) { setError('E-posta ve şifre giriniz.'); return; }
    if (password.length < 6) { setError('Şifre en az 6 karakter olmalıdır.'); return; }
    setError('');
    setInfo('');
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else setInfo('Hesabın oluşturuldu. E-postanı doğrula, sonra giriş yap.');
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
            <Text style={s.wordmark}>Hesap Oluştur</Text>
            <Text style={s.tagline}>Atlas ile alışkanlık yolculuğuna başla.</Text>
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
            {!!info && (
              <View style={s.infoRow}>
                <Ionicons name="checkmark-circle" size={15} color={colors.success} />
                <Text style={s.infoText}>{info}</Text>
              </View>
            )}

            <Button label="Kayıt Ol" onPress={handleRegister} loading={loading} size="lg" style={{ marginTop: space.sm }} />

            <Link href="/(auth)/login" asChild>
              <TouchableOpacity style={s.linkBtn}>
                <Text style={s.linkText}>Zaten hesabın var mı? <Text style={s.linkHighlight}>Giriş yap</Text></Text>
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
  wordmark: { ...font.title, color: colors.text, marginBottom: 6 },
  tagline: { ...font.body, color: colors.textDim, textAlign: 'center' },

  form: { gap: space.md },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  errorText: { color: colors.error, fontSize: 13, flex: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  infoText: { color: colors.success, fontSize: 13, flex: 1, lineHeight: 18 },

  linkBtn: { marginTop: space.lg, alignItems: 'center' },
  linkText: { color: colors.textDim, fontSize: 14 },
  linkHighlight: { color: colors.primaryBright, fontWeight: '700' },
});
