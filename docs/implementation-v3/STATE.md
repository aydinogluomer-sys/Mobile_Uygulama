# Implementation v3 — STATE

```yaml
implementation_version: 3.0
baseline_sha: 0ff1c74b0d8d922fd9bef46d3631a1cf443677e2
guide_commit: ecfd4e3            # docs/plan/22_ADERYTH_CORE_IMPLEMENTATION_V3.md, verbatim
scope_authority: docs/plan/21_KAPSAM_EKI_2026-09-13.md
# 2026-10-07 — PDF 'Aderyth Çekirdek Kapsam ve Budama' sahip tarafından verildi ve
# mevcut teknik borç envanteriyle birleştirilerek F01->F08 faz planına dönüştürüldü.
# ÇELİŞKİ ÇÖZÜMÜ (sahip kararı): kapsam eki geçerli -- PDF'in F04'teki widget /
# Live Activities / kilit ekranı maddeleri ERTELENMİŞ kalır; PDF'in geri kalanı
# (F13/F14/F15/F12 iptalleri, 5 sütun, faz sırası) uygulanır.
core_plan: P0..P9 (F01 kalanı -> F02 -> F03 sync -> F05 runner -> F04 bildirim -> F06 günlük -> F07 yedek -> F08 AI -> kapanış)
db_state: FROZEN  # üretim DB'si 2026-10-03'te boş bulundu; sahip yedek kontrolü bitene kadar
schema_reproducible_from_repo: NO  # 2026-10-07 tespiti -- KRİTİK:
  # supabase/migrations/001..027 TAM ŞEMA DEĞİL, uzakta elle kurulmuş bir temelin
  # üstüne deltalar. Repoda CREATE TABLE edilen yalnız ~17 tablo var (habits,
  # habit_logs, willpower_state, routines, routine_items, notion/gcal integrations,
  # daily_capacity, bad_habits, webhooks, monthly_reviews, user_onboarding,
  # ai_requests, ai_conversations, ai_messages, ai_conversation_actions).
  # TANIMSIZ (uygulama kullanıyor): profiles, tasks, goals, journal_entries,
  # weekly_reviews, journal_insights, focus_sessions, focus_tasks,
  # deep_work_sessions, recovery_plans, credit_transactions ve diğerleri.
  # TANIMSIZ fonksiyon/tetikleyici: fn_habit_log_set_xp, fn_habit_log_award,
  # add_xp (XP), FP RPC'leri. Migration dışında tek .sql dosyası da yok.
  # SONUÇ: boş DB'ye 001..027 uygulamak ÇALIŞAN uygulama VERMEZ. Supabase yedeği
  # şemanın kendisini kurtarmanın tek yolu. Yedek yoksa şema uygulama kodundan
  # (lib/supabase.ts tipleri, repository select'leri, edge functions, RLS
  # matrisi dokümanı) yeniden türetilmeli -- ayrı, büyük ve riskli bir faz.
  # 2026-10-03'te 'şema repodan kurulabilir' denmişti; YANLIŞTI, bu kayıt düzeltir.
                  # Supabase'e yazma/okuma YOK. Migration dosyaları yazılır, UYGULANMAZ.

newer_owner_decision: 2026-10-07  # PDF 'Çekirdek Kapsam ve Budama' + dört karar:
  # 1) kapsam çelişkisinde 2026-09-13 eki geçerli (widget/Live Activity ERTELENMİŞ kalır)
  # 2) DB dondurulur, sahip yedeği kontrol edecek
  # 3) KD-12: telafide ölçülebilir 'yaptım' ölçüm modalını açar, değer uydurulmaz
  # 4) KD-01: countDueDays + isDueOn count dalı DURUR, guard testi yeterli

active_plan: CORE_AUDIT.md   # 2026-10-07: tam R00..R11 denetimi; önceki 'tamamlandı' iddiası alt kümeye dayalıydı ve geri çekildi
completed_cards: [R00.01, R00.02, R00.03, R00.04, R00.05, R00.06, R00.07, R01.01-a, R01.02-a, R01.02-b, R01.06-a, R01.02-c, R01.02-d1, R01.02-d, R01.02-d2, R01.02-e, R01.03-a]
active_card: null
next_ready_card: R01.03-b   # undo: a day back to "no record" (habitLogRepository has insert/update, NO delete) -- new capability + UI. R01.03-a (value = day total, state from the service) DONE. Open, not blocking: KD-08..KD-12, R01.06-b
critical_open_defects: []         # bilinen kusurlar kartlara bağlı; veri kaybı / hesap erişimi / FP kusuru yok
known_defects_bound_to_cards:
  - id: KD-01
    status: NEUTRALISED (kod duruyor, canlı girdisi yok)
    where: frontend/lib/habitSchedule.ts countDueDays + isDueOn count dalı
    what: R01.02-b sonrası HİÇBİR üretim çağıranı count-tabanlı alışkanlığı `isDueOn`'a veremiyor (her çağıran önce guard'lıyor; guard = __tests__/repo/periodConsumerMigration.test.ts). Kod silinmedi -> AC-H03 testleri `isDueOn`'un count davranışını BİLEREK pinliyor ve `isDueOn` dışa açık API; dalı silmek bu test sözleşmesini yeniden yazmak demek
    r01_02_c: doğrudan üretim çağıranı kalmadı -- gün-şeridi `isEligibleOn` soruyor; `isDueOn`'u yalnız modül-içi `dueOnExtended` çağırıyor. İSTİSNA KD-06 (bugün yazılamayan kombinasyon)
    r01_02_d1: KD-06 istisnası KAPANDI -- aralık artık şekil değil zarf; weekly+count+range `weekly_count` sınıflanır ve count guard'larına takılır. `dueOnExtended` içinde 2 isDueOn çağrısı kaldı (every_n_days temel koruma + daily/weekly_days)
    card: SAHİP KARARI bekliyor (silme = AC-H03 yeniden yazımı)
  - id: KD-02
    status: RESOLVED (R01.06-a + R01.06-b, 2026-10-07) -- Bugün artık hafta+ay penceresinin loglarını yüklüyor (reviewService.logsForPeriod, periodWindowStart: önceki aya taşan haftayı da kapsar); dönemi BUGÜNDEN ÖNCE dolmuş sayı tabanlı alışkanlık listeden ve paydadan çıkıp soluk 'BU DÖNEM TAMAM' grubuna gidiyor (hâlâ dokunulabilir, fazladan kaydedilebilir). Yalnız bugünden ÖNCEKİ loglar sayılır (carriesDayLoad ile aynı 'günün başladığı borç' kuralı) -> bugün tamamlanan habit anında kaybolmaz. Loglar yüklenmemişse/başarısızsa NULL -> R01.06-a davranışı (fail-open). Testler: lib/todayPeriodDone.test.ts (15), repo/todayPeriodDoneWired.test.ts (4). Mutasyonlar 3/3/1
    where: frontend/app/tabs/today.tsx (`selectTodayHabits`)
    what: Bugün takvimi sormuyordu; tüm aktif alışkanlıklar "kalan" sayılıyordu. Artık gün-yüzeyleri `isEligibleOn` + fail-open ile süzülüyor
    card: R01.06-a (DONE) / R01.06-b / R03.01
  - id: KD-03
    status: RESOLVED (R05.03, 2026-10-07) -- zamanlayıcı artık koşan SEGMENTLERİN toplamı (saf lib/focusTimer.ts: startClock/pauseClock/resumeClock/completedSeconds/remainingSeconds). sessionStartedAt yalnız idle->running'de yazılır; pause açık segmenti kapatır, mola aktif süreye katılmaz (20 dk iş + 5 dk mola = 20 dk). tick saatten okur (uyuyan JS thread süre kaybetmez). reset ayarlardaki süreyi kullanır (DURATIONS sabiti değil). Oturum 'focus.session.v1' anahtarında kalıcı (geçişlerde + 15 sn heartbeat); app kill sonrası restoreSession DURAKLATILMIŞ geri getirir, açık segment lastSeenAt'te kapatılır (ölü süre sayılmaz); bozuk/başka sürüm anlık görüntü düşürülür. nextPhase tek-seferlik korumalı: kayıt beklenirken gelen tick'ler ikinci focus_sessions satırı yazamaz (eski kodda yazabiliyordu). Seans içinde ayar değişse de planned_seconds seansın başladığı plan. Kapsam dışı: notifyOnFinish (R04/R05.05), deep-work ortak sözleşmesi (R05.06). Testler lib/focusTimer (11), store/focusTimerKd03 (9); focusStoreAnalytics 14/14 değişmeden yeşil. Mutasyonlar 6/6 öldü
    where: frontend/store/focusStore.ts:220,257
    what: resume `sessionStartedAt`'i yeniler; pause ayrılmaz; oturum kalıcı değil
    card: R05.03
  - id: KD-04
    status: RESOLVED (P5/R04.01, 2026-10-07) -- DAILY tetik kaldırıldı; lib/reminderPlan planı (R01 motoru: takvim, aralık, ara/tatil, hedef sürümü; dolmuş dönem, kaydı olan gün, waiting/eski-paused, gün grubu, sessiz saat, geçmiş saat elenir) önümüzdeki 7 günün TEK SEFERLİK tetiklerini verir; services/reminderService uzlaştırır. Ayrıntı: p5_r04_notifications
    where: frontend/lib/notifications.ts:82
    what: tek DAILY tetik; takvim tüketilmiyor
    card: R04.01
  - id: KD-05
    status: RESOLVED (R01.02-b)
    where: frontend/lib/supabase.ts:30, frontend/lib/habitSchedule.ts (V2 başlığı)
    what: "migration bloklu" yorumları bayattı — DB jsonb kabul ediyor, engel istemci validator'ı (routineProposal.ALLOWED_FREQUENCY_KEYS). Yorumlar doğrulanmış gerçekle değiştirildi
    card: R01.02-b (DONE)
  - id: KD-06
    status: RESOLVED (R01.02-d1) -- ikinci delik (interval_days + aralık -> aralıktaki her gün) de kapandı
    where: frontend/lib/habitSchedule.ts scheduleKind (range önce gelir) + dueOnExtended date_range dalı -> isDueOn count dalı -> countDueDays
    what: "`kind:weekly` + `count` + `range_start/end` satırı `date_range` sınıflanıyor, hiçbir count guard'ına takılmıyor; gün-şeridinde countDueDays günleri (Pzt/Çar/Cmt) icat ediliyordu, aralıkla kırpılmış (5,8,10,12,15,17,19 Ağustos). Aynı kök: `daily + interval_days:3 + aralık` interval'i kaybedip aralıktaki 18 günün hepsini due sayıyordu. Düzeltme: aralık şekilden çıkarılıp `withinLifetime` zarfına taşındı; `ScheduleKind`'dan `date_range` silindi"
    card: R01.02-d1 (DONE)
  - id: KD-07
    status: RESOLVED (R01.02-d2) -- occurrencesPerWeek interval_days okuyor (7/N); triage çarpanı tablonun kendi çapaları arasında interpolasyonla. Kayıtlı willpower_cost değerleri geriye dönük yeniden hesaplanmadı (bilerek)
    where: "frontend/lib/triage.ts costBreakdown (FREQ_FACTOR yalnız `kind`'a bakar) -> computeWillpowerCost (buildInstallRows'un yazdığı willpower_cost); frontend/lib/capacity.ts occurrencesPerWeek (daily -> 7 * (count ?? 1)) -> frequencyWeight 1.0"
    what: "İkisi de `interval_days` okumuyor: 'her 3 günde bir' alışkanlık günlük gibi FİYATLANIYOR (irade bedeli daily faktörüyle, kapasite yükü haftada 7 / ağırlık 1.0; doğrusu ~2.33 / ~0.33). Takvim doğru (R01.02-c/d1); bedel ve yük fazla. Bu kartın kapsamı dışında (triage.ts / capacity.ts) bırakıldı, düzeltilmedi"
    card: R01.02-d2 (DONE)
  - id: KD-08
    status: RESOLVED (P1, 2026-10-07) -- 5 aktivasyon kapısı (evaluateProposal, evaluateActivation, timeline/habits kapasite önizlemesi, starterPlan) aktif alışkanlıkları capacity.habitsInRangeOn(asOf) ile süzüyor; tek kural habitSchedule.isWithinRange (withinRange'in dışa açılmış hâli). Takvim UYGULANMIYOR (frequencyWeight zaten haftalık ortalama; çift sayım olurdu). Gün-yürüyüşleri zaten carriesDayLoad ile doğruydu. Kapsam dışı kalan: tarihli end_condition / gelecekteki created_at aynı kapılarda hâlâ sayılıyor (HabitLoadInput o alanları taşımıyor) ve kurulumda yazılan willpower_cost günlük yüktür, aralıktan bağımsız -- doğru. DailyLoadInput'un bayat 'isDueOn ile süz' doc'u düzeltildi. Testler: lib/capacityRangeEnvelope.test.ts (12), repo/capacityGatesRespectRange.test.ts (9). Mutasyonlar 7/3/9
    where: frontend/lib/capacity.ts occurrencesPerWeek / frequencyWeight; frontend/lib/triage.ts costBreakdown
    what: "Tarih aralığı (range_start/range_end) bedel ve yükte okunmuyor: aralığı BİTMİŞ ya da henüz BAŞLAMAMIŞ bir alışkanlık haftalık ortalama yük taşımaya devam eder. Frekans değil yaşam süresi sorusu; occurrencesPerWeek takvim günüyle değil haftalık ortalamayla çalışıyor. Gün-bazlı yük ekranları (weekly/monthly-review, insights) zaten carriesDayLoad ile aralık dışı günü saymıyor -- açık kalan: aktif-alışkanlık kapasite kapısı (canActivate) ve kurulumda yazılan willpower_cost"
    card: ayrı kart (yaşam süresi/zarf ile kapasite)
  - id: KD-09
    status: RESOLVED (P1, 2026-10-07) -- frekans kontrolleri components/FrequencyEditor.tsx'e ÇIKARILDI (HabitOnboarding'den 188 satır, kelimesi kelimesine); oluşturma formu ve habit-detail AYNI bileşeni kullanıyor. habit-detail 'Sıklık' satırında frequencySummary + düzenle butonu -> modal -> isFrequencyComplete kapısı -> lib/frequencyForm.frequencyEditPatch. Bedel kuralı: kayıtlı willpower_cost eski takvimin formül sonucuna EŞİTSE yeni takvime göre yeniden hesaplanır, DEĞİLSE kullanıcı elle seçmiştir ve korunur. habit-detail'in özel scheduleLabel'ı silindi. habitFormFrequency guard'ı yeniden hedeflendi: kontrol iddiaları FrequencyEditor'a taşındı, hiçbiri düşmedi, 2 yeni (form editöre recost'lu updateFreq veriyor; editör frequency_config'i kendisi yazmıyor). Testler: lib/frequencyEdit.test.ts (7), repo/habitDetailEditsFrequency.test.ts (4). Mutasyonlar 1/1/1/2
    where: frontend/app/screens/habit-detail.tsx (frekansı yalnız GÖSTERİR)
    what: "Kurulmuş bir alışkanlığın sıklığı (interval_days, tarih aralığı, haftada/ayda N) sonradan DEĞİŞTİRİLEMİYOR; yalnız oluşturma formu (HabitOnboarding) bunları üretebiliyor. Ayrıca habit-detail scheduleLabel kendi kind-bazlı etiketini üretiyor, lib/frequencyForm.frequencySummary kullanmıyor"
    card: ayrı kart (alışkanlık düzenleme)
  - id: KD-10
    status: OPEN -- SAYIM YAPILMADI, karar bekliyor
    where: üretim verisi, habits.frequency_config
    what: "R01.02-e öncesi form 'Aylık' için {kind:monthly} (count yok) ve hiç gün seçilmemiş 'Haftalık' için {kind:weekly, days:[]} ya da {kind:weekly} yazabiliyordu: hedefsiz satırlar (hiçbir gün due değil, raporlara girmez, Bugün'de yalnız fail-open ile görünür). Ayrıca part_of_day:[] yazılabiliyordu (validator reddeder; takvim etkilenmez). Kaç satır olduğu SAYILMADI (Supabase okuma bu kartta yapılmadı); düzeltme/backfill ayrı karar"
    card: sahip kararı (önce salt-okunur sayım, sonra backfill ya da kullanıcıya düzeltme istemi)
  - id: KD-11
    status: OPEN -- SAYIM YAPILMADI (üretim projesi INACTIVE), karar bekliyor; KD-10'un kardeşi
    where: üretim verisi, habit_logs.value (ölçülebilir alışkanlıklar)
    what: "R01.03-a öncesi timeline aynı güne İKİNCİ ölçülebilir girişte günün toplamı yerine yalnız SON girişi yazıyordu (at_least: 6 + 4 -> value 4, state done; at_most: 2 + 1 -> value 1, state done). Bu satırlarda value günün gerçek toplamından KÜÇÜK ve state ile çelişebilir. Gerçek toplam geri kazanılamaz (artımlar saklanmadı). Bu kart yalnız YENİ yazmaları düzeltir; migration/backfill yok"
    card: sahip kararı (salt-okunur tespit: ölçülebilir + state done + value < daily_goal (at_least) satırları; sonra işaretleme ya da bırakma)
  - id: KD-12
    status: RESOLVED (P1, 2026-10-07) -- sahip kararı: ölçülebilir telafide miktar SORULUR, değer uydurulmaz. recovery.tsx iki yol da makeupNeedsValue ile MeasurableInputModal'a dallanır; recoveryService.completePlanWithMakeup enteredValue+priorDayValue alır, state measuredEntryFor/stateForValue'dan gelir. Ölçülemez alışkanlık davranışı değişmedi. Testler: __tests__/services/recoveryMakeup.test.ts (17, 396 durumluk çelişki süpürmesi dahil), __tests__/repo/recoveryMakeupAsksAmount.test.ts (4). Mutasyonlar 7/1/1 kırmızı
    where: frontend/app/screens/recovery.tsx handleLogNow; frontend/services/recoveryService.ts makeupFor
    what: "Telafi yolları ölçülebilir alışkanlıkta state'i kendi seçiyor, stateForValue'dan geçmiyor: (1) geçmiş günü 'yaptım' -> state done, value YOK -> completionRatio (at_least) 0 okur: satır kendi içinde çelişir. (2) makeupFor tam telafi -> done, value yok (aynı). (3) split_two_days -> partial, value = round(hedef x 0.5): hedef 1 iken value 1 = hedef (stateForValue done der), at_most'ta value sınırın altında (stateForValue done der) -> partial ile çelişir"
    card: ayrı kart (telafi için değer sözleşmesi: 'yaptım' ölçülebilirde hedef kadar mı, değer sorulur mu -- sahip kararı)
  - id: R01.03-b
    status: BLOCKED (2026-10-07) -- DURMA NOKTASI S11. habit_logs DELETE'i RLS izin veriyor (habit_logs_self FOR ALL) AMA XP tetikleyicisi (fn_habit_log_award) yalnız POZİTİF delta ekliyor; silme XP'yi geri almıyor (012_xp_integrity.sql kendi yorumu). DELETE ile geri alma = XP çiftliği (kaydet +XP -> geri al -> kaydet +XP). Düzeltmek AFTER DELETE ile OLD.xp çıkaran sunucu tarafı değişiklik ister; fn_habit_log_award'ın TANIMI REPODA YOK (bkz. schema_reproducible_from_repo: NO), körlemesine create-or-replace mevcut davranışı ezer. Önkoşul: yedekten/uzaktan gerçek tetikleyici tanımı + migration uygulama izni (S2).
    where: frontend/repositories/habitLogRepository.ts (insertHabitLog / updateHabitLog var, delete YOK)
    what: "Bir günü 'kayıtsız'a döndürmek (geri alma) imkânsız: yanlış girilen ölçülebilir değer ancak üzerine yazılarak (ya da miss ile) düzeltilebilir; toplam sözleşmesiyle 'son girişi geri al' da yok. Yeni yetenek + UI"
    card: R01.03-b
r03_02_light_day: DONE (P2, 2026-10-07) -- Bugün ekranında 'Bugün daha az yapabilirim': kullanıcı
  bugünkü açık ritüellerden seçtiklerini AÇIK SEÇİMLE kenara koyar -> o gün için `skip` logu.
  Yeni kavram yok: skip zaten her okuyucuda 'cezasız' (§8.5) -- oranın iki tarafından dışlanır,
  seride şeffaf (ne sayar ne bozar), 0 XP. Hedef/takvim değişmez (gün bazlı). Kenara konanlar
  'BUGÜN HAFİFLETİLDİ' grubunda görünür ve dokunulunca yine de yapıldı kaydedilir. Sayfada
  kapasitenin tahmin olduğu, sağlık ölçümü olmadığı yazılı. Bulgu: üretim kodunda skip YAZAN tek
  yol bu kartla açıldı (öncesinde yalnız AI Coach). Testler lib/todayLightDay (9, sayfanın
  vaatleri motorla pinli), repo/todayLightDayWired (5). Mutasyonlar 1/3/1.
r03_05_recovery_preview: DONE (P2, 2026-10-07) -- telafi planlama sayfasında 'O GÜNÜN YÜKÜ: X -> Y / 100 · bant'.
  Taban = aktivasyon kapısı modeli (aktif alışkanlıklar haftalık ortalama, o günün aralık zarfı) +
  o güne düşen görevler + o güne zaten planlanmış telafiler. Telafi = alışkanlığın TEK uygulaması
  (capacity.oneOccurrencePoints; haftalık alışkanlığın telafisi bir seansın yedide biri değil),
  strateji payı ile (split_two_days 0.5, skip 0). yüksek/aşırı'da öneri metni. Önizleme; planı
  ENGELLEMEZ. Testler lib/makeupLoadPreview (9), repo/recoveryLoadPreviewWired (4). Mutasyonlar 1/1/1.
r05_06_duration_contract: DONE (P4, 2026-10-07) -- lib/focusDuration.ts tek süre sözleşmesi: iki kaynak
  (focus_sessions.completed_seconds, deep_work_sessions.duration_minutes) AKTİF odak süresi demek; mola
  dahil değil (pomodoro saati duraklatmada akmaz, mola fazı satır yazmaz, elle girişte 'Aktif süre
  (molalar hariç)'). secondsToMinutes reportMetrics + focusReport'un tek dönüşümü. Elle süre
  parseManualMinutes: 1..720 tam dakika, aksi REDDEDİLİR (eski repo max(0,round(x)) ile 0 dakikalık
  seans yazabiliyordu; ekran parseInt ile '60dk'yi 60, '1.5'i 1 okuyordu). Ekran kayıt başarısızsa
  sayfayı açık tutar (eskiden sessizce kapanıyordu). İki kaynak BİLEREK ayrı toplam: aynı saati hem
  pomodoro hem elle giren kullanıcı birleşik toplamda iki kez sayılırdı. Hiçbir odak yüzeyi XP vermez
  (guard). Testler lib/focusDuration (8), repo/focusDurationContract (7; eski kodda 5 kırmızı).
  Mutasyonlar 4/4.
r03_03_small_start: DONE (P2, 2026-10-07) -- Bugün'deki her açık görevde 'küçük başla' (play) ->
  SmallStartSheet: ASIL İŞ salt-okunur, İLK ADIM kullanıcı yazar (boş adım reddedilir: kısa
  zamanlayıcılı aynı görev olurdu), süre 2/5/10/15/25 dk -> focusStore.startSmallStep -> odak
  sekmesi. Adım kendi uzunluğuyla (ayar değil) KENDİ odak oturumu; bitince tek focus_sessions satırı
  adımın başlığıyla, hiçbir focus task kredilenmez/otomatik kapanmaz, mola başlamaz, ana görev HİÇ
  yazılmaz (focusStore görev katmanına erişmez -- guard). Açık oturum varken reddedilir. Duraklatma
  aktif süreye girmez (KD-03 saati); app kill sonrası adım anlık görüntüden geri gelir. Başlamadan
  hiçbir kayıt/XP/FP yok. Odak ekranı 'KÜÇÜK ADIM · N dk' + 'Asıl iş: X — bu adım onu tamamlamaz'.
  Yan düzeltme: halka ilerlemesi açık oturumun kendi planını (clock.plannedSeconds) kullanır.
  Testler lib/smallStart (10), store/focusSmallStep (10), repo/smallStartWired (6). Mutasyonlar 7/7.
r01_05_time_off_and_goal_versions: DONE-PENDING-MIGRATION (P2, 2026-10-07) -- skip / ara (pause) / tatil
  AYRI modellendi (lib/habitPauses.ts). skip = tek gün log (değişmedi). Ara = tek alışkanlık için tarih
  aralığı, tatil = habit_id NULL ile bütün alışkanlıklar. Motor tek noktadan okur: withinLifetime
  duraklatılmış günü dışlar (uygun değil, paydada yok, kaçırma değil, yük yok); periodStatus gün
  modunda 'paused'/habit_paused; sayı modunda dönem hedefi kaybedilen gün oranında YUKARI yuvarlanarak
  küçülür (haftada 3, 4 gün ara -> 2), tüm dönem araysa 'paused'; streakBroken küçülmüş hedef + kalan
  çalışılabilir günle. ESKİ status='paused' davranışı korunur (tarihsiz, geçmişi de gizler -- test
  bunu karşıtlık olarak pinler); yeni aralar geçmişe dokunmaz. Hedef sürümleme: habitOn(habit, gün)
  o gün geçerli frequency_config/daily_goal/target_direction'ı verir; scheduledCompletionRate aralığı
  sürüm sınırlarında böler (gün<->sayı modu geçişinde her parça kendi algoritmasıyla). İlk düzenleme
  eski config için oluşturma gününden baseline + bugünden yeni satır yazar; sürüm YALNIZ habit yazımı
  kabul edildikten sonra. Mevcut 'Duraklat' (aktif->kuyruk, irade iadesi) farklı eylem: UI'da 'Ara ver'.
  Bellek-içi alanlar (pause_intervals, goal_versions) her habits yazımından ayıklanır.
  UI: habit-detail 'Ara' satırı (ver / bitir), sıklık düzenlemede hangi günleri yargıladığı yazılı;
  Bugün 'ARADA' grubu, 'TATİL MODU' kartı + 'Birkaç gün ara: tatil modu'. TimeOffSheet atla ile
  farkı ve hedef/oran/seri/hatırlatıcı etkisini gösterir.
  MIGRATION: supabase/migrations/028_habit_pauses_and_goal_versions.sql YAZILDI, UYGULANMADI (S1/S2).
  İstemci yalnız eksik tabloda (PGRST205/42P01) fail-open: available=false, davranış R01.05 öncesiyle
  birebir, sayfa 'sunucu güncellemesini bekliyor' der ve kaydetmez. Başka hata = hata.
  KALAN: bildirimlerin aradaki alışkanlığı atlaması R04.01'e (isPausedOn hazır).
  Testler lib/habitPauses (22), lib/habitScheduleTimeOff (19), store/habitStoreTimeOff (9),
  repo/habitTimeOffWired (8). Mutasyonlar 14/14 (ilk turda 3 sağ kaldı -> ayırt eden 3 test eklendi).
r01_04_habit_checklist: DONE-PENDING-MIGRATION (P2, 2026-10-07) -- alışkanlık kontrol listesi
  (lib/habitChecklist.ts): şablon ADIMLAR (zorunlu/isteğe bağlı, sıralı, en çok 12, 80 karakter;
  silinmez ARŞİVLENİR) + GÜN ÖRNEĞİ (bir adım bir günde en çok bir kez işaretlenir). Geçmiş gün
  o gün sahip olduğu adımlarla okunur (sonradan eklenen geriye uzanmaz, sonradan arşivlenen o
  güne aittir). Gün kaydı işaretlerden türer, uygulamanın geri kalanının yazdığı durumlarla:
  tüm zorunlular -> done, bir şey işaretli ama zorunluların hepsi değil -> partial, yalnız isteğe
  bağlı adımlar varsa herhangi biri -> done, hiç işaret kalmadıysa ve gün kaydı varsa -> miss
  (Bugün'deki ikinci dokunuşla aynı; log silinemez, S11), kayıt yoksa hiçbir şey. İşaret ancak
  sunucu kabul ettikten sonra gösterilir. Görev alt listesiyle AYRI tablo/tip (guard). Bugün:
  adımı olan alışkanlığa dokunmak tek-dokunuş toggle yerine ChecklistSheet açar; habit-detail
  'Kontrol Listesi' bölümünde ChecklistEditor (ekle, zorunlu<->isteğe bağlı, kaldır=arşiv).
  MIGRATION: 029_habit_checklists.sql YAZILDI, UYGULANMADI (S1/S2); eksik tabloda fail-open,
  editör 'sunucu güncellemesini bekliyor' der. Testler lib/habitChecklist (14),
  store/habitStoreChecklist (6), repo/habitChecklistWired (8). Mutasyonlar 10/10.
p3_r02_outbox: PARTIAL (P3, 2026-10-07) -- S7'ye bağlı olmayan kısım yapıldı.
  R02.01 DONE: docs/implementation-v3/R02_OFFLINE_MATRIX.md (çekirdek yazma yolları, bugün/hedef).
  R02.02 MEASURED, DECISION OPEN (S7): AsyncStorage tek-anahtar atomik, anahtarlar arası işlem yok;
    aday expo-sqlite, EKLENMEDİ. lib/outboxStorage.OutboxStorage takas arayüzü.
  R02.03 DONE (görevler): lib/outbox.ts genel motor (operationId idempotent; aynı id farklı payload
    reddedilir; birleştirme; gönderilmemiş create+delete iptal; tombstone (son 200) geç düzenlemeyi
    düşürür; dependsOn + varlık-sırası; 'sending' işareti uçuştaki komutu birleştirme/iptalden korur).
    Yerel değişiklik + komut tek AsyncStorage anahtarına tek setItem (yerel kopya = outbox overlay).
    taskStore yerel-önce: ekle/tamamla/düzenle/sil/taşı/arşiv outbox'tan; yeniden çekme overlay ile
    gönderilmemişi kaybetmez. Görev create'i istemci uuid'si taşır (tekrar teslim 23505 = uygulandı).
  R02.04 DONE: koşucu canlı durumla çalışır (anlık görüntü değil -- gönderim sürerken eklenen
    düzenleme kaybolmuyordu -> düzeltildi), her teslimattan sonra kaydeder; offline deneme tüketmez,
    auth tüm outbox'ı duraklatır (TOKEN_REFRESHED/SIGNED_IN ile sürer), rejected üstel geri çekilme ->
    6 denemede dead, throw = rejected. flush uçuştakini bekler ve yeniden koşar (eskiden sessizce
    dönüyordu). Bugün rozeti log kuyruğu + outbox sayar; OutboxIssues dead/çakışma için 'tekrar dene /
    benimkini uygula / vazgeç' sunar.
  R02.05 DONE (görevler): güncelleme updated_at sürümüne karşı koşullu; sürüm kaymışsa ÇAKIŞMA, sessiz
    uygulanmaz -- ancak sunucu satırı zaten bizim değerlerimizi taşıyorsa (kayıp yanıt/çökme) 'uygulandı'.
    Silinmiş satıra güncelleme 'gone' (diriltme yok).
  R02.06 DONE: outbox hesap başına anahtar; koşucu HER komuttan önce oturumdaki kullanıcıyı sorar;
    repository de beklenen hesabı doğrular (fixture A->B geçişinde A'nın görevinin B'ye yazıldığını
    YAKALADI -> iki katmanda düzeltildi). Çıkışta bellek temizlenir, A'nın işi A'nın anahtarında kalır.
  R02.07 BLOCKED (S7): SQLite'a taşıma.
  R02.08 DONE (fixture): __tests__/fixtures/taskOutboxScenarios (8): uçak modu 100 karışık eylem + kill
    + ağ dönüşü, 5x yeniden teslim tek satır, kayıp yanıt sonrası öz-çakışma yok, iki cihaz çakışması +
    'benimkini uygula', silinmiş öğe geri doğmaz, hesap ayrımı, süresi dolmuş oturum. 5 ardışık koşu
    kararlı. Cihaz kanıtı N/R (S8).
  KALAN (S7 sonrası ya da sonraki fazlar): alışkanlık kaydı kuyruğunun genel outbox'a taşınması;
    kontrol listesi/ara (migration 028/029 uygulanınca), günlük taslağı (R07.01), telafi, odak oturum
    satırı outbox'a.
  Testler lib/outbox (22), services/outboxRunner (13), fixtures/taskOutboxScenarios (8),
  repo/taskOutboxWired (9); syncLifecycleWired rozet guard'ı niyetiyle yeniden hedeflendi.
  Mutasyonlar 20/20.
r05_01_a_pack_fields: DONE (P4, 2026-10-07) -- rutin paketi kurulumu paketin alanlarını KORUR. Kusur:
  routineStore.loadPack paketi doğrulama için packToProposal ile 4 alana indiriyor ve kurulum O
  indirgenmiş öneriyle yapılıyordu ("Su hedefi, 8 bardak" birimsiz/hedefsiz evet-hayır kuruluyordu;
  servis alanları zaten destekliyordu, onboarding yolu doğruydu). Artık anlamsal dört alan (unit,
  daily_goal, target_direction, frequency_config) doğrulayıcıdan geçer; ikon (doğrulanmayan, uygulama
  yazımı) stagedIcons ile kuruluma ada göre eklenir, başka kaynakta null. Test
  store/routinePackInstallKeepsFields (3; eski kodda 3/3 kırmızı).
r05_runner: DONE-PENDING-MIGRATION (P4, 2026-10-07) -- R05.01/02/04/07 + R05.05 kısmi + R05.08 şablonlar.
  lib/routineRunner.ts: ŞABLON -> değişmez ŞABLON SÜRÜMLERİ -> OTURUM anlık görüntüsü. Oturum içi
  ekle/çıkar/sırala/süre düzelt yalnız oturumu değiştirir; 'şablona uygula' ayrı açık eylem -> yeni
  sürüm (eski sürümler kalır); yerleşik şablon değişmez, kullanıcının kopyası olur. Kurallar: adımı
  yalnız kullanıcı tamamlar (süre dolması 'Süre doldu, tamamlamak sana kalmış' der, tamamlamaz);
  atlanan yapılmış sayılmaz; tamamlanan adım düzenlenebilir (done/skipped/açık); geri dönüş işareti
  korur; tamamlanınca sıradaki AÇIK adıma geçer; bitir işaretsizleri işaretsiz bırakır; aktif süre
  KD-03 saati (mola sayılmaz). Eski routines/routine_items = AI öneri geçmişi, yürütücü varlığı
  DEĞİL (guard). R05.07: alışkanlığa bağlı adım tamamlanınca mevcut kayıt yolundan oturum başına BİR
  KEZ done; ölçülebilir alışkanlık buradan ASLA kaydedilmez (KD-12). Oturumun kendisi XP vermez.
  store/routineRunnerStore: cihaz-yerel, hesap başına anahtar; app kill sonrası oturum DURAKLATILMIŞ
  döner, son kayıt anında kapatılır (15 sn heartbeat + arka plana geçişte kayıt). Ekran
  app/screens/routine-runner.tsx (sıradaki adım, sayaç, tamamla/geç/geri/duraklat/bitir, liste,
  oturumu düzenle, özet, şablona uygula); Bugün rail'inde RUTİN kartı. R05.05: ekran okuyucuya
  sıradaki adım duyurusu + süre dolunca tek titreşim; SESLİ duyuru YOK (expo-speech yeni native
  bağımlılık -> DURMA NOKTASI S13), sessiz telefon yapısı gereği sessiz. Yerleşik şablonlar: Sabah,
  Akşam, Çalışma başlangıcı. MIGRATION 030_routine_runner.sql YAZILDI, UYGULANMADI.
  Testler lib/routineRunner (16), store/routineRunnerStore (8), repo/routineRunnerWired (8).
  Mutasyonlar 11/11 (U1 'oturum şablon dizisini paylaşır' EŞDEĞER mutant: tüm oturum işlemleri yeni
  dizi/nesne üretir, paylaşım gözlemlenemez; listeden çıkarıldı). layerBoundary'de UI_ONLY'e
  gerekçesiyle eklendi.
new_stop_point_S13: expo-speech (sesli adım duyurusu, R05.05) -- yeni native bağımlılık, sahip onayı +
  development build gerekir. Onaylanmadıkça ekran okuyucu duyurusu + titreşim ile sınırlı.
p5_r04_notifications: DONE (P5, 2026-10-07; widget/Live Activity HARİÇ -- kapsam eki).
  R04.01: planlayıcı + uzlaştırma (istenen anahtar kümesi vs planlanmış; eski DAILY tetikler ve
    kopyalar iptal; telafi hatırlatıcıları/ertelemeler/tanınmayanlar dokunulmaz). Açılışta, ön planda
    (saat dilimi/DST de böylece), log ve alışkanlık listesi değişiminde çalışır; tek uçuş + bir
    yeniden koşu, her geçişte GÜNCEL alışkanlıklarla. Eski schedule/cancel/syncAll adları korunup
    'yeniden planla' isteğine çevrildi (store'lar ve testleri değişmedi).
  R04.02: reminders jsonb geriye uyumlu genişledi (times[] en çok 4, days[]; time ilk saat olarak
    kalır); ReminderEditor (habit-detail), NotificationSettingsCard (profil): sessiz saatler (gece
    yarısını aşabilir; düşen hatırlatıcı gönderilmez, ertelenmez), kilit ekranında ad gizleme, GERÇEK
    izin durumu -- izin kapalıyken 'çalışıyor' gösterilmez, bizim bekleyen tetiklerimiz temizlenir.
  R04.03: bildirim düğmeleri Tamamla / Miktar gir / 10 dk ertele / Bugünü atla; yanıt anahtarı
    (bildirim+eylem) işlenmeden ÖNCE saklanır -> iki teslim tek kayıt; ölçülebilir alışkanlık
    bildirimden ASLA 'done' yazılmaz (miktar için uygulama açılır, KD-12); eylem sonrası yeniden plan.
  R04.04: Android kanalı izin yolundan bağımsız oluşturulur (eskiden izin zaten verilmişse hiç
    oluşmuyordu); OS bekleyen limiti için en yakın 56 tutulur, kalanı 'dropped' -> sonraki çalışmada.
  R04.05: cihaz matrisi N/R (S8); hassas başlık gizleme var. Düğmeler opensAppToForeground:true
    (arka planda JS'in çalışacağı varsayılmadı).
  R04.06: konum/zincir/NFC tetikleri UI'da sunulmuyor (guard).
  Testler lib/reminderPlan (19), services/reminderService (10), repo/remindersWired (8).
  Mutasyonlar 16/16 (ilk turda S3 sağ -> 'izin geri alınınca temizlik' testi eklendi).
  Bulunan ve düzeltilen: buildReminderConfig tekrar eden saati kabul ediyordu.
p6_r07_journal_moods: DONE (P6, 2026-10-07; R07.02/R07.06 cihaz-yerel + migration 031 yazıldı, UYGULANMADI).
  R07.01: etiket (#kelime, Türkçe büyük/küçük harf birleşik), alışkanlık bağı (#alışkanlık-adı ->
    okuyucuda alışkanlığa bağlantı), hafif biçimlendirme (# başlık, - liste, **kalın**, _italik_) --
    hepsi METNİN İÇİNDE, şema değişmedi; editörde araç çubuğu, arşivde etiket süzgeci, okuyucuda
    JournalBody. ÇEVRİMDIŞI TASLAK: her düzenleme hesap+gün anahtarına yazılır, onaylı kayıtta silinir,
    farklıysa geri yüklenir. KUSUR DÜZELTİLDİ: kaydetme başarısızken ekran 'Kaydedildi' gösteriyordu
    (store sessiz dönüyordu) -> artık sonuç döner, hata söylenir, metin taslakta kalır. Tarih düğmeleri
    YYYY-MM-DD'yi UTC ayrıştırıyordu -> parseLocalDate.
  R07.02: lib/moods + store/moodStore + MoodCheckins: kullanıcının duyguları (ad/emoji/değer 1-5),
    günde çok kayıt (yoğunluk 1-3, not); KALICI KİMLİK -- yeniden adlandırma id'yi korur, her kayıt o
    anki ad/değer ANLIK GÖRÜNTÜSÜNÜ taşır ('Huzurlu (şimdi: Dingin)'); eski 1-5 sayısı builtin-1..5'e
    kalıcı eşli; yerleşikler düzenlenemez; tanımlar arşivlenir.
  R07.05: lib/moodHabitRelation + MoodHabitCard (arşivde, son 60 gün, yerel veri, FP yok): yaptığın /
    yapmadığın günlerde ortalama ruh hali; toplam <14 eşleşmiş gün ya da taraf başına <5 -> 'Yetersiz
    veri' + sayılar; skip ve kaydı olmayan negatif alışkanlık günü dışarıda; cümle 'yalnız birlikte
    görülme; yol açtığını göstermez' der (nedensellik sözcükleri test edilir). Check-in varsa günün
    ruh hali onların ortalaması.
  R07.06: NextActionPicker (haftalık review 'Gelecek hafta' altında): 'görev olarak ekle' GERÇEK görev
    (taskStore/outbox, gelecek pazartesiye) ya da 'alışkanlığı düzenle' (alışkanlık ekranı; değişiklik
    R01.05 ile sürümlü); seçim haftayla saklanır, sonraki review 'geçen hafta seçtiğin: ... — yapıldı /
    henüz yapılmadı' der.
  Testler lib/journalAndMoods (21), repo/journalP6Wired (9). Mutasyonlar 13/13. layerBoundary UI_ONLY'e
  moodStore eklendi.
p7_r08_backup: DONE-PARTIAL-BY-DESIGN (P7, 2026-10-07) -- 'tam yedek & restore' DEĞİL, dürüstçe sınırlı.
  R08.01/02: dışa aktarma biçim 3 = manifest (hesap, koleksiyon başına sayı + FNV-1a sağlaması --
    bütünlük, imza değil); sayfalar sonuna kadar (değişmedi), kesilmiş dosya geri okunmaz.
  R08.03: kuru çalıştırma (lib/restorePlan + restoreService.dryRunRestore): sürüm, manifest, hesap,
    kesilme, sayı/sağlama; koleksiyon başına eklenecek / zaten var / çakışma (hesabınki korunur) /
    bağlantısı kopuk / başka hesabın / geri yüklenmeyecek+neden. HİÇBİR ŞEY YAZILMAZ; hesap
    okunamazsa 'boş' sayılmaz, reddedilir.
  R08.04: güvenli birleştirme: yalnız eksik kimlikler eklenir, mevcut ezilmez/silinmez; ebeveyn önce
    (proje->görev), başarısız ebeveyn çocukları tutar; 50'lik parçalar arasında iptal; aynı dosya
    ikinci kez 0 ekleme; alışkanlıklar 'waiting' gelir (kapasite kapısı atlanmaz); günlük tarih başına
    tekil (aynı gün farklı kimlik = çakışma).
  R08.05: XP/FP/seviye/tier/abonelik/token/headers dosyadan ASLA alınmaz (ayıklanır, raporlanır);
    habit_logs (XP tetikleyicisi, S11), focus_sessions (puan), webhooks (başlıksız) geri yüklenemez.
  R08.06: genel CSV (görev / günlük): ayrıştırma (tırnak, ;/,), başlıktan tahmin + elle sütun eşleme,
    önizleme, rapor (geçersiz / dosyada tekrar / hesapta var), yalnız geçerli+yeni satırlar. Alışkanlık
    kaydı CSV'si YOK (XP). Habitify/Daylio dönüştürücüsü YOK (S6, gerçek anonim örnek gerekir).
  Girdi yapıştırma ile (dosya seçici yeni native bağımlılık -> DURMA NOKTASI S14).
  'Dışa aktarma bir yedek değildir' karar kapısı guard'ı (exportIsNotABackup) GEREKÇESİYLE yeniden
    hedeflendi: dışa aktarma hâlâ tek yönlü; birleştirme ayrı serviste, kuru çalıştırmadan sonra; ekran
    'tam geri yükleme yoktur' ve geri gelmeyenleri sayar; logs/focus/webhooks registry'de restorable:false.
  Testler lib/backupRestore (10), services/restoreService (6), lib/csvImport (8); exportBackup biçim 3.
  Mutasyonlar 16/16 (S4 'okunamayan hesap boş sayılır' ilk turda sağ -> test eklendi).
new_stop_point_S14: expo-document-picker (+ dosya okuma) -- dışa aktarımı dosyadan seçmek için yeni native
  bağımlılık. Onaylanmadıkça yapıştırma ile.
p8_r09_coach: DONE-GATED (P8, 2026-10-07).
  R09.02: ikinci eylem seti -- edit_habit_schedule (frequencyEditPatch, R01.05 sürümlü), pause_habit
    (tarihli ara; geçmişten başlamaz), move_task (outbox), suggest_small_step (startSmallStep, görevi
    tamamlamaz), lighten_today (R09.04; kullanıcı listeyi düzenler, yalnız bugün 'skip', hedef değişmez).
    Dört yer AYNI listeyi söyler (guard): istemci doğrulayıcı (lib/coachActionsV2), edge araç şeması +
    istem kuralları 5-9 (generate-routine KAYNAĞI; deploy = S3), DB CHECK (migration 032, YAZILDI,
    UYGULANMADI), repository satır tipi. YENİ kapı COACH_ACTIONS_V2_ENABLED = false (mevcut 5 false kapı
    değişmedi); kapalıyken bu tipler 'unknown action type' olarak reddedilir -> eski CHECK'e asla satır
    gitmez. Açma sırası: 032 uygula (S2) -> edge deploy (S3) -> kapıyı aç.
  R09.03: her koç yazımı ÖNCE hedefin parmak izini aşamalama anındakiyle karşılaştırır (alışkanlık:
    izleme/hedef/yön/birim/durum/takvim/davranış; görev: başlık/tamam/durum/tarih/updated_at). Değişmişse
    YAZMAZ (v2 kart uyarır; mevcut log yolu güncel alışkanlıkla yeniden önizler), yoksa düşürür. Eski
    davranış: log yolu aşamalamadaki anlık görüntüyle yazıyordu.
  Testler lib/coachActionsV2 (13), repo/coachV2Wired (6). Mutasyonlar 12/12, TABAN YEŞİL DOĞRULANARAK (C1 ilk turda sağ -> iki dalda
  erken dönüş guard'ı eklendi; o guard'ın ilk regex'i şablon dizgisindeki } yüzünden baştan kırmızıydı ve "öldü" sonucu geçersizdi -- tam geçit yakaladı, regex düzeltildi, koşuculara taban kontrolü eklendi).
open_owner_decision_skip_cap: AÇIK -- skip seride şeffaf olduğu için her gün kenara koyan biri seriyi
  hiçbir şey yapmadan canlı tutabilir. Spec (§8.5) bunu bilinçli 'cezasız' tanımlıyor ve bu kart
  sınır KOYMADI; UI 'serin bozulmaz ama uzamaz' diye dürüst. Haftalık skip sınırı gerekip
  gerekmediği sahip kararı. Engelleyici değil.
deferred_ids: [D01, D02, D03, D04, D05, D06, D07, D08, D09]
cancelled_ids: [X01, X02, X03]
core_implementation: IN_PROGRESS   # 2026-10-07: CORE_AUDIT.md'de PARTIAL/NOT_STARTED kartlar var; önceki DONE iddiası geri çekildi
core_quality: GATES_GREEN_DEVICE_NR   # typecheck/lint/run-tests/jest(2x)/diff-check green; device + user measurements N/R (S8)
release_readiness: DEFERRED
evidence_locations:
  - docs/implementation-v3/R10_ACCEPTANCE_REPORT.md
  - docs/implementation-v3/PR_DESCRIPTION.md
  - docs/implementation-v3/R02_OFFLINE_MATRIX.md
  - docs/implementation-v3/R00_GAP_INVENTORY.md
  - docs/implementation-v3/R00_CORE_JOURNEY_MAP.md
  - docs/implementation-v3/R00_TEST_MATRIX.md
  - docs/implementation-v3/STATE.md#r0101-a-evidence
  - docs/implementation-v3/STATE.md#r0102-a-evidence
  - docs/implementation-v3/STATE.md#r0102-b-evidence
  - docs/implementation-v3/STATE.md#r0106-a-evidence
  - docs/implementation-v3/STATE.md#r0102-c-evidence
  - docs/implementation-v3/STATE.md#r0102-d1-evidence
  - docs/implementation-v3/STATE.md#r0102-d-evidence
  - docs/implementation-v3/STATE.md#r0102-d2-evidence
  - docs/implementation-v3/STATE.md#r0102-e-evidence
  - docs/implementation-v3/STATE.md#r0103-a-evidence
gates_run_at_baseline:
  typecheck_ci: 0 errors
  lint_ci: 0 warnings
  jest_ci: 131 suites / 2056 tests
  run_tests_js: 145/145
  scope_guards: 54/54
timing:                           # R00.07 — dev / test / fix ayrı; erişim beklemesi ayrı
  R00: { dev_min: 21, test_min: 12, fix_min: 0, access_wait_min: 0, single_writer: true }
  R01.01-a: { dev_min: 25, test_min: 20, fix_min: 10, access_wait_min: 0, single_writer: true }
  R01.02-a: { dev_min: 30, test_min: 25, fix_min: 15, access_wait_min: 0, single_writer: true }   # fix: CRLF/LF karışımı, precision, import
  R01.02-b: { dev_min: 75, test_min: 60, fix_min: 30, access_wait_min: 0, single_writer: true }   # fix: kayıp flake logu, clip semantiği, bayat kendi yorumum
  R01.06-a: { access_wait_min: 0, single_writer: true }   # dev/test/fix dakikaları ölçülmedi; tahmin yazılmadı
  R01.02-c: { access_wait_min: 0, single_writer: true }   # dev/test/fix dakikaları ölçülmedi; tahmin yazılmadı
  R01.02-d1: { access_wait_min: 0, single_writer: true }  # dev/test/fix dakikaları ölçülmedi; tahmin yazılmadı. Not: önceki iki "d1 bitti" raporu bu çalışma kopyasında iz bırakmamıştı; bu koşu 3524e26'dan sıfırdan yapıldı
  R01.02-d: { access_wait_min: 0, single_writer: true }   # dev/test/fix dakikaları ölçülmedi; tahmin yazılmadı
  R01.02-d2: { access_wait_min: 0, single_writer: true }  # dev/test/fix dakikaları ölçülmedi; tahmin yazılmadı
  R01.02-e: { access_wait_min: 0, single_writer: true }   # dev/test/fix dakikaları ölçülmedi; tahmin yazılmadı
  R01.03-a: { access_wait_min: 0, single_writer: true }   # dev/test/fix dakikaları ölçülmedi; tahmin yazılmadı
```

