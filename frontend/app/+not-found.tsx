import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { font, onColor, radius, space, type Palette } from '../lib/tokens';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';

export default function NotFoundScreen(): React.JSX.Element {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.card}>
        <View style={s.iconWrap}>
          <Ionicons name="compass-outline" size={28} color={c.primary} />
        </View>
        <Text style={s.title} accessibilityRole="header">
          Bu sayfa bulunamadı
        </Text>
        <Text style={s.body}>
          Bağlantı eski ya da hatalı olabilir. Bugün ekranına dönebilirsin.
        </Text>
        <Link
          href="/tabs/today"
          style={s.cta}
          accessibilityRole="link"
          accessibilityLabel="Bugün ekranına dön"
        >
          <Text style={s.ctaText}>Bugün&apos;e dön</Text>
        </Link>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: c.bg,
      alignItems: 'center',
      justifyContent: 'center',
      padding: space.xl,
    },
    card: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.xxl,
      alignItems: 'center',
      gap: space.md,
    },
    iconWrap: {
      width: 56,
      height: 56,
      borderRadius: radius.full,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.borderSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      ...font.title,
      color: c.text,
      textAlign: 'center',
    },
    body: {
      ...font.bodySm,
      color: c.textDim,
      textAlign: 'center',
      lineHeight: 20,
    },
    cta: {
      minHeight: 48,
      paddingHorizontal: space.xl,
      paddingVertical: space.md,
      borderRadius: radius.md,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.xs,
    },
    ctaText: {
      ...font.body,
      color: onColor(c.primary),
      fontWeight: '700',
    },
  });
