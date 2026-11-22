/**
 * Senkron durumu rozeti — plan §18.
 *
 * Sunum bileşeni: store'a bağlanmaz, sayıları prop olarak alır. Kararı veren
 * saf fonksiyon (`syncBadgeParts`) dışa açık, böylece "dead görsel olarak
 * ayırt edilebilir" iddiası bir renderer'a ihtiyaç duymadan test edilebilir.
 */
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, space, font, hexA, palettes, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';

export type SyncBadgeTone = 'pending' | 'dead';

export type SyncBadgePart = {
  tone: SyncBadgeTone;
  count: number;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  /** Yalnız `dead` için: tonal dolgunun üstüne görünür bir çerçeve. */
  outlined: boolean;
};

/**
 * Gösterilecek parçaları üretir. Saf — I/O yok, store yok, React yok.
 *
 * Sıralama bilinçli: `dead` ÖNCE gelir. İki rozet birden varsa dikkat
 * gerektiren olan başta durmalı; "3 bekliyor · 1 eşitlenemedi" sıralaması
 * ikincisini bir dipnot gibi okutur.
 */
export function syncBadgeParts(
  pending: number,
  dead: number,
  palette: Palette = palettes.dark,
): SyncBadgePart[] {
  const parts: SyncBadgePart[] = [];
  if (dead > 0) {
    parts.push({
      tone: 'dead',
      count: dead,
      label: `${dead} eşitlenemedi`,
      icon: 'alert-circle',
      color: palette.error,
      outlined: true,
    });
  }
  if (pending > 0) {
    parts.push({
      tone: 'pending',
      count: pending,
      label: `${pending} bekliyor`,
      icon: 'cloud-upload-outline',
      color: palette.info,
      outlined: false,
    });
  }
  return parts;
}

/** Ekran okuyucu metni — dead durumunda kurtarma yolunu da söyler. */
export function syncBadgeA11yLabel(pending: number, dead: number): string {
  const sentences: string[] = [];
  if (dead > 0) {
    sentences.push(
      `${dead} kayıt eşitlenemedi. Yeniden denemek için alışkanlığa tekrar dokun.`,
    );
  }
  if (pending > 0) {
    sentences.push(`${pending} kayıt eşitlenmeyi bekliyor.`);
  }
  return sentences.join(' ');
}

type Props = {
  /** `useLogStore().pendingSyncCount` */
  pending: number;
  /** `useLogStore().deadSyncCount` */
  dead: number;
  style?: StyleProp<ViewStyle>;
};

const makeStyles = (_c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    pill: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      borderRadius: radius.xs, paddingHorizontal: 7, paddingVertical: 3,
    },
    label: { ...font.caption, fontSize: 11, fontWeight: '700' },
  });

export default function SyncStatusBadge({ pending, dead, style }: Props) {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const parts = syncBadgeParts(pending, dead, c);
  // Her şey senkronsa rozet hiç var olmaz — "0 bekliyor" kalıcı bir gürültü
  // olur ve gerçekten bir şey beklerken fark edilmesini zorlaştırırdı.
  if (parts.length === 0) return null;

  return (
    <View
      style={[s.row, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={syncBadgeA11yLabel(pending, dead)}
    >
      {parts.map((p) => (
        <View
          key={p.tone}
          style={[
            s.pill,
            { backgroundColor: hexA(p.color, 0.16) },
            p.outlined && { borderWidth: 1, borderColor: hexA(p.color, 0.55) },
          ]}
        >
          <Ionicons name={p.icon} size={11} color={p.color} />
          <Text style={[s.label, { color: p.color }]}>{p.label}</Text>
        </View>
      ))}
    </View>
  );
}
