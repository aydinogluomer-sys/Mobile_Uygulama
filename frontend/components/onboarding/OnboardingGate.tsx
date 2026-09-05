import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, space } from '../../lib/tokens';
import { Button } from '../ui';

type Props = {
  error: string | null;
  onRetry: () => void;
};

/**
 * Shown when the app could not read whether this account needs onboarding.
 *
 * ## Why this screen exists at all
 *
 * The alternative was the defect it replaces: a failed read set
 * `hydrated = true` with `status = 'unknown'`, the router stopped waiting,
 * `needsOnboarding('unknown')` answered false, and a brand-new user landed on
 * an empty Today. The app had not decided they were finished — it had failed
 * to ask — and those two produced the same outcome.
 *
 * ## Why it is not a spinner
 *
 * A spinner promises that waiting will help. The read already failed; nothing
 * is in flight. Retrying is the user's decision and needs a control they can
 * press, otherwise a first launch on a bad connection is a frozen app with no
 * way forward and nothing to report.
 *
 * The underlying message is shown rather than replaced with a generic
 * sentence: "Oturum bulunamadı." and a network timeout call for different
 * actions from the user, and only one of them is worth retrying on the spot.
 */
export default function OnboardingGate({ error, onRetry }: Props) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.body}>
        <View style={s.mark}>
          <Ionicons name="cloud-offline-outline" size={26} color={colors.warning} />
        </View>

        <Text style={s.title}>Hesabın hazırlanamadı</Text>
        <Text style={s.lede}>
          Ayarlarını okuyamadık, bu yüzden seni yanlış ekrana göndermek yerine
          burada durduk. Bağlantını kontrol edip tekrar deneyebilirsin.
        </Text>

        {!!error && (
          <View style={s.detail}>
            <Text style={s.detailLabel}>Hata</Text>
            <Text style={s.detailText}>{error}</Text>
          </View>
        )}

        <Button
          label="Tekrar dene"
          icon="refresh-outline"
          onPress={onRetry}
          size="lg"
          style={s.action}
          accessibilityHint="Hesap ayarlarını yeniden okur."
        />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: space.h, gap: space.md },
  mark: {
    width: 56, height: 56, borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.sm,
  },
  title: { ...font.title, color: colors.text },
  lede: { ...font.body, color: colors.textDim, lineHeight: 23 },
  detail: {
    marginTop: space.sm, padding: space.lg,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.borderSubtle, gap: 4,
  },
  detailLabel: { ...font.overline, color: colors.textFaint },
  detailText: { ...font.bodySm, color: colors.textDim, lineHeight: 20 },
  action: { marginTop: space.lg },
});
