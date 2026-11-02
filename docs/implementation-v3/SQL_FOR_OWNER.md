# SQL — sahibin uygulayacağı / çalıştıracağı her şey

> **Bu dosyadaki hiçbir sorgu ajan tarafından çalıştırılmadı.** Veritabanı donduruldu
> (S1: yedek kontrolü, S2: migration uygulama). Aşağıdaki her migration repoda
> **WRITTEN, NOT APPLIED** durumundadır (`supabase/migrations/README.md`).
> Sıra önemlidir; her adımdan sonra doğrulama sorgusunu çalıştırın, sonra ilgili
> kapıyı (`frontend/lib/featureGates.ts`) çevirin.

## 0. Önce: salt-okunur ön kontroller (yedekten sonra)

```sql
-- 0.1 Uygulanmış son migration (027 olmalı)
select version, name from supabase_migrations.schema_migrations order by version desc limit 5;

-- 0.2 habit_logs'un CANLI şekli (repo'daki 001 ile birebir değil — S12)
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'habit_logs'
order by ordinal_position;

-- 0.3 033 öncesi: tz sütunu zaten var mı? (beklenen: 0 satır)
select 1 from information_schema.columns
where table_schema='public' and table_name='habit_logs' and column_name='tz';
```

## 1. Uygulama sırası

