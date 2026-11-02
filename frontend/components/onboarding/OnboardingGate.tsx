import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, space } from '../../lib/tokens';
import { Button } from '../ui';

/** F06 (NAV-04): which way out the gate offers first. */
export type GateErrorKind = 'session' | 'network' | 'other';

const NETWORK_ERROR = /bağlant|çevrimdışı|network|fetch|sunucu/i;
const SESSION_ERROR = /oturum/i;

/**
 * `/bağlant|çevrimdışı|network|fetch|sunucu/i` => network (checked FIRST: "Çevrimdışısın; oturum
 * bağlantı gelince yenilenecek." is a connection problem that happens to mention the session);
 * `/oturum/i` => session; anything else => other. `null` (no message) => network.
 */
export function classifyGateError(error: string | null): GateErrorKind {
  if (error === null) return 'network';
  if (NETWORK_ERROR.test(error)) return 'network';
  if (SESSION_ERROR.test(error)) return 'session';
  return 'other';
}

type Props = {
  error: string | null;
  onRetry: () => void;
  /** F06: the F04 sign-out. Without it the gate offers only "Tekrar dene" (as before F06). */
  onSignOut?: () => void;
  signingOut?: boolean;
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
 *
 * ## F06 (NAV-04): a way out
 *
 * "Tekrar dene" was the only control, so a user whose session could not be read, or who had no
 * connection on a first launch, was locked in. Now a session problem leads with "Tekrar giriş yap"
 * and a connection problem keeps "Tekrar dene" first with "Oturumu kapat" beside it; both sign out
 * through the F04 service (work not yet sent stays on the device for this account). A user whose
 * status was already known opens on it offline instead (lib/onboardingCache.ts), so this gate is
 * now for the cases the app genuinely cannot decide.
 */
export default function OnboardingGate({ error, onRetry, onSignOut, signingOut = false }: Props) {
  const kind = classifyGateError(error);
  const session = kind === 'session';

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.body}>
        <View style={s.mark}>
          <Ionicons name={session ? 'key-outline' : 'cloud-offline-outline'} size={26} color={colors.warning} />
        </View>

        <Text style={s.title} accessibilityRole="header">
          {session ? 'Oturumunu yenilemek gerekiyor' : 'Hesabın hazırlanamadı'}
        </Text>
        <Text style={s.lede}>
          {session
            ? 'Hesabına yeniden giriş yapman gerekiyor. Yazdıkların bu cihazda duruyor.'
            : 'Ayarlarını okuyamadık. Bağlantı yoksa bu normal; seni yanlış ekrana göndermek yerine burada durduk. Bağlantın gelince tekrar deneyebilirsin.'}
        </Text>

        {!!error && (
          <View style={s.detail} accessibilityLiveRegion="polite">
            <Text style={s.detailLabel}>Hata</Text>
            <Text style={s.detailText}>{error}</Text>
          </View>
        )}

        {session && onSignOut ? (
          <>
            <Button
              label="Tekrar giriş yap"
              icon="log-in-outline"
              onPress={onSignOut}
              size="lg"
              loading={signingOut}
              disabled={signingOut}
              style={s.action}
              accessibilityHint="Oturumu kapatır ve giriş ekranına götürür."
            />
            <Button
              label="Tekrar dene"
              icon="refresh-outline"
              variant="ghost"
              onPress={onRetry}
              size="lg"
              disabled={signingOut}
              accessibilityHint="Hesap ayarlarını yeniden okur."
            />
          </>
        ) : (
          <>
            <Button
              label="Tekrar dene"
              icon="refresh-outline"
              onPress={onRetry}
              size="lg"
              disabled={signingOut}
              style={s.action}
              accessibilityHint="Hesap ayarlarını yeniden okur."
            />
            {onSignOut ? (
              <Button
                label="Oturumu kapat"
                icon="log-out-outline"
                variant="ghost"
                onPress={onSignOut}
                size="lg"
                loading={signingOut}
                disabled={signingOut}
                accessibilityHint="Giriş ekranına döner. Gönderilmemiş değişikliklerin bu cihazda kalır."
              />
            ) : null}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: {
    flex: 1, justifyContent: 'center', paddingHorizontal: space.h, gap: space.md,
    // F06: a readable line length on a tablet or a desktop browser
    maxWidth: 480, width: '100%', alignSelf: 'center',
  },
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
