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

-- 0.4 038 öncesi (036'dan SONRA): XP defteri sağlıklı mı? (0 satır beklenir)
-- 0 satır değilse 038 uygulanmaz. 036 tek başına silinmiş bir günün XP'sini purged_xp'ye taşımaz (DB2-07);
-- önce rebuild_profile_xp(uuid) ile onarım gerekir ve bu ayrı bir sahip kararıdır.
select * from public.xp_drift();

-- 0.5 039 öncesi (F07)
-- (a) silinecek yinelenen kullanıcı mesajı sayısı
SELECT coalesce(sum(n - 1), 0) AS fazla_satir
FROM (SELECT count(*) AS n FROM public.ai_messages
      WHERE role = 'user' AND request_id IS NOT NULL
      GROUP BY conversation_id, request_id HAVING count(*) > 1) d;

-- (b) iade edilecek kullanıcı ve FP
SELECT count(*) AS istek, coalesce(sum(-t.delta), 0) AS fp
FROM public.ai_requests a
JOIN public.credit_transactions t
  ON t.user_id = a.user_id AND t.request_id = a.request_id AND t.delta < 0 AND t.created_at >= a.created_at
WHERE a.status = 'failed'
  AND NOT EXISTS (SELECT 1 FROM public.credit_transactions t2
                  WHERE t2.user_id = a.user_id AND t2.request_id = a.request_id || ':refund');

-- 0.6 042 öncesi (F14): habit_logs veya habits tablolarına bağımlı görünüm var mı? (beklenen: 0 satır)
select distinct c.relname as dependent_relation, c.relkind
  from pg_depend d
  join pg_rewrite r on r.oid = d.objid
  join pg_class c on c.oid = r.ev_class
 where d.refobjid in ('public.habit_logs'::regclass, 'public.habits'::regclass)
   and c.relname not in ('habit_logs', 'habits');
```

## 1. Uygulama sırası

| # | Dosya | Açtığı şey | Sonra çevrilecek kapı | Doğrulama | Geri alma |
|---|---|---|---|---|---|
| 028 | `028_habit_pauses_and_goal_versions.sql` | tarihli duraklatma/tatil (`habit_pauses`), etkin tarihli hedef sürümleri (`habit_goal_versions`) — R01.05; yedek/geri yükleme bu tabloları kendiliğinden kapsar (R08.01) | yok (istemci fail-open okur; tablo gelince kendiliğinden açılır) | §2.1 | `supabase/rollbacks/028_habit_pauses_and_goal_versions.rollback.sql` |
| 029 | `029_habit_checklists.sql` | alışkanlık checklist'i (`habit_checklist_items`, `habit_checklist_checks`) — R01.04; yedek/geri yükleme kendiliğinden kapsar (R08.01) | yok (fail-open) | §2.2 | `supabase/rollbacks/029_habit_checklists.rollback.sql` |
| 030 | `030_routine_runner.sql` | rutin şablon/sürüm/oturum — R05.01/02/07 | yok (cihaz-yerel → sunucu) | §2.3 | `supabase/rollbacks/030_routine_runner.rollback.sql` |
| 031 | `031_moods_and_review_actions.sql` | adlı duygular, çoklu check-in, review sonraki eylemi — R07.02/06 | yok (cihaz-yerel → sunucu) | §2.4 | `supabase/rollbacks/031_moods_and_review_actions.rollback.sql` |
| 032 | `032_coach_actions_v2.sql` | koçun ikinci eylem seti için CHECK — R09.02 | `COACH_ACTIONS_V2_ENABLED` **ancak** `generate-routine` edge function deploy edildikten sonra (S3) | §2.5 | `supabase/rollbacks/032_coach_actions_v2.rollback.sql` |
| 033 | `033_habit_log_timezone.sql` | `habit_logs.tz` (log'un yazıldığı IANA bölgesi) — R01.06 | `LOG_TIMEZONE_ENABLED` | §2.6 | `supabase/rollbacks/033_habit_log_timezone.rollback.sql` |
| 034 | `034_coach_reminder_action.sql` | koçun hatırlatma saati eylemi `edit_reminder_time` — R09.02 (CHECK'i 9 türle baştan yazar; 032'den bağımsız doğru) | `COACH_ACTIONS_V2_ENABLED` — 032 + 034 uygulanıp `generate-routine` deploy edildikten SONRA (S3) | §2.7 | `supabase/rollbacks/034_coach_reminder_action.rollback.sql` |
| 035 | `035_coach_lighten_week.sql` | koçun "bu hafta hafiflet" eylemi `lighten_week` — R09.04 (CHECK'i 10 türle baştan yazar; 032/034'ten bağımsız doğru) | `COACH_ACTIONS_V2_ENABLED` — 032 + 034 + 035 uygulanıp `generate-routine` deploy edildikten SONRA (S3) | §2.8 | `supabase/rollbacks/035_coach_lighten_week.rollback.sql` |
| 036 | `036_live_audit_hardening.sql` | **canlı denetimden öneri** (`LIVE_SCHEMA_AUDIT.md`): XP/seri (alışkanlık, gün) defteri — S11 çiftliğini kapatır; `weekly_xp` istemci yazımı kapanır; kullanılmayan/tetikleyici SECURITY DEFINER fonksiyonlarda EXECUTE alınır; grant hijyeni. 028–035'ten bağımsız. **Önce bir branch'te dene.** | yok (R01.03-b geri alma bundan sonra açılabilir); **038 ile birlikte** uygulanır: 036 tek başına silinen bir logun XP'sini `purged_xp`'ye taşımaz (DB2-06/07) | §2.9 | `supabase/rollbacks/036_live_audit_hardening.rollback.sql` — önce 038 geri alınır (varsa); **geri alma açıkları yeniden açar** (weekly_xp yazımı, istemci EXECUTE hakları), yalnız 036 branch denemesinde sorun çıkarsa kullanılır ve ardından F03 (038) uygulanamaz |
| 037 | `037_today_bootstrap_rpc.sql` | tek gidiş-dönüşlü Bugün önyüklemesi `get_today_bootstrap(date)` (çağıranın kendi RLS bağlamında, SECURITY INVOKER; 028/029 tabloları yoksa `to_regclass` ile atlar) | yok (istemci RPC yoksa tablo okumalarına düşer: `todayBootstrapRepository.ts`, `isMissingRpcError`) | `ci.yml` bootstrap adımı (`get_today_bootstrap`) | `supabase/rollbacks/037_today_bootstrap_rpc.rollback.sql` |
| 038 | `038_xp_streak_integrity.sql` | XP/seri bütünlüğü (F03): gün penceresi (sunucu `CURRENT_DATE - 15`..`+ 1`, istemci bugün ve önceki 14 gün), XP'yi yalnız sunucu hesaplar, günlük XP tavanı (2000), defter alışkanlığı silinse de kalır (sil-yeniden-yaz ve aynı adla yeniden oluşturma ikinci kez ödenmez), seri defterdeki ardışık günlerden, `streak_current`/`streak_best` istemciden yazılamaz, log silinince XP `purged_xp`'ye geçer, boss tetikleyicisi kapanır. **036 önkoşul** (betik kendisi denetler). Sıra 036 → 037 → 038; §0.4 `xp_drift()` boş değilse uygulanmaz. Pencere/tavan/çarpan değerleri OD-04 önerisidir. | yok | §2.11 | `supabase/rollbacks/038_xp_streak_integrity.rollback.sql` — 036'nınkinden ÖNCE; **XP sahteciliğini yeniden açar** (pencere, tavan, seri sütunları) |
| 039 | `039_focus_point_hardening.sql` | Focus Point kredi bütünlüğü (F07): aynı (konuşma, `request_id`) için tek kullanıcı mesajı (`ai_messages_user_request_uniq`, önce yinelenen kopyalar silinir), iadesi yazılmamış başarısız AI isteklerine `refund_focus_points` ile tek seferlik iade, eski `spend_focus_points(integer, text)` istemcilere kapanır (036 ile aynı). İstemci sürümünden SONRA (§5). | yok | §2.12 | `supabase/rollbacks/039_focus_point_hardening.rollback.sql` |
| 040 | `040_privilege_hygiene.sql` | Ayrıcalık, `search_path` ve hassas sütun hijyeni + F07-R3 (F09): 20 SECURITY DEFINER fonksiyonda `search_path` sabitlenir, anon yazma/`MAINTAIN` ve küresel `PUBLIC EXECUTE` kapanır, liderlik ve sıra RPC'leri oturum zorunlu ve 1..100 sınırlı olur, `profiles` kullanıcı adı şekil kısıtı (`NOT VALID`, bozuk adlar `archive_040` yedeğiyle onarılır), 028–031'in 10 tablosuna dar yetki, OAuth belirteç tablolarında istemci gizli sütun erişimi kapanır, `add_xp` ve abonelik yenilemesi satır kilidi alır, `ai_request_reconcile_stale` mod duyarlı ileti yazar, iptal edilen F13 tablolarında yazma kapanır ve 6 tablo `archive_f13` şemasına taşınır. Uygulamadan önce §3'teki üç ön sorguyu çalıştırın; 028–039 (özellikle 036, 038, 039) uygulanmış olmalı; sonra `select * from public.xp_drift();` 0 satır. | yok (Notion yeniden açılmadan önce `notion-sync` F45'te service-role'e taşınmalı) | §2.13 | `supabase/rollbacks/040_privilege_hygiene.rollback.sql` — en başta (039/038/036'dan önce) geri alınır; **güvenlik açıklarını yeniden açar** |
| 041 | `041_rls_initplan_and_indexes.sql` | RLS performansı: 45 politika `(SELECT auth.uid())` biçimine geçer, 6 kopya politika düşer, `tasks` alt görev FK'si ON DELETE CASCADE olur, 26 yabancı anahtar indeksi eklenir, yinelenen `idx_habit_logs_habit_date` düşer; veri ve yetki değişmez | yok | §2.14 | `supabase/rollbacks/041_rls_initplan_and_indexes.rollback.sql` |
| 042 | `042_numeric_measures_and_willpower.sql` | Ölçülebilir ondalık değerler ve atomik irade bütçesi (F14): `habit_logs.value` ve `habits.daily_goal` `numeric(12,2)` olur, `habit_xp_value(uuid, text, numeric)` istemciye kapalı (`SECURITY INVOKER`) kurulur, `spend_willpower(date, numeric, integer, boolean)` atomik harcama/iade RPC'si eklenir | yok — **ondalık kabul eden istemci sürümünden ÖNCE uygulanır** (§5) | §2.15 | `supabase/rollbacks/042_numeric_measures_and_willpower.rollback.sql` — kayıplı (kesirler tam sayıya yuvarlanır; önce yedek) |
| 043 | `043_profile_time_zone.sql` | Kullanıcı saat dilimi ve yerel gün/hafta sınırları (F15, DB2-11): `profiles.time_zone` (1..64 IANA), `set_profile_time_zone(text)` (`pg_timezone_names` doğrulamalı RPC), `local_date_in_zone` ve `week_start_in_zone` (geçersiz/boş -> UTC), `fn_habit_log_guard` yerel gün penceresi, `track_weekly_xp` ve `get_weekly_leaderboard` yerel hafta sınırı. **038 önkoşul.** | yok (istemci RPC yoksa sessizce atlar, uygulanınca kendiliğinden çalışır; `LOG_TIMEZONE_ENABLED` 033'e bağlıdır ve ayrıdır) | §2.16 | `supabase/rollbacks/043_profile_time_zone.rollback.sql` — kayıtlı saat dilimleri düşer (uygulama bir sonraki açılışta yeniden bildirir) |

### Geri alma nasıl çalıştırılır

Her migration'ın geri alma betiği `supabase/rollbacks/` altındadır (ayrıntı: `supabase/rollbacks/README.md`). Betikler CI'da
tek kullanımlık Postgres 17'de sınanır: ileri uygula, sondan başa geri al, katalog parmak izini baştakiyle karşılaştır,
yeniden ileri uygula. **Canlıda hiçbiri çalıştırılmadı; yalnız sahip çalıştırır (OD-02).**

1. Önce yedek (S1), sonra `select * from public.xp_drift();` (0 satır beklenir).
2. Sıra **büyükten küçüğe**: 043 (F15), 042 (F14), 041 (F10), 040 (F09), 039 (F07), 038 (F03), 037, 036, 035, 034, 033, 032, 031, 030, 029, 028. 043 en başta, ardından 042, 041 ve 040,
   036'dan önce de 038 geri alınır (036 betiği, `fn_habit_log_guard` varken reddeder).
3. Her betik için **aynı oturumda** önce onay, sonra dosya. Onay değeri betiğin kendi numarası değilse betik `P0001` ile durur
   ve hiçbir şey değiştirmez:

```sql
-- SQL editöründe: SET satırı ve betiğin tamamı AYNI çalıştırmada (tek "Run")
SET aderyth.rollback_confirm = 'NNN';
-- ardından supabase/rollbacks/NNN_<ad>.rollback.sql dosyasının tamamı
```

   `psql` ile: `psql <bağlantı> -X -v ON_ERROR_STOP=1 -c "SET aderyth.rollback_confirm = 'NNN'" -f supabase/rollbacks/NNN_<ad>.rollback.sql`.
4. Her geri almadan sonra `select * from public.xp_drift();` (0 satır) ve §2.10 sorguları.
5. Yıkıcı betikler yedek ister: 028, 029, 030, 031 ve 033 satır/sütun siler; yeniden ileri uygulama o veriyi geri getirmez.
   032/034/035 satır silmez (yeni türde satır varsa kısıt `NOT VALID` kalır). 036 `weekly_xp` yazımını ve istemci
   EXECUTE haklarını yeniden açar; yalnız 036 branch denemesinde sorun çıkarsa kullanılır. 038 gün penceresini, günlük
   tavanı ve seri sütunu korumasını yeniden açar; defteri `habit_logs`'un taşıdığı değere indirir (038 döneminde silinen
   günün XP'si zaten `purged_xp`'dedir; indirilmese 036 geri alması onu ikinci kez taşırdı). 038'in ikinci çalıştırması
   `038 is not applied` ile reddeder.
6. Bir hata alırsanız hiçbir değişiklik uygulanmamıştır (tek transaction); oturumda açık kalmış transaction varsa `ROLLBACK;`.

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

-- 2.10 geri alma öncesi/sonrası: XP defteri sağlıklı mı (0 satır beklenir)
select * from public.xp_drift();
-- hangi migration'ların etkisi var (rollback'ten sonra ilgili satırlar yok olmalı)
select to_regclass('public.habit_pauses') as m028, to_regclass('public.habit_checklist_items') as m029,
       to_regclass('public.routine_templates') as m030, to_regclass('public.mood_checkins') as m031,
       to_regclass('public.habit_xp_awards') as m036, to_regprocedure('public.get_today_bootstrap(date)') as m037;
select exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='habit_logs' and column_name='tz') as m033;
select pg_get_constraintdef(oid) from pg_constraint where conname = 'ai_actions_type_check';
select to_regprocedure('public.fn_habit_log_guard()') as m038;

-- 2.11 (038) ÖNCE: sağlıklı başlangıç (0 satır beklenir; §0.4 ile aynı)
select * from public.xp_drift();
-- 2.11 (038) SONRA: tetikleyiciler (ilk üçü var, boss tetikleyicisi yok)
select tgname from pg_trigger
where tgname in ('trg_habit_log_00_guard','trg_habit_log_purge_on_delete','trg_habits_protect_streak','on_habit_completed_damage_boss')
  and not tgisinternal;
-- defter: öksüz olmayan satırların hepsinde parmak izi dolu (0 beklenir)
select count(*) from public.habit_xp_awards a
where a.habit_fp is null and exists (select 1 from public.habits h where h.id = a.habit_id);
-- hiçbir istemci rolü yeni fonksiyonları çağıramaz (hepsi false)
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth
from pg_proc p where p.proname in ('fn_habit_log_guard','fn_habit_log_set_xp','fn_habit_log_award','fn_habit_log_purge_on_delete','fn_habits_protect_streak');
-- weekly_xp makullük kısıtı var (NOT VALID: yalnız yeni yazımları denetler)
select conname, convalidated from pg_constraint where conname = 'weekly_xp_xp_earned_sane';
-- drift yine boş
select * from public.xp_drift();

-- 2.12 (039) sonrası doğrulama
SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ai_messages_user_request_uniq';  -- 1 satır
SELECT count(*) FROM (SELECT 1 FROM public.ai_messages WHERE role = 'user' AND request_id IS NOT NULL
                      GROUP BY conversation_id, request_id HAVING count(*) > 1) d;                            -- 0
SELECT has_function_privilege('anon', 'public.spend_focus_points(integer, text)', 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', 'public.spend_focus_points(integer, text)', 'EXECUTE') AS auth_exec;  -- f, f
SELECT * FROM public.xp_drift();                                                                               -- 0 satır

-- 2.13 (040) sonrası doğrulama + kullanıcı adı kısıtını geçerli işaretleme
SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%')); -- 0 satır
SELECT conname, convalidated FROM pg_constraint WHERE conname = 'profiles_username_shape';                     -- 1 satır
-- §3 ön sorgusu incelendikten sonra sahip tarafından çalıştırılır:
-- ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_username_shape;
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'archive_f13';                             -- 6
SELECT * FROM public.xp_drift();                                                                               -- 0 satır

-- 2.14 (041) çıplak auth.uid()/auth.role() çağrısı kalan politika (beklenen: 0 satır)
select schemaname, tablename, policyname
from pg_policies
where schemaname in ('public', 'archive_f13')
  and regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
        '\(\s*SELECT\s+auth\.(uid|role)\(\)\s+AS\s+(uid|role)\s*\)', '', 'gi') ~* 'auth\.(uid|role)\(\)';

-- 2.14-b kopya politika kalmadı (beklenen: tasks 1, challenges 1, habit_templates 1)
select tablename, count(*) as politika
from pg_policies
where schemaname = 'public' and tablename in ('tasks', 'challenges', 'habit_templates')
group by 1 order by 1;

-- 2.14-c weekly_xp'te istemci yazma politikası yok (beklenen: 0 satır)
select policyname from pg_policies
where schemaname = 'public' and tablename = 'weekly_xp' and policyname = 'System can manage weekly xp';

-- 2.14-d alt görev kuralı (beklenen: confdeltype = 'c')
select conname, confdeltype from pg_constraint where conname = 'tasks_parent_task_id_fkey';

-- 2.14-e yinelenen indeks yok (beklenen: 0 satır) ve 26 yeni indeksten canlıda var olanlar
select indexname from pg_indexes where schemaname = 'public' and indexname = 'idx_habit_logs_habit_date';
select count(*) as yeni_indeks from pg_indexes where schemaname = 'public' and indexname in (
  'ai_conversation_actions_conversation_idx', 'ai_conversation_actions_assistant_message_idx',
  'ai_conversations_project_idx', 'deep_work_sessions_user_idx', 'focus_sessions_task_idx',
  'focus_tasks_user_idx', 'goals_user_idx', 'habit_deletions_user_idx', 'habit_reminders_habit_idx',
  'habits_cue_habit_idx', 'key_results_user_idx', 'okrs_user_idx', 'projects_user_idx',
  'recovery_plans_source_log_idx', 'routine_items_routine_idx', 'routines_user_idx',
  'tasks_parent_task_idx', 'tasks_project_idx');   -- beklenen: 18; 028-037 uygulandıysa ayrıca 8 indeks

-- 2.14-f xp_drift hâlâ boş (beklenen: 0 satır)
select * from public.xp_drift();

-- 2.15 (042) sütun tipleri numeric(12,2), iki fonksiyon SECURITY INVOKER, ACL ve xp_drift kontrolü
select table_name, column_name, data_type, numeric_precision, numeric_scale
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'habit_logs' and column_name = 'value') or (table_name = 'habits' and column_name = 'daily_goal'));
select p.oid::regprocedure as signature, p.prosecdef as security_definer
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname in ('habit_xp_value', 'spend_willpower')
 order by 1;
select has_function_privilege('authenticated', 'public.spend_willpower(date, numeric, integer, boolean)', 'execute') as authenticated_can_spend,
       has_function_privilege('anon', 'public.spend_willpower(date, numeric, integer, boolean)', 'execute') as anon_can_spend,
       has_function_privilege('authenticated', 'public.habit_xp_value(uuid, text, numeric)', 'execute') as authenticated_can_score;
select * from public.xp_drift();

-- 2.16 (043) profiles.time_zone, set_profile_time_zone, yerel gün/hafta yardımcıları, ACL ve xp_drift kontrolü
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles' and column_name = 'time_zone';
select count(*) filter (where time_zone is null) as without_zone,
       count(*) filter (where time_zone is not null) as with_zone
  from public.profiles;
select p.oid::regprocedure as signature, p.prosecdef as security_definer
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('set_profile_time_zone', 'local_date_in_zone', 'week_start_in_zone', 'track_weekly_xp', 'get_weekly_leaderboard', 'fn_habit_log_guard')
 order by 1;
select has_function_privilege('anon', 'public.set_profile_time_zone(text)', 'execute') as anon_can_set,
       has_function_privilege('authenticated', 'public.set_profile_time_zone(text)', 'execute') as authenticated_can_set;
select name from pg_timezone_names where name in ('Europe/Istanbul', 'America/New_York', 'Pacific/Auckland', 'UTC') order by 1;
select * from public.xp_drift();
```

## 3. BLOCKED / ÖN SORGU — tanımı repoda olmayan ya da 040 öncesi denetlenecek nesneler (yalnız okuma sorguları)

Bu nesnelere dokunan körlemesine SQL **yazılmadı**; gerçek tanımlar/sayımlar görülmeden uygulama yapılmaz. Önce aşağıdakileri çalıştırıp çıktıyı kontrol edin.

```sql
-- S11 (R01.03-b log geri alma): silmede XP geri alınıyor mu?
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('fn_habit_log_award', 'fn_habit_log_set_xp', 'add_xp');

select tgname, pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where c.relname = 'habit_logs' and not t.tgisinternal;

-- DB1-13: auth.users üzerindeki profil tetikleyicisi canlıda var mı? (salt okunur)
select t.tgname, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;

-- DB1-11: 040'ın onaracağı kullanıcı adları (salt okunur; sayı ve uzunluklar)
select count(*) filter (where username is not null) as with_name,
       count(*) filter (where username <> btrim(username)
                           or char_length(username) not between 3 and 32
                           or username ~ '[[:cntrl:]<>]') as will_be_repaired
from public.profiles;

-- DB2-12: 040'ın archive_f13 şemasına taşıyacağı tabloların satır sayısı (salt okunur)
select 'user_pets' as t, count(*) from public.user_pets
union all select 'user_inventory', count(*) from public.user_inventory
union all select 'user_quests', count(*) from public.user_quests
union all select 'user_skills', count(*) from public.user_skills
union all select 'boss_contributors', count(*) from public.boss_contributors
union all select 'user_challenges', count(*) from public.user_challenges;
```

Birinci `DB1-13` sorgusu boş dönerse `auth.users` üzerinde profil tetikleyicisi YOKTUR; bu durumda yeni kayıtlar profil satırı almaz (istemci `fetchOrCreateProfile` ile yaratır, `add_xp` 040'tan sonra profil yoksa satırı kendisi oluşturur). Tetikleyici ancak sahip onayıyla ayrı bir migrasyonla eklenir. `notion-sync`, 040'tan sonra `access_token` okuyamaz; Notion yeniden açılmadan önce service-role'e taşınmalıdır (F45).

```sql
-- F08 (BLD-12): geçmişte izlenen test betiklerindeki hesapların canlı auth.users üzerinde salt-okunur kontrolü
select id, email, created_at, last_sign_in_at
from auth.users
where email in (
  'demo@aderyth.app',
  'testci@habitapp.dev',
  'testci@gmail.com',
  'testci@supatest.com'
)
or email like 'dev_%@aderyth.app'
or email like 'aitest%@gmail.com';
```

Satır dönerse ilgili test hesaplarının parolalarını sıfırlayın ya da Supabase Auth panelinden silin.

**F22 (OD-19) — Supabase Auth Redirect URL İzin Listesi (SQL yok, Dashboard ayarı):** Kayıt onayı (`signUp` / `resend`) ve parola kurtarma (`resetPasswordForEmail`) bağlantılarının uygulamaya dönebilmesi için **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs** izin listesine `atlas://**` (üretim native), **yalnızca** geliştirme projesinde `exp://**`, ve OD-12 sonrası `https://<web-sitesi>/reset-password` ile `https://<web-sitesi>/login` adreslerini ekleyin (`frontend/vercel.json` SPA rewrite karşılığı aktif olmalı; Site URL çalışan bir web adresi olmalı).

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
| 4 | 043 uygulandı + §2.16 | yok — istemci RPC yoksa sessizce atlar, uygulanınca kendiliğinden çalışır (`LOG_TIMEZONE_ENABLED` 033'e bağlıdır ve bu fazla çevrilmez) |

039'u uygulamadan ÖNCE istemci sürümü mağazalarda olmalı; sonra 039; Edge deploy (S3) sıradan bağımsızdır. **042 (F14) ise tersine ondalık girdiyi kabul eden istemci sürümünden ÖNCE uygulanır** (böylece ondalık `daily_goal` ve `habit_logs.value` yazımları veritabanında reddedilmez ve `spend_willpower` atomik RPC hazır olur); hemen ardından `select * from public.xp_drift();` 0 satır olmalıdır. **043 (F15), 038 uygulandıktan sonra uygulanır; ardından `select * from public.xp_drift();` 0 satır; `LOG_TIMEZONE_ENABLED` 033'e bağlıdır ve bu fazla çevrilmez.** Her adımdan sonra `select * from public.xp_drift();` 0 satır.

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
şey yazılmaz.** Testler geçici Postgres'te `live_schema.sql` + 028–041 üzerinde koşar (bugünkü canlı
değil: canlıda 028–041 uygulanmamıştır). Canlıdaki açıklar (örneğin `weekly_xp`, TST-V01) 036/040 sizin
tarafınızdan uygulanana kadar canlıda açık kalır; test CI'da uygulanmış halin kapalı olduğunu kanıtlar,
canlıyı denetlemez. Canlı doğrulama §2'dir.

| Dosya | Ne denetler | Bugünkü beklenti |
|---|---|---|
| `01_client_cannot_write_server_tables.sql` | `authenticated` / `anon` rolü `weekly_xp`, `profiles.total_xp·level·coins`, `user_subscriptions`, `credit_transactions` tablolarına yazamaz (SQLSTATE 42501); sahibin kendi `user_subscriptions` satırını silememesi ile `credit_transactions` ve `ai_requests` satırlarını değiştirememesi (tablo yetkisi açıktır, satırı RLS korur: hiçbir satır değişmez); bu "satır değişmedi" denemelerinin boş geçmediğini gösteren pozitif kontroller | 22 sonuç, hepsi PASS |
| `02_security_definer_hygiene.sql` | anon'un `public` SECURITY DEFINER fonksiyonunda EXECUTE hakkı yok (`T02a`); hepsinde `search_path` sabit (`T02b`); yalnız-servis fonksiyonlar istemciye kapalı (`T02c`–`T02e`) | 5 PASS (`T02a.all` ve `T02b.all` dahil; F09 kapattı) |
| `03_xp_drift_zero.sql` | gerçek `habit_logs` yazma / güncelleme / silme sonrası `xp_drift()` boş (tetikleyici zinciri olduğu gibi) | 4 PASS |
| `04_today_bootstrap_isolation.sql` | `get_today_bootstrap` iki kullanıcı izolasyonu, doğrudan tablo izolasyonu, JWT'siz çağrının fonksiyonun KENDİ `authentication required` hatasıyla reddi (bekçi satırı kalkarsa başka bir 42501 gelir ve test kırmızı olur), anon çağrı reddi | 6 PASS |
| `05_concurrency_spend.sh` | 8 eşzamanlı oturumla `spend_focus_points_v2` (tek kazanan, bakiye eksiye düşmez, aynı `request_id` tek borç) ve `ai_request_begin` (tek `claimed`) yarışı | 5 PASS + 1 INFO |
| `06_xp_integrity_038.sql` | 038 (F03): `authenticated` rolüyle `weekly_xp` yazımı, gün penceresi (−16/+2 red, −15/+1 kabul), istemci `xp` değerinin yok sayılması, sil-yeniden-yaz ve aynı adla yeniden oluşturmanın ikinci kez ödenmemesi, günlük tavan (25 x 100 -> 2000), seri sütunlarının istemciden yazılamaması, done/miss/partial gidip gelmenin seriyi bir kez artırması, boşluğun seriyi sıfırlaması ve x1,2 basamağı, silmelerin XP'yi bir kez `purged_xp`'ye taşıması, boss tetikleyicisinin kalkması, tetikleyici fonksiyonlarının istemciye kapalı ve `search_path`'inin sabit olması, `weekly_xp` makullük kısıtı, log anahtarının taşınamaması, eski günde not düzenlemenin serbest ama durum değişikliğinin reddi, notla yeniden puanlama olmaması; her senaryodan sonra `xp_drift()` boş | 24 PASS |
| `07_focus_point_039.sql` | 039 (F07): aynı `(conversation_id, request_id)` için ikinci kullanıcı mesajı reddedilir (`23505`), asistan yanıtı ve başka konuşma serbesttir, çapraz kiracı mesaj okuma/yazma ve eski/servis FP RPC'leri istemciye kapalıdır, `xp_drift()` boş | 8 PASS |
| `08_privilege_hygiene_040.sql` | 040 (F09 + F07-R3): anon yazma/`MAINTAIN` ve `PUBLIC EXECUTE` kapalı, 20 `SECURITY DEFINER` `search_path` sabit, liderlik ve sıra RPC'leri oturum zorunlu + 1..100 sınırlı + yalnız kendi sırası, `profiles` dar sütun INSERT + kullanıcı adı şekil kısıtı + `handle_new_user` temizliği, 028–031'in 10 tablosu dar yetki ve RLS, OAuth belirteç tabloları gizli sütun yalıtımı, 17 F13 tablosu yazma yasağı ve 6 tablonun `archive_f13`'e taşınması, `add_xp` ve abonelik yenileme satır kilidi, `ai_request_reconcile_stale` mod duyarlı ileti (`routine` vs diğer modlar), `get_today_bootstrap` salt-okunur (`STABLE`), `xp_drift()` boş | 37 PASS |
| `09_rls_initplan_041.sql` | 041 (F10): `public` ve `archive_f13` şemalarında çıplak `auth.uid()`/`auth.role()` politikası yok (`InitPlan` plan şekli ve negatif kontroller dahil), çakışan kopya politikalar (`tasks`, `challenges`, `habit_templates`, `weekly_xp`, `user_challenges`) kalktı, `anon` katalog okuması kapalı, 26 FK öncü indeksi var, yinelenen `idx_habit_logs_habit_date` düştü, `tasks_parent_task_id_fkey` `ON DELETE CASCADE` ve bölücü düz yükü çalışıyor, `xp_drift()` boş | ~69 PASS |
| `10_numeric_and_willpower_042.sql` | 042 (F14): `habit_logs.value` ve `habits.daily_goal` `numeric(12,2)` (yuvarlama ve aralık reddi dahil), `habit_xp_value(uuid, text, numeric)` puanlaması ve istemci erişim yasağı, `get_today_bootstrap` JSON sayı taşıması, `spend_willpower` harcama/birikim/aşım reddi/clamp/iade tabanı/girdi sınırları/kiracı yalıtımı/`anon` ve kimliksiz çağrı reddi, `xp_drift()` boş | 26 PASS |
| `10_willpower_concurrency_042.sh` | 042 (F14): 8 eşzamanlı oturumla `spend_willpower` sert harcama yarışı (tek kazanan, 7 red, `used = 8`) ve `clamp` yarışı (`used = 15`, 0 hata, `active_count = 8`) | 2 PASS |
| `11_profile_time_zone_043.sql` | 043 (F15): `profiles.time_zone` sütunu ve `1..64` CHECK, `local_date_in_zone` ve `week_start_in_zone` sabit anlar ve DST kenarları, `set_profile_time_zone` geçerli IANA kaydı / idempotensi / bilinmeyen ve kısaltma reddi / doğrudan `UPDATE` yasağı / kiracı yalıtımı / `anon` reddi, `fn_habit_log_guard` uç saat dilimlerinde yerel gün penceresi (`Pacific/Kiritimati`, `Pacific/Pago_Pago`), geçersiz kayıtlı bölgede UTC'ye düşüş, `track_weekly_xp` ve `get_weekly_leaderboard` yerel hafta uyumu, `xp_drift()` boş | 25 PASS |

**`supabase/tests/expected_failures.txt` ne demek.** Bilinen açıkların test adı listesidir; her satır bulgu
kimliğini taşır ve başlıkta kapatan faz yazar. Koşucu iki yönlü karşılaştırır: listede olmayan bir test kırmızıysa
`UNEXPECTED FAILURES`, listede olup yeşile dönmüş bir satır kalmışsa `STALE` ile CI kırmızı olur. Yani liste yalnız
küçülebilir; bir açığı kapatan migration aynı commit'te kendi satırlarını siler. F09 (`040_privilege_hygiene.sql`)
20 `T02b_search_path.*` satırının tamamını sabitleyip sildiği için liste artık boştur (`0` beklenen kırmızı). Sizin
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
veritabanına ulaşılamadı (bulgudur, fixture gevşetilmez); `4` sonuç akışı kullanılamaz (140'tan az, ayrıştırılamayan,
tekrarlanan ya da hiç rapor vermeyen test ya da `T02a` / `T02b` sonuç ailesi).

## 9. Auth ve API ayarları — salt-okunur kontrol listesi

Sahip dashboard'da bakar; ajan hiçbir canlı ayarı değiştirmez; sonuçlar OD-19'a girdi olur:

| Ayar | `supabase/config.toml` (yerel, 041 sonrası) | Dashboard yolu | Beklenen canlı değer | Sahip bildirir |
|---|---|---|---|---|
| E-posta onayı | `enable_confirmations = true` (`[auth.email]`) | Authentication → Sign In / Providers → Email → "Confirm email" | açık | ☐ |
| Parola değişiminde yeniden doğrulama | `secure_password_change = true` | Authentication → Sign In / Providers → Email | açık (kurtarma bağlantısı akışı etkilenmez) | ☐ |
| Asgari parola uzunluğu | `minimum_password_length = 6` (istemci tabanı ile aynı; yükseltme OD-19) | Authentication → Sign In / Providers → Email → "Minimum password length" | 6 ya da OD-19 kararı | ☐ |
| Parola gereksinimleri | `password_requirements = ""` | aynı sayfa | boş ya da OD-19 kararı | ☐ |
| Bot koruması | yok (yorum satırı `[auth.captcha]`; F21 ekler) | Authentication → Attack Protection → CAPTCHA | OD-19 kararı | ☐ |
| Kayıt oran sınırı | `sign_in_sign_ups = 30` (yerel) | Authentication → Rate Limits | OD-19 kararı | ☐ |
| Açık şemalar | `schemas = ["public"]` | Project Settings → API → Exposed schemas | `graphql_public` kaldırılabilir (istemci GraphQL çağırmaz) | ☐ |