| # | Dosya | Açtığı şey | Sonra çevrilecek kapı | Doğrulama |
|---|---|---|---|---|
| 028 | `028_habit_pauses_and_goal_versions.sql` | tarihli duraklatma/tatil (`habit_pauses`), etkin tarihli hedef sürümleri (`habit_goal_versions`) — R01.05; yedek/geri yükleme bu tabloları kendiliğinden kapsar (R08.01) | yok (istemci fail-open okur; tablo gelince kendiliğinden açılır) | §2.1 |
| 029 | `029_habit_checklists.sql` | alışkanlık checklist'i (`habit_checklist_items`, `habit_checklist_checks`) — R01.04; yedek/geri yükleme kendiliğinden kapsar (R08.01) | yok (fail-open) | §2.2 |
| 030 | `030_routine_runner.sql` | rutin şablon/sürüm/oturum — R05.01/02/07 | yok (cihaz-yerel → sunucu) | §2.3 |
| 031 | `031_moods_and_review_actions.sql` | adlı duygular, çoklu check-in, review sonraki eylemi — R07.02/06 | yok (cihaz-yerel → sunucu) | §2.4 |
| 032 | `032_coach_actions_v2.sql` | koçun ikinci eylem seti için CHECK — R09.02 | `COACH_ACTIONS_V2_ENABLED` **ancak** `generate-routine` edge function deploy edildikten sonra (S3) | §2.5 |
| 033 | `033_habit_log_timezone.sql` | `habit_logs.tz` (log'un yazıldığı IANA bölgesi) — R01.06 | `LOG_TIMEZONE_ENABLED` | §2.6 |
| 034 | `034_coach_reminder_action.sql` | koçun hatırlatma saati eylemi `edit_reminder_time` — R09.02 (CHECK'i 9 türle baştan yazar; 032'den bağımsız doğru) | `COACH_ACTIONS_V2_ENABLED` — 032 + 034 uygulanıp `generate-routine` deploy edildikten SONRA (S3) | §2.7 |
| 035 | `035_coach_lighten_week.sql` | koçun "bu hafta hafiflet" eylemi `lighten_week` — R09.04 (CHECK'i 10 türle baştan yazar; 032/034'ten bağımsız doğru) | `COACH_ACTIONS_V2_ENABLED` — 032 + 034 + 035 uygulanıp `generate-routine` deploy edildikten SONRA (S3) | §2.8 |
| 036 | `036_live_audit_hardening.sql` | **canlı denetimden öneri** (`LIVE_SCHEMA_AUDIT.md`): XP/seri (alışkanlık, gün) defteri — S11 çiftliğini kapatır; `weekly_xp` istemci yazımı kapanır; kullanılmayan/tetikleyici SECURITY DEFINER fonksiyonlarda EXECUTE alınır; grant hijyeni. 028–035'ten bağımsız. **Önce bir branch'te dene.** | yok (R01.03-b geri alma bundan sonra açılabilir) | §2.9 |

## 2. Doğrulama sorguları (her migration'dan sonra, salt-okunur)

```sql
-- 2.1 (028) iki tablo + RLS açık + yalnız sahibine politika
select tablename, rowsecurity from pg_tables
where schemaname='public' and tablename in ('habit_pauses','habit_goal_versions');
select tablename, policyname, cmd from pg_policies
where schemaname='public' and tablename in ('habit_pauses','habit_goal_versions') order by 1,2;

-- 2.2 (029)
select tablename, rowsecurity from pg_tables
where schemaname='public' and tablename in ('habit_checklist_items','habit_checklist_checks');

-- 2.3 (030) — routine_template_versions'ta UPDATE politikası OLMAMALI (değişmez sürüm)
select tablename, policyname, cmd from pg_policies
where schemaname='public' and tablename like 'routine_%' order by 1,2;

-- 2.4 (031)
select tablename, rowsecurity from pg_tables
where schemaname='public' and tablename in ('mood_definitions','mood_checkins','review_next_actions');

-- 2.5 (032) CHECK'in yeni hali
select pg_get_constraintdef(oid) from pg_constraint where conname = 'ai_actions_type_check';

-- 2.6 (033) sütun nullable text + sınır CHECK'i
select column_name, data_type, is_nullable from information_schema.columns
where table_schema='public' and table_name='habit_logs' and column_name='tz';
select pg_get_constraintdef(oid) from pg_constraint where conname = 'habit_logs_tz_check';

-- 2.7 (034) CHECK 9 türü içerir (edit_reminder_time dahil)
select pg_get_constraintdef(oid) from pg_constraint where conname = 'ai_actions_type_check';

-- 2.8 (035) CHECK 10 türü içerir (lighten_week dahil) -- aynı sorgu; 035 sonrası sonuç bunu göstermeli
select pg_get_constraintdef(oid) like '%lighten_week%' as has_lighten_week
from pg_constraint where conname = 'ai_actions_type_check';

-- 2.9 (036) defter dolu, istemciler yazamıyor, fonksiyonlar kapalı
select count(*) as ledger_rows, (select count(*) from public.habit_logs) as logs from public.habit_xp_awards; -- eşit olmalı
select has_table_privilege('authenticated', 'public.weekly_xp', 'INSERT') as weekly_xp_insert;              -- false
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');            -- 0 satır
select proname, has_function_privilege('authenticated', oid, 'execute') as auth
from pg_proc where proname in ('get_user_rank','get_weekly_leaderboard','get_global_leaderboard','get_or_init_subscription'); -- hepsi true
```

## 3. BLOCKED — tanımı repoda olmayan nesneler (yalnız okuma sorguları)

Bu nesnelere dokunan SQL **yazılmadı**; gerçek tanımlar gelmeden yazılırsa körlemesine
olur. Önce aşağıdakileri çalıştırıp çıktıyı paylaşın.

```sql
-- S11 (R01.03-b log geri alma): silmede XP geri alınıyor mu?
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('fn_habit_log_award', 'fn_habit_log_set_xp', 'add_xp');

select tgname, pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where c.relname = 'habit_logs' and not t.tgisinternal;
```

## 4. KD-10 / KD-11 — salt-okunur sayımlar (S4; backfill ayrı karar)

```sql
-- KD-10: hedefsiz alışkanlık satırları (hiçbir gün due değil)
select count(*) as kd10_targetless
from public.habits
where (frequency_config->>'kind' = 'monthly'
        and frequency_config->'count' is null and frequency_config->'month_days' is null)
   or (frequency_config->>'kind' = 'weekly'
        and frequency_config->'count' is null
        and coalesce(jsonb_array_length(frequency_config->'days'), 0) = 0);

-- KD-10 ek: boş part_of_day
select count(*) as kd10_empty_part_of_day
from public.habits where frequency_config->'part_of_day' = '[]'::jsonb;

-- KD-11: ölçülebilir + done ama value < daily_goal (at_least) — günün toplamı yerine son giriş yazılmış olabilir
select count(*) as kd11_suspect
from public.habit_logs l join public.habits h on h.id = l.habit_id
where h.tracking_type in ('numeric','duration')
  and coalesce(h.target_direction,'at_least') = 'at_least'
  and l.state = 'done' and l.value is not null and h.daily_goal is not null
  and l.value < h.daily_goal;
```

## 5. Uygulama sonrası: hangi kapı, hangi sırayla

| Adım | Ön koşul | Çevrilecek kapı (`frontend/lib/featureGates.ts`) |
|---|---|---|
| 1 | 028, 029, 030, 031 uygulandı + §2.1–2.4 doğrulandı | yok — istemci tabloları fail-open okur (PGRST205/42P01), tablo gelince kendiliğinden açılır |
| 2 | 033 uygulandı + §2.6 | `LOG_TIMEZONE_ENABLED = true` |
| 3 | 032 → 034 → 035 uygulandı + §2.8 `has_lighten_week = true` **ve** `generate-routine` edge function deploy edildi (S3) | `COACH_ACTIONS_V2_ENABLED = true` |

Mevcut beş kapı (`SPOTIFY_OAUTH_ENABLED`, `NOTION_INTEGRATION_ENABLED`, `GOOGLE_CALENDAR_INTEGRATION_ENABLED`,
`PAID_SUBSCRIPTIONS_ENABLED`, `PUBLIC_SITE_URLS_LIVE`) bu migration'larla **ilgisizdir** ve kapalı kalır.

## 6. RLS — uygulamadan sonra salt-okunur negatif kontrol (R10.07)

```sql
-- 6.1 yeni tabloların hepsinde RLS açık (beklenen: rowsecurity = true, 10 satır)
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in (
  'habit_pauses','habit_goal_versions','habit_checklist_items','habit_checklist_checks',
  'routine_templates','routine_template_versions','routine_sessions',
  'mood_definitions','mood_checkins','review_next_actions');

-- 6.2 hiçbir politika anon/public'e açık değil (beklenen: 0 satır)
select tablename, policyname, roles from pg_policies
where schemaname = 'public' and tablename in (
  'habit_pauses','habit_goal_versions','habit_checklist_items','habit_checklist_checks',
  'routine_templates','routine_template_versions','routine_sessions',
  'mood_definitions','mood_checkins','review_next_actions')
  and not (roles = '{authenticated}');
```

**Kabul edilen risk (S12):** `review_next_actions.task_id` yabancı anahtarsızdır, çünkü `tasks`
tablosunun tanımı bu repoda yok; tanımı görülmeden ona dokunan SQL yazılmadı. Başka bir
kullanıcının görev kimliği yazılabilir, ama `tasks` RLS'i nedeniyle hiçbir şeye çözülmez. Yedekten
gerçek `tasks` tanımı gelince bir FK + sahiplik kontrolü ayrı migration'la eklenebilir.

## 7. Canlı denetim sonuçları (2026-10-09, salt-okunur — `LIVE_SCHEMA_AUDIT.md`)

- **§3 S11 cevaplandı:** `habit_logs`'ta yalnız INSERT/UPDATE tetikleyicileri var; silmede XP geri alınmıyor ve
  yeniden yazımda tekrar veriliyor. Düzeltme 036-A.
- **§4 KD-10/KD-11:** `kd10_targetless = 0`, `kd10_empty_part_of_day = 0`, `kd11_suspect = 0` → backfill gerekmiyor.
- Canlıda son migration `account_deletion_cascade` (027 karşılığı); §0.1 beklentisi doğru.

## 8. CI davranış testleri (sahip eylemi gerektirmez)

F01 ile `db-migrations-verify` işi (Postgres 17, `ci.yml`) son adım olarak `bash supabase/tests/run.sh`
koşar. Bu bölüm yalnız o testleri anlatır; **burada çalıştırılacak bir sorgu yoktur ve canlıya hiçbir
şey yazılmaz.** Testler geçici Postgres'te `live_schema.sql` + 028–037 üzerinde koşar (bugünkü canlı
değil: canlıda 028–037 uygulanmamıştır). Canlıdaki açıklar (örneğin `weekly_xp`, TST-V01) 036 sizin
tarafınızdan uygulanana kadar canlıda açık kalır; test CI'da 036 uygulanmış halin kapalı olduğunu kanıtlar,
canlıyı denetlemez. Canlı doğrulama §2'dir.

