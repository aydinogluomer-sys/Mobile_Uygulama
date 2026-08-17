# 20 — Uygulama Rehberi

**Durum:** Phase 1 yürütme rehberi
**Oluşturuldu:** 2026-08-17
**Kapsam:** saptama envanteri Phase 0–8'in tamamını kapsar; adım adım uygulama
detayı yalnızca şu an eyleme geçilebilir olan **Phase 1 + kararlar** içindir.

---

## 1 · Bu belge nedir

Üç belge var ve üçü farklı soruya cevap veriyor. Karıştırılırsa iş tekrarlanır:

| Belge | Cevapladığı soru |
|---|---|
| `todolist.md` | **Hangi sırayla?** — faz sırası ve gate durumu |
| `plan/01_IMPLEMENTATION_BACKLOG.md` | **Ne yapılacak?** — görev tanımı, kabul kriterleri, rollback |
| **bu belge** | **Nasıl uygulanacak?** — saptama envanteri ve adım adım yürütme |

Çelişki çıkarsa `plan/01` bağlayıcıdır; bu belge onu **uygular**, yeniden
tanımlamaz. Bir kabul kriterini değiştirmek gerekiyorsa `plan/01` düzeltilir ve
gerekçe buraya yazılır — sessizce sapılmaz.

### Değişmeyen kurallar

1. **R-01 — önce başarısız test.** Hiçbir düzeltme, hatayı üreten bir test
   yazılıp **başarısız olduğu gözlenmeden** yazılmaz. Başarısız olmayan test
   görevi durdurur; teşhis yanlış demektir.
2. **Kanıt kuralı.** Hiçbir iddia dosya adına dayanamaz. Her iddia `dosya:satır`
   ya da bir komut çıktısı taşır.
3. **Faz sonu testi.** Her fazın sonunda TEST çalışır. Geçmeden sonraki faza
   geçilmez.
4. **Mas Technic yasağı.** `zdqiujpeewtyhtcqhdcj` üzerinde **hiçbir işlem yok** —
   resume, deploy, migration, anahtar rotasyonu, veritabanı ya da Edge Function
   değişikliği. Ayrı ve ilgisiz bir projedir; ikinci bir ortam değildir.
5. **Ayrıcalıklı fonksiyon test için çağrılmaz.** Bir "test çağrısı" istismarın
   kendisi olur. Yalnızca introspection.
6. **Deploy ayrı onaydır.** Bu rehberdeki hiçbir faz kendiliğinden deploy etmez.

---

## 2 · Saptama envanteri

### 2.1 Kapatılanlar — commit ve test kanıtıyla

| Görev | Ne düzeltildi | Dosya | Commit | Test |
|---|---|---|---|---|
| `1D-009` | Yanlış projeye deploy fiziksel olarak engellendi; fail-closed | `supabase/config.toml`, `predeploy_guard.sh` | `c3b2438` | 5/5 validation |
| `1E-000` | Lisans clearance: jest-expo 54.0.17 MIT + shasum; supabase CLI **MIT** *(Apache-2.0 iddiası yanlıştı)* | `research/04` | `20551c5` | npm view |
| `OPS-1E-001` · `1E-L1` | `test`/`typecheck` script'leri, jest-expo harness, `TZ=Europe/Istanbul` **setup'ta** sabitlendi | `jest.config.js`, `jest.setup.js` | `20551c5` | harness çalışıyor |
| `1B-001` · `1E-L1a` | Kanonik tarih modülü; kodda 0 `toISOString` | `lib/date.ts` | `20551c5` | 25/25 |
| `1B-003` | `frequency_config.count` hiç okunmuyordu → "haftada X kez" alışkanlığı **yılın hiçbir gününde** due değildi | `lib/habitSchedule.ts` | `ae1f8f7` | 15/15 |
| `1B-004` | `target_direction` yok sayılıyordu (`at_most` alışkanlığında **daha yüksek değer ödüllendiriliyordu**); `miss`/`skip` tamamlanmış sayılıyordu; `isDueOn` hiç çağrılmıyordu → Pzt/Çar/Cum alışkanlığı %43'te tavan yapıyordu | `lib/reportMetrics.ts` | `ae1f8f7` | 14/14 |
| `1B-002` | 5 dosyada UTC/yerel karışımı; `ymd`'nin **4 ikizi** silindi *(plan 2 diyordu)* | `taskStore`, `deepWorkStore`, `lifeAreasStore`, `focusReport`, `journalStats` | `c8f54fc` | grep → 0 |
| `1B-005` | Çift dokunuş iki `insert` üretiyordu; her iki dal da `error`'ı yutuyordu | `store/logStore.ts` | `9f88cfa` | 7/7 |
| `1B-007` | **F-01** | `lib/focusReport.ts` +3 | `0ffce28` | 7/7 |
| `1B-008` | **F-02** + 12 site | 12 dosya | `29ac301` | invariant |
| `DEMO-001A/B` | Seeder gerçek kullanıcı verisini kirletiyordu; `__DEV__` altında fail-closed, **ilk ifade olarak** | `lib/demoSeed.ts`, `app/tabs/settings.tsx` | `998476e` | 6/6 |
| `1C-003` | `spend()` **dünün satırını** güncelliyordu | `store/willpowerStore.ts` | `04d7605` | 10/10 |
| `1D-006` | `redirect_uri` doğrudan istekten alınıp authorize URL'ine gömülüyordu | `notion-auth`, `spotify-auth`, `_shared/redirectAllowlist.ts` | `6ba6f44` | 17/17 |