## R01.01-a evidence

- **Branch:** `feature/r01-period-status` (from `897dee3` = origin/main)
- **Files:** `frontend/lib/habitSchedule.ts` (+274, additive: `periodStatus`, `PeriodStatus`, `PeriodUnit`, `PeriodStatusKind`, `PeriodReason`, `PeriodStatusOptions`, private `oneLogPerDay`/`amountTarget`/`unknownStatus`); `frontend/__tests__/lib/habitPeriod.test.ts` (new, 35 tests). `frontend/lib/supabase.ts` **untouched** — every input already exists (`tracking_type`, `daily_goal`, `target_direction`, `status`, `frequency_config`, `HabitLog.value`).
- **Reused, not rewritten:** `scheduleKind`, `windowFor`, `completedCountInWindow`, `dueOnExtended` (private), `ymd`, `daysBetweenLocal`; engine `state` for amount verdicts.
- **Divergences made visible in tests (not fixed here):** `isDueOn` fixed-day mapping for weekly count (T01); `isDueOn` false for monthly (T03); `isWindowSatisfied` counts rows not days (3 same-day rows → satisfied vs evaluator `in_progress`); `streakBroken` says broken where evaluator says `in_progress`/`unreachable_in_remaining_days` (complementary).
- **Basis stated in every result:** `{ timezone: 'device-local', weekStart: 'monday' }` — no per-habit column exists.
- **Mutation proof:** (1) feed raw rows to the counter → 4 cases red; (2) open count period → `closed_unmet` → 7 cases red. Both reverted; tree green.
- **Gates:** focused 8 suites 263/263 · `typecheck:ci` 0 · `lint:ci` 0 · full `jest --ci` **132/2091** (two consecutive runs; one earlier parallel run showed 3 suites red, not reproduced, names not captured — recorded as an unexplained flake next to the repo's standing worker-exit warning) · `run-tests.js` 145/145 · `git diff --check` clean.
- **Consumer behaviour changed:** none. **Data/schema impact:** none.

## R01.02-a evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `f6be768` (+ an unrelated `0828c8f` `.claude/settings.json` commit found on the branch, authored under the current session id at 06:54; not R01 work, left untouched, flagged).
- **Call-site classification (from source):** `isDueOn` is read as **obligation** everywhere — recovery backlog/consecutive-miss (`recovery.tsx:95,116`), completion denominators (`reportMetrics.ts:124`, `behaviorIntelligence.ts:228,290`, `capacity.ts` via `scheduledCompletionRate`), streaks (`behaviorIntelligence.ts:355,396`), calendar cell miss verdict (`habit-detail.tsx:174`), per-day load sets (`weekly/monthly-review`, `insights`). **No** pure-eligibility caller. Today does not call it at all (status filter only).
- **Compatibility strategy:** `isDueOn` unchanged (bridge; AC-H03 tests still pin it), `countDueDays` retained as legacy with its sole caller documented; **new** canonical `isEligibleOn` (count modes: every alive day with a target; fixed days: configured days; daily/every-N/date-range: `dueOnExtended`); lifetime guards extracted to `withinLifetime` (behaviour-identical) and shared.
- **`scheduledCompletionRate`:** count modes now go through `periodStatus` per calendar period — denominator = period target (3 / 10), never 7 or a weekday set; unique done days; partial edge periods prorated by covered days (documented approximation: a Thursday-ending 28-day window scores a Tue/Thu/Sun user 0.98, not 1.00; verdict unchanged — mastered). Day-based modes untouched.
- **Files (4 + this):** `frontend/lib/habitSchedule.ts` (+~160), `__tests__/lib/habitSchedule.test.ts` (+2 describes, 18 tests), `__tests__/lib/habitPeriod.test.ts` (+A7 describe, 3 tests), `__tests__/lib/capacity.test.ts` (+2 mastery cases). No consumer, schema or UI change.
- **Acceptance:** A1 Tue/Thu/Sun → eligible ×3, rate 3/3, `periodStatus` satisfied · A2 3 same-day → 1 · A3 open week → prorated, no miss · A4 monthly 10 → denominator 10 (not 30), 4/10 open · A5 fixed Tue/Thu identical to `isDueOn` · A6 daily/every-N/date-range fixtures pass · A7 rate ↔ `periodStatus` agree (3 cases).
- **Negative:** fixed-weekday distribution in canonical path RED; same-day dup inflating numerator RED; open period as miss RED; weekly denominator 7 RED; monthly denominator = calendar days RED (all as assertions).
- **Mutation proof:** M1 fixed `[0,2,5]` map in `isEligibleOn` → 4 red; M2 dedup removed → 6 red; M3 weekly denominator 7 → 12 red. Reverted byte-identical; green.
- **Gates:** focused 9 suites 300/300 (incl. `scopeAddendum`) · `typecheck:ci` 0 · `lint:ci` 0 · full `jest --ci` **132/2114** ×2 captured runs, no FAIL lines · `run-tests.js` 145/145 · `git diff --check` clean.
- **Flake status:** no recurrence in two captured runs; standing "worker failed to exit" warning present once, scope not widened.
- **Known remaining (separate cards):** consumer migration (R01.02-b), monthly production wiring, stale "migration bloklu" comments (KD-05), R01.03 tracking semantics, checklist (R01.04), pause/holiday intervals (R01.05), goal versioning (R01.05), timezone/week_start persistence (R01.06).

## R01.02-b evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `b155588`. `0828c8f`
  (`.claude/settings.json` -> `bypassPermissions`) is still an unrelated commit on
  this branch, not R01 work, still awaiting an owner call before any merge to main.
- **Scope taken from STATE.md's own card line** (`reportMetrics`, `recovery.tsx`,
  `weekly/monthly-review`, `insights`, `behaviorIntelligence`), plus
  `habit-detail.tsx`, which that line omits but which turned out to be the LAST
  live surface of the same defect and the blocker for the card's retirement goal.

