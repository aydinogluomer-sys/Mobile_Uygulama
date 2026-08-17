# Mobile_Uygulama — Yapılacaklar (faz faz)

**Durum:** Gate B `FAIL` (0 blocker · 2 major · 5 minor) — `05ab83e`
**Kural:** Her faz sonunda test çalışır. Test geçmeden sonraki faza geçilmez.
**Yetki sınırı:** Phase 1 ve sonrası **Gate B PASS + açık kullanıcı onayı** gerektirir.

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

## FAZ 1 — Gate B kabulü  🔒 KULLANICI KARARI

Verifier bunu sağlayamaz. Okunacak dört artefakt:

- [ ] **1.1** `1A-002A` + `1A-002B` — post-revoke baseline sözleşmesi doğru mu; Stage A iddia ettiğini kanıtlıyor mu
- [ ] **1.2** `1A-003` — canonical reset artık burada; doğru mu tanımlanmış
- [ ] **1.3** `plan/19 §7` — Gate B / Gate C sınırı istediğin yerde mi
- [ ] **1.4** `plan/18 §4` — kabul edeceğin bilinen limitler
- [ ] **1.5** **Karar:** Gate B PASS / FAIL

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

## FAZ 3 — Phase 1A · Şema temeli  🔒 FAZ 1 + FAZ 2 gerekli

- [ ] **3.1** `1A-001` three-way diff (read-only, Docker gerekmez)
- [ ] **3.2** `1A-002A` baseline yaz — `20260801000000_baseline_schema.sql` + archive
- [ ] **3.3** `1A-002B` Stage A/B — baseline-alone posture kanıtı
- [ ] **3.4** `1D-009` `supabase/config.toml` + deploy guard
- [ ] **3.5** `1A-003` canonical reset + schema hash
- [ ] **3.6** `1A-004` **çalıştırılmaz** — H-14 ayrı onay

**TEST 3:** `supabase db reset` exit 0 · beş rol privilege introspection · schema hash eşleşmesi

---

## FAZ 4 — Phase 1B · Tarih ve metrik doğruluğu  🔒 FAZ 1 gerekli

Docker gerekmez. 14 failing L1 kriterinin tamamı burada.

- [ ] **4.1** `1E-000` lisans clearance · `OPS-1E-001` npm script'leri
- [ ] **4.2** `1E-L1` jest harness
- [ ] **4.3** `1B-001` `lib/date.ts`
- [ ] **4.4** `1E-L1a` testleri **önce yaz, önce başarısız olsun**
- [ ] **4.5** `1B-003` `isDueOn` count · `1B-004` metrik formülleri
- [ ] **4.6** `1E-L1b` metrik/store testleri
- [ ] **4.7** `1B-002` 5 store/lib · `1B-005` log hata · `1B-007` kalan store · `1B-008` `app/**`
- [ ] **4.8** `DEMO-001A` → `DEMO-001B` seeder guard

**TEST 4:** `npm test` yeşil · 14 kriter geçiyor · `npx tsc --noEmit` temiz

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
| H-02, H-04..H-10, H-12 | — | sonraki fazlar |

## Değişmeyen kısıtlar

- Mas Technic (`zdqiujpeewtyhtcqhdcj`) üzerinde **hiçbir işlem yok**
- Gate B PASS + açık onay olmadan production kodu / migration SQL / live DB / Edge Function **yok**
- Ayrıcalıklı fonksiyon test amaçlı **çağrılmaz** — sadece introspection
- Faz sonu testi geçmeden sonraki faza geçilmez