**Toplam: 119 test yeşil, `tsc --noEmit` exit 0.**

### 2.2 Planın adlandırmadığı hatalar — bulundu ve kapatıldı

| # | Yer | Hata |
|---|---|---|
| **F-01** | `lib/focusReport.ts:60,108,126,133` | `focus_sessions.started_at` tam UTC instant (`focusStore.ts:205` `toISOString()` yazıyor). İlk 10 karakteri gün anahtarı sanılıp **yerel** `ymd()` anahtarlarıyla karşılaştırılıyordu. Aynı dosya saatleri (`:95`) **yerel** okuyordu — kendi içinde çelişiyordu. UTC+3'te 00:00–03:00 arası her seans bir önceki güne, grafikte ise **hiçbir kovaya** düşmüyordu |
| **F-02** | `monthly-review.tsx:47`, `weekly-review.tsx:48` | `task.completed_at` tam UTC timestamp; `.split('T')[0]` UTC gününü verip **yerel** ay/hafta sınırlarıyla karşılaştırılıyordu. **Ayın 1'inde 01:00'de tamamlanan görev bir önceki ayın raporuna düşüyordu** |
| **F-03** | `lib/demoSeed.ts:21` | `toISOString().slice(0,10)` — gerçek UTC sızıntısı; plan bunu yalnızca "ikiz `ymd`" olarak listeliyordu |
| **F-04** | 4 dosya | `ymd`'nin kanonik olan dışında **4** kopyası daha vardı *(plan 2 diyordu)* |

`lib/date.ts` üç yardımcı kazandı — hepsi `ymd`'den türetiliyor ki asla
ayrışamasınlar: `ymLocal` (ay anahtarı), `ymdFromIso` (saklanan UTC instant →
yerel gün anahtarı), ve mevcut `weekStartYmd`.

`__tests__/repo/noUtcDayKeys.test.ts` — depo çapında nüks çiti. Kaynak **metni**
üzerinde çalıştığını kendi başlığında yazıyor; davranış kanıtı değildir.

### 2.3 Yeni saptamalar — planda yok, henüz düzeltilmedi

| # | Saptama | Yer | Faz |
|---|---|---|---|
| **N-01** | **P1 — sahte giriş.** `login()` başarılı dönünce `router.replace('/tabs/today')` çalışıyor ama **Supabase oturumu hiç oluşturulmuyor**. Dosyadaki tek gerçek kimlik doğrulama `signInWithPassword`. Kullanıcı uygulamaya giriyor, `supabase.auth.getUser()` her yerde `null`, **RLS her şeyi reddediyor** — boş bir uygulama | `app/(auth)/login.tsx:39-41` | **F** |
| **N-02** | CSRF state **istemcide** doğrulanıyor (AsyncStorage karşılaştırması). CSRF senaryosunda istemci saldırganın kontrolündedir; bu koruma değil dekordur | `store/notionSessionStore.ts:88-97` | **B** |
| **N-03** | `notion-auth` tek uçtan **iki farklı akışa** hizmet ediyor. Planın `1D-007` reçetesi ("callback'te 401 döndür") uygulanırsa giriş akışı **tamamen ölür** — o akışta tanım gereği henüz kullanıcı yoktur | `supabase/functions/notion-auth/index.ts:89` | **F** |
| **N-04** | `logHabit` artık `LogResult` ile hatayı taşıyor ama `app/**` çağıranları hâlâ dönüş değerini yok sayıyor — hata kullanıcıya ulaşmıyor | `today.tsx:154`, `timeline.tsx:84,91`, `recovery.tsx:187,231` | **B** |
| **N-05** | `OAUTH_REDIRECT_ALLOWLIST` — `1D-006` ile **zorunlu** hale geldi. Ayarlanmazsa liste boş, boş liste hiçbir şeye izin vermez → OAuth fonksiyonları fail-closed. İstenen duruş budur ama **deploy şartıdır** | deploy config | **A** |
| **N-06** | pgTAP lisans clearance hâlâ **PENDING**. `research/04:160` "sürüm veya lisans **okunmadı**" diyor — hafızadan iddia etmek yerine kayda geçirilmiş | `1E-L2` girişi | **G** |

