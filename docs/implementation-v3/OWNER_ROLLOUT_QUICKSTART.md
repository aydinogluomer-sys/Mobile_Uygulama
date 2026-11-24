# Sahip Canlı Geçiş Hızlı Başlangıç Kılavuzu (`OWNER_ROLLOUT_QUICKSTART`)

> **Tek Doğruluk Kaynağı:** Tüm tam SQL gövdeleri, doğrulama sorguları ve geri alma kuralları [`SQL_FOR_OWNER.md`](./SQL_FOR_OWNER.md) içindedir (burada kopyalanmaz). Bu belge, kanonik proje **`kbcuolhjjnmhjaarxxmu`** üzerinde hatasız canlı geçiş için **6 adımlı kesin uygulama sırasını** özetler.
>
> **Kritik Yasaklar (`supabase/migrations/README.md`):**
> - Kanonik projeye karşı **ASLA `supabase db push`** veya **`supabase config push`** çalıştırmayın (canlı defter zaman damgası, yerel dosyalar `NNN_` sıra numarası kullanır; CLI tüm geçmişi yeniden oynatmaya çalışır).
> - Tüm migration'lar **Supabase Dashboard SQL Editörü** üzerinden sırayla, tek tek **veya** aşağıdaki fail-closed `tools/execute-owner-rollout.mjs` CLI aracıyla (`SUPABASE_ACCESS_TOKEN` ile Management API üzerinden) uygulanır.

---

## Tek Komutluk Otomatik Geçiş Yardımcısı (`tools/execute-owner-rollout.mjs`)

Aşağıdaki manuel Dashboard adımlarının tamamı (ön kontrol, Faz A, Faz B, 4 Edge fonksiyonu, `pg_cron` ve `Y01` canlı kanıt paketi) kanonik proje kilidi ve `xp_drift() = 0` kapılarıyla otomatik olarak da çalıştırılabilir:

```bash
# 0) Çevrimdışı plan doğrulaması (ağ veya token gerektirmez):
node tools/execute-owner-rollout.mjs --mode all --dry-run --confirm-no-legacy-clients

# 1) Canlı geçiş (S1 tam yedek alındıktan sonra, aşama aşama):
SUPABASE_ACCESS_TOKEN=<sbp_token> node tools/execute-owner-rollout.mjs --mode preflight
SUPABASE_ACCESS_TOKEN=<sbp_token> node tools/execute-owner-rollout.mjs --mode phase-a
# Yeni istemci mağazalarda yayına çıktıktan SONRA (Y02):
SUPABASE_ACCESS_TOKEN=<sbp_token> node tools/execute-owner-rollout.mjs --mode phase-b
SUPABASE_ACCESS_TOKEN=<sbp_token> node tools/execute-owner-rollout.mjs --mode edge
SUPABASE_ACCESS_TOKEN=<sbp_token> node tools/execute-owner-rollout.mjs --mode cron
SUPABASE_ACCESS_TOKEN=<sbp_token> node tools/execute-owner-rollout.mjs --mode verify-live --json --out y01-live-evidence.json

# Not: Eski istemci trafiği tamamen bittiyse tüm zincir tek seferde koşulabilir
# (--confirm-no-legacy-clients olmadan 039 güvenliği için reddedilir):
SUPABASE_ACCESS_TOKEN=<sbp_token> node tools/execute-owner-rollout.mjs --mode all --confirm-no-legacy-clients --out y01-rollout-report.json
```

---

## Adım 1 — Çevrimdışı Ön Kontrol (Offline Preflight)

Hiçbir ağ veya canlı veritabanı bağlantısı kurmadan yerel ağacın geçişe hazır olduğunu doğrulayın:

```bash
# 1.1 Migration <-> Rollback 1:1 eşliği (028..045, 18 migration), rollback onay kilidi,
#     predeploy_guard.sh, DEPLOYMENT.json + deno.lock ve 8 featureGate kontrolü (çıkış: 0)
node tools/verify-owner-rollout-readiness.mjs

# İsteğe bağlı makine-okunur JSON çıktısı:
node tools/verify-owner-rollout-readiness.mjs --json

# 1.2 Kanonik proje hedef kilidi doğrulaması (beklenen: "deploy target OK: kbcuolhjjnmhjaarxxmu")
SUPABASE_PROJECT_REF=kbcuolhjjnmhjaarxxmu bash supabase/predeploy_guard.sh
env -u SUPABASE_PROJECT_REF bash supabase/predeploy_guard.sh
```

**Geçiş Koşulu:** Her iki komut da `0` koduyla çıkmalıdır. `1` dönerse raporlanan uyumsuzluk giderilmeden Adım 2'ye geçilmez.

---

## Adım 2 — Tam Yedek ve Salt-Okunur Ön Kontroller (`SQL_FOR_OWNER.md §0` & `§3`)

1. **Tam Yedek (S1):** Supabase Dashboard üzerinden anlık yedek alın veya kanonik projeden tam `pg_dump` çıktısını saklayın.
2. **Salt-Okunur Ön Sorgular:** [`SQL_FOR_OWNER.md`](./SQL_FOR_OWNER.md) **§0 (`0.1`–`0.6`)** ve **§3** sorgularını Dashboard SQL Editöründe çalıştırın:
   - **`0.1` Son migration:** En üst satır `027` (`20260908133800` / `account_deletion_cascade`) olmalı.
   - **`0.3` Saat dilimi sütunu:** `public.habit_logs.tz` henüz mevcut olmamalı (`0` satır).
   - **`0.4` XP defter sağlığı (ZORUNLU KAPI):**
     ```sql
     SELECT count(*) FROM public.xp_drift();
     ```
     Sonuç kesinlikle **`0`** olmalıdır (`0` değilse `038` uygulanmaz; önce `rebuild_profile_xp(uuid)` değerlendirilir).
   - **`0.5`, `0.6` & `0.7`:** `039` öncesi yinelenen mesaj / iade sayımlarını, `042` öncesi `habit_logs` / `habits` üzerinde bağımlı görünüm olmadığını (`0` satır) ve `045` öncesi `tasks.estimated_minutes` / `estimate_source` sütunlarının henüz bulunmadığını (`0` satır) kaydedin.
   - **`§3` & `§10` (`Y01` Canlı Kanıt Paketi):** `040` öncesi onarılacak `profiles.username` sayısını, `archive_f13`'e taşınacak 6 tablonun satır sayılarını, `auth.users` eski test hesaplarını kontrol edin ve `SQL_FOR_OWNER.md §10` (`Y01`) kapsamındaki 6 parçalı salt-okunur canlı şema/defter/RPC/RLS/`xp_drift`/Edge kanıt çıktısını arşivleyin.

---

## Adım 3 — Sıralı Veritabanı Migration Penceresi (`028`..`045` — 18 Migration)

### Kritik İstemci İkilisi (`Eski İstemci` vs `Yeni İstemci`) ↔ Veritabanı Sıralama Matrisi (`Y02`)

