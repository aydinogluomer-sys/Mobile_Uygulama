# Migration eşleştirmesi — repo ↔ canlı (salt-okunur, 2026-10-09)

> Proje `kbcuolhjjnmhjaarxxmu`. Sahibin izniyle **yalnız okuma**: `list_migrations` ve `execute_sql`
> içinde yalnız `SELECT` (`supabase_migrations.schema_migrations`, `information_schema`, `pg_catalog`,
> `pg_get_*def`). `apply_migration`, `migration repair`, `db push`, deploy ve DDL/DML **çağrılmadı**;
> hiçbir dosya yeniden adlandırılmadı. Kaynaklar: `supabase/migrations/001..036`, `README.md` eşleme
> tablosu, sahibin dökümü `supabase/live_schema.sql`.

## 0. Yöntem

Canlı defterin her kaydı çalıştırdığı SQL'i `statements` sütununda tutuyor (45 kayıt, her biri tek
ifade dizisi; `rollback` boş). İçerik karşılaştırması iki tarafta **aynı normalleştirmeyle** yapıldı:
`/* */` ve `--` yorumları silindi, tüm boşluklar atıldı, küçük harfe çevrildi; sonra (1) bütün metnin
md5'i, (2) `;` ile bölünmüş her ifadenin md5'i karşılaştırıldı. Kanıt sırası: README tablosu →
isim benzerliği → içerik.

| Güven | Tanım (bu belgede) |
| --- | --- |
| **KESİN** | normalleştirilmiş metin canlı kayıtla birebir aynı |
| **KESİN\*** | DDL birebir aynı; fark **yalnız `COMMENT ON` metninde** (dosya, uygulandıktan sonra yorum metni düzeltilerek düzenlenmiş) — şema etkisi aynı |
| **OLASI** | isim/zaman ve nesneler tutuyor, içerik kısmen farklı |
| **YOK** | eşleşen kayıt yok |

Tekrar çalıştırma riski (bugünkü canlıya bu dosya yeniden uygulansa): **DÜŞÜK** = aynı sonuç ·
**ORTA** = veri/davranış değişir ya da sonraki bir düzeltmeyi geri alır · **YÜKSEK** = güvenlik
gerilemesi veya uygulamayı bozar.

## 1. Eşleme tablosu (001..027)

