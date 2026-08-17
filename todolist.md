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

> **2026-08-17 — yürütme haritası `docs/plan/20_UYGULAMA_REHBERI.md`'ye taşındı.**
> Bu belge **sıra** ve **gate durumu** için referans olmaya devam ediyor; adım
> adım *nasıl uygulanacağı* ve saptama envanteri artık rehberde. Rehber FAZ A–G
> kullanıyor; eşleme:
>
> | Bu belge | Rehber | Durum |
> |---|---|---|
> | FAZ 0–2, 4 | *(tamamlandı)* | ✅ |
> | — | **FAZ A** kayıt düzeltme + kilit açma | ✅ A1–A8 · **A9 açık** |
> | FAZ 5 kısmı | **FAZ B** canlısız kod | ✅ B1–B5 |
> | FAZ 3 | **FAZ C** şema temeli | 🔒 **H-15 — başlanmadı** |
> | FAZ 5 | **FAZ D** migration + RPC | 🔒 başlanmadı |
> | FAZ 5 | **FAZ E** generate-routine | 🔒 başlanmadı |
> | *(yeni)* | **FAZ F** Notion kimliği + `1D-007` | 🔒 başlanmadı |
> | FAZ 6 | **FAZ G** Layer 2 + Gate C | 🔒 başlanmadı |

### Alınan kararlar — 2026-08-17

| # | Karar | Sonucu |
|---|---|---|
| **D-01** | **Gerçek Notion→Supabase kimliği kurulacak** | Sahte giriş (**N-01**) kaldırılmıyor, düzeltiliyor. `1D-007` kriteri intent-bazlı hale getirildi (`plan/01` güncellendi) |
| **D-02** | **İmzalı stateless HMAC state** | `1D-005` migration gerektirmiyor → H-15'e takılmıyor. `plan/01` kabul kriterleri yeniden yazıldı. Yeni secret: `OAUTH_STATE_SECRET` |
| **H-15** | **Pro plana yükseltilecek** | Yükseltmeyi kullanıcı yapar; ben yalnızca `restore_project` çağırırım |

### Kendi işimde bulunan eksikler