#### N-03'ün ayrıntısı — iki akış tek uçta

| Akış | Çağıran | `Authorization` | Sunucu davranışı |
|---|---|---|---|
| Entegrasyon bağlama | `notionStore.ts:111` → `integrations.tsx` | **var** | `if (user)` → kayıt yazılıyor ✅ |
| "Notion ile giriş" | `notionSessionStore.ts:61` → `login.tsx:39` | **yok** | `user` null → **hiçbir şey yazılmıyor**, yine de `success:true` + workspace bilgisi dönüyor |

İkinci akışta sunucu bir auth code'u yakıyor, gerçek bir Notion token'ı alıyor,
`/users/me` çağırıyor, sonra **hiçbir şey saklamadan** başarı dönüyor.

### 2.4 Kendi işimdeki eksikler

Bunlar benim ürettiğim işteki kusurlar. Sessizce düzeltmek yerine kayda geçiyorum.

| # | Eksik | Sonuç |
|---|---|---|
| **S-01** | **`1C-003` AC-3 karşılanmadı.** `plan/01:661` "`score()` `state` null iken **loading** döndürmeli, `100` değil" diyor. Uygulamam `willpowerStore.ts:83,85`'te `100` döndürüyor — kullanıcıya **uydurma bir "%100 irade"** gösteriyor. Yorumda gerekçelendirdim ama gerekçe kriteri karşılamıyor | **B1**'de düzeltilecek |
| **S-02** | **`1D-006` bağımlılık sırası dışında yürütüldü.** `plan/01:791` `depends_on: 1D-005` diyor; `1D-006` önce yapıldı. Sıranın gerekçesi *"üçü de `notion-auth/index.ts`'i düzenliyor, eşzamanlı düzenleme olmasın"* — sıralı yürütmeyle bu sağlandı, dolayısıyla **zarar yok**. Ama grafik ile yürütme geçmişi uyuşmuyor | **A**'da kayda geçirildi |
| **S-03** | **Kabul edilmiş bir riskin öncülü geçersizleşti.** `plan/05 §3` free-tier auto-pause'u *"restore **tek çağrı**, veri kaybı yok"* diyerek kabul ediyor. Artık doğru değil: 2-aktif-proje sınırı `restore_project`'i `ForbiddenException` ile reddediyor. **Kabul kararı yanlış bir öncüle dayanıyordu** | **A**'da `plan/05` düzeltilecek |
| **S-04** | **`D-17` yürütmeyle kapandı.** `plan/05:64` `1B-009`'u (kalan 5 `app/**` UTC sitesi) Phase 2A'ya erteliyordu; `1B-008` **hepsini** kapattı (`grep` → 0). Ertelenmiş kalem artık mevcut değil | **A**'da kapatılacak |

### 2.5 Bu oturumda alınan kararlar

| # | Karar | Sonucu |
|---|---|---|
| **D-01** | **Gerçek Notion→Supabase kimliği kurulacak** | Sahte giriş kaldırılmıyor, **düzeltiliyor**. `1D-007` bu özellik gelene kadar bekler. **FAZ F** |
| **D-02** | **İmzalı stateless HMAC state** | `1D-005` migration gerektirmiyor → H-15'e takılmıyor, **FAZ B**'de yazılabilir. Yeni zorunlu secret: `OAUTH_STATE_SECRET` |
| **H-15** | **Pro plana yükseltilecek** | Şema zinciri (FAZ C–G) açılıyor. Yükseltmeyi kullanıcı yapar; ben yalnızca kanonik projeyi başlatırım |

### 2.6 Açık backlog