| Repo dosyası | Canlı version | Canlı name | Güven | İçerik farkı | Tekrar çalıştırma riski |
| --- | --- | --- | --- | --- | --- |
| `001_initial_schema.sql` | `20260606075913` (en yakın) | `add_willpower_and_new_tables` | **OLASI** | 18 ifadenin 9'u ortak (routines/routine_items/willpower_state tabloları, RLS, 3 politika, `habits_user_status` indeksi). Dosya ayrıca `habits`/`habit_logs` tablolarını ve `habits_self`/`habit_logs_self` politikalarını kuruyor — bunlar canlıda **yok** (canlıdaki adlar: "Users can CRUD own habits", "Users can … own logs"). README: 001 defterden önce SQL editöründe elle çalıştırıldı; kendi kaydı yok. | **ORTA** — `willpower_self` zaten var → işlem hatayla durur (tek işlemde etkisiz) ama `db push`'u kilitler; ifade ifade çalıştırılırsa fazladan izin veren politika ekler |
| `002_integrations.sql` | `20260607061239` (yalnız Notion kısmı) | `notion_integrations` | **OLASI** (kısmi) | 8 ifadenin 1'i ortak. Google tablosu bu dosyayla hiç kurulmadı (006 kurdu); Notion politikası canlıda farklı adla ("Users manage own notion integration"). | **YÜKSEK** — `google_calendar_integrations_self` istemci politikası oluşur: tasarım gereği politikasız (yalnız sunucu) OAuth token tablosu istemciye açılır |
| `003_emergency_gate_0_revoke_mock_activate_subscription.sql` | `20260802181931` | `emergency_gate_0_revoke_mock_activate_subscription` | **KESİN** | — | DÜŞÜK (REVOKE) |
| `004_emergency_gate_0_revoke_client_exec_xp_functions.sql` | `20260802205850` | `emergency_gate_0_revoke_client_exec_xp_functions` | **KESİN** | — | DÜŞÜK (REVOKE) |
| `005_phase1_core_engine.sql` | `20260830051844` | `phase1_core_engine` | **KESİN\*** | 39 ifadenin 1'i: `recovery_plans.distributed_days` yorumu (repo örnek JSON ekliyor) | **ORTA** — `recovery_plans_status_check`'i `done`/`skipped` dahil eski geniş kümeye çevirir; 025'in v2 daraltmasını geri alır |
| `006_google_calendar_integrations.sql` | `20260830125719` | `20260830_google_calendar_integrations` | **KESİN\*** | tablo yorumu (`user's jwt` ↔ `user jwt`) | DÜŞÜK |
| `007_habit_logs_ownership_check.sql` | `20260830145934` | `20260830_habit_logs_ownership_check` | **KESİN\*** | tablo yorumu (uzun tire ↔ kısa tire) | DÜŞÜK |
| `008_child_row_ownership.sql` | `20260830164223` | `20260830_child_row_ownership` | **KESİN** | — | DÜŞÜK |
| `009_retire_legacy_backend.sql` | `20260830203457` | `20260830_retire_legacy_backend` | **KESİN** | — | DÜŞÜK |
| `010_focus_point_atomicity.sql` | `20260830214906` | `20260831_focus_point_atomicity` | **KESİN** | — | **YÜKSEK** — 024'ün kaldırdığı `spend_focus_points_v2(integer,text,text)` ve `refund_focus_points(text,text)`'i geri kurar ve `authenticated`'a EXECUTE verir: istemci kendi FP'sini doğrudan harcatıp iade ettirebilen eski yol açılır |
| `011_monthly_reviews.sql` | `20260830220424` | `20260831_monthly_reviews` | **KESİN\*** | tablo yorumunda anahtar adı ters tırnaklı | DÜŞÜK |
| `012_xp_integrity.sql` | `20260830222157` | `20260831_xp_integrity` | **KESİN** | — | **ORTA** — `xp_drift`/`rebuild_profile_xp`'yi 016 öncesi (purge'ü bilmeyen) haline döndürür |
| `013_recovery_vocabulary.sql` | `20260830224359` | `20260831_recovery_vocabulary` | **KESİN** | — | DÜŞÜK (canlı zaten v2; eski sözcüklü satır yok) |
| `014_recovery_vocabulary_compat_rollback.sql` | `20260831015202` | `20260831_recovery_vocabulary_compat_rollback` | **KESİN\*** | sütun yorumu (`§0b` ↔ `paragraph 24`) | **YÜKSEK** — `strategy` CHECK'ini eski sözcüklere (`full/half/mini/reschedule`) çevirir; uygulamanın v2 telafi yazımları reddedilir |
| `015_ceiling_xp.sql` | `20260831084103` | `20260831_ceiling_xp` | **KESİN** | — | DÜŞÜK (canlı `habit_xp_value` bu sürüm) |
| `016_xp_drift_survives_purge.sql` | `20260831085005` | `20260831_xp_drift_survives_purge` | **KESİN** | — | **ORTA** — `purged_xp` doldurma güncellemesi idempotent değil: fark ikinci kez eklenir |
| `017_revoke_ddl_grants.sql` | `20260831085112` | `20260831_revoke_ddl_grants` | **KESİN** | — | DÜŞÜK |
| `018_lock_admin_functions.sql` | `20260831101109` | `20260831_lock_admin_functions` | **KESİN** | — | DÜŞÜK |
| `019_user_onboarding.sql` | `20260905211823` | `20260906_user_onboarding` | **KESİN** | — | **ORTA** — onboarding satırı olmayan her hesabı `legacy` yapar: bugün `pending` okunan yeni kullanıcılar ilk kurulumu atlar |
| `020_user_onboarding_installing_status.sql` | `20260905233428` | `20260906b_user_onboarding_installing_status` | **KESİN** | — | DÜŞÜK |
| `021_onboarding_install_identity.sql` | `20260906013327` | `20260906c_onboarding_install_identity` | **KESİN** | — | DÜŞÜK |
| `022_onboarding_install_return_status.sql` | `20260906054935` | `onboarding_install_return_status` | **KESİN\*** | sütun yorumu (repo bir cümle daha uzun) | DÜŞÜK |
| `023_ai_request_idempotency.sql` | `20260906120240` | `ai_request_idempotency` | **KESİN\*** | tablo yorumu (repo bir cümle daha uzun) | **YÜKSEK** — 024'ün kaldırdığı `auth.uid()` tabanlı 3/2 argümanlı `ai_request_*` fonksiyonlarını geri kurar (024'ün "herhangi bir oturumlu kullanıcı çağırabiliyordu" kusuru) |
| `024_ai_request_privileges_and_lease.sql` | `20260906123146` | `ai_request_privileges_and_lease` | **KESİN\*** | fonksiyon yorumu (repo bir cümle daha uzun) | DÜŞÜK (önce düşürüp yeniden kurar) |
| `025_recovery_v2_vocabulary_release.sql` | `20260906151909` | `recovery_v2_vocabulary_release` | **KESİN** | — | DÜŞÜK (eşleme güncellemeleri idempotent) |
| `026_ai_conversations.sql` | `20260908041021` **+** `20260908041055` | `ai_conversations` + `ai_messages_revoke_update` | **KESİN** (iki kayıt birleşik) | 52 ifadenin 51'i ilk kayıtta; kalan `revoke update on public.ai_messages from authenticated` ikinci kayıt | DÜŞÜK |
| `027_account_deletion_cascade.sql` | `20260908133800` | `account_deletion_cascade` | **KESİN** | — | DÜŞÜK |

