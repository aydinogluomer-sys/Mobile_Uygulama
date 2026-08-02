# "Telafi" — UI/UX Yenileme + Telafi Planlama Sistemi

> Hedef: `app/screens/recovery.tsx`. İki katman: (1) ekranı tasarım sistemine taşı,
> (2) **yeni özellik**: kaçırılan / kısmi yapılan alışkanlıkların **nasıl, ne şekilde, ne zaman**
> telafi edileceğini planlayan bir sistem. Backend (Supabase tablo + store) + UI.
> FAZ 1 token/primitive sistemi kullanılır. Yeni npm bağımlılığı YOK.

---

## 0. Mevcut Durum Teşhisi (Audit)

Mevcut Telafi: hero → özet şerit (gecikmiş görev + bugün kaçırılan) → gecikmiş görevler
(Tamamla / Bu Hafta) → bugün kaçırılan alışkanlıklar (streak + "Kaydet" = şimdi done logla).

**Eksikler:**
1. **Planlama yok** — "kaçırdım" deyince yalnız "şimdi yap" var. *Ne zaman* ve *nasıl* telafi
   edileceği planlanamıyor. Kullanıcının asıl istediği bu.
2. **Kısmi (partial) yok** — yalnız miss/no-log gösteriliyor; kısmi yapılanlar telafi adayı değil.
3. Hardcoded renk; primitive kullanılmıyor; "never miss twice" gibi davranışsal çerçeve yok.

## Davranışsal Çerçeve & İlham
- **James Clear — "Never miss twice":** Bir kez kaçırmak kaza; iki kez kaçırmak yeni (kötü)
  alışkanlığın başlangıcı. Sistem "ikinci kez kaçırmadan toparla"ya odaklanır.
- **Sunsama/Amie:** kaçanı belirli bir güne/saate **yeniden planla** (roll-over).
- **Finch/Fabulous:** suçlayıcı değil, şefkatli + mini adım.
- **2 Dakika Kuralı:** telafi için "mini versiyon" stratejisi — zinciri kırma.

## Telafi Stratejileri (NASIL)
- 🔁 **Tam Telafi** (`full`): telafi gününde tamamını yap.
- 🌗 **Yarım** (`half`): azaltılmış sürüm — hiç yapmamaktan iyi (partial loglanır).
- ⚡ **Mini** (`mini`): 2-dk minimum sürüm — zinciri koru (partial loglanır).
- 📅 **Yeniden Planla** (`reschedule`): ileri bir güne taşı, olduğu gibi.
+ 🕊 **Affet/Atla**: bilinçli, suçluluksuz vazgeçiş → plan `skipped` (strateji değil aksiyon).

## NE ZAMAN seçenekleri
Hızlı çipler: **Bugün akşam · Yarın · Hafta sonu (Cmt) · +gün stepper** (date-picker dep YOK).
Opsiyonel **hatırlatıcı saati** → tek-seferlik bildirim (expo-notifications DATE tetik).

---

