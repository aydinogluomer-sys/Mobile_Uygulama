# Bugün Sadelik Sözleşmesi (`TODAY_CONTRACT`)

> Faz: F27 (`PRF-01`, `STO-07`, `PRF-14`, `NAV-10`, `NAV-13`, `INT-22`)
> Kod karşılığı: `frontend/lib/disclosure.ts`, `frontend/store/disclosureStore.ts`, `frontend/hooks/useTodayModel.ts`, `frontend/lib/todaySelectors.ts`, `frontend/components/today/HabitSection.tsx`, `frontend/app/tabs/today.tsx`
> Otomatik kapılar: `frontend/__tests__/ui/todayCognitiveLoad.test.tsx`, `frontend/__tests__/repo/wholeStoreSubscriptionRatchet.test.ts`

Bu belge Bugün ekranının mimari ve bilişsel bütçesini bağlayıcı sözleşme olarak tanımlar. Sonraki fazlar (`F28`, `F29`, `F30`, `F33`, `F36`, `F37` ve sonrası) Bugün ekranına dokunurken aşağıdaki sekiz maddeyi ihlal edemez.

---

## 1. Sekiz Bağlayıcı Kural

1. **En çok 3 ana blok (+1 bağlamsal kapsayıcı):** Varsayılan görünümde yalnızca üç ana blok render edilir:
   - `today-block-hero`: `<TodayHero />`, özet satırı, sakin mod çipleri ve `<NextUpStrip />`
   - `today-block-habits`: `<HabitSection />` (gün dilimine göre katlanan ritüel listesi)
   - `today-block-composer`: `<OutboxIssues />`, `<InlineComposer />` ve bekleyen görev satırları
   Dördüncü kapsayıcı (`today-block-context`) yalnızca bağlamsal bir durum aktifken (`!legacyNoticeSeen`, `afterBreak`, `holiday`, `setAsideHabits.length > 0`) tek bir kapsayıcı olarak hero ile ritüeller arasına girer; boşken hiç çizilmez.
2. **İlk alışkanlık satırından önce en çok 8 etkileşimli öğe:** `TodayScreen` içinde ilk `accessibilityRole="checkbox"` düğümünden önce gelen `button | checkbox | link | switch` rollü host düğüm sayısı her saatte (`10:00` ve `20:00` akşam kapanış çipi dahil) `<= TODAY_CONTRACT.maxInteractiveBeforeFirstHabit` (`8`) kalır.
3. **Yeni blok ekleme kuralı:** Bugün'e yeni bir özellik ekleyen her faz üç yoldan birini seçmek zorundadır:
   - Mevcut üç bloktan birinin içine tek satır/aksiyon olarak girmek,
   - Akşam kapanışı / hafif gün modallarına bağlanmak (`F29`),
   - `TodayToolId` olarak `lib/disclosure.ts` + `TodayToolsSection.tsx` altına kaydolup ilk gün varsayılan kapalı gelmek (`F30`, `F33`, `F36`, `F37`).
4. **Sakin sayılar ve renkler:** Varsayılan görünümde yalnız kalan iş sayısı gösterilir; yüzde halkası ve 4'lü metrik ızgarası yalnız `metrics` aracı açıkken görünür. Gecikmiş yığını (`overdueCount > 5`) sayı baskısı kurmaz (`"Birikmiş işler var; bugün yalnız birini seç."`), birincil eylemde bugünün alışkanlık ve görevlerinin arkasına tek adım olarak geçer. Yeni araç / özellik için kırmızı nokta veya rozet yasaktır.
5. **En çok iki dokunuş:** Bugün üzerindeki her birincil eylem (ritüel işaretleme, hızlı görev ekleme, sıradaki adıma başlama, "Diğer" menüsünden ikincil ekrana geçiş) en çok iki dokunuşta tamamlanır.
6. **Gün dilimi grupları ve fail-open garantisi:** Ritüeller `habits.frequency_config.part_of_day` alanına göre Sabah (`05:00–11:59`), Öğleden sonra (`12:00–17:59`), Akşam (`18:00–04:59`) ve Her an gruplarına ayrılır. Şimdiki dilim ve `Her an` grubu daima açıktır; `part_of_day` taşımayan, boş ya da çoklu dilimli ritüeller `anytime` grubuna düşer ve **asla gizlenmez**. Tek grup varsa grup başlığı çizilmez (düz liste). Canlı şemadaki eski `habits.preferred_time_of_day` sütunu istemcide okunmaz.
7. **Odak sayacı çalışırken 0 render/saniye:** `useTodayModel` ve `today.tsx` içinde seçicisiz `useXStore()` çağrısı ve `secondsLeft` aboneliği yasaktır (`wholeStoreSubscriptionRatchet.test.ts`). Odak sayacı her saniye `tick()` ile `secondsLeft` güncellerken Bugün ekranı 0 kez yeniden render olur; yalnız `status` (`idle | running | paused`) veya tamamlanan seans sayısı değiştiğinde güncellenir.
8. **Ekran okuyucu ve DOM sırası:** Geniş ekranda (`isWide`) yan yana yerleşimde dahi DOM ve erişilebilirlik sırası değişmez: `today-block-hero` → (`today-block-context`) → `today-block-habits` → `today-block-composer`.

