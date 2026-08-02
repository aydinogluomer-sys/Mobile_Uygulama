# İstatistikler → "Liste" Görünümü — UI/UX Yenileme Planı

> Hedef: `components/HabitListView.tsx` (Stats → Liste sekmesi + /screens/dashboard).
> Bu görünümün işlevi **günlük takip değil**, bir **yönetim/genel-bakış kontrol merkezi**:
> tüm alışkanlıkları durum & önceliğe göre tara, filtrele, sırala, yönetime atla.
> Yeni bağımlılık YOK. FAZ 1'de kurulan token + primitive sistemini kullanır.

---

## 0. Mevcut Durum Teşhisi (Audit)

Şu an HabitListView:
- **Metrik şeridi** (4 durum kartı, sadece sayaç — tıklanamaz) + **ayrı "DURUM" filtre bloğu** =
  **çift filtre mekanizması / yer israfı**. Aynı 4 durum iki kez.
- **Düz liste** — gruplama yok; 4 farklı durum tek listede karışık akıyor, taraması zor.
- **Sıralama yok** — öncelik/irade/isim'e göre sıralanamıyor.
- **3 çip aynı anda** (durum + etki + triaj). Triaj zaten etki×aciliyetten türüyor → etki+triaj kısmen
  tekrar. Görsel kalabalık.
- **Hâlâ hardcoded hex** (rowName #fff, #6b7280, #9ca3af, fab #6366f1, border #1f1f1f…).
- **Empty state** ayrım yok: "hiç yok" vs "filtreyle eşleşmiyor" aynı; EmptyState primitive kullanılmıyor.
- Filtre + arama, ilk alışkanlığı görmeden **çok dikey alan** yiyor.
- Satır hiyerarşisi düz: lider aksan yok, isim ile çipler arası ritim zayıf.

## İlham Sentezi
- **Linear** → durum bazlı **collapsible gruplar** + count rozeti; kompakt filtre/sırala toolbar'ı.
- **Things 3** → temiz satır, lider aksan, kısıtlı meta, cömert boşluk.
- **Notion DB görünümleri** → filtre + sırala + grupla toolbar'ı.
- **Streaks/Atoms** → renkle öncelik, sakinlik.

---

## FAZ A — Tasarım Sistemi & Temizlik (temel)
**A1.** tokens + primitives import; tüm hardcoded hex → token (`colors`, `space`, `radius`, `font`).
**A2.** `rowIcon` → `IconCircle`; durum/etki/triaj çipleri → `Chip`/`Badge`; FAB → `shadow.glow` token.
**A3.** Haptik yardımcı import (filtre/sıralama/satır dokunuşunda `haptic.select/light`).
→ **Test Kapısı A** (tsc + web export).

## FAZ B — Toolbar Konsolidasyonu (çift filtreyi birleştir)
**B1.** Kompakt üst toolbar: [arama input (temizle ikonlu)] + [⚙ "Filtre & Sırala" toggle butonu
  — aktifse nokta/badge].
**B2.** **Durum pill'leri her zaman görünür** (yatay): Yapılıyor(n)/Yapılacak(n)/Fikir(n)/Yapıldı(n),
  tıklanabilir toggle + seçili renk. Eski metricStrip + ayrı DURUM bloğu **tek satırda birleşir**.
**B3.** Etki filtresi + sıralama, toggle ile açılan **collapsible panel**'e taşınır (dikey tasarruf).
  Panelde: "SIRALA" chip grubu + "ETKİ" chip grubu + "Temizle".
→ **Test Kapısı B** (tsc + web export).

## FAZ C — Gruplama + Sıralama
**C1.** Durum bazlı **gruplama**: STATUS_ORDER (active→waiting→idea→completed) her grup bir
  collapsible `SectionHeader` (ikon + etiket + count). statusFilter boşsa tüm gruplar; seçiliyse
  yalnız seçilenler. Boş gruplar gizlenir.
**C2.** **Sıralama** (`sortBy`): `impact` (kritik→düşük, eşitlikte irade ↓) | `willpower` (↓) |
  `name` (A-Z, tr locale) | `recent` (created_at ↓). Panelde chip ile seçilir.
**C3.** `collapsed: Set<status>` — grup başlığına dokununca aç/kapa (haptik.select).
→ **Test Kapısı C** (tsc + web export).

## FAZ D — Satır Redesign (hiyerarşi)
**D1.** Lider **etki-renkli ince aksan** (sol bar) + `IconCircle`. İsim belirgin (font.h3/body).
**D2.** Tek temiz meta satırı: durum `Chip` + triaj `Chip` + irade `Badge` (flash) +
  (numeric → birim Badge / `estimated_minutes` → dk Badge / reminder → saat Badge — yalnız varsa).
**D3.** Kategori (life_area) rozeti varsa; `end_condition` alt satır (süre). Sağda chevron.
  Satır dokunuşu → `/tabs/habits` (yönet), haptik.light.
→ **Test Kapısı D** (tsc + web export).

## FAZ E — Empty State'ler + Cila
**E1.** İki ayrı `EmptyState`: (a) hiç alışkanlık yok → "İlk alışkanlığını ekle" CTA (FAB akışı);
  (b) filtreyle eşleşmiyor → "Filtreleri temizle" CTA.
**E2.** Loading spinner token rengi; sayaç/başlık `SectionHeader`/`font` ile.
**E3.** Final tutarlılık taraması; dev sunucuda görsel kontrol.
→ **Test Kapısı E (final)** (tsc + web export).

---

## Durum/Sıralama Etkileşim Modeli (özet)
State: `statusFilter:Set`, `impactFilter:Set`, `search`, `sortBy`, `collapsed:Set`, `showPanel:bool`.
Akış: arama+etki+statusFilter ile süz → STATUS_ORDER'a göre grupla → grup içi `sortBy` ile sırala →
collapsible gruplar halinde göster. statusFilter tek durumsa tek grup; boşsa hepsi.

## Doğrulama Protokolü (her faz sonu)
1. `npx tsc --noEmit` → 0 hata. 2. `npx expo export --platform web` → başarılı.
3. Dev sunucu açık; Stats → Liste görsel kontrol. Başarılıysa sonraki faza geç.

## Kapsam dışı
- Log tabanlı streak/tamamlama % (habit satırında yok; ayrı sorgu + perf riski) — bu turda yok.
- Backend/şema değişikliği. Yeni npm bağımlılığı.
