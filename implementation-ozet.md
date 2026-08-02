# İstatistikler → "Özet" Görünümü — UI/UX Yenileme Planı

> Hedef: `app/tabs/stats.tsx` Özet görünümü (`view === 'ozet'`).
> Veri yükleme (`loadData`), heatmap grid mantığı, kategori atama modalı **korunur**;
> yalnız sunum + bilgi mimarisi yenilenir. Yeni bağımlılık YOK; FAZ 1 token+primitive sistemi.

---

## 0. Mevcut Durum Teşhisi (Audit)

Mevcut Özet (yukarıdan): toggle → grid4#1 (4 durum kartı) → grid4#2 (4 tamamlama metriği)
→ 14g Trend → Yaşam Alanları → Bu Ay → Heatmap → "Özet" quickCard → yüzen Yenile FAB.

**Sorunlar:**
1. **Ağır tekrar:** alt "Özet" quickCard (Aktif Odak/Bekleme/Tamamlanan/Toplam Tamamlama) =
   grid4#1 + grid4#2'nin **kopyası**. "Bu Ay" üç yerde (grid4#2, Bu Ay kartı, avgPerDay).
   "Toplam Tamamlama" iki yerde. Veri 3–4 kez tekrar ediyor.
2. **Sayı duvarı:** 8 büyük metrik kartı, hepsi eşit ağırlıkta → **hiyerarşi yok**, lider metrik yok.
3. **Streak yok:** habit-tracker'ların en motive edici metriği (🔥 güncel seri, en uzun seri) eksik —
   oysa `heatmap` (gün→sayı) zaten yüklü; client'ta ücretsiz hesaplanır.
4. **Motivasyon gömülü:** en duygusal öğeler (heatmap) en altta; sayı duvarı en üstte.
5. **Hardcoded renkler / tutarsız kart:** her kart #1a1a1a/#2a2a2a/#fff yeniden tanımlıyor;
   `Card/StatTile/SectionHeader/ProgressBar/ProgressRing` primitive'leri kullanılmıyor.
6. **Yüzen "Yenile" FAB** içeriği örtüyor; standart **pull-to-refresh** (Today gibi) yok.
7. **İsim karışıklığı:** "Özet" görünümünün içinde "Özet" başlıklı kart.

## İlham Sentezi
- **Streaks / Atoms** → tek güçlü lider sayı + 🔥 seri; sakin, ödüllendirici.
- **Oak / Rise** → derin koyu hero, halka ile günün durumu.
- **Things 3** → kısıtlı, net hiyerarşi, cömert boşluk.
- **GitHub/heatmap** → yıllık ritim (zaten var, korunur).

---

## FAZ A — Tasarım Sistemi & Temizlik (temel)
**A1.** Primitive + token import (`Card, StatTile, SectionHeader, ProgressBar, ProgressRing,
  IconCircle, EmptyState, Chip` + `space/radius/font/hexA/shadow` + `haptic`).
**A2.** Tüm kart kromu → token: `#1a1a1a→colors.surface`, `#2a2a2a→colors.border`,
  metin `#fff→text / #9ca3af→textDim / #6b7280→textFaint`. View toggle token'a.
**A3.** Yüzen "Yenile" FAB → **pull-to-refresh** (`RefreshControl`, Today ile tutarlı); FAB kaldırılır.
→ **Test Kapısı A** (tsc + web export).

## FAZ B — Hero + Streak (motivasyon çekirdeği)
**B1.** `heatmap`'ten `currentStreak` + `longestStreak` hesapla (bugün boşsa seri kırılmaz —
  dünden say). Saf fonksiyon.
**B2.** **Hero kart** (toggle'ın hemen altı, en üst): solda **bugünün tamamlama `ProgressRing`'i**
  (`todayCompletions / max(1, aktif sayısı)`, %), sağda 🔥 **güncel seri** + **en uzun seri** + tek
  satır motive edici alt metin.
**B3.** Hero en üste yerleşir; sayı duvarı aşağı iner.
→ **Test Kapısı B** (tsc + web export).

## FAZ C — Konsolidasyon (tekrarı kaldır + hiyerarşi)
**C1.** Alt **"Özet" quickCard'ı tamamen kaldır** (verisi hero + pipeline'da).
**C2.** grid4#1 (durumlar) → tek kompakt **Durum Hattı (pipeline)** kartı: yatay **yığılı oran çubuğu**
  (Aktif/Bekleme/Fikir/Tamamlanan) + altında 4 küçük lejant satırı (renk + etiket + sayı).
**C3.** grid4#2 (tamamlama) → **tekrarsız** `StatTile` satırı: Toplam Alışkanlık · Toplam Tamamlama ·
  Günlük Ort. (Bugün → hero'da; Bu Ay → Bu Ay kartında — tekrar kaldırıldı).
**C4.** Sıralama (hiyerarşi): Hero → Durum Hattı → StatTile satırı → 14g Trend → Heatmap →
  Yaşam Alanları → Bu Ay (ince).
→ **Test Kapısı C** (tsc + web export).

## FAZ D — Kart İçi Cila
**D1.** TrendChart → token renkleri (primary/primaryDim), `SectionHeader`; bugün vurgusu netleşir.
**D2.** Yaşam Alanları → `Card`+`SectionHeader`; alan satırı bar'ı `ProgressBar`; boş → `EmptyState`;
  "Kategori Ata" → `Button` tonal.
**D3.** Bu Ay → `Card`+`SectionHeader`; ilerleme `ProgressBar`.
**D4.** Heatmap kromu → token; `ratioColor(0)` → `colors.surfaceAlt` (yeni yüzeyle uyum); başlık SectionHeader.
→ **Test Kapısı D** (tsc + web export).

## FAZ E — Empty State + Cila + Final
**E1.** Hiç veri yokken (habits 0 & tamamlama 0) dostça global `EmptyState` + CTA (alışkanlık ekle).
**E2.** Kategori atama modalı → token/`Card`/`Chip`; haptik (toggle/refresh/heatmap hücre/kategori).
**E3.** Final tutarlılık taraması; dev sunucuda görsel kontrol.
→ **Test Kapısı E (final)** (tsc + web export).

---

## Streak Hesabı (özet)
`heatmap[gün] > 0` = o gün ≥1 tamamlama. current: bugünden geri yürü (bugün boşsa dünden başla),
ardışık >0 günleri say. longest: 365 pencerede en uzun ardışık >0 dizisi. Saf, O(365).

## Doğrulama Protokolü (her faz sonu)
1. `npx tsc --noEmit` → 0 hata. 2. `npx expo export --platform web` → başarılı.
3. Dev sunucu açık; Stats → Özet görsel kontrol. Başarılıysa sonraki faza geç.

## Kapsam dışı
- `loadData`/sorgu mantığı, heatmap grid algoritması, kategori modal işlevi (yalnız sunum değişir).
- Backend/şema değişikliği. Yeni npm bağımlılığı.