### What each consumer now asks

| Consumer | Question it actually asks | Before | After |
|---|---|---|---|
| `reportMetrics.habitAveragePercent` / `summarizeHabitProgress` | completion denominator | day walk via `isDueOn` -> invented weekdays | count modes short-circuit to `scheduledCompletionRate` (period target) |
| `behaviorIntelligence.dueDayStats` (feeds `habitCompletionRate`, `weekdayBreakdown`, `weeklyRates`, `completionTrend`) | scheduled vs completed | same day walk | period target + unique done days |
| `behaviorIntelligence.weekdayBreakdown` | per-weekday rate | "Monday 0%" for a habit with no Monday obligation | count habits excluded -- no per-weekday claim is made |
| `behaviorIntelligence.currentStreak` / `longestStreak` | streak | consecutive due DAYS | consecutive satisfied PERIODS (`periodStreakBack` / `periodStreakLongest`); open period transparent, `closed_unmet` breaks |
| `weekly-review` / `monthly-review` / `insights` (`countOverloadDays`, `habitsDueToday`) | **how much does this day carry?** | `isDueOn` -> load on Mon/Wed/Sat | new `carriesDayLoad` -- `isDueOn` for day-based, open-and-unmet period for count-based |
| `recovery.tsx` backlog + `consecutiveMissedDue` | **was this day missed?** | phantom misses on days the user never chose | count schedules skipped: a day-level miss is undefined for them |
| `habit-detail.tsx` `dayCellFor` | per-day calendar cell | invented days painted `miss`, and a real Tuesday completion returned `not_scheduled` (work hidden from its own calendar) | a log is the only thing that gives a count day a state; unlogged owes nothing |