| Dosya | Ne denetler | Bugünkü beklenti |
|---|---|---|
| `01_client_cannot_write_server_tables.sql` | `authenticated` / `anon` rolü `weekly_xp`, `profiles.total_xp·level·coins`, `user_subscriptions`, `credit_transactions` tablolarına yazamaz (SQLSTATE 42501); sahibin kendi `user_subscriptions` satırını silememesi ile `credit_transactions` ve `ai_requests` satırlarını değiştirememesi (tablo yetkisi açıktır, satırı RLS korur: hiçbir satır değişmez); bu "satır değişmedi" denemelerinin boş geçmediğini gösteren pozitif kontroller | 22 sonuç, hepsi PASS |
| `02_security_definer_hygiene.sql` | anon'un `public` SECURITY DEFINER fonksiyonunda EXECUTE hakkı yok (`T02a`); hepsinde `search_path` sabit (`T02b`); yalnız-servis fonksiyonlar istemciye kapalı (`T02c`–`T02e`) | `T02a` PASS; `T02b` 20 FAIL (listede) |
| `03_xp_drift_zero.sql` | gerçek `habit_logs` yazma / güncelleme / silme sonrası `xp_drift()` boş (tetikleyici zinciri olduğu gibi) | 4 PASS |
| `04_today_bootstrap_isolation.sql` | `get_today_bootstrap` iki kullanıcı izolasyonu, doğrudan tablo izolasyonu, JWT'siz çağrının fonksiyonun KENDİ `authentication required` hatasıyla reddi (bekçi satırı kalkarsa başka bir 42501 gelir ve test kırmızı olur), anon çağrı reddi | 6 PASS |
| `05_concurrency_spend.sh` | 8 eşzamanlı oturumla `spend_focus_points_v2` (tek kazanan, bakiye eksiye düşmez, aynı `request_id` tek borç) ve `ai_request_begin` (tek `claimed`) yarışı | 5 PASS + 1 INFO |

