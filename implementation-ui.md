# Atlas — Kapsamlı UI/UX Yenileme Planı (implementation-ui.md)

> Hedef: İşlevsel olarak olgun ama görsel olarak "düz/araçsal" olan Atlas'ı,
> sınıfının en iyisi habit-tracker'lar seviyesinde **rafine, sakin, tatmin edici**
> bir deneyime taşımak. Yeni bağımlılık YOK (offline kısıt). Mevcut deps:
> react-native-svg, expo-haptics, reanimated, animatable, expo-blur, gifted-charts.

---

## 0. Mevcut Durum Teşhisi (Audit)

**Güçlü yanlar:** Tutarlı koyu tema, zengin özellik seti, mantıklı bilgi mimarisi,
irade ekonomisi + triaj akışı özgün.

**Zayıf yanlar (düzeltilecek):**
1. **Tasarım token'ı yok** — `lib/theme.ts` var ama bileşenler kullanmıyor; her ekranda
   hardcoded hex (`#0c0c0c`, `#1a1a1a`, `#2a2a2a`, `#6366f1`...) tekrar ediyor.
2. **Ortak primitive yok** — Card/Button/Chip/SectionHeader/EmptyState her ekranda
   yeniden tanımlanıyor → radius 8/9/10/11/12/14/16/20/24 arası kaos, padding/gap drift.
3. **Sahte progress ring** — `focus.tsx` ring'i tek `border + rotate` hilesi; gerçek
   yay render etmiyor (görsel bug). SVG ring gerekli.
4. **Marka tutarsızlığı** — login "CoreHabit", drawer "Atlas".
5. **Tipografi hiyerarşisi zayıf** — sistem fontu, ölçek tanımsız, metrikler tabular değil.
6. **Mikro-etkileşim yok** — haptik yok, tamamlama animasyonu yok, geçişler ani.
7. **Empty state'ler cılız** — ikon + tek satır; yönlendirici CTA yok.
8. **Boşluk/ritim** — 4pt grid yok; dikey ritim ekrandan ekrana değişiyor.

## Tasarım Dili v2 — "Calm Focus"
İlham sentezi: **Things 3** (net hiyerarşi, kısıtlılık), **Atoms/James Clear** (sakinlik,
cömert boşluk), **Streaks** (tatmin edici ring + büyük sayılar), **Linear/Oak** (derin koyu
yüzey, ince gradient & glow). İlkeler:
- Derinlik kenarlıkla değil **katmanlı yüzey + yumuşak gölge/glow** ile.
- **Tek accent sistemi**: indigo korunur + `#8b5cf6`'ya gradient; semantik renkler netleşir.
- **4pt grid**, tutarlı radius ölçeği, **tabular** metrikler.
- Her tamamlamada **tatmin** (haptik + ring/check animasyonu).
- Empty state'ler **sakin + tek net CTA**.

---

## FAZ 1 — Tasarım Sistemi Temeli  `components/ui/`
**Amaç:** Tüm ekranların üzerine oturacağı token + primitive katmanı. Hiçbir ekran
değişmez; sadece yeni dosyalar eklenir → düşük risk, yüksek kaldıraç.

### 1.1 Token katmanı — `lib/tokens.ts`
- `colors`: bg, bgElevated, surface, surfaceAlt, surfaceHover, border, borderSubtle,
  text, textDim, textFaint, primary, primaryDim, primaryGlow, success/warn/error/info
  (+ `*Dim` tonal varyantları), accent2 (teal), gradient çiftleri.
- `space` (4pt): xs4, sm8, md12, lg16, xl20, xxl24, h32, h40.
- `radius`: xs8, sm10, md14, lg18, xl24, pill999.
- `font`: ölçek (display30/title22/h2_18/h3_16/body15/bodySm13/caption12/overline11/metric26),
  weight haritası, tabularNums helper.
- `shadow`: sm/md/lg/glow (renkli) preset'leri (iOS shadow + Android elevation).
- `hexA(hex, alpha)` yardımcı (tonal arka planlar için `'#6366f1' + '20'` yerine).

### 1.2 Primitive bileşenler — `components/ui/*`
1. `Card.tsx` — variant: `plain | elevated | glass`; padding ölçeği; `onPress?` (varsa
   TouchableOpacity activeOpacity 0.7); seçili/vurgu kenarlığı.
2. `Button.tsx` — variant: `primary | tonal | ghost | danger`; size `sm|md|lg`; `icon?`;
   `loading?`; `gradient?` (LinearGradient yerine 2 katman View — yeni dep yok, expo-linear-gradient
   varsa kullan, yoksa düz primary). disabled durumu.
3. `IconCircle.tsx` — tonal renkli ikon kabı (uygulamada ~10 yerde tekrar eden desen).
4. `Chip.tsx` + `Badge.tsx` — tonal pill; `dot?`, `icon?`, `color`, `selected?`.
5. `SectionHeader.tsx` — overline başlık + opsiyonel `count` + opsiyonel sağ aksiyon.
6. `ProgressBar.tsx` — track + fill; color, height, animasyonlu genişlik.
7. `ProgressRing.tsx` — **SVG** gerçek dairesel yay (size/stroke/progress/color/trackColor),
   ortada `children`. focus.tsx'in sahte ring'ini bu değiştirecek.