### Two new exports (both additive)

- `isCountBasedSchedule(habit)` -- one canonical "is a day-level verdict even
  definable?" predicate, so four call sites stop re-deriving it.
- `carriesDayLoad(habit, logs, date)` -- the load question. Day-based schedules
  delegate to `isDueOn` unchanged (pinned by a test that compares the two across
  a whole week for four shapes), so those habits cannot regress. Count-based: the
  period is open and unmet. Logs are clipped **strictly before** `date` -- the
  question is what the day BEGAN owing, because including the day's own completion
  would make exactly the days the user did the work read as free. Net effect: a
  "3 a week" habit finished Mon-Wed carries load on Mon/Tue/Wed and nothing after
  -- three loaded days for a target of three, on the days it actually happened.

### countDueDays — NOT retired, deliberately

The card asked for retirement. After the migration no production caller can pass
a count-based habit to `isDueOn`, so the branch and `countDueDays` are dead for
every real input -- pinned by `__tests__/repo/periodConsumerMigration.test.ts`.
They were still **not deleted**: the AC-H03 tests pin `isDueOn`'s count behaviour
on purpose (written before the fix and observed to fail), and `isDueOn` is
exported API. Deleting the branch means rewriting that pinned contract, which is
an owner decision rather than a side effect of a consumer-migration card. This is
the one deliberate deviation from the card and is flagged as such.

### Gates

- `typecheck:ci` 0 · `lint:ci` 0 · `run-tests.js` 145/145 · `git diff --check` clean
- full `jest --ci --maxWorkers=2` **133 suites / 2158 tests**, two consecutive
  green runs, no FAIL lines, 0 OOM markers (baseline `b155588`: 132 / 2114)
- focused 6 suites 253/253 before the screen work; new guard suite 12/12
- **Mutations** (each reverted byte-identical, sha256 verified):
  M1 `carriesDayLoad` count lane back to `isDueOn` -> 6 named red ·
  M2 clip `<` -> `<=` -> 1 red (the "began owing" case) ·
  M3 drop recovery's count guard -> 1 red ·
  M4 disable `dueDayStats`'s count branch -> 4 red ·
  M5 `habit-detail` countBased -> false -> 1 red

### Flake investigation (the card's protocol)

The R01.02-b gate went red four times before the cause was named. Verdict:
**worker/environment flake -- host memory exhaustion**, not a product regression.
Mechanism, not inference:

| Run | Workers | Tree | OOM markers | Suites that failed | Failed *tests* |
|---|---|---|---|---|---|
| 1 | 7 (default) | R01.02-b | log lost | `aiCoachActions`, `aiCoachMessages` | 2 |
| 2 | 7 | R01.02-b | 4 | `crossProjectIsolation`, `skeletonStates` | 1 |
| 3 | 2 | R01.02-b | 0 | `syncLifecycleWired` | 0 |
| 4, 5 | 2 | R01.02-b | 0 | — | 0 |
| B1 | 2 | `b155588` | 0 | — | 0 |
| B2 | 7 | `b155588` | 0 | — | 0 |
| 6 | 7 | R01.02-b | 2 | `habitStrength`, `willpowerCapacity` | 0 |

- **Nine distinct suites across four red runs, never the same set twice.** A
  product regression is deterministic; this is not.
- **Every failure is suite-level, not an assertion.** Named mechanisms:
  `FATAL ERROR: Zone Allocation failed - process out of memory` (V8 worker death),
  `A jest worker process (pid=...) was terminated by another process: signal=SIGTERM`,
  `Command failed: git ls-files` and `Command failed: grep -rl ...` (the OS
  refusing to fork a child), and a `jest-worker messageParent` circular-JSON
  crash. Runs 2 and 6 report **0 failed tests** alongside failed suites -- the
  signature of a killed worker, not of a bad expectation.
- **Host:** 7.85 GB RAM with **0.70 GB free**, 8 logical cores. Jest's default
  spawns 7 jest-expo/RNTL workers at roughly 0.3-0.6 GB each. It cannot fit.
- **Reachability:** `crossProjectIsolation`, `skeletonStates` and
  `syncLifecycleWired` are static source scanners whose project-local import
  graph is 2 modules and reaches **none** of the changed files. The two aiCoach
  suites reach `behaviorIntelligence` / `reportMetrics` by import but never
  execute them: both mock `loadReviewData` to throw, so `loadAnalyticsSummary`
  bails before any call. Every offender passes in 1-3 s in isolation.
- **Not claimed:** a red run was never reproduced at `b155588` under default
  workers (B2 was green). By then the host had freed memory, so the condition had
  eased -- the shared mechanism is the evidence, not a matched red baseline.
- **Wall time is not a usable signal on this host:** `aiCoachMessages` measured
  8.4 s / 72.1 s / 8.8 s / 5.6 s across runs. The single 90 s full run was a
  crashed-worker restart; settled runs are 28-31 s against a 46 s baseline, so
  this card carries no perf regression.
