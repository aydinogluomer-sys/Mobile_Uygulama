# Geri alma betikleri (`supabase/rollbacks/`)

**Durum: YAZILDI, UYGULANMADI.** Buradaki hiçbir betik canlı veritabanında çalıştırılmadı ve ajan
tarafından çalıştırılamaz (OD-02: SQL'i sahip uygular). Betikler `db-migrations-verify` işinin geçici
Postgres 17 hizmetinde sınanmak üzere bağlanmıştır; ilk gerçek CI koşusu sahip dalı taşıyınca olur
(OD-21), o zamana kadar yalnız yerel tek kullanımlık Postgres 17'de koşturulmuştur.

## Amaç

`supabase/migrations/028` ile `043` arasındaki on altı migration ileri yönde yazılmıştır ve canlıda
uygulanmamıştır. Sahip birini bir Supabase branch'inde ya da canlıda uygulayıp bir sorun görürse,
elinde sınanmış bir geri dönüş yolu olmalıdır. Her migration için bir geri alma betiği, CI'da
"ileri uygula, sondan başa geri al, kataloğu baştakiyle karşılaştır, yeniden ileri uygula" döngüsüyle
sınanır. Migration dosyalarının kendisi değişmez; salt-okunur referanstır.

## Adlandırma

`NNN_<migration_adı>.rollback.sql`: gövde, geri alınan migration dosyasının adıyla aynıdır
(`036_live_audit_hardening.sql` için `036_live_audit_hardening.rollback.sql`). Bu dizinde yalnız bu
dosyalar, `catalog_fingerprint.sql` ve bu README bulunur; eşi olmayan betik `migrationRollbackPresent`
guard'ını kırar. Eşleşme, migration dosyalarının `NNN_` önekini koruduğu sürece geçerlidir:
`docs/implementation-v3/MIGRATION_MAPPING.md` önerisindeki zaman damgalı adlara geçilirse (sahip kararı)
betikler ve guard aynı commit'te yeniden adlandırılır.

## Neden `supabase/migrations/` dışında

Supabase CLI ve `migrationRlsGuard.test.ts` o dizini tarar. Bir geri alma betiği orada dursa CLI onu
**ileri** migration sayıp uygulardı: en tehlikeli hata sınıfı. Bu yüzden betikler burada durur ve
`migrationRlsGuard.test.ts` migrations dizininde adında `rollback` geçen dosya bulunmasını reddeder
(tek istisna `014_recovery_vocabulary_compat_rollback.sql`: canlıya uygulanmış bir ileri migration).

## Onay sözleşmesi: `aderyth.rollback_confirm`

Her betik `BEGIN;` ile başlar, `COMMIT;` ile biter (tek transaction) ve ilk işi oturum değişkeni
`aderyth.rollback_confirm` değerinin **kendi migration numarasına eşit** olduğunu denetlemektir. Değer
yoksa ya da başka bir numaraysa betik `P0001` ile durur ve hiçbir şey değiştirmez. Numaranın betiğe
özel olması, bir betiğin onayının bir sonrakine sızmasını engeller.

Aynı oturumda, önce onay, sonra dosya:

```bash
psql <bağlantı> -X -v ON_ERROR_STOP=1 \
  -c "SET aderyth.rollback_confirm = '036'" \
  -f supabase/rollbacks/036_live_audit_hardening.rollback.sql
```

Supabase SQL editöründe `SET` satırı ile betiğin tamamı **aynı çalıştırmada** (tek "Run") olmalıdır:
editör ayrı çalıştırmalar için ayrı bağlantı kullanabilir ve oturum değişkeni onlar arasında
taşınmayabilir.

```sql
SET aderyth.rollback_confirm = '036';
-- ardından 036_live_audit_hardening.rollback.sql dosyasının tamamı
```

Bir hata görürseniz hiçbir değişiklik uygulanmamıştır (tek transaction); oturumda açık kalmış bir
transaction varsa `ROLLBACK;` çalıştırın. Betikler `DROP TABLE` ile `ACCESS EXCLUSIVE` kilidi alır ve
geri alma sırasında istemci yazmaları bekler; bakım penceresinde çalıştırın. İsterseniz aynı oturumda
önce `SET lock_timeout = '10s';` verin: kilit alınamazsa betik değişiklik yapmadan düşer.

Oturum değişkeni aynı bağlantıda kalmalıdır: işlem modunda çalışan bir bağlantı havuzu (transaction
pooler) `SET` ifadesini sonraki ifadelere taşımayabilir. O durumda betik onay göremez ve güvenli
biçimde reddeder; doğrudan bağlantı ya da SQL editörü kullanın.

Hiçbir betikte `DROP ... CASCADE` biçimi, `DROP SCHEMA` ya da `auth.` şemasında değişiklik yoktur.
(Bir dış anahtarı yeniden kuran `ON DELETE CASCADE` eylemi bu yasağın dışındadır.)

## Her geri almadan önce ve sonra

```sql
select * from public.xp_drift();   -- 0 satır beklenir
```

Yıkıcı betikler (028, 029, 030, 031, 033 veri siler; 036 ve 040 güvenlik açıklarını, 038 XP pencere, tavan ve
seri açıklarını yeniden açar) yedek ister
(S1). Ayrıntılı salt-okunur sorgular `docs/implementation-v3/SQL_FOR_OWNER.md` §2.10'dadır.

## Betikler ve sıra

Sıra **büyükten küçüğe**: 043, 042, 041, 040, 039, 038, 037, 036, 035, 034, 033, 032, 031, 030, 029, 028.

| Betik | Geri aldığı migration | Etkisi | Veri kaybı |
| --- | --- | --- | --- |
| `043_profile_time_zone.rollback.sql` | `043_profile_time_zone.sql` | `profiles.time_zone`, `profiles_time_zone_check`, `set_profile_time_zone`, `local_date_in_zone` ve `week_start_in_zone` düşer; `fn_habit_log_guard`, `track_weekly_xp` ve `get_weekly_leaderboard` 043 öncesi UTC gövdelerine döner | kayıtlı IANA saat dilimi adları silinir (uygulama bir sonraki açılışta yeniden bildirir; XP ve defter değişmez) |
| `042_numeric_measures_and_willpower.rollback.sql` | `042_numeric_measures_and_willpower.sql` | `habit_logs.value` ve `habits.daily_goal` `integer` tipine döner, `habit_xp_value(uuid, text, integer)` canlı gövdesiyle geri gelir, `habit_xp_value(uuid, text, numeric)` ve `spend_willpower` düşer | **kayıplı**: ondalık `value` ve `daily_goal` değerleri en yakın tam sayıya yuvarlanır (XP ve defter değişmez) |
| `041_rls_initplan_and_indexes.rollback.sql` | `041_rls_initplan_and_indexes.sql` | 45 politika satır-başı `auth.uid()`/`auth.role()` biçimine döner, 5 kopya politika geri gelir (`weekly_xp` P0 yazma politikası bilerek geri getirilmez), `tasks_parent_task_id_fkey` `ON DELETE` kuralsız haline döner, 26 FK indeksi düşer, `idx_habit_logs_habit_date` geri gelir | yok (yalnız performans/katalog değişikliği) |
| `040_privilege_hygiene.rollback.sql` | `040_privilege_hygiene.sql` | 6 F13 tablosu `archive_f13`'ten `public`'e döner, düşürülen zombi tetikleyiciler (`archive_040.dropped_triggers`), 8 fonksiyon gövdesi (F07-R3 dahil), onarılmış kullanıcı adları (`archive_040.profiles_username_backup`), 20 `search_path` sabitlemesi ve tüm `public` tablo/sütun/fonksiyon/varsayılan ACL'leri `archive_040.acl_snapshot`'tan 039 sonrası duruma döner | yok; boş `archive_040` ve `archive_f13` şemaları yerinde kalır; **güvenlik açıklarını yeniden açar** |
| `039_focus_point_hardening.rollback.sql` | `039_focus_point_hardening.sql` | `ai_messages_user_request_uniq` düşer | yok; 039'un sildiği yinelenen kullanıcı mesajları ve yazdığı iadeler geri alınmaz, `spend_focus_points(integer, text)` REVOKE'u 036'ya da aittir (gerekçe betiğin başında) |
| `038_xp_streak_integrity.rollback.sql` | `038_xp_streak_integrity.sql` | gün penceresi, günlük XP tavanı, seri sütunu koruması ve silmede `purged_xp` aktarımı düşer; `fn_habit_log_set_xp` canlı, `fn_habit_log_award` 036 gövdesine döner; boss tetikleyicisi geri gelir | ad parmak izleri, silinmiş alışkanlıkların defter satırları, 038 döneminde silinip yeniden yazılmış günlerin en yüksek ödül işareti; **XP sahteciliğini yeniden açar** |
| `037_today_bootstrap_rpc.rollback.sql` | `037_today_bootstrap_rpc.sql` | `get_today_bootstrap(date)` düşer; istemci tablo okumalarına düşer | yok |
| `036_live_audit_hardening.rollback.sql` | `036_live_audit_hardening.sql` | defter düşer, `fn_habit_log_award` canlı gövdesine döner, `weekly_xp` yazımı ve istemci EXECUTE hakları yeniden açılır | defter satırları (gün başına en yüksek ödül); **güvenlik açıklarını yeniden açar** |
| `035_coach_lighten_week.rollback.sql` | `035_coach_lighten_week.sql` | CHECK 9 türe döner (`lighten_week` çıkar) | yok (satır silinmez, `NOT VALID`) |
| `034_coach_reminder_action.rollback.sql` | `034_coach_reminder_action.sql` | CHECK 8 türe döner (`edit_reminder_time` çıkar) | yok (satır silinmez, `NOT VALID`) |
| `033_habit_log_timezone.rollback.sql` | `033_habit_log_timezone.sql` | `habit_logs.tz` ve kısıtı düşer | log başına IANA saat dilimi |
| `032_coach_actions_v2.rollback.sql` | `032_coach_actions_v2.sql` | CHECK 3 türe döner | yok (satır silinmez, `NOT VALID`) |
| `031_moods_and_review_actions.rollback.sql` | `031_moods_and_review_actions.sql` | `review_next_actions`, `mood_checkins`, `mood_definitions` düşer | adlı duygular, check-in'ler, haftalık sonraki eylemler |
| `030_routine_runner.rollback.sql` | `030_routine_runner.sql` | `routine_sessions`, `routine_template_versions`, `routine_templates` düşer | şablonlar, sürümler, oturumlar |
| `029_habit_checklists.rollback.sql` | `029_habit_checklists.sql` | `habit_checklist_checks`, `habit_checklist_items` düşer | checklist maddeleri ve günlük işaretler |
| `028_habit_pauses_and_goal_versions.rollback.sql` | `028_habit_pauses_and_goal_versions.sql` | `habit_goal_versions`, `habit_pauses` düşer | duraklatma, tatil ve hedef sürümü satırları |

Zorunlu sıra kısıtları şunlardır:

- **041'den sonra 040, 039/038/036'dan önce geri alınır.** 041 geri alması politikaları `public` ve `archive_f13` içinde eski haline çevirir; 040 ACL anlık görüntüsünü (`archive_040.acl_snapshot`) 039 sonrasında aldığı için 039, 038 ya da 036'dan önce geri alınmalıdır.
- **036'dan önce 038 geri alınır.** 038 defteri kullanır; `fn_habit_log_guard` varken 036 betiği
  reddeder (`038 is still applied`).
- **035, sonra 034, sonra 032.** CHECK listesi her adımda küçülür; sıra bozulursa son çalışan
  betiğin listesi kazanır. CI sıralı çalıştırır.

028 ve 029 ile 037 arasında bağımlılık yoktur: 037 bu tabloları `to_regclass` ile dinamik denetler.

## Güvenli yeniden çalıştırma

028, 029, 030, 031, 033, 037, 039 ve 041 `IF EXISTS` / `IF NOT EXISTS` ve idempotent politika/kısıt yenilemesi kullanır: ikinci çalıştırma no-op'tur. 032, 034 ve 035
aynı kısıtı yeniden kurar. **036 ikinci çalıştırmada reddeder** (`036 is not applied`): defter yoksa 036
uygulanmamış sayılır ve böyle bir veritabanına `TO PUBLIC` hakları vermemek bilinçli bir güvencedir.
**038 de ikinci çalıştırmada reddeder** (`038 is not applied`, `fn_habit_log_guard` yoksa): 038'in
geri alması ödül tetikleyicisine 036'nın defter yazan gövdesini verir; 036 da geri alınmışsa bu gövde
her log yazımını kırardı. **040 da ikinci çalıştırmada reddeder** (`040 is not applied`,
`archive_040.acl_snapshot` yoksa): anlık görüntü olmadan ACL tahmini yapmaz.
**043 de ikinci çalıştırmada reddeder** (`043 is not applied`, `profiles.time_zone` yoksa): 038 ve 040
geri alınmışken eski fonksiyon gövdelerini taban veritabanında yeniden yaratmamak için.

## Neyi geri almaz

- Yeniden ileri uygulama silinen satırları geri getirmez; tablolar boş gelir. Önce yedek alın (S1).
- 036 geri alması `profiles.purged_xp` aktarımını geri almaz: defterde kayıtlı ama `habit_logs`'ta
  karşılığı olmayan XP (silinip daha düşük XP ile yeniden yazılmış gün), defter düşmeden önce
  `purged_xp`'ye taşınır ki `total_xp = sum(habit_logs.xp) + purged_xp` geçerli kalsın ve
  `xp_drift()` o kullanıcıyı raporlamasın (DB2-07). Betik sonunda kendi içinde doğrular: geri alma
  yeni bir "drift'li kullanıcı" üretecekse tüm transaction geri sarılır.
- 038 geri alması seri yeniden hesabını (038 bölüm 9) geri almaz: eski "ömür boyu geçiş sayacı" zaten
  yanlıştı.
- 038 geri alması defteri `habit_logs`'un taşıdığı değere indirir. 038 altında silinen bir logun XP'si
  silindiği anda `purged_xp`'ye taşınır; defter fazlası bu yüzden zaten hesaptadır. İndirilmezse 036
  geri alması aynı fazlayı ikinci kez `purged_xp`'ye taşır ve kendi drift denetimiyle reddeder. Bedeli:
  038 döneminde silinmiş bir gün, yalnız 036 kalınca yeniden yazılırsa yeniden ödenir; defter dengede
  kalır (`xp_drift()` boş).
- 036 geri alması `interact_with_pet`, `upgrade_skill`, `buy_shop_item`, `claim_quest_reward` ve
  öteki uykudaki RPG RPC'lerine yalnız 036 öncesindeki canlı EXECUTE haklarını geri verir. İstemcide
  bunlar için yüzey yoktur ve olmayacaktır (kapsam eki F13, kalıcı iptal).

## CI döngüsü (`db-migrations-verify`)

`catalog_fingerprint.sql`, `public` şemasının katalog özetini (tablo, RLS bayrakları ve ACL, sütun,
sütun ACL, kısıt, indeks, politika, tetikleyici, fonksiyon imzası/ACL/gövde özeti) deterministik,
sıralı satırlar olarak yazar. CI sırayla:

1. `live_schema.sql` uygulanır, **taban parmak izi** alınır (037 ve 028+ öncesi).
2. 037 ön denetimi; 036'sız veritabanında 038'in ilk ifadesinde durduğu ve katalogu değiştirmediği
   (olumsuz kontrol); 028+ ileri uygulama ve `supabase/tests/run.sh` (F01, F03'ün 06 testi dahil).
3. **İleri parmak izi** alınır; her betik onaysız ve başka bir numarayla reddettirilir (olumsuz
   kontroller). Hatada durmayan bir istemci de (`ON_ERROR_STOP` yok) denenir: başarısız onay bloğu
   transaction'ı iptal durumunda bırakır, sonraki ifadeler reddedilir, `COMMIT` geri sarar. Reddedilen
   denemeler katalogu değiştirmez.
4. 041'den 028'e, her betik kendi `SET aderyth.rollback_confirm` değeriyle geri alınır.
5. Geri alınmış katalog tabanla `diff -u` ile karşılaştırılır, `xp_drift()` 0 satır olmalıdır.
6. İkinci geri alma turu hiçbir şeyi değiştirmez (036, 038 ve 040 reddeder).
7. Yeniden ileri uygulama; ikinci ileri parmak izi ilkine eşit olmalı, `run.sh` yeniden yeşil olmalıdır.
8. Gerçek XP satırlarıyla 036 geri alması (DB2-07): önce 038 geri alınır; defterde `habit_logs`'tan
   fazla XP varken `xp_drift()` geri almadan sonra 0 satırdır; aynı XP zaten elle düzeltilmişse betik
   reddeder. Sonda 036 ve 038 yeniden uygulanır.
9. Gerçek XP satırlarıyla 038 sonra 036 geri alması (F03): 038 altında silinmiş, silinip yeniden yazılmış
   ve aynı adla yeniden oluşturulmuş alışkanlık günleri; iki geri almadan sonra `xp_drift()` 0 satırdır ve
   `purged_xp` değişmez (ikinci aktarım yok).
10. Kasıtlı yeni türde satırla 032/034/035: satır silinmez, kısıt `NOT VALID` kalır ve yalnız yeni
    yazımları denetler.
11. Parmak izi öz-sınaması: hiç dokunulmamış bir ACL (NULL) ile REVOKE edilip geri GRANT edilmiş ACL
    (açık varsayılan) aynı satırı basar. Betiklerin dokunduğu nesnelerin hepsi `live_schema.sql`'de
    zaten açık ACL taşır, bu yüzden bu özelliği döngü göstermez; geçici bir tablo ve fonksiyon gösterir.

Parmak izini elle de alabilirsiniz (salt-okunur): `psql <bağlantı> -X -At -f supabase/rollbacks/catalog_fingerprint.sql`.
Bir Supabase branch'inde geri almadan önce ve sonra iki çıktıyı `diff` ile karşılaştırmak, betiğin o
veritabanında da tabanı geri getirdiğini gösterir.
