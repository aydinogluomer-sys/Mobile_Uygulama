import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, radius, font, shadow, fontFamily, hexA } from '../../lib/tokens';
import { Button } from '../ui';

type Props = {
  /** The address the account was opened with — shown so a typo is catchable. */
  email: string;
  onResend: () => void;
  onChangeEmail: () => void;
  /** Seconds left before another confirmation mail may be requested. */
  resendCooldown: number;
  resending?: boolean;
  notice?: string;
  error?: string;
};

/**
 * The state after a successful `signUp()` when the project requires email
 * confirmation.
 *
 * ## Why this is a screen and not a line of text
 *
 * It used to be `setInfo('Hesabın oluşturuldu. E-postanı doğrula…')` rendered
 * into the same 13px row that shows validation errors, three pixels below the
 * button the user just pressed. Two things were wrong with that. The row is
 * where failures appear, so the one moment the flow actually succeeded looked
 * like the moments it did not — same size, same position, same weight, only
 * the colour differed. And it is the single point in the whole product where
 * the user has to leave the app and come back; a sentence cannot carry that
 * instruction, because the form is still sitting underneath it inviting
 * another submission.
 *
 * So the form is replaced outright. What is on screen is the only thing left
 * to do.
 *
 * ## The address is repeated back
 *
 * A mistyped address is indistinguishable from a mail that has not arrived
 * yet: both are an empty inbox. Showing what was actually submitted — in mono,
 * so `rn`/`m` and `l`/`1` separate — turns a ten-minute wait into a glance.
 * `onChangeEmail` returns to the form rather than making them restart.
 *
 * ## What it deliberately does not say
 *
 * Whether the address was already registered. Supabase answers a repeat signup
 * with a user object carrying an empty `identities` array and no session,
 * which is a distinction this component could read and render — and rendering
 * it would hand an attacker a membership oracle for any address they care to
 * type. That is the exact leak the server's enumeration protection exists to
 * close, so the copy covers both cases and the code never branches on it.
 */
export default function SignupPending({
  email, onResend, onChangeEmail, resendCooldown, resending, notice, error,
}: Props) {
  const canResend = resendCooldown <= 0 && !resending;

  return (
    <View style={s.wrap} accessibilityRole="summary">
      <View style={s.mark}>
        <Ionicons name="mail-open-outline" size={26} color={colors.primary} />
      </View>

      <Text style={s.eyebrow}>KAYIT ALINDI</Text>
      <Text style={s.title}>Şimdi e-postanı doğrula</Text>

      <Text style={s.lede}>
        Hesabını etkinleştirmek için bir doğrulama bağlantısı gönderdik.
      </Text>

      <View style={s.addressChip}>
        <Ionicons name="at-outline" size={15} color={colors.textFaint} />
        <Text style={s.address} numberOfLines={1} ellipsizeMode="middle">{email}</Text>
      </View>

      <View style={s.steps}>
        <Step n="1" text="Gelen kutunu aç." />
        <Step n="2" text="Mesajdaki doğrulama bağlantısına dokun." />
        <Step n="3" text="Buraya dön ve giriş yap." />
      </View>

      <View style={s.hintRow}>
        <Ionicons name="information-circle-outline" size={15} color={colors.textFaint} />
        <Text style={s.hint}>
          Birkaç dakika içinde gelmezse Spam / Gereksiz klasörüne bak. Bu adres
          zaten kayıtlıysa yeni bir posta gelmez — doğrudan giriş yapabilirsin.
        </Text>
      </View>

      {!!notice && (
        <View style={s.noticeRow}>
          <Ionicons name="checkmark-circle" size={15} color={colors.success} />
          <Text style={s.noticeText}>{notice}</Text>
        </View>
      )}
      {!!error && (
        <View style={s.noticeRow}>
          <Ionicons name="alert-circle" size={15} color={colors.error} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      <Button
        label={resendCooldown > 0 ? `Tekrar gönder (${resendCooldown})` : 'Doğrulama postasını tekrar gönder'}
        onPress={onResend}
        variant="tonal"
        size="lg"
        icon="refresh-outline"
        loading={resending}
        disabled={!canResend}
        style={{ marginTop: space.xl }}
        accessibilityHint={
          resendCooldown > 0
            ? `Yeni bir posta istemek için ${resendCooldown} saniye bekleyin.`
            : 'Doğrulama e-postasını aynı adrese yeniden gönderir.'
        }
      />

      <TouchableOpacity onPress={onChangeEmail} style={s.linkBtn}>
        <Text style={s.linkText}>
          Adresi yanlış mı yazdın? <Text style={s.linkHighlight}>Düzelt</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <View style={s.step}>
      <View style={s.stepNum}><Text style={s.stepNumText}>{n}</Text></View>
      <Text style={s.stepText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center' },

  mark: {
    width: 64, height: 64, borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.xl, ...shadow.sm,
  },

  eyebrow: { ...font.overline, color: colors.primary, marginBottom: space.sm },
  title: { ...font.title, color: colors.text, textAlign: 'center', marginBottom: space.md },
  lede: { ...font.body, color: colors.textDim, textAlign: 'center', lineHeight: 22, marginBottom: space.xl },

  addressChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'stretch', paddingVertical: space.md, paddingHorizontal: space.lg,
    backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  address: { flex: 1, fontFamily: fontFamily.mono, fontSize: 14, color: colors.text },

  steps: { alignSelf: 'stretch', gap: space.md, marginTop: space.xl },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  stepNum: {
    width: 22, height: 22, borderRadius: radius.pill,
    backgroundColor: hexA(colors.primary, 0.14), borderWidth: 1, borderColor: hexA(colors.primary, 0.28),
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  stepNumText: { fontFamily: fontFamily.mono, fontSize: 11, fontWeight: '700', color: colors.primary },
  stepText: { flex: 1, ...font.bodySm, color: colors.textDim, lineHeight: 20 },

  hintRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    alignSelf: 'stretch', marginTop: space.xl,
  },
  hint: { flex: 1, ...font.caption, color: colors.textFaint, lineHeight: 18 },

  noticeRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    alignSelf: 'stretch', marginTop: space.lg,
  },
  noticeText: { flex: 1, color: colors.success, fontSize: 13, lineHeight: 18 },
  errorText: { flex: 1, color: colors.error, fontSize: 13, lineHeight: 18 },

  linkBtn: { marginTop: space.lg, alignItems: 'center' },
  linkText: { color: colors.textDim, fontSize: 14 },
  linkHighlight: { color: colors.primaryBright, fontWeight: '700' },
});