`1A-001..004` · `1C-001` · `1C-002` · `1C-004` · `1C-005` · `1C-006` ·
`1D-000..004` · `1D-005` · `1D-007` · `1D-008` · `SEC-1D-001..004` ·
`SEC-1D-005a..f` · `OPS-0B-001` · `1E-L2` · `1E-L2a` · `1E-L2b`

### 2.7 Açık insan kararları

| # | Karar | Engellediği |
|---|---|---|
| **H-15** | Pro yükseltme *(karar verildi, uygulanmadı)* | FAZ C–G |
| **H-11** | `last_ai_context` sahipliği | `SEC-1D-005a` |
| **H-14** | `1A-004` canlı ledger cutover onayı | yalnızca `1A-004` |
| **H-03** | `backend/.env.local` taşıma | `OPS-0B-001` (Phase 2C) |
| **H-02** | Pruned credential rotasyonu | — |
| **N-05** | `OAUTH_REDIRECT_ALLOWLIST` değeri | OAuth deploy'u |
| H-04..H-10, H-12 | sonraki fazlar | — |

---

## 3 · Fazlar

### FAZ A — Kayıt düzeltme ve kilit açma *(kod yok)*

**Giriş şartı:** yok.

| # | İş |
|---|---|
| A1 | Bu belge yazılır |
| A2 | **S-03** — `plan/05 §3`'teki geçersiz risk kabulü düzeltilir; `R-18`'in mitigation'ı güncellenir |
| A3 | **S-04** — `plan/05` `D-17` kapatılır (yürütmeyle karşılandı) |
| A4 | **S-02** — `1D-006` sıra sapması `plan/01`'e not düşülür |
| A5 | **D-02** — `plan/01` `1D-005` kabul kriterleri **HMAC**'e göre yeniden yazılır *(mevcut metin `oauth_states` tablosu istiyor)* |
| A6 | **D-01** — `plan/01` `1D-007` kabul kriterleri N-03 gereği düzeltilir; FAZ F görevleri eklenir |
| A7 | **N-05** — deploy şartı `plan/01 1D-006` ve `todolist.md`'ye yazılır |
| A8 | `todolist.md` FAZ A–G yapısına göre güncellenir |
| A9 | **H-15** — kullanıcı Pro'ya yükseltir → `restore_project` çağrılır |

**TEST A** — hepsi geçmeli:

```bash
python tools/audit/verify_gate_b.py          # FAILURES: NONE
bash supabase/predeploy_guard.sh             # exit 0
cd frontend && npm test && npm run typecheck # 119/119, exit 0
```

Artı: `list_projects` kanonik projeyi `ACTIVE_HEALTHY` gösterir ve salt-okunur
`execute_sql` cevap verir *(A9 tamamlandıysa)*.

**Çıkış şartı:** yukarıdakiler yeşil. A9 beklerse FAZ B yine de başlayabilir —
FAZ B kotadan bağımsızdır.

---

### FAZ B — Canlı DB gerektirmeyen kod

**Giriş şartı:** TEST A geçti. **H-15 gerekmez.**

#### B1 · `1C-003` AC-3 tamamlanması (**S-01**)

**Sorun:** `score()` `state` null ya da bayat iken `100` döndürüyor. Kullanıcı
hiç veri yokken "%100 irade" görüyor — uydurma bir sayı.

**Adımlar:**
1. Önce testi yaz: `willpowerRollover.test.ts`'e `score()` `state` null iken
   `null` döndürmeli assertion'ı ekle. **Başarısız olduğunu gözle.**
2. `score(): number` → `score(): number | null`. Bayat ya da null durumda `null`.
3. Çağıranları bul (`grep -rn "score()" app/ components/`) ve her birinde
   `null` → yükleniyor göstergesi. Uydurma sayı gösterme.
4. `npm run typecheck` — dönüş tipi değişimi çağıranları zorlayacak, bu istenen.

**Not:** `canActivate()` fail-**closed** kalır, `score()` artık fail-**null**.
Mevcut koddaki "fail-open 100" yorumu bu değişiklikle geçersizleşiyor; yorum da
güncellenmeli.

#### B2 · `1D-005` — HMAC imzalı state (**D-02**)

**Sorun:** `state` üretilip döndürülüyor, callback onu **hiç okumuyor**. CSRF
koruması yok.

**Tasarım:**

```
state = base64url(payload) + "." + base64url(HMAC-SHA256(payload, secret))
payload = { v: 1, nonce: <rastgele>, exp: <unix ts>, uid?: <supabase user id> }
```

