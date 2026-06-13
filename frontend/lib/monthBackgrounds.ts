/**
 * Takvim ekranı için aylık arka plan görselleri (Ocak=0 … Aralık=11).
 * React Native `require()` statik literal yol gerektirdiği için harita elle yazılır.
 * Görseller: frontend/assets/images/months/ (kullanıcı tasarımı, mevsimsel illüstrasyon).
 */
import type { ImageSourcePropType } from 'react-native';

export const monthBackgrounds: ImageSourcePropType[] = [
  require('../assets/images/months/01-ocak.webp'),
  require('../assets/images/months/02-subat.webp'),
  require('../assets/images/months/03-mart.webp'),
  require('../assets/images/months/04-nisan.webp'),
  require('../assets/images/months/05-mayis.webp'),
  require('../assets/images/months/06-haziran.webp'),
  require('../assets/images/months/07-temmuz.webp'),
  require('../assets/images/months/08-agustos.webp'),
  require('../assets/images/months/09-eylul.webp'),
  require('../assets/images/months/10-ekim.webp'),
  require('../assets/images/months/11-kasim.webp'),
  require('../assets/images/months/12-aralik.webp'),
];

/** 0–11 ay indeksinden arka plan görselini döndürür (sınır dışı değerleri sarmalar). */
export function getMonthBackground(month: number): ImageSourcePropType {
  const i = ((month % 12) + 12) % 12;
  return monthBackgrounds[i];
}