---

## 2. Sabit Tavanlar (`TODAY_CONTRACT` & `STAGE_THRESHOLDS`)

| Sabit | Değer | Kural |
|---|---:|---|
| `TODAY_CONTRACT.maxMainBlocks` | `3` | Yalnız düşebilir (ratchet) |
| `TODAY_CONTRACT.maxBlocksWithContext` | `4` | Yalnız düşebilir (ratchet) |
| `TODAY_CONTRACT.maxInteractiveBeforeFirstHabit` | `8` | Yalnız düşebilir (ratchet) |
| `TODAY_CONTRACT.segmentsAutoItemThreshold` | `8` | `itemCount > 8` ve aşama `!= first_day` iken segmentler otomatik açılır |
| `STAGE_THRESHOLDS.firstWeekActiveDays` | `3` | Standart `first_week` eşiği |
| `STAGE_THRESHOLDS.firstWeekActiveDaysFast` | `2` | Hızlı kurulum (`<= 10 dk`) için `first_week` eşiği |
| `STAGE_THRESHOLDS.establishedActiveDays` | `14` | Yerel aktif gün ile `established` eşiği |
| `STAGE_THRESHOLDS.establishedAccountAgeDays` | `14` | Hesap yaşı ile `established` eşiği |
| `STAGE_THRESHOLDS.legacyAccountAgeDays` | `7` | Tek seferlik `"Bugün sadeleşti."` bilgi notu eşiği |

---

## 3. Araç Görünürlük Matrisi (`TodayToolId`)

| `TodayToolId` | Ayarlar > Araçlar Etiketi | `first_day` (Otomatik) | `first_week` / `established` (Otomatik) | Açık Tercih (`'on'` / `'off'`) |
|---|---|---|---|---|
| `spark` | Günün odak akışı | Kapalı | Kapalı (isteğe bağlı) | Her zaman kazanır |
| `metrics` | Sakin metrik kartları | Kapalı | Kapalı (isteğe bağlı) | Her zaman kazanır |
| `segments` | Görünüm filtreleri | Kapalı | `itemCount > 8` ise Açık | Her zaman kazanır |
| `balance` | Denge paneli (deneyim puanı, irade dengesi, telafi rayı) | Kapalı | Açık | Her zaman kazanır |
| `routine` | Rutin kartı | Yalnız aktif oturum varsa Açık | Açık | Her zaman kazanır |
| `strategy` | Strateji ve OKR kartı | Kapalı | Kapalı (isteğe bağlı) | Her zaman kazanır |

---

## 4. Sonraki Fazlar İçin Entegrasyon Kuralları

- **F29 (Akşam kapanışı ve hafif gün):** Kapanış modalını (`ShutdownSheet`) yeniden yazarken onay adımında `useDisclosureStore.getState().markFirstClose(clock.today)` çağrısını **mutlaka korumalıdır**; bu sinyal kullanıcıyı `first_day` aşamasından `first_week` aşamasına taşır.
- **F30 / F33 / F36 / F37:** Yeni kart veya modül eklenirken `app/tabs/today.tsx` içine doğrudan koşulsuz blok konulmaz; `TodayToolId` genişletilir veya mevcut üç bloktan birinin satır bütçesi içinde kalınır ve `todayCognitiveLoad.test.tsx` (`P1–P8`, `N1–N4`) yeşil tutulur.