| Kural / Matris (`Y02`) | Migration | Zorunlu Zamanlama | `Eski İstemci` × `Yeni İstemci` Uyum Özeti (`SQL_FOR_OWNER.md §11`) |
|---|---|---|---|
| **ÖNCE / BİRLİKTE (Faz A)** | **`042`** (`042_numeric_measures_and_willpower.sql`) | Yeni istemci sürümünden **ÖNCE** (veya aynı pencerede birlikte) | `042` sonrası eski tam sayı yazımları kayıpsız çalışır; yeni istemci ondalık (`1.5`) veri göndermeden önce `numeric(12,2)` ve `spend_willpower` hazır olmalıdır (`042` öncesi ondalık yazım `22P02` alır). |
| **ÖNCE / BİRLİKTE (Faz A)** | **`045`** (`045_task_estimated_minutes.sql`) | Yeni istemci sürümünden **ÖNCE** (veya aynı pencerede birlikte) | `045` sonrası nullable `estimated_minutes` (`1..1440`) ve `estimate_source` eski istemciyi hiç etkilemez (`NULL` kalır); yeni istemci `045` öncesi çalışırsa `42703`/`PGRST204` (`E08` `schema_missing`) ile dar-kolon fallback'ine düşer ama süreyi sunucuda saklayamaz. |
| **SONRA (Faz B)** | **`039`** (`039_focus_point_hardening.sql`) | Yeni istemci sürümü mağazalarda yayına çıktıktan **SONRA** | Eski `spend_focus_points(integer, text)` RPC'sinin istemci `EXECUTE` yetkisini kapatır; `039` sonrası eski istemciler `42501` alır, yeni istemci ise Edge v2 akışıyla tam uyumludur (`SQL_FOR_OWNER.md §5 & §11`). |
| **XP Drift Kapısı** | **`036`, `038`, `040`, `044`, `045`** (ve `041`–`043`) | Her adımdan hemen **SONRA** | `SELECT count(*) FROM public.xp_drift();` **`0`** dönmelidir (`0` değilse bir sonraki adıma geçilmez). |

### Uygulama Dizisi (`SQL_FOR_OWNER.md §1` & Doğrulama `§2.1`–`§2.18`)

1. **Faz A — İstemci Yayını Öncesi Hazırlık ve Şema Genişletme:**
   - Sırayla uygula ve her adımdan sonra karşılık gelen `SQL_FOR_OWNER.md §2` doğrulamasını çalıştır:
     `028` → `029` → `030` → `031` → `032` → `033` → `034` → `035` → `036` *(ardından `xp_drift() = 0`)* → `037` → `038` *(önkoşul: `036` + `xp_drift() = 0`; sonrasında tekrar `xp_drift() = 0`)* → **`042`** *(yeni istemci ikilisinden ÖNCE/birlikte; `§2.15` + `xp_drift() = 0`)* → **`045`** *(görev süre tahmini + `get_today_bootstrap` görev projeksiyonu; `§2.18` + `xp_drift() = 0`)*.
2. **Faz B — Yeni İstemci İkilisi Yayında Olduktan Sonra Sıkılaştırma:**
   - Sırayla uygula:
     **`039`** *(istemci yayını SONRASI)* → **`040`** *(önkoşul: `028–039`; sonrasında `xp_drift() = 0` ve `§2.13` doğrulaması)* → `041` *(`§2.14`)* → `043` *(önkoşul: `038`; `§2.16`)* → **`044`** *(önkoşul: `039` + `040`; sonrasında `xp_drift() = 0` ve `§2.17`)*.
   - *(Not: Yeni istemci ikilisi halihazırda yayındaysa ve eski istemci trafiği sonlandıysa `028` → `045` kesintisiz artan sırayla uygulanabilir; `042` ve `045` her koşulda ondalık/süre yazan istemciden önce devrede olmalıdır.)*
3. **Bitiş RLS Negatif Kontrolü ve `Y01` Kanıt Paketi:** [`SQL_FOR_OWNER.md §6` & `§10`](./SQL_FOR_OWNER.md) (`6.1` tüm 10 yeni tabloda `rowsecurity = true`, `6.2` anon/public politikası `0` satır, `§10` iki hesaplı RLS izolasyonu ve `xp_drift() = 0`).
4. **Kurtarma ve Acil Geri Alma Kararı (`Y06`):** Canlı veri yazıldıktan sonra varsayılan yol **ileri düzeltmedir (`Forward-Fix`, RPO = 0)** (`SQL_FOR_OWNER.md §12`). Geri alma betiği gerekiyorsa yalnızca `supabase/rollbacks/` altından **büyükten küçüğe** (`045 → ... → 028`; `040` mutlaka `039/038/036`'dan önce, `038` mutlaka `036`'dan önce), aynı SQL oturumunda `SET aderyth.rollback_confirm = 'NNN';` komutuyla çalıştırılır (`supabase/rollbacks/README.md`).

