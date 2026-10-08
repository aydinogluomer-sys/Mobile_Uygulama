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
