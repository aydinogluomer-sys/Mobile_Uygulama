# Canlı şema denetimi — salt-okunur (2026-10-09)

> Proje `kbcuolhjjnmhjaarxxmu` ("Alışkanlık Uygulaması", eu-central-1, Postgres 17, ACTIVE_HEALTHY) —
> `get_project` ile doğrulandı. Sahibin izniyle **yalnız okuma**: `list_tables`, `list_migrations`,
> `get_advisors`, `execute_sql` içinde yalnız `SELECT` / `information_schema` / `pg_catalog` /
> `pg_get_functiondef` / `pg_get_triggerdef`. **Hiçbir şey değiştirilmedi**: `apply_migration`, deploy,
> restore ve DDL/DML çağrılmadı. Önerilen SQL: `supabase/migrations/036_live_audit_hardening.sql`
> (WRITTEN, NOT APPLIED).
> Çapraz kontrol: sahibin bugünkü şema dökümü `supabase/live_schema.sql` (yalnız şema; satır verisi
> ve anahtar yok — `INSERT` satırları fonksiyon gövdelerinde, `service_role` yalnız GRANT rol adı)
> aynı 58 tabloyu listeliyor. Dosya izlenmiyor; commit kararı sahibin.

## 1. Özet

| | |
|---|---|
| Canlı migration | 45 kayıt, sonuncusu `20260908133800 account_deletion_cascade` (repo 001–027 karşılığı). **028–035 canlıda yok** — beklenen (S2). |
| Canlı tablo (public) | 58, hepsinde RLS açık |
| Veri | **Boş değil**: 6 kullanıcı, 7 alışkanlık, 13 log, 7 günlük, 16 FP hareketi, 12 AI isteği, 800 şablon. `STATE.md` "2026-10-03'te boş bulundu" diyordu — o tarihten sonra veri girmiş. |
| Repo ↔ canlı | 58 canlı tablonun **42'sinin CREATE'i repoda yok** (S12 doğrulandı); repo 028–031'in 10 tablosu canlıda yok |
| Kod ↔ canlı | Kodun okuduğu 4 tablo canlıda yok: `habit_pauses`, `habit_goal_versions`, `habit_checklist_items`, `habit_checklist_checks` — istemci bunlarda PGRST205/42P01'de fail-open, davranış 028/029 öncesiyle aynı. Başka eksik yok. |
| KD-10 / KD-11 | hedefsiz alışkanlık **0**, boş `part_of_day` **0**, şüpheli ölçülebilir `done` **0** — backfill gerekmiyor (S4 kapanabilir) |
| Bütünlük | başka sahibin alışkanlığına bağlı log **0**; bilinmeyen `status` **0**; `is_completed` NULL log **0** |

## 2. Bulgular (önem sırasıyla)

