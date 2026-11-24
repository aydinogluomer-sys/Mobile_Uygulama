/**
 * R02.05 — "aynı notta çatışan sürümü koru": an edit met a newer version made
 * elsewhere. Neither text has been thrown away; the user chooses what stays.
 *
 * Three choices, always all three, in plain words:
 *   - Bu cihazdakini tut   this device's text replaces the other one
 *   - Diğerini tut         the other text stays, this device's edit is dropped
 *   - İkisini de tut       nothing is dropped (a second note / both texts in the day)
 */
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { space, radius, hexA, type Palette } from '../lib/tokens';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';
import Button from './ui/Button';

export type ConflictChoiceValue = 'mine' | 'theirs' | 'both';

export default function ConflictChoice({
  what, onChoose, busy = false,
}: {
  /** e.g. `"Plan" notu` or `8 Ekim günlüğü` */
  what: string;
  onChoose: (c: ConflictChoiceValue) => void;
  busy?: boolean;
}) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.box} accessibilityRole="alert" accessibilityLabel={`${what} başka bir yerde de değiştirildi. Hangisi kalsın?`}>
      <View style={s.head}>
        <Ionicons name="git-compare-outline" size={18} color={colors.warning} />
        <Text style={s.title}>{what} başka bir yerde de değiştirildi</Text>
      </View>
      <Text style={s.body}>İki sürüm de duruyor; hiçbiri silinmedi. Hangisi kalsın?</Text>
      <View style={s.row}>
        <Button size="sm" variant="tonal" label="Bu cihazdakini tut" onPress={() => onChoose('mine')} disabled={busy}
          accessibilityLabel="Bu cihazdaki sürümü tut" />
        <Button size="sm" variant="ghost" label="Diğerini tut" onPress={() => onChoose('theirs')} disabled={busy}
          accessibilityLabel="Diğer sürümü tut, bu cihazdaki değişikliği bırak" />
        <Button size="sm" variant="primary" label="İkisini de tut" onPress={() => onChoose('both')} disabled={busy}
          accessibilityLabel="İki sürümü de tut" />
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    box: { borderWidth: 1, borderColor: hexA(colors.warning, 0.5), backgroundColor: hexA(colors.warning, 0.08), borderRadius: radius.lg, padding: space.md, marginBottom: space.md, gap: space.sm },
    head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    title: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
    body: { color: colors.textDim, fontSize: 13 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  });
