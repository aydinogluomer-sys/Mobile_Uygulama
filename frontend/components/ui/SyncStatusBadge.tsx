/**
 * Senkron durumu rozeti — plan §18.
 *
 * NEDEN VAR OLDUĞU, tek cümleyle: `dead` bir op kullanıcı açısından SESSİZ
 * VERİ KAYBIDIR.
 *
 * `lib/syncQueue.ts` iki ayrı durum üretiyor ve aradaki fark kullanıcı için
 * hayati:
 *  - `pending` — yazma henüz gitmedi ama gidecek. Kullanıcının yapması
 *    gereken hiçbir şey yok; beklemek yeterli.
 *  - `dead` — yazma retry bütçesini tüketti ve TERMİNAL durumda. Uygulama bir
 *    daha denemeyecek (`orderedPending` dead op'ları dışlar). Kullanıcı
 *    müdahale etmezse o dokunuş sunucuya asla ulaşmayacak.
 *
 * Bu ikisini aynı gri "senkronize ediliyor" tonuyla göstermek, ikincisini
 * birincisi gibi okutur: kullanıcı bekler, hiçbir şey olmaz, kayıt kaybolur.
 * Bu yüzden ayrım YALNIZ renkle değil; farklı ikon, farklı metin ve dead
 * varyantında ek bir çerçeve ile yapılıyor — renk körlüğü ve düşük kontrastlı
 * ekranlarda tek başına ton yeterli bir sinyal değil.
 *
 * NEDEN DOKUNULABİLİR DEĞİL. Buraya bir "yeniden dene" düğmesi koymak cazip,
 * ama dead op için YALAN olurdu: `flushPendingSync` dead op'ları hiç görmez
 * (`orderedPending`), yani düğme tam da kullanıcının en çok düzeltmek
 * istediği durumda hiçbir şey yapmaz. Gerçek kurtarma yolu farklı ve
 * `lib/syncQueue.ts`'in `enqueue` sözleşmesinde yazılı: aynı (alışkanlık,
 * gün) için YENİ bir dokunuş op'u diriltir (attempts sıfırlanır, status
 * `pending`'e döner). Bu yüzden rozet bilgilendirici kalıyor ve kurtarma
 * yolunu erişilebilirlik etiketinde söylüyor.
 *
 * F05: rozet hâlâ dokunulamaz (gerekçe yukarıda aynen geçerli), ama artık
 * ayrı bir kurtarma yolu daha var: Ayarlar > Çevrimdışı Senkronizasyon
 * sayfasındaki "Gönderilemeyenler" listesi, her dead değişiklik için
 * "Yeniden dene" ve "Bu değişikliği bırak" sunar (`reviveSyncOp` /
 * `dropSyncOp`). Rozet metinleri ve `syncBadgeParts` değişmedi.
 *
 * Sunum bileşeni: store'a bağlanmaz, sayıları prop olarak alır. Kararı veren
 * saf fonksiyon (`syncBadgeParts`) dışa açık, böylece "dead görsel olarak
 * ayırt edilebilir" iddiası bir renderer'a ihtiyaç duymadan test edilebilir.
 */
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, font, hexA } from '../../lib/tokens';

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
export function syncBadgeParts(pending: number, dead: number): SyncBadgePart[] {
  const parts: SyncBadgePart[] = [];
  if (dead > 0) {
    parts.push({
      tone: 'dead',
      count: dead,
      label: `${dead} eşitlenemedi`,
      icon: 'alert-circle',
      color: colors.error,
      outlined: true,
    });
  }
  if (pending > 0) {
    parts.push({
      tone: 'pending',
      count: pending,
      label: `${pending} bekliyor`,
      icon: 'cloud-upload-outline',
      color: colors.info,
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

export default function SyncStatusBadge({ pending, dead, style }: Props) {
  const parts = syncBadgeParts(pending, dead);
  // Her şey senkronsa rozet hiç var olmaz — "0 bekliyor" kalıcı bir gürültü
  // olur ve gerçekten bir şey beklerken fark edilmesini zorlaştırırdı.
  if (parts.length === 0) return null;

  return (
    <View
      style={[s.row, style]}
      // `accessible` olmadan bu etiket ATIL kalıyordu: kap erişilebilirlik
      // öğesi olmadığı için ekran okuyucu içindeki iki pill metnini ayrı ayrı
      // ("1 eşitlenemedi", "3 bekliyor") okuyor, yukarıdaki kurtarma cümlesini
      // hiç söylemiyordu — yani `dead`in tek eyleme dönüştürülebilir kısmı
      // duyulmuyordu. Gruplayınca etiket gerçekten okunur.
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

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: radius.xs, paddingHorizontal: 7, paddingVertical: 3,
  },
  label: { ...font.caption, fontSize: 11, fontWeight: '700' },
});