| # | Bulgu | Kanıt (canlı) | Etki | Öneri |
|---|---|---|---|---|
| L1 | **XP / seri çiftliği (S11'in cevabı)** | `habit_logs` tetikleyicileri yalnız INSERT/UPDATE: `trg_habit_log_set_xp` (BEFORE) `NEW.xp := greatest(ödül, OLD.xp)`, `trg_habit_log_award` (AFTER) pozitif farkı `add_xp` + `track_weekly_xp` ile ekler ve "done'a geçişte" seriyi artırır. DELETE tetikleyicisi yok; `Users can delete own logs` politikası var. | Sahibi bir logu silip yeniden yazınca XP ve seri **yeniden** verilir (INSERT'te `OLD` yok); done→partial→done gidip gelmek de seriyi her seferinde artırır. Geri alma düğmesinden bağımsız, bugün API ile mümkün. | **036-A**: (alışkanlık, gün) anahtarlı ödeme defteri `habit_xp_awards`; gün yalnız en yüksek değerine kadar ödenir, seri adımı günde bir kez. Mevcut 13 log deftere aktarılır. Sonra R01.03-b (geri alma) güvenle açılabilir. |
| L2 | **Haftalık lider tablosu elle yazılabilir** | `weekly_xp`: `System can manage weekly xp` (ALL, `auth.uid() = user_id`) + `authenticated` için `xp_earned` dahil INSERT/UPDATE grant'ı | Oturum açmış kullanıcı kendi haftalık XP'sini istediği değere çeker; `get_weekly_leaderboard` bunu gösterir. Uygulama bu tabloya hiç yazmıyor. | **036-B**: politika + yazma grant'ları kaldırılır; yazan tek yol `track_weekly_xp` (SECURITY DEFINER). |
| L3 | **27 SECURITY DEFINER fonksiyon `anon` ve `authenticated` için çağrılabilir** (advisor) | `has_function_privilege` | 8'i tetikleyici fonksiyonu (doğrudan çağrılamaz — hijyen). Uygulamanın hiç çağırmadığı yazan fonksiyonlar: F13 seti (`buy_shop_item`, `claim_quest_reward`, `interact_with_pet`, `upgrade_skill`, `get_daily_quests`, `get_user_pet_status` …), eski tahsilat `spend_focus_points` (idempotent değil; uygulama `_v2` kullanıyor), `log_makeup_completion` (alışkanlık sahipliğini denetlemiyor; olmayan benzersiz anahtar ve sütun yüzünden **her çağrıda hata verip geri alınıyor** — ölü kod). `get_user_rank` / `get_weekly_leaderboard` / `get_global_leaderboard` oturumsuz çağrılabiliyor. | **036-C**: tetikleyici ve kullanılmayan fonksiyonlarda EXECUTE istemcilerden alınır; uygulamanın çağırdığı dördü yalnız `authenticated`. Tetikleyiciler EXECUTE'tan bağımsız çalışır. |
| L4 | Grant hijyeni | `user_subscriptions`: anon/authenticated için tüm sütunlarda INSERT/UPDATE grant'ı, yazma politikası **yok** (RLS reddediyor). `profiles`: INSERT tüm sütunlarda (`total_xp`, `coins` dahil); uygulama yalnız `(id, email)` ekliyor, profil kaydı zaten `handle_new_user` ile oluşuyor. | Bugün sömürülemiyor (RLS/PK), ama tek bir politika hatası FP/XP otoritesini açar. | **036-D** |
| L5 | `ai_conversation_actions.action_type` CHECK canlıda 3 tür | `pg_get_constraintdef` | Koç v2 eylemleri canlıda CHECK'e takılır | Beklenen: 032 → 034 → 035, sonra edge deploy, sonra kapı (`SQL_FOR_OWNER.md` §5) |
| L6 | `tasks` üzerinde 3 örtüşen ALL politikası | `pg_policies` | Davranış aynı (hepsi sahip yüklemi); bakım riski | Sadeleştirme ayrı küçük migration — bu denetimde yazılmadı |
| L7 | `function_search_path_mutable` 23 fonksiyon; sızdırılmış parola koruması kapalı (advisor) | `get_advisors` | Düşük | search_path sabitleme toplu bir sonraki migration; parola koruması Auth ayarı (panel) |
| L8 | F13 (RPG/pet/boss) tabloları canlıda ve verili (`user_pets` 6, `challenges` 21 …) | sayımlar | Kapsam eki: kalıcı iptal | Fonksiyonlar 036-C ile kapanır; **tablo silme önerilmedi** (veri, geri dönüşsüz) — sahip kararı |
| L9 | `habit_logs.value`, `habits.daily_goal` **integer** | `information_schema.columns` | Ondalıklı ölçüm (2,5 km) sunucuda saklanamaz | Ürün kararı; not |

**S11 kapanışı için:** gerçek tetikleyici tanımları okundu (yukarıda). 036-A uygulanıp doğrulandıktan sonra
R01.03-b (log geri alma) güvenle yazılabilir: silinen gün yeniden yazılınca XP/seri tekrar verilmez.

**`review_next_actions.task_id` riski (R10.07):** `tasks` tanımı artık görüldü (`id uuid` PK, sahip
politikaları). FK + sahiplik kontrolü, 031 uygulandıktan sonra ayrı bir migration ile eklenebilir; bu
turda yazılmadı.

## 3. Tablo tablo

| Tablo | Canlıda | Repoda (CREATE) | Kod kullanıyor | Satır | Öneri |
|---|---|---|---|---:|---|
| `ai_calls` | evet | **hayır** (S12) | hayır | 4 | kod kullanmıyor (eski özellik); silme yerine önce sahip kararı |
| `ai_conversation_actions` | evet | evet | evet | 0 | 032 → 034 → 035 (CHECK hâlâ 3 tür) |
| `ai_conversations` | evet | evet | evet | 1 | değişiklik yok |
| `ai_messages` | evet | evet | evet | 2 | değişiklik yok |
| `ai_requests` | evet | evet | dolaylı: edge `ai_request_*` RPC | 12 | değişiklik yok |
| `bad_habits` | evet | evet | evet | 0 | değişiklik yok |
| `boss_contributors` | evet | **hayır** (S12) | hayır | 0 | F13 (kalıcı iptal) artığı; fonksiyonları 036-C ile istemciye kapatılır; tablo silme ayrı sahip kararı (veri var olabilir) |
| `calendars` | evet | **hayır** (S12) | hayır | 0 | kod kullanmıyor (eski özellik); silme yerine önce sahip kararı |
| `challenges` | evet | **hayır** (S12) | hayır | 21 | F13 (kalıcı iptal) artığı; fonksiyonları 036-C ile istemciye kapatılır; tablo silme ayrı sahip kararı (veri var olabilir) |
| `credit_transactions` | evet | **hayır** (S12) | evet | 16 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `daily_capacity` | evet | evet | hayır | 0 | kod kullanmıyor (eski özellik); silme yerine önce sahip kararı |
| `deep_work_sessions` | evet | **hayır** (S12) | evet | 0 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `event_templates` | evet | **hayır** (S12) | hayır | 0 | kod kullanmıyor (eski özellik); silme yerine önce sahip kararı |
| `events` | evet | **hayır** (S12) | hayır | 0 | kod kullanmıyor (eski özellik); silme yerine önce sahip kararı |
| `focus_sessions` | evet | **hayır** (S12) | evet | 2 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `focus_tasks` | evet | **hayır** (S12) | evet | 6 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `global_bosses` | evet | **hayır** (S12) | hayır | 1 | F13 (kalıcı iptal) artığı; fonksiyonları 036-C ile istemciye kapatılır; tablo silme ayrı sahip kararı (veri var olabilir) |
| `goals` | evet | **hayır** (S12) | evet | 0 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `google_calendar_integrations` | evet | evet | evet | 0 | bilerek politikasız (sunucu-yalnız); kapı kapalı — dokunma |
| `habit_checklist_checks` | **hayır** | evet | evet — cihaz-yerel, tablo gelince sunucuya | — | 029 uygulanınca oluşur (SQL_FOR_OWNER sırası) |
| `habit_checklist_items` | **hayır** | evet | evet — cihaz-yerel, tablo gelince sunucuya | — | 029 uygulanınca oluşur (SQL_FOR_OWNER sırası) |
| `habit_deletions` | evet | **hayır** (S12) | evet | 5 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `habit_goal_versions` | **hayır** | evet | evet — cihaz-yerel, tablo gelince sunucuya | — | 028 uygulanınca oluşur (SQL_FOR_OWNER sırası) |
| `habit_logs` | evet | evet | evet | 13 | **036-A** (XP/seri ledger'ı — S11); `tz` için 033 |
| `habit_pauses` | **hayır** | evet | evet — cihaz-yerel, tablo gelince sunucuya | — | 028 uygulanınca oluşur (SQL_FOR_OWNER sırası) |
| `habit_reminders` | evet | **hayır** (S12) | hayır | 0 | kod kullanmıyor (eski özellik); silme yerine önce sahip kararı |
| `habit_templates` | evet | **hayır** (S12) | hayır | 800 | 800 satırlık katalog; kod `.from` ile okumuyor — kullanım dışı mı, sahip kararı |
| `habits` | evet | evet | evet | 7 | değişiklik yok |
| `journal_entries` | evet | **hayır** (S12) | evet | 7 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `journal_insights` | evet | **hayır** (S12) | evet | 0 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `key_results` | evet | **hayır** (S12) | evet | 0 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `life_area_logs` | evet | **hayır** (S12) | evet | 0 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `monthly_reviews` | evet | evet | evet | 0 | değişiklik yok |
| `mood_checkins` | **hayır** | evet | evet — cihaz-yerel, tablo gelince sunucuya | — | 031 uygulanınca oluşur (SQL_FOR_OWNER sırası) |
| `mood_definitions` | **hayır** | evet | evet — cihaz-yerel, tablo gelince sunucuya | — | 031 uygulanınca oluşur (SQL_FOR_OWNER sırası) |
| `notes` | evet | **hayır** (S12) | evet | 0 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `notion_integrations` | evet | evet | evet | 0 | kapı kapalı (`NOTION_INTEGRATION_ENABLED=false`) — dokunma |
| `okrs` | evet | **hayır** (S12) | evet | 0 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `pet_stages` | evet | **hayır** (S12) | hayır | 5 | F13 (kalıcı iptal) artığı; fonksiyonları 036-C ile istemciye kapatılır; tablo silme ayrı sahip kararı (veri var olabilir) |
| `profile_badges` | evet | **hayır** (S12) | evet | 3 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `profiles` | evet | **hayır** (S12) | evet | 6 | **036-D**: INSERT'i `(id, email, username)` sütunlarına daralt |
| `projects` | evet | **hayır** (S12) | evet | 0 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `quests` | evet | **hayır** (S12) | hayır | 4 | F13 (kalıcı iptal) artığı; fonksiyonları 036-C ile istemciye kapatılır; tablo silme ayrı sahip kararı (veri var olabilir) |
| `reading_list` | evet | **hayır** (S12) | evet | 0 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `recovery_plans` | evet | **hayır** (S12) | evet | 0 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `reminders` | evet | **hayır** (S12) | hayır | 0 | kod kullanmıyor (eski özellik); silme yerine önce sahip kararı |
| `review_next_actions` | **hayır** | evet | evet — cihaz-yerel, tablo gelince sunucuya | — | 031 uygulanınca oluşur (SQL_FOR_OWNER sırası) |
| `routine_items` | evet | evet | hayır | 0 | kod kullanmıyor (eski özellik); silme yerine önce sahip kararı |
| `routine_sessions` | **hayır** | evet | evet — cihaz-yerel, tablo gelince sunucuya | — | 030 uygulanınca oluşur (SQL_FOR_OWNER sırası) |
| `routine_template_versions` | **hayır** | evet | evet — cihaz-yerel, tablo gelince sunucuya | — | 030 uygulanınca oluşur (SQL_FOR_OWNER sırası) |
| `routine_templates` | **hayır** | evet | evet — cihaz-yerel, tablo gelince sunucuya | — | 030 uygulanınca oluşur (SQL_FOR_OWNER sırası) |
| `routines` | evet | evet | evet | 0 | değişiklik yok |
| `shop_items` | evet | **hayır** (S12) | hayır | 4 | F13 (kalıcı iptal) artığı; fonksiyonları 036-C ile istemciye kapatılır; tablo silme ayrı sahip kararı (veri var olabilir) |
| `skills` | evet | **hayır** (S12) | hayır | 3 | F13 (kalıcı iptal) artığı; fonksiyonları 036-C ile istemciye kapatılır; tablo silme ayrı sahip kararı (veri var olabilir) |
| `spotify_accounts` | evet | **hayır** (S12) | evet | 0 | bilerek politikasız (sunucu-yalnız); kapı kapalı — dokunma |
| `tasks` | evet | **hayır** (S12) | evet | 0 | 3 örtüşen ALL politikası (`tasks_own`, `Users can manage own tasks`, `Users can CRUD own tasks`) — tek politikaya indirgeme ayrı karar; `review_next_actions.task_id` FK'sı artık eklenebilir (tanım görüldü) |
| `user_challenges` | evet | **hayır** (S12) | hayır | 0 | F13 (kalıcı iptal) artığı; fonksiyonları 036-C ile istemciye kapatılır; tablo silme ayrı sahip kararı (veri var olabilir) |
| `user_gamification` | evet | **hayır** (S12) | hayır | 1 | F13 (kalıcı iptal) artığı; fonksiyonları 036-C ile istemciye kapatılır; tablo silme ayrı sahip kararı (veri var olabilir) |
| `user_inventory` | evet | **hayır** (S12) | hayır | 0 | F13 (kalıcı iptal) artığı; fonksiyonları 036-C ile istemciye kapatılır; tablo silme ayrı sahip kararı (veri var olabilir) |
| `user_onboarding` | evet | evet | evet | 6 | değişiklik yok |
| `user_pets` | evet | **hayır** (S12) | hayır | 6 | F13 (kalıcı iptal) artığı; fonksiyonları 036-C ile istemciye kapatılır; tablo silme ayrı sahip kararı (veri var olabilir) |
| `user_quests` | evet | **hayır** (S12) | hayır | 3 | F13 (kalıcı iptal) artığı; fonksiyonları 036-C ile istemciye kapatılır; tablo silme ayrı sahip kararı (veri var olabilir) |
| `user_skills` | evet | **hayır** (S12) | hayır | 0 | F13 (kalıcı iptal) artığı; fonksiyonları 036-C ile istemciye kapatılır; tablo silme ayrı sahip kararı (veri var olabilir) |
| `user_subscriptions` | evet | **hayır** (S12) | evet | 3 | **036-D**: yazma grant'larını kaldır (RLS zaten reddediyor) |
| `webhooks` | evet | evet | evet | 0 | değişiklik yok |
| `weekly_reviews` | evet | **hayır** (S12) | evet | 0 | tanımı yalnız canlıda ve `supabase/live_schema.sql` dökümünde — repoya taban migration olarak alınmalı (S12) |
| `weekly_xp` | evet | **hayır** (S12) | dolaylı: leaderboard RPC + `track_weekly_xp` | 1 | **036-B**: istemci yazma politikası + grant'ları kaldır (kendi skorunu yazabiliyor) |
| `willpower_state` | evet | evet | evet | 29 | 29 satır / 6 kullanıcı (gün başına satır) — beklenen |

Okuma: "Repoda (CREATE)" = `supabase/migrations/001..035` içinde tablo tanımı var mı. "**hayır** (S12)"
tabloları canlıda var ama repodan kurulamaz; tek kaynak `supabase/live_schema.sql` dökümü.

## 4. Kullanılan sorgular (hepsi salt-okunur)

- satır sayıları: her tablo için `select count(*)` (planlayıcı tahmini değil)
- fonksiyon/tetikleyici: `pg_get_functiondef`, `pg_get_triggerdef`, `has_function_privilege`
- politika ve grant: `pg_policies`, `information_schema.column_privileges`
- kısıtlar/indeksler: `pg_constraint`, `pg_index` + `pg_get_indexdef`
- KD-10/11: `SQL_FOR_OWNER.md` §4 sorgularının aynısı

## 5. Sıradaki (sahip)

1. 036'yı **bir Supabase branch'inde** dene (yazıldı, hiç çalıştırılmadı); sonra canlıya, 028–035 sırasından bağımsız.
2. 036 sonrası doğrulama: `SQL_FOR_OWNER.md` §2.9.
3. `supabase/live_schema.sql`'i repoya taban şema olarak alma kararı (S12'yi kapatır).
