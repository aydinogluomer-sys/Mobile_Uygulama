/**
 * R06.03 — the shared pieces of a small form: what the save will do
 * (`FormPreview`) and why it did not happen (`FormError`).
 *
 * Used by the checklist editor, the goal editor, the recovery plan sheet and
 * the review's next-action picker, so an error reads, sounds (role "alert")
 * and sits the same way everywhere. The rule that comes with it: a failed
 * save keeps the form open with what the user typed -- the error is shown
 * where the input is, nothing is lost.
 */
import { View, Text, StyleSheet } from 'react-native';
import { space, radius, hexA, type Palette } from '../../lib/tokens';
import { useThemedStyles } from '../../hooks/useThemeColors';

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    error: { fontSize: 12, color: c.error, marginTop: space.xs },
    preview: {
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: hexA(c.accent, 0.06),
      borderRadius: radius.md,
      padding: space.sm,
      gap: 2,
    },
    previewLabel: { fontSize: 10, letterSpacing: 1, color: c.textFaint },
    previewText: { fontSize: 13, color: c.textDim },
  });

export function FormError({ message }: { message: string | null | undefined }) {
  const s = useThemedStyles(makeStyles);
  if (!message) return null;
  return (
    <Text style={s.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}

export function FormPreview({ label = 'Önizleme', children }: { label?: string; children: React.ReactNode }) {
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.preview} accessibilityLabel={label}>
      <Text style={s.previewLabel}>{label.toLocaleUpperCase('tr-TR')}</Text>
      {typeof children === 'string' ? <Text style={s.previewText}>{children}</Text> : children}
    </View>
  );
}
