/**
 * F08 (BLD-02) — what a build without its public Supabase configuration shows.
 *
 * The error is in the build, not in anything the user did, so there is no button ("Try again" would
 * be an empty promise) and no blame; the missing variable NAMES are shown small for whoever reports
 * it. Values are never shown: the component only ever receives names.
 *
 * Deliberately depends on react-native and theme tokens only — no safe-area provider, no icon font —
 * because it renders when the rest of the app could not start.
 */
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { type Palette } from '../lib/tokens';
import { useThemedStyles } from '../hooks/useThemeColors';

export type ConfigErrorScreenProps = {
  /** Eksik değişkenlerin ADLARI; değerler asla gösterilmez. */
  readonly missing: readonly string[];
};

export const CONFIG_ERROR_TITLE = 'Yapılandırma eksik';
export const CONFIG_ERROR_BODY =
  'Bu sürüm gerekli ayarlar olmadan oluşturulmuş. Uygulamayı güncellemeyi dene; sorun sürerse bize bildir.';

export default function ConfigErrorScreen({ missing }: ConfigErrorScreenProps) {
  const s = useThemedStyles(makeStyles);
  const names = missing.filter((n) => typeof n === 'string' && /^[A-Z0-9_]+$/.test(n)).join(', ');

  useEffect(() => {
    // Sentry may not be initialised in a broken build; names only, never values.
    console.error(`[config] Eksik ortam değişkeni: ${names}`);
  }, [names]);

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <View style={s.body} accessibilityRole="alert">
        <Text style={s.title} accessibilityRole="header">
          {CONFIG_ERROR_TITLE}
        </Text>
        <Text style={s.lede}>{CONFIG_ERROR_BODY}</Text>
        {names ? <Text style={s.detail}>{names}</Text> : null}
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 48 },
    body: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: 12 },
    title: { fontSize: 22, lineHeight: 28, fontWeight: '600', color: colors.text },
    lede: { fontSize: 16, lineHeight: 23, color: colors.textDim },
    detail: { fontSize: 13, lineHeight: 19, color: colors.textDim, marginTop: 4 },
  });
