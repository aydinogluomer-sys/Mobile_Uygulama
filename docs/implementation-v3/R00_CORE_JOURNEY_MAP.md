# R00.03 — Çekirdek Yolculuk Haritası (mevcut ekranlar, `0ff1c74`)

Yol: **Bugün → öncelik seç → küçük başlanabilir adım → rutin / focus →
kesinti → recovery → review → sonraki plan.** Her aşama için gerçek giriş
noktası, mevcut davranış ve tespit edilen **dead-end / duplicate / eksik
bağlantı**. Kanıt: kaynak okuması (`OBSERVED_SOURCE`); render/cihaz
gözlemi yapılmadı.

| # | Aşama | Giriş (gerçek route) | Bugün ne oluyor | Dead-end / duplicate / eksik bağlantı |
|---|---|---|---|---|
| 1 | **Bugün** | `app/tabs/today.tsx` (hero, metrik, "Sırada", `RecoveryRailCard`) | Aktif alışkanlıklar + bugünün görevleri + odak sayacı + telafi rayı. Onboarding → `starterPlan` ile ilk plan kurulur. | **Takvim yok:** `today.tsx:64` tüm `status==='active'` alışkanlıklar listelenir; Pzt/Çar alışkanlığı Salı "kalan" sayılır. **Çoklu CTA:** hero + metrik kartları + rail; tek baskın "başla/devam et" yok (R06.02). |
| 2 | **Öncelik seç** | Bugün "Sırada" kartı, `tabs/tasks.tsx`, `screens/eisenhower.tsx`, kapasite bandı (`willpowerStore`, `capacityService`) | Kapasite yükü ve bant gösterilir; `canActivate` bekleyen alışkanlığı tutar. | **Kullanıcı kontrollü yük yok** ("bugün daha az" → 0 sonuç). Bekleyen alışkanlığın **neden** beklediği ve nasıl aktive edileceği Bugün'de açıklanmıyor (R03.04). Eisenhower ile Bugün önceliği **iki ayrı öncelik dili** (duplicate). |
| 3 | **Küçük başlanabilir adım** | Yok. En yakın: AI Coach → `taskDecomposition` (alt görev önerisi), `AIRoutineModal` | Alt görev önerisi doğrulanıp göreve yazılabilir. | **Dead-end:** öneri → "ilk adımı düzenle → başlat" bağlantısı yok; başlatma odak/rutin oturumuna gitmiyor. Küçük adım ile asıl hedef ayrımı modelde yok (R03.03). |
| 4 | **Rutin / focus** | `tabs/focus.tsx` (Pomodoro, görev seçimi), `screens/deep-work.tsx`; rutin: `AIRoutineModal` → `installProposal` (kurulum) | Odak oturumu çalışır; work-phase bitince `focus_sessions` yazılır, görev kredilenir. Rutin **kurulur** ama **yürütülmez**. | **Runner yok** (adım adım oturum, `routine_sessions` yok). Rutin ↔ Bugün ↔ odak bağlantısı: kurulan rutin Bugün'de sıradan alışkanlık listesine düşer. `tabs/focus` ile `deep-work` **iki süre modeli** (duplicate; R05.06 ortak sözleşme). |
| 5 | **Kesinti** | `focusStore.pause/start`, AppState (yalnız sync replay için) | Pause/devam UI'da var. | **Kusur:** `start()` resume'da `sessionStartedAt`'i yeniler → önceki aktif segment kaybolur; pause süresi ayrılmaz; **çalışan oturum kalıcı değil** → app kill = oturum yok. Kesinti sonrası "kaldığın yerden / süreyi gözden geçir" ekranı yok (§7.4 "belirsiz" durumu). |
| 6 | **Recovery** | Bugün rail + 3 link → `screens/recovery.tsx`; Drawer "Telafi"; `tabs/insights` içine gömülü aynı ekran | Eksik gün listesi, dört strateji, `completePlanWithMakeup` (tek etki), süresi geçen plan. | Eksik tespiti `isDueOn` → **haftalık-sayı alışkanlığında sahte eksikler** (sabit gün dağılımı). Aylık alışkanlık hiç girmez. Taşınan işin **yeni gün yükü önizlemesi** yok. Aynı ekranın iki yerde (`screens/recovery` + `tabs/insights` embed) render edilmesi — duplicate yüzey. |
| 7 | **Review** | Bugün → `screens/weekly-review.tsx`; `monthly-review.tsx`; `screens/insights.tsx` | Haftalık/aylık özet, yansıma metni (`saveWeeklyReflection`, monthly draft/final), `recoverySuccessRate`, aşırı yük günleri. | Sayılar `isDueOn` üzerinden (R01 kusuru rapora yansır). "Ne çok geldi / gelecek hafta ne değişsin" yansıması **metin olarak kalır**, R01/R03 komutuna bağlanmaz. |
| 8 | **Sonraki plan** | Yok | — | **Dead-end:** review'den plana dönüş yok; kullanıcının seçtiği bir sonraki eylem saklanmaz (R07.06). Döngü kapanmıyor: review → Bugün'e geri dönüş yalnız navigasyonla. |

## Tespit özeti

- **Dead-end (3):** küçük adım → başlatma; review → sonraki plan; kesinti → uzlaşma ekranı.
- **Duplicate (3):** Eisenhower vs Bugün önceliği; `tabs/focus` vs `deep-work` süre modeli; recovery ekranının iki yüzeyi.
- **Eksik bağlantı (4):** Bugün → takvim (R01.06); recovery/review/insights → dönem motoru (R01.02-b); rutin kurulumu → runner (R05); bildirim → takvim (R04.01).
- **Ana navigasyon çoğaltılmayacak** (R00.03 kuralı): tüm düzeltmeler mevcut route'larda; yeni sekme yok.

## İlk anlaşılabilirlik turu (plan, uygulanmadı)

5–8 hedef kullanıcı; görevler: (a) haftada 3 hedefli alışkanlık kur ve
Salı'yı işaretle, (b) "bugün az yapabilirim" ile günü hafiflet, (c) bir işi
seçip ilk adımı başlat, (d) odak oturumunu duraklat/kapat/aç, (e) kaçırılan
günü telafi et, (f) haftalık review'den bir değişiklik seç. Ölçüm: yardımsız
tamamlama, süre, yardım sayısı, yanlış yan etki. Sayı pazar/klinik genelleme
sağlamaz; tur R03/R05/R07 kartları hazır olduğunda yapılır.