**`supabase/tests/expected_failures.txt` ne demek.** Bilinen açıkların test adı listesidir; her satır bulgu
kimliğini taşır ve başlıkta kapatan faz yazar. Koşucu iki yönlü karşılaştırır: listede olmayan bir test kırmızıysa
`UNEXPECTED FAILURES`, listede olup yeşile dönmüş bir satır kalmışsa `STALE` ile CI kırmızı olur. Yani liste yalnız
küçülebilir; bir açığı kapatan migration aynı commit'te kendi satırlarını siler. Bugün listede 20 satır vardır
(`T02b_search_path.*`: `search_path` sabitlenmemiş 20 SECURITY DEFINER fonksiyon); hepsini F09 kapatır. Sizin
canlıya uyguladığınız bir migration bu listeyi değiştirmez: liste canlıyı değil CI'daki şemayı anlatır.

**Yerel koşum (yalnız geçici veritabanı).** Koşucu `PGHOST` yerel değilse (`127.0.0.1`, `localhost`, `::1`),
`PGHOSTADDR` yerel değilse ya da `PGSERVICE` tanımlıysa hiçbir şey yazmadan `REFUSED` ile 2 koduyla çıkar. Yerel bir
adres tek başına güvence değildir (bir SSH ya da havuz tüneli canlı bir veritabanına çıkabilir), bu yüzden koşucu ikinci
bir salt-okunur katalog denetimi daha yapar: hedef CI'daki geçici veritabanına benzemiyorsa (GoTrue'nun `auth.users`
tablosunda olan `encrypted_password` sütunu varsa ya da bağlanan kullanıcı superuser değilse) yine `REFUSED` ile çıkar ve
hiçbir şey yazmaz. Bu bir güvence katmanıdır, mutlak değildir: testler şema ve satır oluşturur, bu yüzden hedef her
zaman tek kullanımlık, CI'daki gibi hazırlanmış bir veritabanı olmalıdır. **`supabase test db` komutunu (özellikle
`--linked` ile) bu dizine yöneltmeyin:** Supabase CLI'nin pgTAP koşucusu testleri geleneksel olarak `supabase/tests/`
altında arar; buradaki dosyalar pgTAP değildir ve `01` ile `05` kalıcı satır yazar. Bunlar yalnız `bash supabase/tests/run.sh`
ile koşar.

```bash
docker run --rm -d --name aderyth-pg17 -e POSTGRES_PASSWORD=ci_ephemeral_pg_password -e POSTGRES_DB=aderyth_ci -p 127.0.0.1:55432:5432 postgres:17
export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGPASSWORD=ci_ephemeral_pg_password PGDATABASE=aderyth_ci
# ci.yml db-migrations-verify adımlarını aynı sırayla uygula: bootstrap, live_schema.sql, 037 ön kontrolü, 028+ döngüsü; sonra:
bash supabase/tests/run.sh; echo exit=$?
docker rm -f aderyth-pg17
```

Çıkış kodları: `0` başarılı; `1` beklenmeyen kırmızı ya da bayat liste satırı; `2` `REFUSED` (yerel olmayan ya da
CI'daki geçici veritabanına benzemeyen hedef); `3` bir test dosyası fixture / tetikleyici / sözdizimi hatasıyla düştü ya da
veritabanına ulaşılamadı (bulgudur, fixture gevşetilmez); `4` sonuç akışı kullanılamaz (30'dan az, ayrıştırılamayan,
tekrarlanan ya da hiç rapor vermeyen test ya da `T02a` / `T02b` sonuç ailesi).
