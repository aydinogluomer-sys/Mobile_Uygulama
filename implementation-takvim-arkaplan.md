# Takvim Aylık Arka Plan Görselleri — Uygulama Planı

> Hedef: Kullanıcının tasarladığı **12 aylık görseli** (Ocak…Aralık) Takvim ekranına
> (`frontend/app/screens/calendar.tsx`) tam-ekran arka plan olarak yerleştirmek.
> Görünen ay (`month` state'i) hangi görselin gösterileceğini belirler; aylar arası
> geçişte yumuşak crossfade olur. İçerik, görselin üzerinde okunabilir kalsın diye
> yarı-saydam koyu "cam" (glass) panellere oturtulur.

## Bağlam / Keşif Notları

- **Kaynak görseller:** `C:\Users\Trade Bilisim\Desktop\habit_tracker_12_ay_gorselleri\`
  - 12 adet PNG, dosya adları Türkçe ay isimleri: `Ocak.png … Aralık.png`.
  - Boyut ~**941×1672** (dikey 9:16, telefon tam-ekran için ideal), toplam **~26 MB**.
  - Stil: parlak/pastel, aydınlık merkez + dekoratif kenarlar (mevsimsel illüstrasyon).
    → Açık renk metin doğrudan görselin üstünde **okunmaz**; koyu scrim + cam panel şart.
- **`MONTHS` dizisi** `calendar.tsx:10`'da görsel adlarıyla **birebir** aynı sırada
  (`['Ocak','Şubat',…,'Aralık']`). `month` state'i 0–11 indeks.
- **Mevcut stack:** `expo-image` (~2.4.0) ✔, `expo-blur` (~14.1.5) ✔ kurulu.
  `expo-linear-gradient` **kurulu değil** → yeni bağımlılık eklemeden, düz scrim + blur ile çözüldü.
- **Layout:** `app/screens/_layout.tsx` ortak Stack header'ı solid `#1D1C17`, başlık "Takvim".
- **Tasarım token'ları:** `lib/tokens.ts` (`colors.bgSunk = #100F0B`, `hexA()` alpha helper, `radius`, `space`).

## Mimari Karar

Tekil, yeniden kullanılabilir parçalar (repo'nun `lib/` + `components/ui/` desenine uygun):

1. `frontend/lib/monthBackgrounds.ts` — statik `require()` haritası (RN statik yol gerektirir),
   `month` indeksinden (0–11) görsele. `getMonthBackground(month)` helper'ı.
2. `frontend/components/ui/GlassPanel.tsx` — yeniden kullanılabilir frosted-glass kabı
   (BlurView + yarı-saydam koyu dolgu + ince açık kenar). Mevcut `Card` **değiştirilmez**.
3. `frontend/components/MonthBackground.tsx` — verilen `month` için tam-ekran görsel +
   scrim render eden bileşen (crossfade `transition`). `pointerEvents="none"`.
4. `calendar.tsx` entegrasyonu — kök View'a `MonthBackground`, içerik `GlassPanel`'lere sarılır,
   `s.safe` arka planı `transparent` yapılır.

## Fazlar

### Faz 1 — Görselleri içe aktar  ✅

- 12 PNG, ASCII slug isimlerle `frontend/assets/images/months/` altına alındı
  (`01-ocak … 12-aralik`; Türkçe karakterli adlar Metro'da sorun çıkarabilir → ASCII slug).
- Orijinaller Desktop'ta korunur (kaynak). Boyut optimizasyonu Faz 6'da yapıldı (WebP).

### Faz 2 — Statik harita modülü  ✅

- `frontend/lib/monthBackgrounds.ts`: 12 `require()` (`.webp`) + `getMonthBackground(month)`.

### Faz 3 — Bileşenler  ✅

- `frontend/components/ui/GlassPanel.tsx`.
- `frontend/components/MonthBackground.tsx`.

### Faz 4 — Takvim entegrasyonu  ✅

- `calendar.tsx`: kök sarmalayıcı + `MonthBackground month={month}`.
- Ay navigasyonu + gün başlıkları + ızgara → tek `GlassPanel` içine.
- Görev / alışkanlık bölümleri → birer `GlassPanel` içine.
- `s.safe.backgroundColor` → `transparent`. Sertkodlu hex'ler token'lara çevrildi.

### Faz 5 — Doğrulama  ✅

- `tsc --noEmit` (frontend) → **temiz, exit 0** (tüm proje, yeni dosyalar dahil).
- 12 asset dosyası mevcut; `monthBackgrounds.ts`'deki 12 `require()` yolu birebir eşleşiyor.
- Kalan manuel adım: `expo start` ile canlı görsel kontrol (scrim 0.45 / blur 22 muhafazakâr
  ayarlandı; gerçek cihazda ay-ay parlaklığa göre `scrim` / `intensity` ince ayar yapılabilir).

### Faz 6 — Cila  ✅

- ✅ **Şeffaf frosted header:** `_layout.tsx`'te yalnızca `calendar` ve `monthly-review` ekranlarına
  `headerTransparent` + BlurView'lı `headerBackground` (`GlassHeaderBg`) verildi. Görsel header'ın
  arkasına taşındı; başlık frosted bar üzerinde okunur. Diğer ekranlar etkilenmedi.
  Ekranlarda `useHeaderHeight()` ile içeriğe üst boşluk verildi.
- ✅ **Aylık Özet entegrasyonu:** `monthly-review.tsx` aynı `MonthBackground` + `GlassPanel` desenine
  geçirildi (ay seçici + özet + ısı haritası tek panelde; performans ve refleksiyon ayrı panellerde).
- ✅ **Görsel boyut optimizasyonu:** Geçici bir dizinde `sharp` ile 12 görsel **WebP q82**'ye
  çevrildi: **~26 MB → ~1.82 MB (%93 küçülme)**, görsel kalite kaybı yok (yumuşak gradyanlarda
  bantlanma yok). PNG kopyalar silindi; `monthBackgrounds.ts` `.webp`'yi referans alır.
  (Not: WebP, Metro varsayılan `assetExts`'inde ve `expo-image` tarafından desteklenir.)

## Riskler / Kararlar

- **Okunabilirlik:** Görseller parlak → scrim (~0.45–0.5 `bgSunk`) + glass panel zorunlu.
- **Boyut:** PNG yerine WebP; alpha gerekmediği için güvenli, %93 tasarruf.
- **Bağımlılık eklenmez:** uygulama yalnızca kurulu `expo-image` + `expo-blur` kullanır
  (`sharp` sadece geçici dizinde tek seferlik dönüştürme için kuruldu, projeye eklenmedi).
- **Mevcut `implementation.md` korunur** (alakasız, 40 KB) — bu plan ayrı dosyada.
