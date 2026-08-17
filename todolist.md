# Mobile_Uygulama — Yapılacaklar (faz faz)

**Plan onayı:** ✅ **ONAYLANDI** (kullanıcı, 2026-08-04) — bu belge artık
uygulanacak faz sırasının referansıdır.
**Kural:** Her faz sonunda test çalışır. Test geçmeden sonraki faza geçilmez.
**Yetki sınırı:** Phase 1 ve sonrası **Gate B PASS + açık kullanıcı onayı** gerektirir.

> **Bu onay planın kendisinedir, Gate B kabulü değildir.** FAZ 1 (task
> semantiklerinin kabulü) hâlâ açık ve FAZ 3+ onu bekliyor. İkisi ayrı kararlar:
> bu belge *neyin hangi sırayla yapılacağını* onaylar; Gate B *yapılacak şeyin
> doğru tarif edilip edilmediğini* onaylar.

Gate durumu: `⬜ yapılacak` · `🟦 devam` · `✅ bitti` · `🔒 kilitli (karar/insan bekliyor)`

---

## FAZ 0 — Gate B kapanışı  ✅ **TAMAMLANDI** (TEST 0: 6/6)

Son review'ın iki major bulgusu. İkisi de tek satır.

- [x] **0.1** `plan/01:407` — `1A-003` risk alanındaki silinmiş `1A-002` referansı → `1A-002A`
- [x] **0.2** `verify_gate_b.py:935` — `src.index("def main(")` kendi satırındaki string'i buluyor; `ast` ile parse et
- [x] **0.3** `plan/19 §4` — self-test iddiasını gerçekte kanıtladığıyla sınırla
- [x] **0.4** `plan/18:61` kapsam kaydını üç guarantee listesine taşı (docstring, README, `plan/19 §6`)
- [x] **0.5** Minor'lar: `plan/19 §3` 33→31 · `[13]` çift numara kaydı · README 16→19 check · stale adjudication kaydı

**TEST 0 — GEÇTİ (6/6):**
- ✅ `verify_gate_b.py` → `FAILURES: NONE`
- ✅ `check_h01` / `check_stale` / `check_fence_syntax` çağrısı silinince → **FAIL**
- ✅ throwaway `Report()` → **FAIL**
- ✅ `risk` alanına sahte token → **FAIL**
- ✅ temiz durum → **PASS**
- ✅ kapsam: sadece `docs/` + `tools/` + `todolist.md`

**Sınıf kapatıldı, örnek değil:** check [13] artık zorunlu task alanlarını da
tarıyor; self-test `main()`'i `ast` ile buluyor.

---

## FAZ 1 — Gate B kabulü  ✅ **PASS** (kullanıcı, 2026-08-04)

Verifier bunu sağlayamaz. Okunacak dört artefakt:

- [x] **1.1** `1A-002A` + `1A-002B` — post-revoke baseline sözleşmesi doğru mu; Stage A iddia ettiğini kanıtlıyor mu
- [x] **1.2** `1A-003` — canonical reset artık burada; doğru mu tanımlanmış
- [x] **1.3** `plan/19 §7` — Gate B / Gate C sınırı istediğin yerde mi
- [x] **1.4** `plan/18 §4` — kabul edeceğin bilinen limitler
- [x] **1.5** **Karar:** Gate B PASS / FAIL

---

## FAZ 2 — H-13 (Docker)  ✅ **TAMAMLANDI** (TEST 2 geçti)

- [x] **2.1** Docker zaten çalışıyor — Docker Desktop, server 29.7.2
- [x] **2.2** `docker info` → exit 0
- [x] **2.3** `supabase --version` → 2.109.1
- [x] **2.4** **YENİ BULGU:** 54322'yi ilgisiz bir stack tutuyor —
      `supabase_db_meritflow-dev` (postgres 17.6.1.155), 9 container.
      `1A-002B` kendi stack'ini başlatıyordu → **çakışırdı**.
      Düzeltme: scratch config'e özel port bloğu (55321–55329) + doğrulama.
      İlgisiz projeye **dokunulmadı**.

**TEST 2 — GEÇTİ:**
- ✅ `docker info` exit 0 · server 29.7.2
- ✅ `supabase --version` 2.109.1
- ✅ port yeniden yazımı gerçek `supabase init` çıktısında çalıştırıldı:
  6 port taşındı, `DB_PORT` çıkarımı 55322, assertion geçti

**H-13 artık Phase 1A'yı engellemiyor.** Kalan tek engel FAZ 1.

---

## FAZ 3 — Phase 1A · Şema temeli  🟦 **DEVAM EDİYOR**