**Özet:** 25 dosyanın 16'sı canlı kayıtla birebir, 8'i yalnız yorum metninde farklı (DDL aynı), 026 iki
kayda bölünmüş; 001 ve 002 defterden önce elle çalıştırılmış ve kısmen başka adlarla canlıda.
**Uyarı (kural ihlali):** KESİN\* olan 8 dosya uygulandıktan sonra düzenlenmiş — README "uygulanmış
migration'ın gövdesi değiştirilmez" diyor. Değişiklik yalnız yorum metni, ama dosya artık "çalışan SQL'in
kaydı" değil; asıl kayıt defterdeki `statements`.

## 2. Her eski migration — sonuç bugün duruyor mu?

| # | Ne yapıyor | Canlıda sonuç | Sonradan ezildi / geri alındı mı |
| --- | --- | --- | --- |
| 001 | çekirdek tablolar + `*_self` politikaları | tablolar var; `habits_self`/`habit_logs_self` **yok** (yerlerinde başka adlı politikalar) | habit_logs politikaları 007 ile yeniden yazıldı |
| 002 | Notion + Google tabloları, `*_self` politikaları | Notion tablosu var (farklı politika); Google tablosu 006'dan | Google kısmı 006 ile **değiştirildi** (politikasız tasarım) |
| 003 | `mock_activate_subscription` EXECUTE kaldır | anon: **false** ✓ | — |
| 004 | `add_xp`/`track_weekly_xp`/`deal_damage…` EXECUTE kaldır | üçü de anon: **false** ✓ | — |
| 005 | kapasite tablosu, telafi sütunları, CHECK'ler | `daily_capacity`, `recovery_plans_habit_source_unique` ✓ | status/strategy CHECK'leri 013 → 014 → **025** ile değişti; canlı = 025 (v2) |
| 006 | Google token tablosu, sıfır politika | politika **0** ✓ | — |
| 007 | habit_logs: alışkanlık sahipliği şartı | politikalar ✓ | — |
| 008 | çocuk satırlar ebeveyn sahipliği | `rp_insert`/`rp_update` ✓ | — |
| 009 | `bad_habits`, `webhooks` | tablolar ✓ | — |
| 010 | FP tek tahsilat (`_v2`, `refund`) | — | **024 ile değiştirildi**: imzalar `p_user_id` aldı, istemci EXECUTE'u kalktı |
| 011 | `monthly_reviews` | tablo + benzersiz anahtar ✓ | — |
| 012 | XP istemci-yazılamaz; `xp_drift` | `profiles.total_xp` UPDATE: **false** ✓ | `xp_drift`/`rebuild_profile_xp` **016** ile yeniden tanımlandı |
| 013 | telafi sözcükleri v2'ye | — | **014 geri aldı, 025 yeniden uyguladı** (canlı = v2) |
| 014 | 013'ü geri al (uyumluluk) | — | **025 ile ezildi** |
| 015 | `habit_xp_value` tavan yönü | canlı tanım bu ✓ | — |
| 016 | `purged_xp`, düzeltilmiş `xp_drift` | sütun + tetikleyici ✓ | — |
| 017 | TRUNCATE/REFERENCES/TRIGGER yetkilerini kaldır | **false** ✓ | — |
| 018 | yönetim fonksiyonlarını kilitle | anon: **false** ✓ | — |
| 019–022 | onboarding tablosu, `installing`, kurulum kimliği, dönüş durumu | sütunlar ✓ | — |
| 023 | AI istek defteri | — | fonksiyonları **024 ile değiştirildi** |
| 024 | defter yetkileri + kira | imzalar `p_user_id`'li ✓ | — |
| 025 | v2 sözcükleri yayın | status CHECK = `planned/completed/expired/cancelled` ✓ | — |
| 026 | koç sohbetleri | tablolar ✓; `ai_messages` UPDATE: **false** ✓ | — |
| 027 | hesap silme zinciri | `auth.users`'a 47 FK'nin **47'si** CASCADE ✓ | — |