| # | Eksik | Durum |
|---|---|---|
| **S-01** | `1C-003` AC-3 karşılanmadı — `score()` `state` null iken `100` döndürüyor, `plan/01:661` "loading" istiyor | FAZ B1'de düzeltilecek |
| **S-02** | `1D-006` bağımlılık sırası dışında yürütüldü (`1D-005`'ten önce) | ✅ `plan/01`'e kaydedildi; `depends_on` bilerek değiştirilmedi |
| **S-03** | `plan/05 §3` free-tier auto-pause kabulü yanlış öncüle dayanıyordu ("restore tek çağrı") | ✅ kabul geri çekildi, R-18 `H×H` olarak yeniden puanlandı |
| **S-04** | `D-17` (`1B-009`) yürütmeyle kapandı — `1B-008` 12 sitenin hepsini aldı | ✅ `plan/05`'te kapatıldı |

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

## FAZ 5 — Phase 1C/1D · İrade, telafi, edge-fn güvenliği  🟦 **KISMEN AÇIK**

> **Düzeltme.** Bu bölüm toptan "🔒 FAZ 3 gerekli" diye işaretlenmişti; **yanlıştı**.
> `plan/02 §2`'ye göre `1C-003`, `1D-005`, `1D-006` ve `1D-009` canlı DB
> gerektirmiyor. Yalnızca `1A-002B`'ye bağlı olanlar FAZ 3'ü bekliyor.

- [ ] **5.1** `1C-001` atomik debit RPC 🔒 · `1C-002` 🔒 · `1C-004`/`1C-005`/`1C-006` 🔒
- [x] **5.1a** `1C-003` gece yarısı rollover — **10/10** (`04d7605`)
- [x] **5.1b** `1C-007` bayat irade satırı + `1C-008` onboarding ikizleri — **6/6** (`2d640d6`). Bulgu **N-07**'den doğdu; backlog'a `af6c987` ile eklendi. Serileştirme: `1C-003` → `1C-007` → `1C-002`
- [ ] **5.2** `1D-000` generate-routine reconcile 🔒 (canlı v11 ile karşılaştırma gerekir)
- [ ] **5.3** `1D-001`→`002`→`003`→`004` zinciri 🔒
- [x] **5.4a** `1D-006` redirect_uri allowlist — **17/17** (`6ba6f44`), iki fonksiyona da uygulandı
- [x] **5.4b** `1D-005` state doğrulama — ✅ **HMAC ile uygulandı** (`4a66abc`), 21 test. D-02 kararı verildi; migration gerekmediği için H-15'e takılmadı. **Bilinen sınır:** imzalı state TTL dolana kadar replay edilebilir; tam tek-kullanımlık `oauth_states` tablosu ister, FAZ D'de yeniden değerlendirilir
- [ ] **5.4c** `1D-007` callback auth — ⬜ **AÇIK, FAZ F'e atandı.** D-01 kararı verildi (gerçek Notion→Supabase kimliği). `plan/01`'deki hatalı öncül düzeltildi: "her durumda 401" yerine **intent-bazlı** kriter. Kod, kimlik özelliği geldikten sonra
- [ ] **5.4d** `1D-008` webhook idempotency 🔒
- [ ] **5.5** `SEC-1D-001..004` 🔒 · `SEC-1D-005a..f` 🔒 (005a **H-11** bekliyor)

### `notion-auth` — planın kaçırdığı yapısal çatışma

Tek uç iki farklı akışa hizmet ediyor:

| Akış | Çağıran | Auth başlığı | Sunucu davranışı |
|---|---|---|---|
| Entegrasyon bağlama | `notionStore.ts:111` → `integrations.tsx` | **var** | `if (user)` → kayıt yazılıyor |
| "Notion ile giriş" | `notionSessionStore.ts:61` → `login.tsx:39` | **yok** | `user` null → **hiçbir şey yazılmıyor**, yine de `success:true` |

Planın `1D-007` reçetesi "callback'te 401 döndür". O satır yazılırsa **"Notion
ile giriş" tamamen ölür**, çünkü o akışta tanım gereği henüz kullanıcı yoktur.

**Altındaki asıl kusur (P1, yeni):** `login.tsx:39-41` — `login()` başarılı
dönünce `router.replace('/tabs/today')` çalışıyor ama **Supabase oturumu hiç
oluşturulmuyor**. Kullanıcı uygulamanın içine giriyor, `supabase.auth.getUser()`
her yerde `null`, RLS her şeyi reddediyor. Sahte giriş.

**İkincil:** `notionSessionStore.ts:88-97` CSRF state'ini **istemcide**
doğruluyor (AsyncStorage karşılaştırması). CSRF senaryosunda istemci saldırganın
kontrolündedir; bu koruma değil. `state` sunucuda doğrulanmalı — `1D-005`.

### Açık kararlar

| # | Karar | Neyi engelliyor |
|---|---|---|
| **D-01** | "Notion ile giriş" ne olsun: kaldırılsın mı, gerçek Notion→Supabase kimliği mi kurulsun | `1D-007` |
| **D-02** | OAuth `state` nerede doğrulansın: imzalı stateless HMAC (tablo yok, bugün yazılabilir, yeni secret) ya da `oauth_states` tablosu (migration → H-15'e bağlı) | `1D-005` |

> Bu iki karar bu oturumda **sorulmuş ama cevaplanmamıştır.** Hiçbiri varsayılarak
> ilerlenmedi.

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

> **Kapananlar tablodan çıkarıldı, kaydı burada:** **Gate B** ✅ PASS (kullanıcı, 2026-08-04 — FAZ 1) · **H-13** ✅ Docker çalışıyor (FAZ 2). Açık bir karar listesinde kapanmış madde tutmak, listeyi okunmaz yapar.

| # | Karar | Engellediği |
|---|---|---|
| **H-11** | `last_ai_context` sahipliği | `SEC-1D-005a` |
| **H-14** | `1A-004` canlı cutover onayı | sadece `1A-004` |
| **H-03** | `backend/.env.local` taşıma | `OPS-0B-001` (2C) |
| **OAUTH_REDIRECT_ALLOWLIST** | `1D-006` ile zorunlu: ayarlanmazsa liste boş, boş liste hiçbir şeye izin vermez → fail-closed. Deploy adımı, kod adımı değil | `notion-auth`, `spotify-auth` deploy'u |
| **OAUTH_STATE_SECRET** 🆕 | `1D-005` ile zorunlu: HMAC anahtarı. Yoksa state üretimi ve doğrulaması fail-closed. Service-role anahtarı **kullanılmaz** — amaç ayrımı | `notion-auth`, `spotify-auth` deploy'u |
| **H-15** | free-tier 2-aktif-proje sınırı — **karar: Pro plana yükselt** (2026-08-17). ⬜ **YAPILMADI.** Son gözlem 2026-08-17: org `plan: free`, kanonik proje `INACTIVE`, `restore_project` → `ForbiddenException`. Faturalama işlemi; kullanıcı yapar. Detay + devam adımları: `docs/plan/20_UYGULAMA_REHBERI.md §0` | `1A-001` → tüm şema zinciri (FAZ C–G) |
| H-02, H-04..H-10, H-12 | — | sonraki fazlar |

## Değişmeyen kısıtlar

- Mas Technic (`zdqiujpeewtyhtcqhdcj`) üzerinde **hiçbir işlem yok**
- Gate B PASS + açık onay olmadan production kodu / migration SQL / live DB / Edge Function **yok**
- Ayrıcalıklı fonksiyon test amaçlı **çağrılmaz** — sadece introspection
- Faz sonu testi geçmeden sonraki faza geçilmez