- `uid` **opsiyonel**: bağlama akışında kimlikli kullanıcıya bağlanır; giriş
  akışında henüz kullanıcı yoktur (N-03).
- Secret: `OAUTH_STATE_SECRET`. **Yoksa fail-closed** — service-role anahtarını
  HMAC anahtarı olarak yeniden kullanma (amaç ayrımı).
- `supabase/functions/_shared/oauthState.ts` — `redirectAllowlist.ts` gibi
  **Deno-bağımsız** yazılır ki jest doğrudan test edebilsin (Web Crypto hem
  Deno'da hem Node 18+'ta var).

**Adımlar:**
1. `__tests__/edge/oauthState.test.ts` yaz — imza doğrulama, süre dolması,
   kurcalanmış payload, yanlış secret, `uid` eşleşmesi. **Başarısız olduğunu gözle.**
2. `_shared/oauthState.ts` — `mintState()`, `verifyState()`.
3. `notion-auth` ve `spotify-auth`: `action=url`'de `mintState`, `action=callback`'te
   `verifyState`. Doğrulanmazsa **400**.
4. İstemci `state`'i geri göndermeli: `notionStore.ts:143` callback gövdesine
   `state` eklenir *(`notionSessionStore.ts:108` zaten gönderiyor)*.

> **Sınır — açıkça yazılacak:** HMAC tek-kullanımlığı TTL'e dayanır, tam replay
> koruması **değildir**. Aynı state süresi dolmadan iki kez kullanılabilir. Tam
> koruma `oauth_states` tablosudur; şema zinciri açıldığında **FAZ D**'de
> yeniden değerlendirilir. Bu sınır kod yorumunda ve commit mesajında yer alır.

#### B3 · **N-02** — istemci CSRF tiyatrosunun kaldırılması

`notionSessionStore.ts:88-97` AsyncStorage karşılaştırmasını siler; state artık
sunucuda doğrulanıyor. İstemci yalnızca `state`'i taşır.

#### B4 · **N-04** — `logHabit` hatalarının gösterilmesi

`today.tsx:154`, `timeline.tsx:84,91`, `recovery.tsx:187,231` dönüş değerini yok
sayıyor. Her biri `LogResult`'ı okur; `ok:false` ise kullanıcıya mesaj gösterir.

**TEST B:**

```bash
cd frontend && npm test && npm run typecheck
```

Geçme ölçütü: hepsi yeşil · `tsc` exit 0 · **her yeni düzeltmenin testi önce
başarısız olduğu gözlendi** (R-01).

---

### FAZ C — Şema temeli

**Giriş şartı:** TEST B geçti **ve** H-15 kapandı (kanonik proje `ACTIVE_HEALTHY`).

`1A-001` → `1A-002A` → `1A-002B` → `1A-003`. `1A-004` **çalıştırılmaz** (H-14).

`1A-001` şu açık soruları da cevaplar:

- `habit_logs`'ta `(habit_id, completed_at)` unique constraint canlıda **var mı**?
  `1B-005`'in `.upsert({onConflict})` kullanamamasının sebebi buydu. Repo
  migration'ı `001_initial_schema.sql:34` `UNIQUE (habit_id, date)` diyor ama
  kolon canlıda `completed_at` olarak yeniden adlandırılmış — **repo bu soruya
  cevap veremiyor**.
- `willpower_state` PK'sı (`date` → `state_date`)
- Dört yeniden adlandırılmış kolon, `status` CHECK çatışması (`001:20` `'idea'`
  değerini reddediyor, istemci yazıyor)

**TEST C:** `supabase db reset` exit 0 · beş rol privilege introspection ·
schema hash canlıyla eşleşiyor.

---

### FAZ D — Migration ve RPC güvenliği

**Giriş şartı:** TEST C geçti (`1A-002B` yeşil).

`1C-001` atomik debit RPC → `1C-002` TOCTOU + refund guard · `1C-004` telafi→log ·
`1C-005` unique constraint · `1C-006` istemci · `1D-008` webhook idempotency ·
`SEC-1D-001..004` · `SEC-1D-005a..f` (`005a` **H-11** bekliyor).

Ek: **B2'nin TTL sınırı** burada yeniden değerlendirilir — `oauth_states`
tablosuna geçilecek mi?

**TEST D:** `supabase test db` yeşil · `AC-S01..S07` beş rol · concurrency testleri.

---

### FAZ E — `generate-routine` zinciri

**Giriş şartı:** TEST D geçti.

