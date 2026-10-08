# R06.01 — Mevcut tasarım sistemi ve referans ekran

> Kapsam: **yeni UI kit yok, ekran yeniden tasarımı yok.** Var olanı tespit et, token/bileşen
> kullanımını yay, geri kaymayı bir testle durdur.

## 1. Sistem (zaten var)

| Katman | Kaynak | İçerik |
|---|---|---|
| Renk/boşluk/yarıçap/yazı token'ları | `frontend/lib/tokens.ts` | `colors` (bg, surface*, border*, text/textDim/textFaint/textGhost, accent/primary*, success/warning/error/info, white/black), `space`, `radius`, `font`, `fontFamily`, `hexA`/`alphaHex` |
| Ortak bileşenler | `frontend/components/ui/*` (`index.ts`) | Card, Button, Chip, Badge, IconCircle, SectionHeader, ProgressBar, ProgressRing, EmptyState, StatTile, Skeleton, SyncStatusBadge, WillpowerBand, GlassPanel, FloatingLabelInput, ErrorBoundary |
| Erişilebilirlik sözleşmesi | `__tests__/ui/uiPrimitivesAccessibility.test.tsx`, `__tests__/ui/screenAccessibility.test.ts` | rol/etiket/durum |
| Akış metinleri | `frontend/lib/flowCopy.ts` (R03.07) | ilk adım / yükü hafiflet / mola sonrası |

## 2. Referans ekranlar (en tutarlı)

Ölçüt: ham hex renk sayısı (0 = yalnız token), `components/ui` kullanımı, token referansı sayısı.

| Ekran | Ham hex | `components/ui` | Not |
|---|---|---|---|
| `app/tabs/today.tsx` | 0 | evet | Card/SectionHeader/SyncStatusBadge; **birincil referans** |
| `app/screens/recovery.tsx` | 0 | evet | Card/SectionHeader/EmptyState/Badge/Button/Chip/Skeleton |
| `app/screens/routine-runner.tsx` | 0 | — | yalnız token |

Yeni veya düzenlenen ekran bu üçünü örnek alır: renk yalnız `colors.*`, boşluk `space.*`,
yarıçap `radius.*`; kart/başlık/boş durum/rozet için `components/ui`.

## 3. Yayma (bu kart)

Token değerine **birebir eşit** her ham hex (`'#827E72'` → `colors.textFaint`, `color="#D97757"` →
`color={colors.accent}` …) `app/` ve `components/` altındaki 38 dosyada token'a çevrildi:
**266 değişim** (eski Tailwind `neutral400/500/600` ramp'i dahil), `app`+`components` ham hex sayısı **407 → 141**. Görünüm değişmez (aynı renk değeri;
`#fff` → `colors.white` = `#ffffff`).

Kalan 141 literal token DEĞİL: kategori/yaşam alanı paletleri (`#ec4899`, `#8b5cf6`, `#f59e0b`,
`#14b8a6` …) ve tek seferlik vurgu tonları. Bunları token'a zorlamak yeni bir palet tasarlamak
olurdu — bu kartın kapsamı dışı.

## 4. Geri kayma koruması

`__tests__/repo/designTokensRatchet.test.ts`:
- `app/`+`components/` içinde token değerine eşit ham hex **0** (yeni bir `'#827E72'` kırmızıya düşer);
- toplam ham hex **≤ 141** (yalnız azalabilir; azalırsa eşik düşürülür);
- referans ekranlar (Today, Recovery, Routine runner) **0** ham hex.