- **Follow-up for the gate, not for this card:** `--maxWorkers=2` is what this
  machine can sustain; the default is not. CI (Node 22, cloud runner) is
  unaffected and was not changed.

### Incidental

`MAX_STREAK_LOOKBACK_DAYS` (3650, documented as a DAY-step ceiling) was being
reused by the two new period-step loops, stretching "~10 years" to 70 (weekly) or
300 (monthly). Added `MAX_STREAK_LOOKBACK_PERIODS = 520` for those two; the legacy
day loop keeps the day bound. Not a live bug -- `periodStatus` returns
`closed_unmet` for an empty closed period, so the walk already stopped at the
first one -- but the bound now matches its own documentation.

### Known remaining (separate cards)

Monthly production wiring; R01.03 tracking semantics; R01.04 checklist; R01.05
pause/holiday intervals + goal versioning; R01.06 timezone/week_start
persistence; recovery's **period-deficit make-up surface** ("you were 2 short last
week") -- the day-keyed backlog list cannot express a period row, so the interim
behaviour is to offer nothing rather than a wrong-day make-up.

## R01.06-a evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `96de9be`. No new branch.
- **Files (4):** `frontend/app/tabs/today.tsx`; `frontend/__tests__/lib/todaySchedule.test.ts`
  (new, 22 tests); `frontend/__tests__/repo/todayScheduleScoped.test.ts` (new, guard,
  9 tests); this file. `lib/habitSchedule.ts` **untouched** (behaviour and text);
  `isDueOn`, `countDueDays`, AC-H03 tests untouched; `app/tabs/habits.tsx` untouched.
- **Defect (verified before the change):** `today.tsx` made zero calls to the
  schedule oracle -- `activeHabits = habits.filter(status === 'active')` was the
  list, the completed count, the percentage denominator, "N adım kaldı", the ring
  subtitle and `buildTodayNarrative`'s `totalHabits`.

### What changed on the screen

Three pure, exported selectors in `today.tsx` (no new lib file):

| Function | Question |
|---|---|
| `selectTodayHabits(habits, date)` | active ∩ (`isEligibleOn(h, date)` ∪ `isScheduleAmbiguous(h)`) |
| `summarizeTodayHabits(todayHabits, completedHabits)` | `{ total, completed, remaining, pct }` from ONE denominator; completed is counted *inside* `todayHabits`, so a log for a habit not on today's list (e.g. a Mon/Wed/Fri habit logged on Tuesday from timeline) cannot push pct over 100 or remaining below 0; `pct = 0` when `total = 0` |
| `todayHabitCopy(summary, activeCount)` | the two subtitles |

| Surface | Before | After |
|---|---|---|
| Ritüeller list (`RİTÜELLER · BUGÜN`) + its visibility condition | `activeHabits` | `todayHabits` |
| completed count | `activeHabits.filter(done)` | `todayHabits.filter(done)` |
| `habitPct` / ProgressRing / metric value | / `activeHabits.length` | `habitSummary.pct` |
| "N adım kaldı" / metric tone | `activeHabits.length - completed` | `habitSummary.remaining` / `total > 0` |
| ring subtitle `x/y tamamlandı` | y = all active | y = today's total |
| `buildTodayNarrative({ remainingHabits, totalHabits })` | all active | today's |

**The one place `activeHabits` stays, with an inline comment:** `todayHabitCopy(habitSummary,
activeHabits.length)` -- telling "no habits at all → create your first" apart from
"habits exist, none scheduled today" (new copy: `bugün planlı ritüel yok` /
`Bugün planlı ritüel yok`). Offering "create your first ritual" to someone with
five habits on their rest day would be wrong; that distinction genuinely needs
the total. It is never a denominator.

**Day input:** `parseLocalDate(todayLocal()) ?? now` -- the same local day the
screen already uses to load today's logs; weekday mapping stays inside
`habitSchedule.weekdayIndex` (no `getDay()` added; the existing `getDay()` is the
eyebrow label only, pinned by the guard).

**Why not `carriesDayLoad`:** it needs period logs; this screen only loads today's
(`fetchLogsForDate(today)`). Accepted consequence: a "3 a week" habit whose target
is met stays visible every day (it can still be logged). "Already done this week"
dimming is R01.06-b, not done here.

### Fail-open (mandatory)

`scheduleKind` classifies a `kind:'weekly'` row with neither `days` nor `count` as
`weekly_count`/`count: 0`, and `isEligibleOn` then says `false` on every day. Such
rows were visible on Bugün before this card. Hiding them would hide a loggable
habit with no surface saying so. Rule: **if the schedule is ambiguous, show it.**

Implemented on the screen side only (`isScheduleAmbiguous`), not by changing the
oracle -- the oracle's "under-count when unsure" principle is right for reports
and wrong for "what do I show". Ambiguous = count mode with target ≤ 0 (weekly
*or* monthly without a count), or fixed-day mode whose `days` holds no valid
0..6 integer index (`includes` would never match). Ambiguous rows bypass the
lifetime check too, i.e. they behave exactly as before this card.

**Behaviour change worth stating:** a habit whose dated `end_condition` has
passed (or whose `created_at` is in the future) is no longer on Bugün, because
`isEligibleOn` applies the lifetime guard. It is still listed in `habits.tsx`.

### Acceptance

| | Result | Evidence |
|---|---|---|
| A1 | Mon/Wed/Fri absent Tue, present Wed; week mask `[T,F,T,F,T,F,F]` | `todaySchedule.test.ts` A1 ×4 |
| A2 | "3 a week" present 7/7 days | A2 ×2 |
| A3 | "10 a month" present 31/31 days of Aug 2026 | A3 |
| A4 | `interval_days: 3` from Mon → Mon/Thu/Sun; `range_start..end` Wed..Fri → only Wed-Fri (fixtures; client validator still rejects the keys) | A4 ×2 |
| A5 | weekly with no days/count, `days: [] + count: 0`, monthly without count, `days: [9]` → all visible; well-formed schedules NOT ambiguous | A5 ×5 |
| A6 | pct and remaining from one total (2/1/1/0.5); denominator 0 → pct 0, finite, empty-state copy in both variants; out-of-list completion not counted | A6 ×6 |
| A7 | `habits.tsx` unchanged (`git diff` empty), still `habits.filter(status === 'active')`, no schedule filter | guard `A7` + diff |

Negative assertions (not comments): Tuesday MWF in denominator → red; count habit
hidden on any day → red; ambiguous row hidden → red.

### Mutation proof (each reverted byte-identical, sha256 `05785803…46bb4fa` verified OK)