## 3. Yalnız canlıda (repoda dosyası olmayan kayıtlar — S12)

| Version | Name | Ne yaptı (statements'tan) | Not |
| --- | --- | --- | --- |
| `20260606075913` | add_willpower_and_new_tables | routines, routine_items, willpower_state + habits/habit_logs değişiklikleri | 001 ile kısmen örtüşür (OLASI) |
| `20260606081143` | security_rls_and_grants | pet_stages/skills okuma politikaları, SELECT revoke | F13 |
| `20260606081212` | revoke_anon_functions | EXECUTE revoke | |
| `20260606114641` | ai_rate_limit_table | `ai_calls` + `cleanup_old_ai_calls` | |
| `20260606134848` | create_test_user_v2 | `auth.users`'a test kullanıcısı **INSERT** | ⚠ ifade parolayı `crypt('…')` ile **açık metin** içeriyor; kullanıcı artık yok (`auth.users`'ta 0) ama metin defterde duruyor |
| `20260606134943` | create_test_user_identity_v2 | `auth.identities` INSERT | veri işlemi |
| `20260606135009` | fix_test_user_null_tokens | `auth.users` UPDATE | veri işlemi |
| `20260606154808` | atlas_features_tasks_projects_notes_journal_focus | tasks, projects, notes, journal_entries, focus_tasks, focus_sessions + `*_own` politikaları | çekirdek tablolar — repoda hiç yok |
| `20260606154901` | tasks_add_atlas_columns | tasks sütunları, `set_updated_at`, tetikleyiciler | |
| `20260606170510` | reading_list_table | reading_list | |
| `20260607061239` | notion_integrations | notion_integrations | 002 ile kısmen (OLASI) |
| `20260611101120` | add_new_feature_tables | deep_work_sessions, goals, life_area_logs, weekly_reviews | |
| `20260613171904` | m1_unify_rank_for_level_6tier | `get_rank_for_level` | |
| `20260613171926` | m2_habit_xp_value | `habit_xp_value` (ilk sürüm) | 015 ezdi |
| `20260613172012` | m3_fix_habit_xp_triggers | `fn_habit_log_award`, `fn_habit_log_set_xp` + tetikleyiciler | XP tetikleyici çifti — S11'in kaynağı |
| `20260613172032` | m4_leaderboard_and_backfill | `get_global_leaderboard`, profiles backfill | |
| `20260613172039` | m5_journal_ai_summary_flag | journal_entries.ai_summary | |
| `20260613180341` | journal_insights_table | journal_insights | |
| `20260614105030` | create_spotify_accounts | spotify_accounts | |

