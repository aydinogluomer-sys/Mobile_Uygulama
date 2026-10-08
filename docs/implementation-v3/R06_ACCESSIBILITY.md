# R06.04 — Erişilebilirlik: ölçülen, sayılmayan

> Kart: "yalnız accessibilityLabel sayarak tamamlandı deme." Aşağıdaki her satır ya bir
> ölçüm ya da çalışan bir testtir (`frontend/__tests__/repo/accessibilityMeasured.test.tsx`,
> mevcut `ui/uiPrimitivesAccessibility.test.tsx`, `ui/screenAccessibility.test.ts`).

## 1. Kontrast (WCAG 2.1, gerçek token değerleri)

| Ön plan | bg `#15140F` | surface `#1D1C17` | surfaceAlt `#28261F` |
|---|---|---|---|
| text | 15.32 | 14.18 | 12.58 |
| textDim | 9.60 | 8.88 | 7.88 |
| **textFaint (yeni `#928E82`)** | **5.63** | **5.21** | **4.62** |
| textFaint (eski `#827E72`) | 4.55 | 4.21 ✗ | 3.73 ✗ |
| textGhost | 2.43 | 2.25 | 1.99 |
| accent | 5.91 | 5.47 | 4.85 |
| success | 6.81 | 6.30 | 5.59 |
| warning | 8.34 | 7.72 | 6.85 |
| error | 5.00 | 4.63 | 4.11 |
| info | 6.23 | 5.76 | 5.11 |

- **Değişiklik:** `textFaint` `#827E72` → `#928E82` (kart üzerindeki küçük yazı AA'nın altındaydı).
- `textGhost` (2.4:1) okunması gereken metin için kullanılmaz; **23 placeholder** `textFaint`'e
  çevrildi. Kalan kullanımları devre dışı/dekoratif. Test: hiçbir `placeholderTextColor` textGhost değil.
- **Dolu düğme etiketi:** `onColor(fill)` beyaz 4.5:1'e ulaşmıyorsa koyu mürekkep seçer.

| Dolgu | beyaz | koyu mürekkep | seçilen |
|---|---|---|---|
| clay (varsayılan) | 3.12 ✗ | 5.91 | koyu |
| moss | 2.71 ✗ | 6.81 | koyu |
| slate | 2.96 ✗ | 6.23 | koyu |
| amber | 2.21 ✗ | 8.34 | koyu |
| danger | 3.69 ✗ | 5.00 | koyu |

`components/ui/Button.tsx` (primary, danger) ve `components/today/TodayHero.tsx` birincil eylemi.
Görünür değişiklik: dolu düğmelerde etiket koyu mürekkep oldu (beyaz bu dolgularda okunaksızdı).

## 2. Dokunma alanı

- `Button`: `sm` 36pt görünür, `hitSlop` ile **≥ 44pt** dokunma (`MIN_TOUCH`); `md` 46, `lg` 54.
- `Chip` (basılabilir): dikey `hitSlop` 10+10.
- `height` → `minHeight`: büyük sistem yazısında düğme büyür, metin kırpılmaz.

## 3. Büyük yazı

`allowFontScaling={false}` ya da `maxFontSizeMultiplier={1}` hiçbir ekranda/bileşende yok (test).
Sabit yükseklikli düğme kalmadı (yukarı).

## 4. Azaltılmış hareket

Sistem ayarı `useReducedMotion` (AccessibilityInfo) ile okunur. Animasyon yapan **her** dosya onu
okur (ratchet testi): takvim ve aylık review sayfa çevirme (zaten vardı), mevsimsel arka plan,
Skeleton (zaten vardı) + **bu kart:** Drawer (kayma yok, doğrudan açık/kapalı), HabitListView
(LayoutAnimation yok), FloatingLabelInput (süre 0), alışkanlık ve timeline toast'ları (giriş
animasyonu yok).

## 5. Roller, etiketler, odak sırası

- Rol/etiket/durum: mevcut testler (`uiPrimitivesAccessibility`, `screenAccessibility`,
  `habitFormFrequency` A9 tarayıcısı, R06.03 `FormError` role=alert).
- Odak sırası: RN'de görsel sırayı izler; formlarda hata girdinin hemen altında ve canlı bölge
  olarak duyurulur. **Ekran okuyucuyla gerçek cihazda odak gezintisi: N/R (S8 — cihaz yok).**
