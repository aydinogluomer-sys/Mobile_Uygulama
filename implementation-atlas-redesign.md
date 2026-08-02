# Atlas "Paper/Clay Editorial" — Tüm Uygulama Tasarım Dili Yenilemesi

> İlham: yüklenen `personal-os-v2` artifact'ının **Atlas Design Language**'i.
> Mevcut: soğuk indigo dark (#0a0a0b / #6366f1 / sistem font).
> Hedef: **sıcak clay editöryel** — warm near-black, tek **clay (terracotta) accent**,
> **serif editöryel başlıklar**, **mono tabular sayılar**, eyebrow etiketleri, keskin küçük
> radii, kıl-payı kenarlıklar. Yeni npm bağımlılığı YOK; font dosyası YOK (offline) →
> serif/mono **platform fontlarıyla** yaklaşıkla (iOS Georgia / Android serif; mono Menlo/monospace).

## Tasarım Dili Kararları (artifact'tan damıtıldı)
- **Palet (warm dark):** bg `#15140F` · surface `#1D1C17` · alt `#28261F` · border `#383528` ·
  text `#EDEAE0` · dim `#BFBBAE` · faint `#827E72`. **Clay accent `#D97757`** (hover `#E08866`, deep `#B85C38`).
  Semantik (desatüre, editöryel): moss `#87A678` · amber `#D4A84A` · rust `#C76A6A` · slate `#7C97C5`.
- **Tipografi:** Display/Title/Date → **serif** (Georgia/serif), weight 400, negatif letter-spacing.
  Body/label → sans (sistem). **Metrik → mono**, tabular-nums. Eyebrow: 11px uppercase tracking .1em, faint.
- **Şekil:** radii keskin (xs6/sm8/md10/lg12/xl16); kenarlıklar 1px kıl-payı; gölgeler "barely there".
- **Mimari:** statik `colors` anahtarları korunur (geriye-uyumlu) → token-tabanlı ekranlar otomatik döner.

---

## FAZ 1 — Token Sistemi (tokens.ts) ⭐ en yüksek kaldıraç
**1.1** `colors` değerlerini Atlas warm-clay paletine çevir (anahtarlar aynı: bg/surface/primary/
  success/warning/error/info/teal/text…). primary→clay; teal→slate(info) (Yapıldı durumunu ayrı tutar).
**1.2** `gradients.primary` → clay çifti; warm/ocean → editöryel tonlar.
**1.3** Tipografi: `Platform`-aware `serif`/`mono` font aileleri + `font.display/title` serif'e (weight 400),
  `font.metric` mono'ya, `eyebrow` (overline) sıkı tracking. `fontFamily` helper export.
**1.4** `radius` keskinleştir (xs6/sm8/md10/lg12/xl16/pill999); shadow yumuşat (warm, düşük opaklık).
→ **Test Kapısı 1** (tsc + web export).

## FAZ 2 — Primitive'ler (components/ui) editöryel pas
**2.1** `Card` keskin radius + kıl-payı border; elevated yumuşak gölge.
**2.2** `Button` primary = clay (+glow yumuşak); tonal/ghost clay-uyumlu.
**2.3** `SectionHeader` — overline eyebrow + opsiyonel **serif** başlık varyantı.
**2.4** `StatTile` — değer **mono**, label eyebrow; `EmptyState` başlık **serif**.
**2.5** `Chip`/`Badge` keskin radius; `ProgressRing`/`ProgressBar`/`WillpowerBand` clay.
**2.6** (Yeni) `Eyebrow` ve `Display` küçük metin yardımcıları (serif başlık + eyebrow tekrarını azaltır).
→ **Test Kapısı 2** (tsc + web export).

## FAZ 3 — Auth (login/register) — ilk izlenim
Serif "Atlas" wordmark (clay nokta hissi), paper-uyumlu input focus (clay), editöryel tagline.
→ **Test Kapısı 3**.

## FAZ 4 — Bugün (today.tsx)
Serif selamlama + tarih (italik-serif hissi), eyebrow bölüm başlıkları, **clay tamamlama ring'i**,
**mono** metrikler, WillpowerBand clay. Hardcoded kalan hex → token.
→ **Test Kapısı 4**.

## FAZ 5 — Alışkanlıklar (timeline.tsx)
Bölüm başlıkları eyebrow/serif, clay vurgular, takip satırı editöryel (mono maliyet), modallar clay.
→ **Test Kapısı 5**.

## FAZ 6 — Odak (focus.tsx) + Stats Özet
Odak: clay SVG ring, mono sayaç, editöryel kontroller, preset'ler. Stats: hero serif + mono,
heatmap clay tonları (yeşil→clay/moss tercih), pipeline & StatTile editöryel.
→ **Test Kapısı 6**.

## FAZ 7 — Telafi + Liste (HabitListView) + Stats kalanı
Telafi: serif hero, eyebrow, clay; strateji çipleri editöryel. Liste: grup başlıkları eyebrow,
satır editöryel, mono sayaç.
→ **Test Kapısı 7**.

## FAZ 8 — Tasks + Hub + Settings + Drawer + Tab bar + /screens taraması
Kalan hardcoded indigo/koyu hex'leri token'a çevir; tab bar clay aktif renk + warm bg; drawer
serif marka; /screens/* (calendar, projects, notes, journal, okr, paywall, vb.) yüzey/accent uyumu.
→ **Test Kapısı 8 (final)**.

---

## Doğrulama Protokolü (her faz)
`npx tsc --noEmit` (0 hata) + `npx expo export --platform web` (başarılı). Dev sunucuda görsel kontrol.
Her ana faz geçince sonrakine geç.

## Kapsam / Notlar
- **Dark-first warm** uygulanır (artifact'ın kendi dark modu birebir bu) — light "paper" modu, runtime
  tema-context refactoru gerektirdiğinden bu turda kapsam dışı (gelecek tur).
- Gerçek Instrument Serif/Geist dosyaları offline yüklenemez → platform serif/mono ile yaklaşıklanır;
  EAS/online turda `expo-google-fonts` ile birebir font eklenebilir.
- Backend/şema/işlevsel mantık değişmez — yalnız görsel dil.