- **M1** selector's `isEligibleOn(h, date)` → `(() => true)()`: **13 / 31 red** (2 guard +
  A1 ×3, A4 ×2, end-condition ×1, A6 ×5). First attempt of M1 lost the behaviour
  suite to `Cannot find module './elements/ForeignObject'` from `react-native-svg`
  (file present on disk; Jest's own message says it found it) -- a resolver/
  environment failure, not a test verdict. Re-run: 13 red, as listed.
- **M2** fail-open branch removed (`|| isScheduleAmbiguous(h)` dropped): **5 / 31 red**
  (1 guard + A5 ×4).

### Gates

- `typecheck:ci` exit 0 · `lint:ci` exit 0 (`--max-warnings=0`) · `git diff --check` clean
- `run-tests.js` **145/145**. First run after the change was 144/145: check
  `Alışkanlık metrik kartı` requires the identifier `completedHabits` in
  `today.tsx`. `run-tests.js` is out of scope, so the screen keeps a real
  `const completedHabits = todayHabits.filter(...)` that feeds the summary
  (not a comment to satisfy a substring). Pinned by the guard.
- focused: 2 suites **31/31**
- full `jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`, two consecutive runs: **135 suites / 2189
  tests**, 0 FAIL lines, 0 OOM/SIGTERM/`Command failed` markers (baseline 133 / 2158;
  +2 suites, +31 tests).
- **Not done:** no device/emulator observation (none installed on this host). The
  render itself was not exercised by RNTL; the selectors are.

## R01.02-c evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `fc6ddff`. No new branch.
- **Defect (split brain in one module):** `interval_days` / `range_start` /
  `range_end` were read only through private `dueOnExtended` (`streakBroken`,
  `isEligibleOn`, `periodStatus`). Every other day walk asked `isDueOn`, which
  reads kind/days/count only: "every 3 days" was due EVERY day there and range
  bounds were ignored. Latent today (the client validator rejects the keys);
  fixed before R01.02-d opens them -- consumer first, validator second.

### Call sites swapped `isDueOn` -> `isEligibleOn` (11), each with its count guard

All 11 verified by reading the source, not assumed. Every guard classifies via
`scheduleKind` (`isCountBased` in reportMetrics/behaviorIntelligence is a local
`scheduleKind(...).kind === 'weekly_count' | 'monthly_count'`, identical to
`isCountBasedSchedule`). So `isEligibleOn`'s count branch (every day true) is
unreachable from these lines. No site lacked a guard; none was skipped.

| Call site | Function | Count guard (before the call) |
|---|---|---|
| `lib/habitSchedule.ts` | `scheduledCompletionRate` day walk | `sk.kind === 'weekly_count' \|\| 'monthly_count'` -> `periodCompletionRate` return |
| `lib/habitSchedule.ts` | `carriesDayLoad` day branch | `if (!isCountBasedSchedule(habit))` |
| `lib/reportMetrics.ts` | `habitAveragePercent` | `if (isCountBased(habit)) { ...; continue; }` |
| `lib/reportMetrics.ts` | `summarizeHabitProgress` | `if (isCountBased(habit)) { return {...} }` |
| `lib/behaviorIntelligence.ts` | `dueDayStats` | `if (isCountBased(habit) && days.length > 0) return` -- with empty `days` the loop never runs |
| `lib/behaviorIntelligence.ts` | `weekdayBreakdown` | `if (isCountBased(habit)) continue;` |
| `lib/behaviorIntelligence.ts` | `currentStreak` | `if (isCountBased(habit)) return periodStreakBack(...)` |
| `lib/behaviorIntelligence.ts` | `longestStreak` | `if (isCountBased(habit)) return periodStreakLongest(...)` |
| `app/screens/recovery.tsx` | backlog loop | `if (isCountBasedSchedule(h)) continue;` |
| `app/screens/recovery.tsx` | `consecutiveMissedDue` | `if (isCountBasedSchedule(h)) return 0;` |
| `app/screens/habit-detail.tsx` | `dayCellFor` | `!countBased && ...` short-circuit |

Also: the now-unused `isDueOn` import dropped from the four consumer files;
`dayCellFor` exported (pure function, for the A3 test). `isDueOn` body,
`countDueDays`, `scheduleKind`, `dueOnExtended` (still private) untouched;
`isDueOn`'s DOC caller table rewritten (it listed the old callers).
`routineProposal.ALLOWED_FREQUENCY_KEYS`, UI, `featureGates.ts` untouched.

### Finding recorded, not fixed: KD-06

`scheduleKind` puts range first, so `weekly` + `count` + `range_*` is
`date_range`: not count-based to any guard, and `dueOnExtended`'s range branch
calls `isDueOn`, whose count branch runs `countDueDays` (invented Mon/Wed/Sat).
This predates the card (before, the same row went straight to `isDueOn` ->
`countDueDays`, without even the range clip), cannot be written today, and the
fix is a classification decision (`scheduleKind` -- out of scope) or a
validator rule (R01.02-d). Classification pinned by a test; `isDueOn`'s doc
names it; KD-01 now carries the exception.

### Acceptance

| | Result | Evidence |
|---|---|---|
| A1 | every 3 days from Mon: due Mon/Thu/Sun = 3 in the week; done on those → 100% / rate 1 / streak 3; a `miss` row on an off day moves nothing | reportMetrics ×3, behaviorIntelligence ×4, habitSchedule ×2 |
| A2 | recovery's predicate is `isEligibleOn` for both walks (guard pins exactly 2 lines); off days stay off at 14:37 and 23:59 (recovery passes `subDays(now, k)`, not midnight) | guard + habitSchedule A2. **Not rendered**: the backlog is inline in the component |
| A3 | habit-detail cells: due days `miss`, the days between `not_scheduled`; range days outside → `not_scheduled` | habitDetailDayCell ×4 |
| A4 | range Wed..Fri: 3 due days in every consumer; outside days no load | reportMetrics ×2, behaviorIntelligence, habitSchedule, habitDetailDayCell |
| A5 | trap 1: Mon/Wed/Fri + range keeps the weekday filter (Thu inside range not due; 5 days over 2 weeks) -- `dueOnExtended` calls `isDueOn` first; not "fixed" | habitSchedule, reportMetrics, behaviorIntelligence |
| A6 | trap 2: no `created_at` → not narrowed, 7/7 due -- kept | habitSchedule, reportMetrics |
| A7 | daily / weekly_days unchanged: (1) `isEligibleOn === isDueOn` over 366 days for 4 shapes; (2) `daySchedulePreservation.test.ts` -- 8 consumer outputs (incl. the six the card names, plus `scheduledCompletionRate` and `weekdayBreakdown`) for 4 habits over 28 days, expected values **captured by running the fixture at `fc6ddff` before any edit**, then compared after: byte-identical JSON | 8 tests |
| A8 | count habits: period target denominator, period streak, logged-only cells -- unchanged | reportMetrics, behaviorIntelligence, habitDetailDayCell |

Negative assertions (not comments): every-3-days denominator 7 → red; out-of-range day due → red; weekday filter swallowed by range → red.

**One existing test updated, with reason:** `habitSchedule.test.ts` "carriesDayLoad
is identical to isDueOn for every day-based shape" listed `interval_days: 3`
among the identical shapes -- i.e. it pinned the defect. Split: the identity
stays for daily / weekly_days / the malformed weekly row; interval moves to a
new test against `isEligibleOn` with the explicit Mon/Thu/Sun mask.
`periodConsumerMigration.test.ts`: the two R01.02-b assertions that the four
consumers "still call `isDueOn`" now assert they call `isEligibleOn` and not
`isDueOn` (the guard-before-call ordering check kept, retargeted).

### Mutation proof (focused 6 suites, 193 tests; each reverted byte-identical, sha256 verified for all 5 source files)

- **Ma** all 11 calls back to `isDueOn` (= revert the card): **29 / 193 red**, 0 suite-level. The 8 A7 preservation tests stay GREEN under it -- the expected result if the swap is neutral for daily/weekly_days.
- **Ma'** one call (`summarizeHabitProgress`) back: **7 / 193 red** (5 reportMetrics + 2 guard).
- **Mb** `dueOnExtended` every-N modulo `=== 0` → `=== 1`: **18 / 193 red** (incl. 4 pre-existing streakBroken/isEligibleOn tests).

### Gates

- `typecheck:ci` exit 0 · `lint:ci` exit 0 · `run-tests.js` **145/145** · `git diff --check` clean
- focused 12 suites **321/321**
- full `jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`, two consecutive runs: **137 suites / 2235 tests** each, 0 FAIL lines, 0 OOM/SIGTERM/`Command failed` markers (base 135 / 2189: +2 suites, +46 tests)
- **Not done:** no device/emulator observation (none on this host); recovery and habit-detail were not rendered.

## R01.02-d1 evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `3524e26`. Verified at
  start: HEAD `3524e26`, tree clean, none of the card's changes present.
- **Defect, measured at `3524e26` before editing:** `weekly + count 3 + range
  08-05..08-20` was `date_range`, not count-based, eligible on 5, 8, 10, 12, 15,
  17, 19 Aug (countDueDays' Mon/Wed/Sat, clipped) = KD-06. `daily + interval 3 +
  range 08-03..08-20` was eligible on all 18 days -- the interval was lost.

### What moved where (all in `lib/habitSchedule.ts`)

| Before | After |
|---|---|
| `scheduleKind`: `if (range_start \|\| range_end) return { kind: 'date_range' }` before reading `kind` -- the range replaced the shape | early return removed; reports the real shape (5 modes). Priority-list comment and the "SINIR — bilerek" paragraph rewritten: the old note called the combination "not expressible"; it was silently WRONG |
| `ScheduleKind` union had `date_range` (6 members) | `date_range` removed (5). `tsc` clean -- no production code compared against the literal |
| `dueOnExtended` had a `date_range` branch | removed; every path calls `isDueOn` first, which calls `withinLifetime` |
| `withinLifetime`: `created_at` + dated `end_condition` | + `withinRange` (new private helper): `ds < range_start` or `ds > range_end` → false; either end optional; no range → always true |
| count branches of `streakBroken` / `periodStatus` used the calendar window | new private `rangeSlice` (window ∩ range; for a range-less habit it returns the window object itself): `streakBroken` returns false outside the range and counts/remaining-days inside the slice; `periodStatus` returns `unknown/not_scheduled` for a period wholly outside the range, counts only in-range completions, and computes days left inside the slice |

Why the envelope in `withinLifetime` is enough for eligibility: `isDueOn` calls
it first (all day shapes) and `isEligibleOn`'s count branch is `sk.count > 0 &&
withinLifetime(...)` (all count shapes). The two window-based count branches
(`streakBroken`, `periodStatus`) do not go through it, which is why A4 needed
`rangeSlice` -- otherwise `streakBroken(w3, [], 08-22)` would read "3 left, 2
days" as broken on a day outside the range.

Not touched: `isDueOn`'s body and count branch, `countDueDays`, AC-H03 tests,
`ALLOWED_FREQUENCY_KEYS`, UI, `featureGates.ts`. `dueOnExtended` stays private.
Comments in other files that say "+ every_n_days/date_range" (R01.02-c) were
left as they are: still true in meaning (ranges are honoured), outside scope.

### Period target — decision, not silent behaviour (A6)

The target stays NOMINAL in a period the range cuts (no proration -- R01.05,
goal versioning). Known limit, written at the code site: if the slice is
shorter than the target, the period cannot be met, and `periodStatus` SAYS so:
`not_started`/`in_progress` with reason `unreachable_in_remaining_days` while
open, `closed_unmet` after. A cut period that can still make it reports `ok`.
For a period the range does NOT cut, `counted === 0` keeps its pre-existing
`'ok'` reason (A7). `periodCompletionRate` (reports) inherits this: weeks wholly
outside the range contribute target 0; weeks it touches contribute their
nominal target.

### Acceptance

| | Result |
|---|---|
| A1 | `weekly+count:3+range`: `weekly_count`, `isCountBasedSchedule` true, eligible on every one of Aug 5..20 (16 days), none outside; `[5,8,10,12,15,17,19]` asserted ABSENT. Monthly count + range same |
| A2 | `interval 3 + range 08-03..08-20`: 03, 06, 09, 12, 15, 18 -- length 6, not 18, no 21; August due-day denominator 6 |
| A3 | `weekly_days [0,2,4] + range`: 5, 7, 10, 12, 14, 17, 19 (Mon/Wed/Fri only), kind `weekly_days` -- output unchanged, now by design |
| A4 | out-of-range days (1, 4, 21, 22, 31 Aug) false for `isDueOn`, `isEligibleOn`, `carriesDayLoad` (day + count shapes); `scheduledCompletionRate` 16 not 31; `streakBroken` false outside for day + count; `periodStatus` `not_scheduled`; `summarizeHabitProgress` 16 (day) / 9 = 3×3 (count, only weeks touched); `habitAveragePercent` 100; `currentStreak` 16, `habitCompletionRate` 1, `weekdayBreakdown` Σscheduled 16 |
| A5 | only `range_start` → nothing before, open after; only `range_end` → open back to `created_at`, nothing after; both bounds inclusive |
| A6 | range from Sat 08-08 (2 days of the week for 3): `not_started`/`unreachable` with 0 logged, `in_progress`/`unreachable` with 1, `closed_unmet` after; range Mon..Wed ending mid-week → `unreachable`; 08-05..08-09 (5 days) → `ok`, target 3 (not prorated) |
| A7 | **range-less: byte-identical.** `rangelessOutputs` (8 habits: daily, weekly_days, weekly_count, monthly_count, every_n_days, malformed weekly, dated end, negative born mid-window × 12 functions, 42 days, periodStatus every day) captured at `3524e26` with lib untouched, compared after the change: `cmp` identical; pinned in `rangelessPreservation.test.ts` (13 tests). R01.02-c's `daySchedulePreservation` (8 tests) also still green |
| A8 | `ScheduleKind` has 5 members; `typecheck:ci` 0 |

Negative assertions: invented weekday pattern → red; interval+range every day → red; any out-of-range day due in any consumer → red; any range-less output changed → red (A7 test).

### Existing tests retargeted (none deleted, none narrowed)

- `habitSchedule.test.ts` "range_start/range_end produces date_range, regardless
  of the underlying kind" → "does not change the shape": asserts the underlying
  kind for ALL five shapes plus a one-sided range (was: one daily case).
- `habitSchedule.test.ts` A5 (trap 1): only the `toBe('date_range')` line →
  `'weekly_days'`, with the reason; behaviour assertions unchanged and green.
- `habitSchedule.test.ts` KD-06: pinned the defect (`date_range`, not count-based)
  → pins the fixed behaviour (card A1), same fixture, plus a negative.
- `periodConsumerMigration.test.ts` (`__tests__/repo`, outside the card's file
  list but broken by this card's mechanics): `isDueOn` calls inside
  `dueOnExtended` 3 → 2, because the range branch went; the "only inside
  `dueOnExtended`" invariant kept.
- `streakBroken — date_range` (4 tests): **no change needed, all green** -- no
  behaviour regression. `phase1Adversarial.test.ts` mentions date_range only in
  a header comment; `coachHabitSemantics.test.ts` asserts the validator still
  REJECTS `range_start` -- untouched and green.

### Mutation proof (9 focused suites, 267 tests; each reverted byte-identical, sha256 `d77d7b45…b112af` verified)

- **M1** range clip removed from `withinLifetime`: **27 / 267 red**
- **M2** bounds made exclusive (`<`→`<=`, `>`→`>=`): **22 / 267 red**
- **M3** `scheduleKind`'s early return put back (= revert the card): **17 / 267 red**
- **M4** (extra) `rangeSlice` ignores the range: **5 / 267 red** (A4 periodStatus/report, A6)
- 0 suite-level failures; the 13 range-less preservation tests stayed GREEN under all four -- the expected result for a change that must be neutral without a range.

### Gates

- `typecheck:ci` exit 0 · `lint:ci` exit 0 · `run-tests.js` **145/145** · `git diff --check` clean
- focused 13 suites **413/413**
- full `jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`, two consecutive runs: **139 suites / 2271 tests** each, 0 FAIL lines, 0 OOM/SIGTERM/`Command failed` markers (base 137 / 2235: +2 suites, +36 tests)
- **Not done:** no device/emulator observation (none on this host).

### Open for R01.02-d (not decided here)

- **Decided in R01.02-d (owner):** anchor = max(created_at, range_start) -- see below. Original note:
  `every_n_days` anchors on `created_at`, not on `range_start`: "every 3 days,
  10-20 Aug" for a habit created 1 Aug cycles from 1 Aug. Unchanged by this card
  (trap 2 of R01.02-c pins the anchor rule); the validator/UI card should decide
  whether a range re-anchors the cycle.
- Target proration for cut periods: R01.05.
- `isWindowSatisfied` (no production consumer -- grep finds only a comment in behaviorIntelligence.ts) still uses the calendar window.

## R01.02-d evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `1cd0bc9` (verified at start, tree clean).
- **What it opens:** `validateFrequencyConfig` (`lib/routineProposal.ts`) accepts
  `interval_days`, `range_start`, `range_end`. Callers: `lib/coachActions.ts`
  (AI Coach `propose_habit`) and `validateRoutineProposal`. Traced to the row:
  `coachActionToRoutineProposal` → `validateRoutineProposal` →
  `services/routineService.buildInstallRows` passes `frequency_config` through
  untouched; `habitRepository` selects/maps it whole. No layer filters keys.
  DB is unconstrained jsonb -- **no migration written or needed.**

### Accepted / refused (refuse-don't-coerce, same style as days / part_of_day / count)

| Config | Verdict |
|---|---|
| `{daily, interval_days: 3}` / `365` | accepted as given |
| `{daily, interval_days: 1 \| 0 \| -3 \| 3.5 \| 366 \| '3' \| null}` | refused -- 1/0 are NOT turned into plain daily |
| `{weekly \| monthly, …, interval_days: 3}` | refused (only meaningful with daily) |
| `range_start` / `range_end` alone (one-sided) | accepted |
| both, start ≤ end (incl. a one-day range) | accepted |
| range with every kind (`weekly`+`count`, `weekly`+`days`, `monthly`+`count`, `daily`+interval) | accepted -- envelope |
| `start > end` | refused |
| `'2026-02-30'`, `'5 Ağustos'`, `''`, `'2026-8-5'`, a number, `null` | refused (`parseLocalDate`, the repo's leaf date module -- no hand regex) |
| unknown key (`foo`, `intervalDays`, `range`) | refused, as before |
| `__proto__` / `constructor` next to the new keys | refused, as before |

`MIN_INTERVAL_DAYS = 2`, `MAX_INTERVAL_DAYS = 365` exported next to the count
ceilings. The allow-list doc and `validateFrequencyConfig`'s doc rewritten (why
each key is now accepted; the `monthly` limitation note kept).

### Anchor — owner decision, R01.02-d

`dueOnExtended`'s `every_n_days` cycle now counts from **max(created_at,
range_start)**. Counted from `created_at`, "every 3 days, 11-20 Aug, created
1 Aug" gave 13/16/19 -- the window's first day skipped, which cannot be
explained to a user. Now 11/14/17/20. No range → max is `created_at` →
range-less habits unaffected (A7). No `created_at` but a range → the range
start anchors. Neither → not narrowed (R01.02-c trap 2 kept). Rationale written
at the code site, marked "SAHİP KARARI, R01.02-d".

### Retargeted test

`coachHabitSemantics.test.ts` "refuses schedule fields the scheduler does not
read": its stated reason (`isDueOn` ignores the fields) was voided by R01.02-c
and d1. Not deleted -- turned to the ACCEPT side and widened into 4 tests:
accepts (7 shapes incl. range with every kind), refuses bad intervals (9
cases), refuses bad ranges (7 cases), still refuses unknown fields (3 cases).
The value it protected -- nothing unknown passes silently -- kept explicitly.

### The 9 stale comments (KD-05 class), fixed

R01.02-c's "`isEligibleOn` = `isDueOn` for daily/weekly_days, + every_n_days/date_range."
was wrong twice after d1 (`date_range` is no longer a mode; range clipping is in
`withinLifetime`, so BOTH predicates apply it). Replaced in all 9 places --
`reportMetrics.ts` ×2, `behaviorIntelligence.ts` ×4, `recovery.tsx` ×2,
`habit-detail.tsx` ×1 -- with: "`isEligibleOn` = `isDueOn` for
daily/weekly_days; it adds the every_n_days interval. The date range is not a
mode: it is the lifetime envelope (`withinLifetime`) both read." Diff: 9 comment
lines, 0 code lines. No `date_range` mention left outside `habitSchedule.ts`'s
own history notes.

### Acceptance

| | Result |
|---|---|
| A1 | `{daily, interval 3}` accepted; with weekly refused; 1, 0, 3.5 refused |
| A2 | `{weekly, count 3, 08-05..08-20}` accepted unchanged; evaluated `weekly_count`, eligible every day 5..20 |
| A3 | one-sided ranges accepted |
| A4 | start > end refused; `'2026-02-30'`, `'5 Ağustos'`, `''`, number refused |
| A5 | `foo` refused; `__proto__` / `constructor` still refused, also next to the new keys |
| A6 | validator → `scheduleKind` + `isEligibleOn`: created 1 Aug, every 3 days, 11-20 Aug → **11, 14, 17, 20** (asserted ≠ 13/16/19); created 13 Aug → 13/16/19 (max); no `created_at` → 11/14/17/20; August denominator 4 |
| A7 | **validator:** 34-config corpus without the new keys (11 valid, 23 invalid) captured at `1cd0bc9`, re-run after: verdicts, `frequency` objects, error paths and messages identical, except the allowed-key list inside 2 unknown-field messages, which grows by the three keys (normalised in the comparison and pinned exactly in its own test). **calendar:** `rangelessOutputs` re-captured at `1cd0bc9` before the anchor change and after it -- byte-identical (`cmp`); `rangelessPreservation.test.ts` keeps pinning it |
| A8 | AI Coach `propose_habit` with `{daily, interval 3, 11-20 Aug}`: accepted, action equal to the input; through `coachActionToRoutineProposal` → `validateRoutineProposal` → `buildInstallRows`: `frequency_config` identical on the row. `interval_days: 1` from the coach rejected, not installed |

Negative assertions: interval 1 accepted → red; start > end accepted → red;
unknown key accepted → red; any range-less day output changed → red.

### Mutation proof (6 focused suites, 214 tests; each reverted byte-identical, sha256 of both source files verified)

- **M1** the three keys out of `ALLOWED_FREQUENCY_KEYS`: **10 / 214 red**
- **M2** start ≤ end check removed: **1 / 214 red**
- **M3** anchor back to `created_at`: **3 / 214 red** -- all A6; `rangelessPreservation` (A7) stayed GREEN, as required
- **M4** (extra) `MIN_INTERVAL_DAYS` 2 → 1: **2 / 214 red** (validator + coach path)
- 0 suite-level failures.

### Gates

- `typecheck:ci` exit 0 · `lint:ci` exit 0 · `run-tests.js` **145/145** · `git diff --check` clean
- focused 6 suites **214/214**
- full `jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`, two consecutive runs: **140 suites / 2321 tests** each, 0 FAIL lines, 0 OOM/SIGTERM/`Command failed` markers (base 139 / 2271: +1 suite, +50 tests)
- **Not done:** no screen rendered in this card; no device/emulator (none on this host). `HabitOnboarding.tsx` untouched; `habit-detail.tsx` only its one comment line.

### Found, recorded, not fixed: KD-07 (now reachable)

Opening the validator makes "every N days" installable by the AI Coach, and
the cost side does not read `interval_days`: `triage.costBreakdown`'s
`FREQ_FACTOR` keys on `kind` only, and `capacity.occurrencesPerWeek` returns 7
for `daily`. An every-3-days habit is therefore priced and loaded as daily
(should be ~2.33/week, weight ~0.33). The calendar is right; willpower cost and
capacity load are high. Outside this card's files; flagged so it is decided
before R01.02-e opens the mode to every user via the form.

## R01.02-d2 evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `70bd0d6` (verified at start, tree clean).
- **Defect (KD-07), verified in source before editing:** `lib/triage.ts`
  `costBreakdown` priced by `frequency_config.kind` only (`FREQ_FACTOR`), and
  `lib/capacity.ts` `occurrencesPerWeek` returned `7 * (count ?? 1)` for
  `daily` -- neither file mentioned `interval_days`. "Every 3 days" was costed
  with factor 1.0 and loaded at weight 1.0 (7/week).

### The rule

- **Load (`capacity.ts`):** `occurrencesPerWeek`'s daily branch: `interval_days > 1`
  → `7 / N` a week, times `count` when given; absent or `<= 1` → exactly as
  before. `frequencyWeight` (and its 1.0 clamp) untouched. `occurrencesPerWeek`
  is now EXPORTED so it stays the one frequency → occurrences mapping.
- **Cost (`triage.ts`):** for `daily` + `interval_days > 1` only, the factor is
  read off `FREQ_FACTOR`'s own three anchors by occurrences per week,
  piecewise-linearly -- monthly (~0.23/wk) 0.5, weekly (1/wk) 0.7, daily (7/wk)
  1.0 -- clamped at both ends. *One sentence:* the table is a hand-tuned
  judgement, so an interval habit is priced where its frequency falls between
  the table's own values, never by `1/N` (which would put "every 3 days" at
  0.33, below weekly). Anchor frequencies come from `occurrencesPerWeek`, so cost
  and load cannot disagree on "how often". `FREQ_FACTOR`'s three values unchanged.
- **Deviation from the card, stated:** the card names two anchors (weekly,
  daily). `interval_days` reaches 365 (validator), so below 1/week the
  two-anchor rule is undefined: clamping at 0.7 would make "every 30 days"
  dearer than `monthly` (0.5) at the same frequency. The table's third value
  (monthly) is used as the lower anchor; still no new constant.
- **Import direction checked:** `capacity` → `habitSchedule` → `date` /
  `supabase` (types); none imports `triage`, so `triage → capacity` is acyclic.
- **Transparency (A6):** `costBreakdown` adds `freqSource: 'interval'`,
  `intervalDays`, `perWeek` -- ONLY on interval rows, so every other breakdown
  object is byte-identical (A7).
- `CostInput.frequency_config` gains `interval_days?: number`. `tsc` showed no
  break in `routineProposal.ts` / `routineService.ts` / `HabitOnboarding.tsx`;
  none was edited.
- **Not retro-computed:** `willpower_cost` stored on existing rows is untouched;
  only new computations change.

### Monotonicity (generated from the code, not hand-written)

| schedule | /week | load weight | cost factor | cost (diff 5, pos) |
|---|---|---|---|---|
| daily | 7.000 | 1.000 | 1.000 | 5 |
| every 2 days | 3.500 | 0.500 | 0.825 | 4 |
| every 3 days | 2.333 | 0.333 | 0.767 | 4 |
| every 4 days | 1.750 | 0.250 | 0.737 | 4 |
| every 5 days | 1.400 | 0.200 | 0.720 | 4 |
| every 6 days | 1.167 | 0.167 | 0.708 | 4 |
| every 7 days | 1.000 | 0.143 | 0.700 | 4 |
| every 8 days | 0.875 | 0.125 | 0.668 | 3 |
| every 9 days | 0.778 | 0.111 | 0.642 | 3 |
| every 10 days | 0.700 | 0.100 | 0.622 | 3 |
| every 11 days | 0.636 | 0.091 | 0.606 | 3 |
| every 12 days | 0.583 | 0.083 | 0.592 | 3 |
| every 13 days | 0.538 | 0.077 | 0.580 | 3 |
| every 14 days | 0.500 | 0.071 | 0.570 | 3 |
| every 30 days | 0.233 | 0.033 | 0.501 | 3 |
| weekly (1/wk) | 1.000 | 0.143 | 0.700 | 4 |
| monthly (1/mo) | 0.230 | 0.033 | 0.500 | 3 |

Load weight falls as 1/N; the cost factor falls monotonically from 1.0 to the
monthly floor 0.5; every 7 days = weekly in both; every 30 days ≈ monthly.

### Acceptance

| | Result |
|---|---|
| A1 | every 3 days: 7/3 = 2.333/week, weight 0.333 (was 1.0); cost factor 0.767 (was 1.0) |
| A2 | every 2 days 3.5/week; every 7 days 1/week, same load as `weekly count 1` and `weekly days [3]` |
| A3 | load and factor AND rounded cost non-increasing over interval 1..14 (and 7..365 for the factor, floor 0.5); interval 1 ≡ plain daily (breakdown `toEqual`) |
| A4 | daily ≥ every 2 ≥ … ≥ every 7 ≥ weekly ≥ monthly, for the factor and for the rounded cost at difficulty 1/3/5 × positive/negative; every 3 days never cheaper than weekly |
| A5 | interval + count: 14/3/week (weight 2/3); 17.5/week clamps to weight 1.0 and factor 1.0 |
| A6 | breakdown shows `freqSource: 'interval'`, `intervalDays`, `perWeek`, and `base = diff × freqFactor`; non-interval breakdowns carry none of these keys |
| A7 | **byte-identical.** Corpus (`__tests__/helpers/costCorpus.ts`): 30 frequency shapes -- every kind, `count` variants, ranges, `interval_days` 1/0/-3 (must stay daily), interval on weekly/monthly (not "every N days") -- × difficulty × minutes (360 load inputs) and × behaviour (incl. negative) × tracking (boolean/numeric/duration) × impact (4500 cost inputs), 4 whole days. Captured at `70bd0d6` before any edit (`occurrencesPerWeek`/`frequencyWeight` from a verbatim copy of that file with only `export` added), re-run after: `cmp` identical (732,682 bytes). Pinned in `costPreservation.test.ts` by SHA-256 per function + whole, with the small arrays verbatim |
| A8 | `capacitySingleSourceOfTruth` green; new source checks: triage imports `occurrencesPerWeek` from capacity, contains no `7 /` or interval division of its own, and `function occurrencesPerWeek` is defined in exactly one production module |

Negative assertions: every 3 days priced/loaded as daily → red; every 3 days cheaper than weekly → red; cost rising with the interval → red; any non-interval output changed → red (A7).

### Mutation proof (4 focused suites, 76 tests; each reverted byte-identical, sha256 of both files verified)

- **M1** interval read removed from `occurrencesPerWeek`: **12 / 76 red** (6 capacity + 6 triage -- triage reads the same mapping)
- **M2** triage factor `1 / interval_days`: **7 / 76 red**, incl. both A4 ordering tests and "never cheaper than weekly"
- **M3** interpolation inverted (rarer = dearer): **7 / 76 red**, incl. both A3 monotonicity tests and both A4 tests
- 0 suite-level failures; `costPreservation` (A7) stayed GREEN under all three -- none of them touches a non-interval input.

### Gates

- `typecheck:ci` exit 0 · `lint:ci` exit 0 · `run-tests.js` **145/145** · `git diff --check` clean
- focused 7 suites **202/202**
- full `jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`, two consecutive runs: **142 suites / 2355 tests** each, 0 FAIL lines, 0 OOM/SIGTERM/`Command failed` markers (base 140 / 2321: +2 suites, +34 tests)
- **Not done:** no screen rendered; no device/emulator (none on this host).

### Out of scope, recorded: KD-08

The date range does not reach cost or load: a habit whose range has ended (or
not begun) still carries its weekly-average load in `canActivate` (it adds
`habitLoadPoints` directly) and in the stored `willpower_cost`. Day-keyed load
screens already skip out-of-range days (`carriesDayLoad` → `withinLifetime`).
A lifetime question, not a frequency one -- separate card. Target proration
stays R01.05.

### Process note

The card says the previous card broke the no-push rule. For the record: the
R01.02-d push (`1cd0bc9..70bd0d6`) was done on the owner's explicit "push et"
instruction in the session, after the card's own report had stopped at the
commit. This card: commit only -- no push, no merge, no PR.

## R01.02-e evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `6895c44` (verified at start, tree clean).
- **Defect (verified in source before editing):** step 3 of `HabitOnboarding`
  expressed 2 of the 5 shapes. "Aylık" wrote `{ kind: 'monthly' }` and "Haftalık"
  with no day wrote `{ kind: 'weekly' }` / `days: []` -- count 0, no target, due
  on no day. No count, interval or range input existed. `setKind` reset the
  config to `{ kind }`, silently dropping `part_of_day`.
- **Files:** `components/HabitOnboarding.tsx`; NEW `lib/frequencyForm.ts` (pure
  transitions + summary; the card's §11 "saf yardımcılar"); NEW tests
  `__tests__/lib/frequencyForm.test.ts` (40), `__tests__/repo/habitFormFrequency.test.ts`
  (19), helper `__tests__/helpers/legacyFrequencyForm.ts`. `run-tests.js` needed
  no change (145/145 as is). No package added; `habitSchedule` / `routineProposal`
  / `capacity` / `triage` behaviour untouched (only constants imported).

### What the form can produce now

| UI | `frequency_config` | `scheduleKind` |
|---|---|---|
| Günlük · Her gün | `{ kind: 'daily' }` | daily |
| Günlük · 2/3/7 günde bir, or typed 2–365 | `{ kind: 'daily', interval_days: N }` | every_n_days |
| Haftalık · Haftada N kez (default) | `{ kind: 'weekly', count: 1–7 }` | weekly_count |
| Haftalık · Belirli günler | `{ kind: 'weekly', days: [...] }` (≥1 day to continue) | weekly_days |
| Aylık · Ayda N kez | `{ kind: 'monthly', count: 1–31 }` | monthly_count |
| any of the above + "Yalnızca şu tarihler arasında" | `+ range_start? / range_end?` | same shape, envelope |

Start presets: Hemen / 1 hafta sonra / 1 ay sonra; end presets: Süresiz / 7 / 30 /
90 gün (inclusive, from the start or today) -- the `end_condition` ready-button
pattern, no date-picker dependency.

### Rules and defaults (each written at the code site)

- **setKind (`setFrequencyKind`):** shape fields (`days`, `count`,
  `interval_days`) belong to the old shape and are dropped -- carrying
  Pzt/Çar/Cum into "Aylık" would be a schedule nobody picked. `range_*` and
  `part_of_day` are not shapes and are KEPT. Re-selecting the current kind
  changes nothing (the old form reset it).
- **Defaults:** weekly → `count: 3` (the commonest stated weekly goal, room
  both ways in 1–7); monthly → `count: 1` (the smallest real target: "Aylık"
  says nothing about how often, so commit to the least). Untouched "Devam" on
  any kind yields a target.
- **Weekly days XOR count** (`setWeeklyMode`): `scheduleKind` reads `days` first and
  would silently ignore a `count` beside it. "Belirli günler" starts with no day
  picked -- exactly the old form's state after "Haftalık", so the old day path
  is reproduced byte-for-byte -- and `canProceed` (step 3 →
  `isFrequencyComplete`) blocks "Devam" until a day is chosen, with a visible
  hint. `toggleWeekday` is a no-op outside days mode.
- **Interval:** "Her gün", 1, 0, empty or garbage REMOVE `interval_days`; never
  written as 1 (the validator refuses 1 rather than coercing). >365 clamps to 365.
- **Envelope:** start after end drops the end (one-sided, valid); an end before
  the start is refused; an impossible day is refused.
- **Bounds** `MAX_WEEKLY_COUNT`, `MAX_MONTHLY_COUNT`, `MIN/MAX_INTERVAL_DAYS`
  imported from `routineProposal.ts`; no literal bound in `frequencyForm.ts`.
- **Cost (A10):** every frequency change goes through `applyAndRecost`, so the
  stored `willpower_cost` (summary, `canActivate`) follows the schedule. Before,
  step 3 used plain `setForm`, so changing the frequency left the cost stale until
  a step-4/5 control was touched. Step 5's breakdown now says "3 günde bir"
  with the interpolated factor instead of "günlük".
- **Summary (Adım 5):** `frequencySummary` (from `scheduleKind`, so it cannot
  claim a shape the engine does not read) replaces the kind-only `freqLabel` in
  step 7 and is shown live under step 3: "Her gün", "3 günde bir", "Haftada 3
  kez", "Haftada 3 gün · Pzt, Çar, Cum", "Ayda 10 kez", "… · 5–20 Ağustos arası",
  "5 Ağustos itibarıyla", "20 Ağustos tarihine kadar".

### Found and fixed on the way (by the state-space test)

1. `toggleWeekday` had no mode guard -- reachable as `days` next to `count`
   (A2) or `days` on daily (validator-refused). Guarded.
2. **Pre-existing:** picking then un-picking a time of day left
   `part_of_day: []`, which `validateFrequencyConfig` refuses ("expected 1-3
   entries") -- the old form could produce a config the AI Coach path rejects.
   Now the key is removed. This is the ONE intended A7 difference (below).

### Acceptance

| | Result |
|---|---|
| A1 | over every state reachable from the default form (BFS depth 3 over all 35 UI actions + 400 deterministic 40-step walks; >1000 distinct states, all 5 shapes reached): every complete state is one of the 5 shapes, count > 0 in count modes, ≥1 weekday in days mode, eligible on ≥1 day; the ONLY incomplete reachable state is "belirli günler" with no day yet, which `canProceed` blocks |
| A2 | no reachable state has `days` and `count` together; sub-mode switch clears the other field |
| A3 | monthly default 1; stepper clamps to 1..31; `count: 0` unreachable; NaN ignored |
| A4 | interval 2/3/7/typed 2–365; 1/0/negative/empty/garbage remove the key; >365 → 365; only on daily |
| A5 | envelope on all five shapes, one-sided allowed, start > end unreachable in every explored state |
| A6 | 6 source states × 3 target kinds: valid after every switch, envelope + `part_of_day` kept, shape fields cleared, same kind = no-op |
| A7 | 304 old paths ("Günlük" 160, "Haftalık + belirli günler" 144) replayed through the old step-3 logic (copied verbatim from `6895c44`:345-361, checked against `git show`) and the new: **292 byte-identical**; the other **12 differ only by `part_of_day: []` being dropped**, and all 12 old outputs are refused by the validator (asserted) |
| A8 | every complete reachable state passes `validateFrequencyConfig` with `errors: []` and comes back unchanged (validator sorts `days`; compared sorted) |
| A9 | the controls block (8 touchables + 1 text input) scanned tag by tag with a comment/string-blind tokenizer (self-tested on a synthetic violation): every touchable has role, non-empty label and state; exclusive choices are `radio` in 5 labelled `radiogroup`s, weekdays `checkbox` with full names ("Pazartesi", not "Pzt"), steppers `button` with `disabled` state, live regions on the count and summary; source order = decision order (kind → how often → days/count → dates → summary); every target reuses `dayBtn`/`freqBtn` (`wideChip` adds only horizontal padding). `screenAccessibility` (app/screens only -- it never covered this component) and `uiPrimitivesAccessibility` green. **Not verified on a device / with a screen reader** |
| A10 | `computeWillpowerCost`: every 3 days < daily at the form defaults and at difficulty 5; form recosts on every frequency change (guard-pinned) |

Negative assertions: count 0 reachable → red; days + count together → red;
setKind wiping the envelope → red; any Günlük / Haftalık+günler output change
(beyond the named `part_of_day: []` fix) → red.

### Mutation proof (2 suites, 59 tests; each reverted byte-identical, sha256 of both files verified)

- **M1** count defaults → 0: **12 / 59 red** (A1, A6)
- **M2a** component `setKind` back to `{ kind }` reset: **3 / 59 red** (guard)
- **M2b** `setFrequencyKind` back to `{ kind }`: **23 / 59 red** (A1, A3, A6)
- **M3** days and count written together: **4 / 59 red** (A2, A7)
- **M4** (extra) one radio's `accessibilityLabel` removed: **1 / 59 red** (A9)
- 0 suite-level failures. (An earlier M2b attempt failed to apply -- CRLF anchor
  on an LF file -- and was re-run after fixing the anchor; the file was restored
  byte-identical in both runs.)

### Gates

- `typecheck:ci` exit 0 · `lint:ci` exit 0 · `run-tests.js` **145/145** (unchanged) · `git diff --check` clean
- full `jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`, two consecutive runs: **144 suites / 2414 tests** each, 0 FAIL lines, 0 OOM/SIGTERM/`Command failed` markers (base 142 / 2355: +2 suites, +59 tests)
- **Not done:** no screen rendered (no RNTL test written; logic proven on the pure layer + source guard), no device/emulator (none on this host).

### Recorded, not done

- **KD-09:** habit-detail only DISPLAYS the frequency; an installed interval / range / count cannot be edited afterwards.
- **KD-10:** target-less rows already in production (old "Aylık", "Haftalık" with no day, `part_of_day: []`) -- **not counted**, no Supabase read was made; backfill is an owner decision.

## R01.03-a evidence

- **Branch/HEAD:** `feature/r01-period-status`, on top of `5ef17bd` (verified at start, tree clean).
- **Defect (verified in source):** `app/tabs/timeline.tsx` `handleMeasurableSubmit`
  decided the state itself -- `value >= getRemainingValue(...) ? 'done' :
  'partial'` for at_least, `deriveState(raw entry)` for at_most -- and wrote
  the ENTRY as `value`. `services/habitLogService.stateForValue`'s doc claimed
  screens no longer did this. Measured on the corpus at `5ef17bd`: the old
  screen produced **1,472 at_least rows with `state: 'done'` and `value` below
  the target**.

### The contract (owner decision)

**`habit_logs.value` = THE DAY'S TOTAL**, never one entry. Reason, written at
`measuredEntryFor`: `completionRatio`, `habitLogPercent` and `habitStrength`
already read `value` against `daily_goal` as a same-day ratio; a ceiling
already reads it as absolute; with `UNIQUE (habit_id, date)` a row describes a
DAY, not an event. Adding remains how the user enters it; the add happens once,
in the service.

### What changed

| File | Change |
|---|---|
| `services/habitLogService.ts` | NEW `dayTotalAfterEntry(prior, entered)` (guards: bad prior → 0, bad/negative entry adds 0, 1e-6 rounding) and `measuredEntryFor(habit, prior, entered)` = `completionFor(habit, total)` with `value: total`. `stateForValue` doc updated. Existing functions untouched (A7: byte-identical) |
| `app/tabs/timeline.tsx` | submit: no direction branch, no `getRemainingValue`, no state; reads the day's prior `value`, calls `measuredEntryFor`, passes the intent to `logHabit`. Modal now gets the day's real total (was `goal − remaining`, which clamps at the goal and hid an exceeded ceiling). `deriveState`/`adaptTrackingType` imports dropped |
| `components/MeasurableInputModal.tsx` | "Bugüne ne kadar ekleyelim?", "Girdiğin sayı bugünkü toplama eklenir", live "Kaydedince bugün: N" (same `dayTotalAfterEntry` as the write); direction-aware status ("sınıra N kaldı", "Sınır aşıldı"); input labelled for screen readers; a ceiling may enter **0** (a clean day -- the card's A3 case was not enterable before: the modal required `> 0`) |
| `store/logStore.ts` | `getRemainingValue` documented DISPLAY ONLY |

### Every measurable entry path, scanned

| Path | Status |
|---|---|
| `app/tabs/timeline.tsx` modal | **fixed** (above) |
| `app/screens/ai-coach.tsx` + `lib/coachActions.ts` `log_habit` | on contract: `completionFor(habit, completion.value)` -- the coach's value is the day's amount, state from the service. Caveat (not fixed): "4 dakika daha" phrased as an increment would be stored as the day total; the coach does not read the day's prior value |
| `components/coach/CoachActionCard.tsx` | display + consent only; writes through ai-coach above |
| `app/tabs/habits.tsx`, `app/screens/habit-detail.tsx` | no write path |
| `app/tabs/today.tsx` | binary toggle only; measurable rows route to timeline |
| `app/screens/recovery.tsx` "yaptım" / `services/recoveryService.makeupFor` | **NOT on contract, not fixed → KD-12**: done without a value (ratio readers see 0), and split make-up picks `partial` itself (contradicts `stateForValue` at target 1 and for ceilings). Fixing means inventing a value -- owner decision |
| `lib/demoSeed.ts` | consistent (walk is boolean; water 1200/2000 partial; read 20/15 done) |

### Acceptance

| | Result |
|---|---|
| A1 | target 10, 6 logged, +4 → `value 10`, `done` (old: `value 4`, `done` -- asserted on the verbatim old screen) |
| A2 | target 10, 6 logged, +1 → `value 7`, `partial` |
| A3 | ceiling first entries identical to the old screen for every reachable input (asserted over the corpus). **Correction to the card's example:** "en çok 2" with 3 is `partial`, not `miss` -- the engine (unchanged) grades an overshoot proportionally (`1 − (v − limit)/limit` = 0.5); 4 is `miss`. Tests assert the engine's real rule |
| A4 | sweep 168 habits (4 tracking × 3 directions × 7 targets × 2 behaviours) × 11 prior values × 11 entries = **20,328 rows**: `stateForValue(habit, row.value) === row.state` for every one; the old screen contradicted itself on reachable inputs (asserted > 0) |
| A5 | every reachable `done` row reads ratio ≥ 1 (at_least) or `value ≤ limit` (at_most); `partial` at_least rows read strictly between 0 and 1 |
| A6 | guard `measurableStateAuthority.test.ts`: no `value >=` / `>= getRemainingValue` on any code line of timeline; the submit body contains no `deriveState`/`stateForValue`/`getRemainingValue`/direction/state literal; every remaining `getRemainingValue` use is display; no `>= remaining` state choice in all of `app/` + `components/`; modal text and shared add pinned |
| A7 | captured at `5ef17bd` before any edit, SHA-256 pinned: `stateForValue`/`completionFor`/`toPatch` over 1,848 inputs and the `xpFor` sweep (396) -- **byte-identical**; the old screen (copied verbatim, checked against `git show`) over 20,328 inputs -- reproduces the capture. Every reachable FIRST entry of a day writes exactly what the old screen wrote. Boolean paths (`handleYesNoTap`, today, recovery) untouched; report modules untouched and their R01.02 preservation suites green |
| A8 | `logHabit` still the only write; `measuredEntryFor` writes nothing; `layerBoundary` and `logHabitErrorsSurfaced` green |

**The expected change, pinned separately:** a reachable SECOND entry of the day
writes `prior + entered` with the state of that total. **One thing beyond the
card's wording, stated rather than hidden:** the card expected this only for
`at_least`. The modal says "ekleyelim" for BOTH directions, so under "value = the
day's total" a ceiling's second entry adds too: "en çok 2", 2 then +1 → 3
(`partial`), 2 then +2 → 4 (`miss`). The old screen wrote the latest entry alone
(1 → `done`, 2 → `done`), hiding the overshoot -- the "same field, two
meanings" defect the card itself names. Pinned by its own test.

(Corpus rows with `entered = 0` on at_least differ from the old screen --
`partial` → `miss`, and `done` at a 0/absent target -- but the modal refuses
`0` for a floor, so they are unreachable; excluded from the claims, not hidden.)

### Mutation proof (2 suites, 30 tests; each reverted byte-identical, sha256 of both files verified)

- **M1** raw entry written (no total): **5 / 30 red** (A1, A2, the increment negative, ceiling second entry, the pinned change)
- **M2** screen produces the state itself (`intent.value >= goal ? 'done' : 'partial'`): **3 / 30 red** (A6 guard)
- **M3** at_most forced through the at_least rule: **8 / 30 red** (A3 ×4 incl. first-entry identity, A4, A5, A7 first-entry, pinned change)
- 0 suite-level failures.

### Gates

- `typecheck:ci` exit 0 · `lint:ci` exit 0 · `run-tests.js` **145/145** · `git diff --check` clean
- full `jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB`, two consecutive runs: **146 suites / 2444 tests** each, 0 FAIL lines, 0 OOM/SIGTERM/`Command failed` markers (base 144 / 2414: +2 suites, +30 tests)
- **Not done:** no screen rendered, no device/emulator (none on this host); no Supabase read (production project INACTIVE, per the card).

### Recorded, not done

- **KD-11:** rows written before this card by a same-day second entry hold the last entry, not the total -- not counted, not migrated.
- **KD-12:** recovery's measurable writes are off-contract (above).
- **R01.03-b:** undo -- `habitLogRepository` has insert/update and no delete; a day cannot return to "no record".

## Paket sınıflandırması (R00.02 özeti)

| Paket | Sınıf | Gerekçe (kanıt envanterde) |
|---|---|---|
| R01 | EXTEND | Pencere değerlendiricisi var, tüketicisi yok; `isDueOn` sabit gün; sözleşme/oturum/checklist/sürümleme yok |
| R02 | EXTEND (log kuyruğu) / NEW (genel outbox) | Yalnız habit log kuyruklu |
| R03 | EXTEND | Kapasite + 4 stratejili recovery var; yük seçimi ve küçük adım başlatma yok |
| R04 | EXTEND | Tek DAILY tetik |
| R05 | NEW (runner) / EXTEND (odak) | Runner yok; odak zamanlayıcı kusurlu ve kalıcı değil |
| R06 | EXTEND | Token/bileşen sistemi var; tek CTA ve render kanıtı yok |
| R07 | EXTEND | Günlük/review var; duygu modeli, ilişki kartı, plana bağlı review yok |
| R08 | NEW (restore) / REUSE (export) | Restore bilinçli yok |
| R09 | REUSE / EXTEND | Durable AI + tek etki kapalı; eylem listesi dar |
| R10, R11 | süreç | Guard'lar var; bağımsız reviewer yok |

## CP01–CP08 mevcut durumu (puan verilmedi — §2.3 gereği ölçülmemiş)

| CP | Durum | Not |
|---|---|---|
| CP01 Esnek hedef/geçmiş | **büyük ölçüde var** | kanonik motor + eligibility + count-denominator (R01.01-a/R01.02-a) ve tüm tüketiciler dönem semantiğinde (R01.02-b); kalan: izleme semantiği (R01.03), checklist (R01.04), hedef sürümleme (R01.05) |
| CP02 Kapasite/küçük adım/recovery | kısmi | recovery 4 yol var; yük seçimi + küçük adım yok |
| CP03 Rutin yürütme | **yok** | runner yok |
| CP04 Odak/bildirim | kısmi | odak var (KD-03); bildirim tek tetik (KD-04) |
| CP05 Günlük/duygu/review | kısmi | temel var; duygu modeli/ilişki/plan bağı yok |
| CP06 Yerel veri/taşıma | kısmi | log kuyruğu + export var; outbox/restore yok |
| CP07 Uygulama içi AI | büyük ölçüde var | eylem listesi dar |
| CP08 Sadelik/erişilebilirlik | kısmi | sistem var; tek CTA ve render kanıtı yok |

## R01.01-a kartı (DONE)

```yaml
id: R01.01-a
status: DONE
priority: CORE MUST
owner_role: Habit domain
skills: [S02, S03, S08]     # design-habit-domain-model, verify-date-time-and-streak-logic, plan-small-agent-tasks
depends_on: [R00.02]
scope:
  - frontend/lib/habitSchedule.ts                 # mevcut; `periodStatus()` eklenir, `windowFor`/`completedCountInWindow` REUSE
  - frontend/lib/supabase.ts                      # planlandı, GEREKMEDİ: tüm girdiler mevcut tipte; dosya dokunulmadı
  - frontend/__tests__/lib/habitPeriod.test.ts    # YENİ; T01–T04 kanonik fixture'ları
size: S
goal: >
  §7.1 çıktı sözleşmesini tek fonksiyonda kurmak: periodStatus(habit, logs, date) ->
  { window, unit: 'days'|'sessions'|'amount', target, counted, actual, remaining,
    status: not_started|in_progress|satisfied|closed_unmet|paused|unknown, reason }.
  Günlük uygunluk (isDueOn) ile dönem başarısı ayrılır. 'sessions' tipte kabul edilir,
  değerlendirici R05 runner gelene kadar status=unknown, reason='sessions_unsupported' döner.
acceptance:
  - Sal/Per/Paz done kayıtları, weekly count=3 -> satisfied (T01)
  - aynı gün 3 kayıt -> counted=1 gün (günde-bir-log değişmezi korunur) (T02)
  - ayın 12'si, monthly count=10, 4 done -> in_progress, remaining=6; closed_unmet DEĞİL (T03)
  - hafta sonu ve done<count -> closed_unmet; hafta ortası ve yetişilebilir -> in_progress
  - status='paused' alışkanlık -> paused; count<=0 -> unknown, reason='no_target'
  - daily/weekly_days/every_n_days/date_range -> window=null, status günlük uygunluktan türer (mevcut isDueOn ile birebir)
  - hiçbir mevcut test değişmez; hiçbir tüketici bu kartta değişmez
validation:
  - npx jest __tests__/lib/habitPeriod.test.ts __tests__/lib/habitSchedule.test.ts __tests__/lib/phase1Adversarial.test.ts
  - npm run typecheck:ci && npm run lint:ci
risk: Yeni API tüketicisiz kaldığında "yazıldı ama bağlanmadı" — R01.02-a/b bu kartın ardılıdır ve aynı fixture'ı kullanır.
rollback: Eklemeli; fonksiyon ve tip silinerek geri alınır, veri etkisi yok.
effort: S
next: R01.02-a
```

**R01.02-a (DONE, M):** `isDueOn`'un `weekly_count` dalından `countDueDays` kaldırılır — sayı tabanlı modlarda **her gün uygundur** (kaçırma günlük değil dönemseldir); `scheduledCompletionRate` count modlarında paydayı `periodStatus` penceresinden alır. Kabul: T01 tüm `isDueOn` tüketicilerinde sahte kaçırma üretmez; mastery oranı Sal/Per/Paz için 1.0. Scope: `habitSchedule.ts`, `habitSchedule.test.ts`, `phase1Adversarial.test.ts` (gerekçeli güncelleme), `capacity` testleri.
**R01.02-b (DONE, M):** tüketici geçişi tamamlandı — `reportMetrics`, `behaviorIntelligence`, `recovery.tsx`, `weekly/monthly-review`, `insights` **ve** kapsam listesinde olmayan ama aynı kusuru gösteren `habit-detail.tsx` → dönem semantiği; bayat "migration bloklu" yorumları düzeltildi (KD-05). Kanıt aşağıda.

### "R01.02-a gerçekten ilk READY kart mı?" — cevap

Hayır, iki nedenle: (1) rehberin kendi bağımlılığı `depends_on: [R00.02, R01.01]`;
(2) kod kanıtı: pencere değerlendiricisi (`windowFor`/`isWindowSatisfied`/`streakBroken`)
zaten var ve test edilmiş, eksik olan **§7.1 çıktı sözleşmesi** (R01.01) ve
**`isDueOn`'un sabit-gün dalı + tüketiciler** (R01.02-a/b). Bu yüzden ilk kart
R01.01-a'dır; R01.02-a onun ardından, envanterdeki daraltılmış kapsamla gelir.
Helper reuse: `windowFor`, `completedCountInWindow`, `startOfWeekLocal`,
`addDaysLocal`, `daysBetweenLocal`, `ymd` — yeniden yazılmaz.

## CORE_AUDIT aşaması (2026-10-08) — kart kanıtı ve gerekçeli yeniden hedeflemeler

Her kartın satırı `CORE_AUDIT.md`'dedir; burada yalnız mevcut testlere dokunan değişikliklerin gerekçesi durur. Hiçbir test silinmedi ya da gevşetilmedi.

- **R01.02 (`2f26c78`)** — `costCorpus` bilinmeyen-tür vakası `'yearly'` → `'fortnightly'` (yearly gerçek tür oldu); `costPreservation` dökümdeki etiketi hash'ten önce geri eşler, eski SHA birebir üretildi. `intervalRangeValidator` tür listesi metni `daily/weekly/monthly/yearly`. `habitFormFrequency` A9: radiogroup listesine `Aylık tür`, `Kısa ay kuralı`, `29 Şubat kuralı`; checkbox 1→2 (ay günü ızgarası), button 2→4 (yıllık gün −/+); sayaç koşulu yeni aylık alt-moda göre.
- **R01.06 (`09e3e53`)** — mevcut teste dokunulmadı. Yeni kapı `LOG_TIMEZONE_ENABLED = false` (033 uygulanınca çevrilir).
- **R01.07** — `app/screens/recovery.tsx`'deki backlog yürüyüşü kelimesi kelimesine `lib/recoveryBacklog.ts`'e taşındı (saat parametre). `periodConsumerMigration` guard'ının dört `recovery.tsx` hedefi aynı kalıplarla yeni dosyaya taşındı (count-guard ×2, `isEligibleOn(h, dObj)` ×2, `isDueOn` yok); ekran artık `recoveryBacklog`/`consecutiveMissedDue` çağırıyor.