---

## Adım 4 — Edge Functions Dağıtımı ve Canlı Eşlik Doğrulaması

[`supabase/functions/DEPLOYMENT.json`](../../supabase/functions/DEPLOYMENT.json) içinde yalnızca `deploy: true` olan **4 fonksiyon** dağıtılır (`google-auth`, `notion-auth`, `spotify-auth` `deploy: false` kararındadır — **deploy edilmez**):

```bash
# 4.1 Deploy öncesi hedef kilidi
SUPABASE_PROJECT_REF=kbcuolhjjnmhjaarxxmu bash supabase/predeploy_guard.sh

# 4.2 Yalnızca deploy: true olan 4 fonksiyonu dağıtın
npx supabase functions deploy generate-routine --project-ref kbcuolhjjnmhjaarxxmu
npx supabase functions deploy delete-account --project-ref kbcuolhjjnmhjaarxxmu
npx supabase functions deploy subscription-webhook --no-verify-jwt --project-ref kbcuolhjjnmhjaarxxmu
npx supabase functions deploy notion-sync --project-ref kbcuolhjjnmhjaarxxmu

# 4.3 CLI yan etkisi kontrolü (supabase/migrations/ dosyalarının yeniden adlandırılmadığını doğrula)
git status --short

# 4.4 Canlı <-> DEPLOYMENT.json eşlik doğrulaması (beklenen çıkış: 0, "Production matches the manifest")
SUPABASE_ACCESS_TOKEN=<token> node tools/verify-edge-deployment.mjs --project-ref kbcuolhjjnmhjaarxxmu
```

---

## Adım 5 — Günlük `pg_cron` AI Saklama Temizliği (`SQL_FOR_OWNER.md §5` / OD-25)

`044_ai_messages_and_retention.sql` uygulandıktan ve Supabase Dashboard → **Database → Extensions** altından `pg_cron` etkinleştirildikten sonra SQL Editöründe bir kez çalıştırın:

```sql
-- Her gece 03:17 UTC'de 30g yanıt metni boşaltma, 400g bitmiş ai_requests ve 7g ai_calls temizliği:
SELECT cron.schedule('purge-ai-retention', '17 3 * * *', $$SELECT public.purge_ai_retention()$$);

-- Doğrulama (beklenen: 1 satır, active = true):
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'purge-ai-retention';
```

---

## Adım 6 — Geçiş Sonrası 2 Satırlık Feature Gate PR'ı (`frontend/lib/featureGates.ts`)

Sunucu önkoşulları doğrulandıktan sonra ayrı, incelemeli **2 satırlık bir PR** ile [`frontend/lib/featureGates.ts`](../../frontend/lib/featureGates.ts) içinde yalnızca aşağıdaki iki bayrağı `true` yapın (`SQL_FOR_OWNER.md §5`):

1. **`LOG_TIMEZONE_ENABLED = true`** — Önkoşul: `033_habit_log_timezone.sql` uygulandı ve `§2.6` doğrulandı.
2. **`COACH_ACTIONS_V2_ENABLED = true`** — Önkoşul: `032` + `034` + `035` uygulandı (`§2.8 has_lighten_week = true`) **ve** Adım 4'te `generate-routine` deploy edilip `verify-edge-deployment.mjs` `0` döndü.

```bash
# PR içinde post-rollout doğrulaması (önkoşul kontrol listesini basar ve çıkış 0 döner):
node tools/verify-owner-rollout-readiness.mjs --post-rollout
```

> **Kapalı Kalacak Bayraklar:** `SPOTIFY_OAUTH_ENABLED`, `NOTION_INTEGRATION_ENABLED`, `GOOGLE_CALENDAR_INTEGRATION_ENABLED`, `PAID_SUBSCRIPTIONS_ENABLED`, `PUBLIC_SITE_URLS_LIVE` (MVP kapsam dışı) ve ayrı sahip kararı gerektiren `LIGHT_THEME_ENABLED` (F25) **`false`** olarak kalır.