Bunlara ek olarak defterde **hiç izi olmayan** canlı nesneler de var (ör. `profiles`, `habit_templates`,
F13 tabloları, `user_subscriptions`, `credit_transactions`): SQL editöründen elle kurulmuşlar. Tek tam
kaynak `supabase/live_schema.sql` (LIVE_SCHEMA_AUDIT.md: 58 canlı tablonun 42'si repoda yok).

## 4. Yalnız repoda

`028`…`036` — beklenen: yazıldı, uygulanmadı (`README.md` NOT APPLIED; `SQL_FOR_OWNER.md`).

## 5. Öneri — `db push`'un güvenle çalışması (yalnız belge, UYGULAMA YOK)

### Bugünkü durum neden tehlikeli

CLI, yerel dosya adının sayısal önekini defterdeki `version` ile karşılaştırır. Yerelde `001…036`,
defterde `20260606…`–`20260908…` var: hiçbiri eşleşmez. `supabase db push` bugün iki şeyden birini yapar —
defterdeki 45 sürüm yerelde yok diye **reddeder**, ya da (bayraklarla zorlanırsa) yerel 36 dosyanın
hepsini "uygulanmamış" sayıp **yeniden çalıştırır**. İkincisi §1'deki YÜKSEK riskleri tetikler: 002
Google token tablosunu açar, 010/023 istemci-çağrılabilir tahsilat fonksiyonlarını geri getirir, 014
telafiyi bozar, 016 `purged_xp`'yi ikiler, 019 onboarding'i atlatır.

### Seçenekler

| | Ne | Artı | Risk |
| --- | --- | --- | --- |
| **(a)** Yerel dosyaları canlı zaman damgalarıyla adlandırmak | 003–027'yi `<version>_<name>.sql` yap; 026'yı ikiye böl; 001/002 ve 19 "yalnız canlı" kayıt için dosya üret | defter dokunulmaz; geçmiş okunur kalır | elle yeniden adlandırma 36 dosya + 19 eksik dosya üretme; KESİN\* dosyaların gövdesi zaten defterden farklı (yorum); 001/002 hiçbir sürüme tam karşılık gelmez → biri yanlış eşlenirse ileride yeniden çalıştırılır |
| **(b)** `supabase migration repair --status applied <version>` | yerel `001…027` sürümlerini defterde "uygulandı" işaretle | dosyalar yerinde kalır | defter **iki ad sistemi** taşır (45 zaman damgası + 27 sıra numarası); CLI defterdeki 45 kaydın yerelde olmamasını yine reddeder → bunlar için `--status reverted` gerekir, bu da **defter satırlarını (ve içindeki `statements` kaydını) siler**. Geri dönüşsüz tarih kaybı. |
| **(c)** Tek taban migration + yeni zaman damgaları | `live_schema.sql`'i `<ts>_baseline.sql` yap, 45 eski kaydı `reverted`, tabanı `applied` işaretle; 028+ yeni adlarla | yerel kurulum (`supabase db reset`) mümkün olur — bugün değil | 45 defter satırı silinir (b ile aynı kayıp); taban dökümü canlıyla birebir olmalı, değilse sessiz sapma; `live_schema.sql` henüz repoda değil ve sahip kararı |

### Önerilen: (a), elle değil `supabase migration fetch` ile — "defter aynası"

`supabase migration fetch` defterdeki her kaydı `statements` içeriğiyle `supabase/migrations/<version>_<name>.sql`
olarak indirir. Böylece (a)'nın amacı (yerel = defter) **elle eşleme yapmadan, tam olarak çalışan SQL ile**
sağlanır; defterde hiçbir satır silinmez, `repair` gerekmez. 001…027 belgesel değeri için arşive taşınır
(README'deki eski adlar oradan çözülür). 028…036 defterin son sürümünden sonraki zaman damgalarıyla
adlandırılır; `db push` yalnız bunları görür.

(c)'nin tek kalıcı faydası (yerelde sıfırdan kurulum) bu seçeneğe **ayrıca** eklenebilir: `live_schema.sql`
yalnız yerel geliştirme için `supabase/seed`/ayrı klasörde tutulur, canlı deftere dokunmadan.

**Doğrulanmadı:** `migration fetch` bu oturumda çalıştırılmadı (yazma yok kuralı); adım 0'daki `--help` kontrolü komutun kurulu CLI'da olduğunu teyit eder. Yoksa aynı sonuç, defteri `select version, name, statements from supabase_migrations.schema_migrations` ile okuyup her satırı `<version>_<name>.sql` olarak yazarak elde edilir.

**Neden bu:** defterdeki `statements` canlıyı gerçekten kuran SQL'dir (§1: dosyaların 8'i ondan
sapmış); geri dönüşsüz tek işlem (`repair --status reverted`) hiç gerekmez; 002/010/014/016/019/023'ün
yeniden çalıştırılma yolu kapanır.

### Sahibin çalıştıracağı komutlar (sırayla) — ajan çalıştırmadı

```bash
# 0. Ön koşul: yedek alındı; CLI 'migration fetch' destekliyor
supabase --version
supabase migration --help          # 'fetch' alt komutu listelenmeli; yoksa CLI'ı güncelle
supabase link --project-ref kbcuolhjjnmhjaarxxmu

# 1. Belgesel dosyaları CLI'ın okumadığı yere taşı (git geçmişi korunur)
mkdir -p supabase/migrations_archive
git mv supabase/migrations/0[0-2][0-9]_*.sql supabase/migrations_archive/

# 2. Defteri yerel dosya olarak indir (45 dosya, tam çalışan SQL)
supabase migration fetch

# 3. GİZLİ BİLGİ: test kullanıcısı kaydı parolayı açık metin içeriyor — commit'ten ÖNCE gövdeyi
#    bir yorumla değiştir (CLI içerik değil sürüm karşılaştırır; push etkilenmez)
#    supabase/migrations/20260606134848_create_test_user_v2.sql   -> "-- redacted: test user (deleted)"
#    aynısını 20260606134943 ve 20260606135009 için de değerlendir (auth veri işlemleri)

# 4. Yerel = uzak doğrulaması: 45 satırın hepsi iki sütunda da dolu, bekleyen yok
supabase migration list

# 5. Yeni migration'ları zaman damgalı adlara taşı (bkz. aşağıdaki tablo)
git mv supabase/migrations/028_habit_pauses_and_goal_versions.sql supabase/migrations/20261010000100_habit_pauses_and_goal_versions.sql
#    … 029–036 aynı şekilde

# 6. Kuru çalıştırma: YALNIZ 9 yeni dosya listelenmeli; eski bir sürüm görünürse DUR
supabase db push --dry-run

# 7. Önce bir branch projesinde uygula ve SQL_FOR_OWNER.md §2 doğrulamalarını çalıştır
# 8. Sonra canlıya: supabase db push   → ardından §2 doğrulamaları, §5 kapı sırası
```

**Repo tarafında aynı commit'te güncellenmesi gerekenler** (bu belge değiştirmedi): `README.md` eşleme
tablosu ve "db push çalıştırma" kuralı; dosya adını okuyan testler — `repo/coachV2Wired.test.ts`
(032/034/035 yolları), `repo/migrationRlsGuard.test.ts` (`^0(2[89]|[3-9]\d)_` deseni),
`repo/liveSchemaAudit.test.ts` (036 yolu), `SQL_FOR_OWNER.md` dosya adları.

### 028..036 için önerilen yeni adlar

Defterin son sürümü `20260908133800`; aşağıdakilerin hepsi ondan sonra ve uygulama sırasıyla artan:

| Bugün | Önerilen |
| --- | --- |
| `028_habit_pauses_and_goal_versions.sql` | `20261010000100_habit_pauses_and_goal_versions.sql` |
| `029_habit_checklists.sql` | `20261010000200_habit_checklists.sql` |
| `030_routine_runner.sql` | `20261010000300_routine_runner.sql` |
| `031_moods_and_review_actions.sql` | `20261010000400_moods_and_review_actions.sql` |
| `032_coach_actions_v2.sql` | `20261010000500_coach_actions_v2.sql` |
| `033_habit_log_timezone.sql` | `20261010000600_habit_log_timezone.sql` |
| `034_coach_reminder_action.sql` | `20261010000700_coach_reminder_action.sql` |
| `035_coach_lighten_week.sql` | `20261010000800_coach_lighten_week.sql` |
| `036_live_audit_hardening.sql` | `20261010000900_live_audit_hardening.sql` |
| `037_today_bootstrap_rpc.sql` | `20261010001000_today_bootstrap_rpc.sql` |

## 6. Kullanılan sorgular (hepsi salt-okunur)

- `select version, name, created_by, array_length(statements,1), md5(…)` — defter dökümü
- normalleştirilmiş tam metin ve ifade başına md5 (`regexp_replace`, `string_to_array(…, ';')`)
- nesne çıkarımı: `regexp_matches(statements, 'create table|create … function|alter table|…')`
- sonuç kontrolleri: `has_function_privilege`, `has_table_privilege`, `has_column_privilege`,
  `pg_get_constraintdef`, `pg_policies`, `pg_proc` imzaları, `pg_constraint` (FK `confdeltype`)
- test kullanıcısı: yalnız sayımlar (`auth.users`'ta var mı, `crypt(` geçiyor mu) — parola okunmadı/yazdırılmadı