## FAZ 0 — Backend (tablo + store + bildirim)
**0.1 Tablo** `public.recovery_plans` (execute_sql):
  `id, user_id(fk auth.users cascade), habit_id(fk habits cascade), source_date date,
   target_date date, strategy text check(full|half|mini|reschedule), note text,
   reminder_time text, status text check(planned|done|skipped), created_at`.
  RLS aç; owner-only 4 policy (`TO authenticated` + `auth.uid()=user_id`, update'te WITH CHECK);
  index (user_id,status,target_date) + (habit_id); `grant ... to authenticated`. `get_advisors`.
**0.2 Tip** `RecoveryPlan` (lib/supabase.ts).
**0.3 Store** `store/recoveryStore.ts`: `plans, loading, fetchPlans, addPlan, completePlan,
  skipPlan, deletePlan` (RLS ile auth.uid bazlı).
**0.4 Bildirim** `lib/notifications.ts`: `scheduleRecoveryReminder(plan, habitName)` (DATE tetik) +
  `cancelRecoveryReminder(planId)`; data.recoveryId ile filtre.
→ **Test Kapısı 0** (SQL round-trip + advisors temiz + tsc).

## FAZ A — Tasarım Sistemi & Temizlik
Ekranı token/primitive'e taşı: `Card, SectionHeader, EmptyState, IconCircle, Chip, Badge,
Button, ProgressBar`; hero rafine + "never miss twice" alt metni; pull-to-refresh tint token;
haptik. Davranış korunur.
→ **Test Kapısı A** (tsc + web export).

## FAZ B — Telafi Planlama Motoru (NE ZAMAN + NASIL)
**B1.** Bugün **kaçırılan** (no-log/miss) + **kısmi** (partial) aktif alışkanlıkları hesapla;
  mevcut `planned` planlarla çapraz eşle (zaten planlı olanı ayır).
**B2.** **Planlama sheet'i** (modal): alışkanlık başlığı; NE ZAMAN çipleri (Bugün akşam/Yarın/
  Hafta sonu/+gün stepper → target_date); NASIL strateji çipleri (4, ikon+etiket+açıklama);
  opsiyonel not; opsiyonel hatırlatıcı saati (HH:mm).
**B3.** "Planla" → `addPlan` (+ reminder varsa schedule). Haptik.
→ **Test Kapısı B** (tsc + web export).

## FAZ C — "Telafi Planın" Bölümü (plan listesi + aksiyonlar)
**C1.** `planned` planları target_date'e göre sıralı listele; **gecikmiş** (target<bugün) kırmızı
  "gecikti" rozeti; strateji çipi + not + hedef gün (Bugün/Yarın/dd.MM).
**C2.** Aksiyonlar: **Telafi Et** (plan→done + alışkanlığı logla: full→done, half/mini→partial,
  reschedule→done; reminder iptal) · **Atla** (→skipped, reminder iptal) · **Sil**.
**C3.** Boş → `EmptyState`.
→ **Test Kapısı C** (tsc + web export).

## FAZ D — "Bugün Telafi Bekleyen" + Entegrasyon
**D1.** Bugün kaçırılan+kısmi (henüz planı olmayan) liste: her satır **Şimdi Yap** (done logla) ·
  **Telafi Planla** (sheet aç). Kısmi olanlar ilerleme/birim gösterir.
**D2.** **"Never miss twice"** içgörü banner'ı: bir alışkanlık üst üste 2+ gün kaçtıysa uyarı +
  öncelikli telafi önerisi.
**D3.** Gecikmiş görevler bölümü primitive'lere taşınır (Tamamla / Bu Hafta korunur), aşağı alınır.
→ **Test Kapısı D** (tsc + web export).

## FAZ E — Empty State + Cila + Final
Hepsi tamam (hiç kaçan/plan yok) → kutlayıcı `EmptyState`; haptik (planla/telafi/atla/şimdi yap);
motive edici mikro-metin; tutarlılık; dev sunucu görsel kontrol.
→ **Test Kapısı E (final)** (tsc + web export).

---

## Telafi Et → loglama eşlemesi
`full`/`reschedule` → habit_logs state `done`; `half`/`mini` → `partial` (value ~ hedefin yarısı/
mini). Log tarihi = target_date (telafi günü). Plan `done`. İlgili reminder iptal.

## Doğrulama Protokolü
Her faz: `npx tsc --noEmit` 0 hata + `npx expo export --platform web` başarılı. FAZ 0 ayrıca
SQL round-trip + `get_advisors` (security) temiz. Dev sunucu görsel kontrol.

## Kapsam dışı
- Telafi için AI önerisi; tekrarlayan otomatik telafi; takvim entegrasyonu (ileride).
- Backend yalnız `recovery_plans` (mevcut tablo/şema değişmez). Yeni npm bağımlılığı yok.
