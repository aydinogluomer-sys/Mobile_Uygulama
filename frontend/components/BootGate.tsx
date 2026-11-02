/**
 * F06 (NAV-04, SYN-23) — what the root layout shows when the app cannot start normally.
 *
 *   stalled  the boot chain has run for 12 s (BOOT_WATCHDOG_MS): a slow or captive connection, a
 *            storage read that hangs. A spinner that never ends promises that waiting helps; this
 *            offers the one thing that can: start again.
 *   config   EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY were not set at build time. Nothing the user can
 *            do fixes it, so there is no button; the detail is shown small for whoever reports it.
 *
 * Calm wording, no blame, no exclamation; nothing the user wrote is lost (the outbox is on disk).
 * Only design tokens; no animation (Reduce Motion is unaffected).
 */
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, space } from '../lib/tokens';
import { Button } from './ui';

type Props =
  | { variant: 'stalled'; onRetry: () => void }
  | { variant: 'config'; detail: string };

export default function BootGate(props: Props) {
  const stalled = props.variant === 'stalled';
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.body}>
        <View style={s.mark}>
          <Ionicons name={stalled ? 'hourglass-outline' : 'construct-outline'} size={26} color={colors.warning} />
        </View>

        <Text style={s.title} accessibilityRole="header">
          {stalled ? 'Açılış beklenenden uzun sürüyor' : 'Uygulama yapılandırması eksik'}
        </Text>

        {props.variant === 'stalled' ? (
          <>
            <Text style={s.lede}>Bağlantın yavaş olabilir. Yazdıkların kaybolmadı.</Text>
            <Button
              label="Tekrar dene"
              icon="refresh-outline"
              onPress={props.onRetry}
              size="lg"
              style={s.action}
              accessibilityHint="Açılışı yeniden başlatır."
            />
          </>
        ) : (
          <Text style={s.detail} accessibilityLiveRegion="polite">{props.detail}</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: {
    flex: 1, justifyContent: 'center', paddingHorizontal: space.h, gap: space.md,
    maxWidth: 480, width: '100%', alignSelf: 'center',
  },
  mark: {
    width: 56, height: 56, borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.sm,
  },
  title: { ...font.title, color: colors.text },
  lede: { ...font.body, color: colors.textDim, lineHeight: 23 },
  detail: { ...font.bodySm, color: colors.textDim, lineHeight: 20 },
  action: { marginTop: space.lg },
});