- [ ] **3.1** `1A-001` three-way diff — 🔴 **ENGELLİ**
      Canonical proje INACTIVE. `restore_project` **reddedildi**: free-tier
      2 aktif proje sınırı dolu.
      Yer tutanlar: **Mas Technic** (`zdqiujpeewtyhtcqhdcj`, yasaklı) ve
      **MeritFlow** (`ieiblroubtzktnykvhhz`, ilgisiz üçüncü proje).
      **H-15 (YENİ):** birinin duraklatılması/yükseltilmesi gerekiyor — kullanıcı kararı.
      Ben yapamam: Mas Technic yasak, MeritFlow bana ait değil.
- [ ] **3.2** `1A-002A` baseline yaz — `20260801000000_baseline_schema.sql` + archive
- [ ] **3.3** `1A-002B` Stage A/B — baseline-alone posture kanıtı
- [x] **3.4** `1D-009` `supabase/config.toml` + deploy guard — **5/5 validation geçti**
- [ ] **3.5** `1A-003` canonical reset + schema hash
- [ ] **3.6** `1A-004` **çalıştırılmaz** — H-14 ayrı onay

**TEST 3:** `supabase db reset` exit 0 · beş rol privilege introspection · schema hash eşleşmesi

> **H-15 bu turda ikinci kez ısırdı.** `1B-005` `.upsert({ onConflict:
> 'habit_id,completed_at' })` yazacaktı — çift kaydı gerçekten imkânsız kılan
> tek şey bu. Ama o constraint'in canlıda var olup olmadığını okuyamadım:
> proje INACTIVE, `execute_sql` connection timeout verdi. Constraint yoksa
> `upsert` çalışma anında hata verir ve **alışkanlık kaydı tamamen çalışmaz**.
> Bu yüzden `1B-005` `upsert` **kullanmıyor**; serileştirme + 23505 kurtarma
> ile yetiniyor ve sınırını commit mesajında açıkça yazıyor.
>
> Repo migration'ı `001_initial_schema.sql:34` `UNIQUE (habit_id, date)` diyor
> ama canlıda kolon `completed_at` olarak yeniden adlandırılmış (bilinen drift),
> yani repo bu soruya **cevap veremez**. `1A-001` three-way diff'in
> cevaplayacağı şeylerden biri de bu.

---

## FAZ 4 — Phase 1B · Tarih ve metrik doğruluğu  ✅ **TAMAMLANDI** (TEST 4 geçti)

Docker gerekmez. 14 failing L1 kriterinin tamamı burada.