8. `EmptyState.tsx` — ikon kabı + başlık + alt metin + opsiyonel CTA Button.
9. `StatTile.tsx` — büyük tabular değer + label + opsiyonel sub + opsiyonel ProgressBar.
10. `index.ts` — barrel export.

### 1.3 Test Kapısı 1
- `npx tsc --noEmit` temiz.
- `npx expo export --platform web` başarılı.
- (Primitive'ler henüz kullanılmadığı için davranış değişmez; yalnız derleme doğrulanır.)

---

## FAZ 2 — Marka & İlk İzlenim (Auth + Splash hissi)
### 2.1 Marka birliği
- Tüm "CoreHabit" → "Atlas". Login/register başlık + alt başlık.
### 2.2 Login / Register yeniden tasarım
- Üstte marka işareti (gradient daire + "Atlas" wordmark + tagline).
- Input'lar: focus state (kenarlık primary'ye döner), şifre göster/gizle ikonu,
  inline hata metni (Alert yerine), KeyboardAvoiding düzgün.
- Birincil buton `Button primary lg` + loading.
- Alt geçiş linki rafine.
### 2.3 Test Kapısı 2 (tsc + web export).

---

## FAZ 3 — "Bugün" (today.tsx) yeniden tasarım  ⭐ en yüksek trafik
### 3.1 Hero başlık
- Selam + tarih + (opsiyonel) küçük streak/seri rozeti. Journal butonu IconCircle.
### 3.2 Metrik şeridi → `StatTile` + gerçek ring
- Alışkanlık tamamlama: küçük `ProgressRing` ile yüzde; Görev/Odak StatTile.
### 3.3 İrade bandı → ortak bileşen `components/ui` (WillpowerBand) — today + timeline paylaşır.
### 3.4 Bugünün alışkanlıkları
- Yatay chip yerine **dokununca tamamlanan** mini kartlar (haptik + check animasyonu);
  done state belirgin.
### 3.5 Yaklaşan görevler + zengin empty state (CTA: "Görev Ekle").
### 3.6 Test Kapısı 3.

---

## FAZ 4 — "Alışkanlıklar" (timeline.tsx) — uygulamanın kalbi
### 4.1 Üst blok: WillpowerBand bileşeni + hafta takvimi rafine (bugün/seçili net).
### 4.2 Bölüm başlıkları `SectionHeader`; Aktif Odak için tamamlama ring'i.
### 4.3 Takip satırı (renderTrackRow) redesign:
- Net hiyerarşi (isim > rozetler > ölçüm bar), `Chip/Badge` primitives,
  ProgressBar primitive; tamamlamada **haptik + check pop** animasyonu.
### 4.4 Yönetim kartı (renderMgmtCard) `Card` + `IconCircle` + `Button tonal`.
### 4.5 Modallar (silme nedeni, kapasite) primitive'lere taşı; tutarlı sheet.
### 4.6 Test Kapısı 4.

---

## FAZ 5 — "Odak" (focus.tsx)
### 5.1 **Sahte ring → gerçek `ProgressRing` (SVG)**; dakika tabular, faz etiketi.
### 5.2 Kontrol butonları `Button`; preset chip'leri `Chip`; görev satırı rafine.
### 5.3 Çalışma↔mola geçişinde haptik.
### 5.4 Test Kapısı 5.

---

## FAZ 6 — "Görevler" (tasks.tsx) + "Keşfet" (hub.tsx) + Stats cila
### 6.1 tasks: satır + segment tab + modal primitive'lere; öncelik görselleştirme rafine.
### 6.2 hub: grid kartlar `Card`+`IconCircle`; başlık hiyerarşisi.
### 6.3 stats: Özet kartları `StatTile`/`Card`; (heatmap zaten yeni) tutarlılık.
### 6.4 Test Kapısı 6.

---

## FAZ 7 — Mikro-etkileşim & Cila (cross-cutting)
### 7.1 Haptik yardımcı `lib/haptics.ts` (success/light/warning) — tamamlama/aktivasyon/silme.
### 7.2 Tab bar rafine (yükseklik/ikon/aktif renk; gerekiyorsa hafif gölge).
### 7.3 Liste girişlerinde hafif `FadeInUp` (animatable) — abartısız.
### 7.4 Tutarlılık taraması: kalan hardcoded hex → token; radius/space sapmaları.
### 7.5 Test Kapısı 7 (tsc + web export) — final.

---

## Doğrulama Protokolü (her faz sonu)
1. `npx tsc --noEmit` → 0 hata.
2. `npx expo export --platform web` → başarılı bundle.
3. Dev sunucu (`expo start --offline`) açık; tarayıcıda görsel kontrol.
4. Başarılıysa bir sonraki faza geç. (android export hermesc/Windows bug'ı nedeniyle
   atlanır — prod Android EAS Build/Linux'ta.)

## Kapsam dışı (bu turda)
- Custom font dosyası ekleme (offline risk) — sistem fontu + ağırlık/ölçekle çözülür.
- Yeni npm bağımlılığı.
- Backend/şema/Edge Function değişikliği (yalnız UI/UX).