`1D-000` → `1D-001` → `1D-002` → `1D-003` → `1D-004`.

> **R-19 kapısı.** `1D-000` **herhangi bir 1D deploy'undan önce** landing
> yapmalı. Commit'li dosya 2 mod destekliyor, uygulama 4 gönderiyor, deploy'da
> **v11** var. Uzlaştırmadan deploy etmek **çalışan iki AI modunu sessizce
> bozar**.

**TEST E:** `AC-S14`/`AC-S15` · N+1 hızlı çağrı 429 · **dört AI modu da çalışıyor**.

---

### FAZ F — Notion kimliği (**D-01**) ve `1D-007`

**Giriş şartı:** TEST D geçti (migration hattı açık).

| # | İş |
|---|---|
| F1 | `notion_identities` migration — Notion kullanıcı id ↔ Supabase user id |
| F2 | `notion-auth`'a `intent` ayrımı: `link` (kimlik ister) / `login` (istemez) |
| F3 | Giriş akışı **gerçek Supabase oturumu** üretir |
| F4 | **N-01** kapanır — `login.tsx` yalnızca gerçek oturum varsa yönlendirir |
| F5 | **`1D-007`** — `link` kimliksizse **401**; `login` Notion'a karşı doğrulanır |

**F3 tasarımı:** Notion `/users/me` yanıtından e-posta alınır. Edge fonksiyon
service-role ile kullanıcıyı bulur ya da oluşturur, `notion_identities`'e bağlar,
sonra `auth.admin.generateLink({ type: 'magiclink' })` ile bir token üretir;
istemci `verifyOtp` ile gerçek oturumu kurar. Supabase'in yerleşik Notion
sağlayıcısı **yoktur**, bu yüzden özel akış gerekir.

> **Planın reçetesi burada değiştiriliyor.** `plan/01:806` "callback geçerli
> kullanıcı olmadan 401 döner" diyor. **N-03** gereği bu her durumda doğru
> değil: `login` intent'inde tanım gereği kullanıcı yoktur. Kriter
> intent-bazlı hale getirilir ve gerekçe `plan/01`'e yazılır.

**TEST F:** `supabase test db` · kimliksiz `link` → 401 · **giriş sonrası
`getUser()` gerçek kullanıcı döndürür** · RLS'li bir okuma başarılı.

---

### FAZ G — Layer 2 ve Gate C

**Giriş şartı:** TEST E ve TEST F geçti.

**N-06** pgTAP clearance kapatılır → `1E-L2` harness → `1E-L2a` (willpower/
recovery concurrency) → `1E-L2b` (güvenlik regresyonu) → **Gate C** raporu →
**DUR** (Phase 2 ayrı onay).

**TEST G:** `npm test` **ve** `supabase test db` ikisi de yeşil · `tsc` temiz ·
lint sınıflandırılmış · bağımsız review · Gate C raporu.

---

## 4 · Doğrulama komutları

| Ne | Komut | Geçme ölçütü |
|---|---|---|
| L1 testler | `cd frontend && npm test` | hepsi yeşil (şu an **119**) |
| Tipler | `cd frontend && npm run typecheck` | exit 0 |
| Gate B yapısı | `python tools/audit/verify_gate_b.py` | `FAILURES: NONE` |
| Deploy guard | `bash supabase/predeploy_guard.sh` | exit 0; yabancı ref'te non-zero |
| UTC nüks çiti | `cd frontend && npm test -- noUtcDayKeys` | 0 ihlal |
| L2 testler *(FAZ C sonrası)* | `supabase test db` | yeşil |
| Canlı durum | `list_projects` | kanonik proje `ACTIVE_HEALTHY` |

---

## 5 · Deploy şartları

Bu rehber **hiçbir şey deploy etmez**. Deploy günü gerekenler:

| Değişken | Neden | Yoksa |
|---|---|---|
| `OAUTH_REDIRECT_ALLOWLIST` | `1D-006` — izinli redirect listesi | OAuth fonksiyonları **fail-closed**, authorize URL üretmeyi reddeder |
| `OAUTH_STATE_SECRET` | `1D-005` — HMAC anahtarı | state üretimi/doğrulaması **fail-closed** |
| `NOTION_CLIENT_ID` / `_SECRET` | mevcut | 500 |
| `SPOTIFY_CLIENT_ID` / `_SECRET` | mevcut | 500 |

Deploy öncesi **her zaman** `bash supabase/predeploy_guard.sh` — yanlış projeye
deploy'u fiziksel olarak engeller.