- [x] **4.1** `1E-000` clearance **kapatıldı** (jest-expo 54.0.17 MIT + shasum; supabase CLI **MIT**, Apache-2.0 iddiası yanlıştı; pgTAP hâlâ PENDING — sadece 1E-L2'yi bekletir) · `OPS-1E-001` script'ler + devDeps
- [x] **4.2** `1E-L1` harness — `TZ=Europe/Istanbul` sabitlendi, `.env` okumuyor
- [x] **4.3** `1B-001` `lib/date.ts` — kodda 0 `toISOString`
- [x] **4.4** `1E-L1a` date testleri — **25/25**
- [x] **4.5** `1B-003` count → **15/15** · `1B-004` AC-H04..H09 → **14/14** (9 test önce başarısız oldu)
- [x] **4.6** `1E-L1b` metrik/store testleri — `dateDerivation` 7/7, `logStore` 7/7
- [x] **4.7** `1B-002` (`c8f54fc`) · `1B-005` (`9f88cfa`) · `1B-007` (`0ffce28`) · `1B-008` (`29ac301`)
- [x] **4.8** `DEMO-001A` → `DEMO-001B` seeder guard (`998476e`)

**TEST 4 SONUÇ:** `npm test` **92/92** · `npx tsc --noEmit` exit 0 · her düzeltme
önce başarısız olan bir testle kanıtlandı (R-01).

### FAZ 4'te bulunan, planda adlandırılmamış hatalar

| # | Yer | Hata | Nasıl bulundu |
|---|---|---|---|
| **F-01** | `lib/focusReport.ts:60,108,126,133` | `started_at` tam UTC instant; ilk 10 karakteri gün anahtarı sanılıp **yerel** `ymd()` anahtarlarıyla karşılaştırılıyordu. Aynı dosya saatleri **yerel** okuyordu — kendi içinde çelişiyordu | `1B-007` taraması |
| **F-02** | `app/screens/monthly-review.tsx:47`, `weekly-review.tsx:48` | `task.completed_at` tam UTC timestamp; `.split('T')[0]` UTC gününü verip yerel ay/hafta sınırlarıyla karşılaştırılıyordu. 01:00'de tamamlanan görev bir önceki ayın raporuna düşüyordu | `1B-008` taraması, ilk regex'in kaçırdığı kalıp |
| **F-03** | `lib/demoSeed.ts:21` | `toISOString().slice(0,10)` — gerçek UTC sızıntısı, plan bunu yalnızca 'ikiz `ymd`' olarak listeliyordu | `1B-002` |
| **F-04** | `lib/journalStats.ts`, `lib/focusReport.ts`, `lib/habitSchedule.ts`, `lib/reportMetrics.ts` | `ymd`'nin kanonik olan dışında **4** kopyası daha vardı (plan 2 diyordu) | `grep 'function ymd'` |

`lib/date.ts` iki yardımcı kazandı: `ymLocal` (ay anahtarı) ve `ymdFromIso`
(saklanan UTC instant → yerel gün anahtarı). İkisi de `ymd`'den türetiliyor ki
asla ayrışamasınlar.

Yeni: `__tests__/repo/noUtcDayKeys.test.ts` — depo çapında invariant. Kaynak
**metni** üzerinde çalıştığını kendi başlığında açıkça yazıyor; davranış kanıtı
değil, nüks çiti.

---

## FAZ 5 — Phase 1C/1D · İrade, telafi, edge-fn güvenliği  🔒 FAZ 3 gerekli

- [ ] **5.1** `1C-001` atomik debit RPC · `1C-003` → `1C-002` · `1C-004`/`1C-005`/`1C-006`
- [ ] **5.2** `1D-000` generate-routine reconcile (R-19 — 1D deploy'undan önce)
- [ ] **5.3** `1D-001`→`002`→`003`→`004` zinciri
- [ ] **5.4** `1D-005`→`006`→`007` OAuth zinciri · `1D-008` webhook
- [ ] **5.5** `SEC-1D-001..004` · `SEC-1D-005a..f` (005a **H-11** bekliyor)

**TEST 5:** `supabase test db` yeşil · AC-S01..S07 beş rol · concurrency testleri

---

## FAZ 6 — Phase 1E · Layer 2 + Gate C  🔒 FAZ 3 + 5 gerekli

- [ ] **6.1** `1E-L2` pgTAP harness · `1E-L2a` · `1E-L2b`
- [ ] **6.2** Gate C: tsc · lint · L1 · L2 · bağımsız review · rapor
- [ ] **6.3** **DUR** — Phase 2 ayrı onay

---

## FAZ 7+ — Phase 2–8  🔒 HER BİRİ AYRI ONAY

- [ ] **7** Phase 2 — erişilebilirlik, ürün dürüstlüğü, SDK 54, backend canonicalisation
- [ ] **8** Phase 3 — REF paritesi (`3-ENTRY-001` giriş şartı)
- [ ] **9** Phase 4 — raporlama, analitik, AI, dışa aktarma
- [ ] **10** Phase 5 — tasarım sistemi, a11y, motion
- [ ] **11** Phase 6 — QA, CI/EAS, mağaza
- [ ] **12** Phase 7 — git history (ayrı rewrite onayı)
- [ ] **13** Phase 8 — OSS adoption, skill rollout

---

## Açık insan kararları

| # | Karar | Engellediği |
|---|---|---|
| **Gate B** | task semantiklerinin kabulü | FAZ 1 → her şey |
| **H-13** | Docker başlat | FAZ 2 → 3, 5, 6 |
| **H-11** | `last_ai_context` sahipliği | `SEC-1D-005a` |
| **H-14** | `1A-004` canlı cutover onayı | sadece `1A-004` |
| **H-03** | `backend/.env.local` taşıma | `OPS-0B-001` (2C) |
| **H-15** 🆕 | free-tier 2-aktif-proje sınırı: Mas Technic veya MeritFlow duraklatılmalı / plan yükseltilmeli | `1A-001` → tüm şema zinciri (FAZ 3) |
| H-02, H-04..H-10, H-12 | — | sonraki fazlar |

## Değişmeyen kısıtlar

- Mas Technic (`zdqiujpeewtyhtcqhdcj`) üzerinde **hiçbir işlem yok**
- Gate B PASS + açık onay olmadan production kodu / migration SQL / live DB / Edge Function **yok**
- Ayrıcalıklı fonksiyon test amaçlı **çağrılmaz** — sadece introspection
- Faz sonu testi geçmeden sonraki faza geçilmez
