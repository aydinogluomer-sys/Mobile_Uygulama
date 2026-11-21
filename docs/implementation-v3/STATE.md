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
live_schema_audit: 2026-10-09  # salt-okunur, sahip izniyle (LIVE_SCHEMA_AUDIT.md): canlı BOŞ DEĞİL (6 kullanıcı, 7 alışkanlık, 13 log); 028-035 yok; S11 cevaplandı (sil+yeniden yaz XP/seri çiftliği) -> 036 önerisi; KD-10/11 = 0; şema dökümü supabase/live_schema.sql (izlenmiyor, sahip)
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
core_closed_at: 2026-10-08  # CORE_AUDIT: 78 DONE / 3 BLOCKED (S11, S7, S13) / 5 N/R / 0 PARTIAL / 0 NOT_STARTED -- R10_ACCEPTANCE_REPORT.md, R11_CORE_CLOSURE.md
next_ready_card: none (owner decisions: SQL_FOR_OWNER.md order, S3 deploy, S11/S7/S13)  # was R01.03-b   # undo: a day back to "no record" (habitLogRepository has insert/update, NO delete) -- new capability + UI. R01.03-a (value = day total, state from the service) DONE. Open, not blocking: KD-08..KD-12, R01.06-b
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
core_implementation: COMPLETE_3_OWNER_BLOCKED   # 2026-10-08: CORE_AUDIT.md'de PARTIAL/NOT_STARTED yok (repo/acceptanceReport.test.ts); BLOCKED: R01.03-b S11, R02.07 S7, R05.05 S13
core_quality: NOT_MEASURED   # otomatik kanıt yeşil (typecheck/lint/run-tests/jest 2x/diff-check); kullanıcı/cihaz/model ölçümü N/R -- 9-9,5 hedef, henüz kanıtlanmadı
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
- **R02.03/05/06 + R10.04** — günlük, not, recovery planı ve odak oturumu core outbox'a geçti (yerel-önce). Gerekçeli yeniden hedeflemeler: `layerBoundary` — `journalStore`/`noteStore` CRUD_ONLY → ORCHESTRATED (yazma artık outbox komutu, sürüm/çakışma kuralı var); focusService çapası `if (!session.ok)` → `if (!delivered)` (kural aynı: yalnız sunucunun kabul ettiği oturum kredilenir; `session.ok` artık yalnız "cihazda tutuldu" demek). `recoveryStoreAnalytics` — plan id'si cihazda üretiliyor (olay o id'yi taşır); reddedilen insert artık planı KAYBETMİYOR (kuyrukta görünür, olay yok); her testte core outbox sıfırlanıyor (modül tekil). `recoveryMakeup` — plan kapatma artık outbox yazması; "kapatılmadı" iddiası `coreOutbox.write` üzerinde. `syncLifecycleWired`/`taskOutboxWired` — rozet ve oturum satırları core outbox sayılarını/çağrılarını da içeriyor. Bilinen sınır: çevrimdışı tamamlanan odak oturumu kaybolmaz ve sonra teslim edilir, ama görev kredisi ve `focus_completed` yalnız anında kabul edilen oturum için yazılır.
- **R03.07** — `smallStartWired` / `todayLightDayWired`: "İlk adımı seç:" ve hafif gün cümleleri ekran kaynağından `lib/flowCopy.ts`'e taşındı; guard artık cümlenin orada olduğunu VE ekranın `{FLOW_COPY.firstStep}` / `{FLOW_COPY.lighten}` render ettiğini doğruluyor (iddia aynı, kaynağı tek).
- **R06.02** — `todayScreen` R03.01 render testi: ayrı ŞİMDİ kartı hero'nun tek baskın eylemine birleşti; aynı iddia (tek sonraki adım, açık oturum devralır, dokununca odak ekranı) artık o düğmenin etiketi (`Başla: …` / `Devam et: …`) üzerinde.
- **R06.04** — `designTokensRatchet` tarayıcı sağlama satırı sabit `827E72` yerine `colors.textFaint`'i okur (token değeri bu kartta AA kontrastı için değişti; iddia aynı).
- **R09.02** — `coachV2Wired` CHECK testi: istemcinin listesi artık **güncel** tanımla (son migration, 034) karşılaştırılır; 032 düzenlenmedi ve testte tarihsel olarak ilk beş tür + NOT APPLIED olarak hâlâ doğrulanır. `coachActionsV2` "beş tür" testi → "altı tür" (liste bilerek büyüdü, iddia aynı: tam liste ve sırası).
- **R09.04** — `coachV2Wired` CHECK testi güncel tanım olarak 035'i okur ve 035'ten sonra kısıtı yeniden tanımlayan migration olmadığını da doğrular; 034 ve 032 tarihsel listeleriyle hâlâ doğrulanır. `coachActionsV2` "altı tür" → "yedi tür" (liste bilerek büyüdü).
- **R10.05** — `ui/coachLightenWeek` beklentileri sayıları ham (`12.5`) yerine `decimalTR` ile kurar: kart artık Türkçe ondalık yazıyor; iddia (önce→sonra yük, seçim) aynı.
- **Canlı denetim (036)** — `migrationRlsGuard`: "GRANT yok / SECURITY DEFINER yok" kuralı 036'nın daraltıcı biçimlerine izin verecek şekilde yeniden hedeflendi: yalnız `GRANT EXECUTE … TO authenticated` ve `GRANT INSERT (sütunlar) … TO authenticated`, ikisi de aynı nesnenin REVOKE'undan sonra; SECURITY DEFINER yalnız `search_path` sabit ve EXECUTE'u aynı dosyada PUBLIC/anon/authenticated'dan alınmış fonksiyonda. anon/public'e açma, `USING (true)`, RLS kapatma hâlâ yasak; 6 mutant öldürüldü.
- **R08.01** — `backupRestore` R08.05 testi: geri yüklenmeyen koleksiyon listesi yeni YALNIZ-DIŞA-AKTARIM koleksiyonlarıyla genişletildi (önceden geri yüklenebilen hiçbiri taraf değiştirmedi). `exportBackup` testi yeni genel okuyucu `fetchOwnedTable` ve `lib/supabase` için mock aldı (bağımlılık eklendi, iddia değişmedi).

## Claude 360 planı (`implementation.md`, 50 faz) — faz kanıtları

Plan sahibin 2026-11-02 onayıyla uygulanıyor; dal `feature/claude-360-implementation`, her faz kendi kabul kapısını geçince yerel commit'lenir, push/PR/merge sahibin kararıdır (OD-21). Canlı veritabanına dokunulmaz; migrasyonları sahip `SQL_FOR_OWNER.md` sırasıyla uygular (OD-02). Ertelenmiş kapılar (`featureGates.ts`) sahip kararı olmadan değişmez.

### F00 (2026-11-02) — `9c37f93`, `05ca519`

**Sahip kararı OD-01 (sahip uygulayıcıya bıraktı):** çalışma ağacındaki commit edilmemiş `frontend/repositories/shared.ts` düzenlemesi (eager `dynamicClient` sabiti) tembel erişimciyle değiştirildi; düzenleme işlevsel kazanç getirmeden 22 testi kırıyordu, kaybolan bir şey yok. `docs/ADERYTH_360_AUDIT_AND_COMPETITOR_REPORT.md` üzerindeki 2 boş satırlık değişiklik (IDE biçimlendiricisi) commit'lere alınmadı ve çalışma ağacında bırakıldı: geri almak yerel bir silme işlemidir, sahip isterse `git checkout -- docs/ADERYTH_360_AUDIT_AND_COMPETITOR_REPORT.md` ile atar. Dört CR-farklı dosya (`settings.tsx`, `stats.tsx`, `CoachActionCard.tsx`, `components/ui/index.ts`) `.gitattributes` sonrası `git add --renormalize` ile içerik değişmeden temizlendi (sahne boş kaldı); `supabase/predeploy_guard.sh` yerel kopyası LF'ye çevrildi (`i/lf w/lf`, blob aynı).

**Değişenler:** `repositories/shared.ts` (sözleşme yorumu + `(): SupabaseClient =>` tembel erişimci, 8 çağrı `dynamicClient()`), `.gitattributes` (planın listesi + `*.pdf binary`), `__tests__/repo/repositorySharedLazyClient.test.ts` (11 test), `__tests__/repo/lineEndings.test.ts` (7 test). İkinci commit F00 kabul kapısının web export maddesi için öne çekildi: `lib/localReadCache.ts`'in üst düzey `expo-sqlite` içe aktarması web paketini "Unable to resolve module ./wa-sqlite/wa-sqlite.wasm" ile tamamen düşürüyordu (GAP2-12, P3 -> P1). Çözüm platform dikişi: `lib/sqliteDriver.native.ts` (tek çalışma zamanı içe aktarıcısı), `lib/sqliteDriver.ts` (web, yalnız `import type`, `null`); guard `__tests__/repo/sqliteWebBoundary.test.ts` (8 test). Planın F18'deki `require('expo-sqlite')` önerisi bu hatayı gidermezdi (Metro `require`'ı grafiğe alır); `implementation.md` izlenebilirlik satırı, F18 ve F49 buna göre notlandı.

**Mutasyon kanıtı:** eager `dynamicClient` mutantı -> `repositorySharedLazyClient`, `repositoryBoundary`, `paginationRuntime` kırmızı (27 başarısız); `localReadCache`'e eklenen üst düzey `import * as … from 'expo-sqlite'` mutantı -> `sqliteWebBoundary` kırmızı. Her iki dosya byte-identical geri yüklendi (`cmp`).

**Kapılar (son koşu):** `typecheck:ci` 0, `lint:ci` 0, jest 267/267 suite (3475 test), `run-tests.js` 145/145, `npx expo export --platform web` 0 (2772 modül), `bash supabase/predeploy_guard.sh` 0 (kanonik ref) ve yasaklı ref guard dosyasından okunarak 1. Bir tam jest koşusunda `todayScreen.test.tsx` R03.07 5 sn sınırını ana makine yükü altında aştı (tek başına 7/7 yeşil, sonraki iki tam koşu yeşil); bu makinede duvar saati sinyal değildir.

**Plan düzeltmesi (yayından önce):** `crossProjectIsolation.test.ts` kural A/B, yasaklı proje kimliğinin `implementation.md` ve sentez raporunda geçmesini reddetti; iki belgede kimlik `<DENIED_REF>` ile değiştirildi ve F08'in tasarımı kara liste sabiti yerine kapalı-varsayılan izin listesine (yalnız kanonik ref) çevrildi; test komutları kimliği `supabase/predeploy_guard.sh` `DENIED=` satırından okur.

### F01 (2026-11-02) — bu commit

**Faz:** SQL davranış kapısı: `db-migrations-verify` yeşil ve kanıt üreten (G0; DB1-05, TST-01, TST-V01, TST-07, BLD-14). **Durum: DONE (CI KANITI BEKLİYOR).** Faz canlıya hiçbir şey yazmaz (sahip kararı yok; OD-02 bloklamaz). Push yok (OD-21): gerçek GitHub CI koşusu sahip dalı taşıyınca üretilir ve `supabase/tests/expected_failures.txt` o ilk çıktıyla bir kez daha mutabık kılınır. O zamana kadarki kanıt: bu makinede ne `psql` ne Docker var; `ci.yml`'in `db-migrations-verify` adımlarının GERÇEK `run:` betikleri (YAML'dan çıkarılıp `bash -e` ile; bootstrap + `live_schema.sql` yerine aynı SQL'i uygulayan harness taban çizgisiyle) yerel tek kullanımlık Postgres 17.6'ya (embedded-postgres, 127.0.0.1) karşı koşturuldu. `psql` yerine yalnız bu fazın kullandığı bayrak kümesini uygulayan küçük bir öykünücü kullanıldı (deyimleri tek tek gönderir, NOTICE'lar stderr'e, `ON_ERROR_STOP` çıkış kodları 3/1). Harness ve öykünücü depoda değildir.

**Değişenler:** `.github/workflows/ci.yml` (guard tek adım -> yorum + üç adım `:119-142`; fixture `'binary'` -> `'boolean'` `:289`; yeni son adım `:339-340`), `.github/workflows/supabase-release-verify.yml` (`:41-50` guard adımı İKİ komut: düz `bash supabase/predeploy_guard.sh` ve `env -u SUPABASE_PROJECT_REF bash supabase/predeploy_guard.sh`; sapma 11), yeni `supabase/tests/` (`run.sh`, `01_client_cannot_write_server_tables.sql`, `02_security_definer_hygiene.sql`, `03_xp_drift_zero.sql`, `04_today_bootstrap_isolation.sql`, `05_concurrency_spend.sh`, `expected_failures.txt`), yeni `frontend/__tests__/repo/sqlBehaviorTestsWired.test.ts` (74 test), `docs/implementation-v3/SQL_FOR_OWNER.md` §8 (dosya ayrıca LF'ye normalize edildi, içerik aynı). `predeploy_guard.sh`, `config.toml`, `live_schema.sql`, 037, `ciGatesWired`, `crossProjectIsolation`, `migrationRlsGuard`, `run-tests.js` DEĞİŞMEDİ. Migration yok. Kullanıcı yüzeyi yok: görsel QA "değişiklik yok", web export gerekmedi.

**DB1-05 önce/sonra:** HEAD'deki `ci.yml` aynı harness'te `Apply forward migrations 028+` adımında `new row for relation "habits" violates check constraint "habits_tracking_type_check"` ile düşer (çıkış 3, u1/u2 izolasyon bloğu hiç çalışmaz). Düzeltilmiş `ci.yml` üç adımı da çıkış 0 ile geçer: 037 ön kontrolü, 028+ döngüsü ve u1/u2 izolasyon bloğu, yeni davranış adımı.

**Sonuç (`run.sh`, `live_schema.sql` + 028-037):** 62 sonuç, 41 PASS, 20 FAIL (hepsi listedeki `T02b_search_path.*`), 1 INFO. `T01a-q`, `T01z1-5`, `T02a`, `T02c-e`, `T03a-d`, `T04a-f`, `T05a-e` PASS: gizlenen gerçek bir açık çıkmadı, bu yüzden STATE'e P0 notu düşülmedi. `T05` altı ardışık koşuda kararlı. Canlıya eşdeğer taban çizgisinde (yalnız `live_schema.sql` + 037; `04` koşamaz, `habit_pauses` yok) aynı testler 34 ek kırmızı verir: `T01a-c` ve `T01z2` (`weekly_xp`, TST-V01), `T01g`, `T01i`, `T01l` ve anon'un çalıştırabildiği 27 SECURITY DEFINER fonksiyon (`T02a.*`); yani 036'nın canlıya uygulanması (OD-02) bunları kapatır ve test bunu kanıtlar. 036 uygulanana kadar canlıda bu açıklar vardır.

**Sapmalar (planın hatalı ya da uygulanamaz yerleri; her biri sınandı):**

1. SQL testlerinden `\set ON_ERROR_STOP on` çıkarıldı: dosyalar saf SQL kalmalı (harness ve CI psql aynı dosyayı koşar); `run.sh` zaten `-v ON_ERROR_STOP=1` verir.
2. Planın `psql ... | grep ... || true; [ "${PIPESTATUS[0]}" = 0 ]` döngüsü psql hatasını göremez: `|| true` `PIPESTATUS`'u sıfırlar ve hata metnini de grep'ler (bozuk `SELEKT 1;` dosyasıyla çıkış 0 verdiği gösterildi). Çıkış kodu doğrudan okunur, hata metni basılır, `HARNESS ERROR` çıkış 3.
3. Plan glob'u `0[0-9]_*` yalnız 01-09'u koşar; plan 10-14'ü ayırıyor (F14 `10_`, F15 `11_`, F21 `12_`, F38 `13_`, F42 `14_`) ve bunlar sessizce atlanırdı. `[0-9][0-9]_*`, `.sql` ve `.sh` tek sayısal sırada; adlandırmaya uymayan dosya `HARNESS ERROR`.
4. `05`: `ok::text` `true/false` basar, planın `t:f`/`t:t` sayımı `T05d`'yi her zaman kırmızı yapardı; `ok::int || ':' || replayed::int` (`1:0`/`1:1`) kullanıldı. Her sonuç adı bir kez bildirilir (`report`/`info`): planın `PASS || FAIL` çifti adı iki kez yazıyordu ve tekillik guard'ıyla çelişiyordu. Sonuç ve hata dosyaları ayrı önekli (planın `A.[0-9]*` glob'u `.err` dosyalarını da okurdu); temizlik EXIT tuzağında.
5. `profiles` tohumu: dormant `on_profile_created_pet` `pet_stages` FK'sinde düşer. Yalnız o INSERT `SET LOCAL session_replication_role = replica` ile yapılır; `03`'te hemen `origin`'e dönülür, XP tetikleyicileri çalışır. `pet_stages` tohumlanmadı (uykudaki RPG tablosuna veri yazılmaz).
6. `expect_allowed` üçüncü bir `p_min_rows` argümanı aldı (varsayılan 0): RLS fixture'ı gizlerse pozitif kontrol boş geçmesin (`T01z1` ve `T01z2` 1 ister). Yardımcı DDL `SET client_min_messages = warning` ile başlar.
7. Planın üstüne koşucu güvenceleri: `PGHOSTADDR` ve `PGSERVICE` de `REFUSED`; yinelenen, ayrıştırılamayan ya da hiç bildirilmeyen sonuç adı ve kötü biçimli `expected_failures.txt` çıkış 4; uzlaştırma `sort/comm` yerine tam eşleşmeli awk (yerel ayardan bağımsız); `RACE_BARRIER_SECONDS` (varsayılan 3, yavaş koşucuda 5); test dosyaları `-q` olmadan koşar (`-o /dev/null` çıktıyı zaten atar, hiçbir ayar NOTICE'ı gizleyemez).
8. Plan Bölüm 5 mutasyon (1), `GRANT INSERT ON weekly_xp TO authenticated`, tek başına `T01a`'yı kırmızı yapmaz: 036 politikayı da düşürdüğü için RLS aynı 42501'i verir (derinlikte savunma). Canlıya eşdeğer mutant kullanıldı (politika + üç yetki).
9. `sqlBehaviorTestsWired.test.ts` plan listesinin üstünde: iki koşucunun `REFUSED`'ini gerçekten çalıştırır (10 `bash` süreci; kelimenin statik eşleşmesi bozuk bir `case` kalıbından sağ çıkardı), beklenen-kırmızı satırlarını canlı dökümdeki sabitlenmemiş SECURITY DEFINER fonksiyonlara bağlar, SQL testlerinin saf, GRANT'siz ve ROLLBACK'li kalmasını ve guard'ın yalnız `env -u` ya da olumsuz kontrol biçiminde çağrılmasını kilitler. Yasaklı proje kimliği bu dosyaya yazılmaz; `supabase/predeploy_guard.sh`'ın `DENIED=` satırından çalışma zamanında okunur.
10. `git update-index --chmod=+x` indeksi değiştirir; bu faz indekse dokunmaz. Yürütme biti varsayılmaz (`bash supabase/tests/run.sh`, `run.sh` içinden `bash "$f"`). Windows'ta `core.fileMode` kapalıdır; bu yüzden commit eden (Gate+Commit) `git add` ile aynı adımda `git update-index --add --chmod=+x supabase/tests/run.sh supabase/tests/05_concurrency_spend.sh` çalıştırdı ve `git ls-files -s supabase/tests` ile `100755`i doğruladı (yoksa Linux'ta `./supabase/tests/run.sh` çalışmaz).

**İnceleme turu (aynı gün, commit öncesi) — ek sapmalar ve düzeltmeler:**

11. **Yayın iş akışı guard adımı tek `env -u` değil iki komut (plan metninden sapma; anayasa A.1 önce gelir).** Plan Bölüm 4 adım 3 adımı yalnız `env -u SUPABASE_PROJECT_REF bash ...` yapar. Oysa `supabase-release-verify.yml`'de iş düzeyi `SUPABASE_PROJECT_REF` sonraki adımın CANLI hedefidir: `tools/verify-edge-deployment.mjs --project-ref "$SUPABASE_PROJECT_REF"` bu değişkenle `GET /v1/projects/<ref>/functions` çağırır ve kendi kanonik kontrolü yoktur; guard o adımda tam olarak bu değişkeni denetliyordu. Tek `env -u` guard'ı `config.toml`'a çevirir ve fiilen kullanılan hedefi denetlemeyi bırakırdı (yeniden üretildi: iş düzeyi ref `not-the-canonical-ref` iken eski adım `DEPLOY BLOCKED` çıkış 1, tek `env -u` adımı çıkış 0). Anayasa A.1 "bu iki koruma hiçbir fazda gevşetilmez" dediği için adım önce düz `bash supabase/predeploy_guard.sh` (iş düzeyi ref, eski denetim aynen), sonra `env -u SUPABASE_PROJECT_REF bash supabase/predeploy_guard.sh` (`config.toml` pin'i, BLD-14) koşar. `ci.yml`'de iş düzeyi ref ve dağıtım yoktur: orada planın biçimi (`env -u` + iki olumsuz kontrol) aynen kalır. Jest guard'ı bunu hem metin hem YÜRÜTME olarak kilitler (yanlış iş düzeyi ref engellenir, sürüklenmiş `config.toml` engellenir) ve iş düzeyi ref'i guard'ın `CANONICAL=` değerine eşitler.
12. **İkinci güvenlik katmanı: veritabanı parmak izi.** Yerel adres tek başına güvence değildir (canlı veritabanına SSH ya da havuz tüneli, yerel Supabase CLI yığını `127.0.0.1`'dir; `01` ve `05` kalıcı satır yazar). `run.sh` ve `05`, hiçbir şey yazmadan, temizlik tuzağı ve yardımcı şema kurulmadan ÖNCE salt-okunur tek katalog sorgusu çalıştırır: `auth.users`'ta GoTrue'nun `encrypted_password` sütunu yok VE bağlanan kullanıcı superuser ise devam eder, değilse `REFUSED` çıkış 2 (ulaşılamayan veritabanı çıkış 3). CI bootstrap stub'ı bu sütunu taşımaz ve `postgres` kullanıcısı superuser'dır. İncelemenin diğer seçeneği (yalnız CI'ın verdiği `ADERYTH_THROWAWAY_DB=1` onay değişkeni) alınmadı: değişken kabuk geçmişinde unutulabilir, katalog denetimi insan disiplinine dayanmaz ve `ci.yml` iş env'ine dokunmaz. SQL_FOR_OWNER.md §8'deki "Supabase projesine bağlanmak mümkün değildir" cümlesi bu yüzden "güvence katmanıdır, mutlak değildir; hedef tek kullanımlık olmalı" olarak yeniden yazıldı.
13. **`01`'e "satır değişmez" probları.** Yeni yardımcı `expect_no_effect` (42501 ya da 0 satır etkilenirse PASS, bir satır değişirse FAIL) ve beş probe: `T01m` `user_subscriptions` DELETE, `T01n`/`T01o` `credit_transactions` UPDATE/DELETE, `T01p`/`T01q` `ai_requests` UPDATE/DELETE. Bu tablolarda tablo yetkisi açık kalır (`authenticated`: `SELECT,INSERT,DELETE,MAINTAIN,UPDATE`), satırı yalnız yalnız-SELECT RLS politikası korur; `FOR ALL` politikası ekleyen bir regresyon eski kapıyı yeşil bırakırdı (`user_subscriptions` DELETE'i sonra `get_or_init_subscription()` ile 30 FP'lik bakiye yenilemesi). Probeler boş geçmesin diye tohum `credit_transactions` ve `ai_requests` satırı eklendi; `T01z3`-`T01z5` sahibin `user_subscriptions`, `credit_transactions` ve `ai_requests` satırlarını GÖRDÜĞÜNÜ kanıtlayan pozitif kontrollerdir. `expect_denied` isteğe bağlı üçüncü `p_message` argümanı aldı: `T04e` fonksiyonun KENDİ `authentication required` hatasını bekler (bekçi satırı kalkarsa `willpower_state` RLS'inden başka bir 42501 gelir; ilk turdaki "eşdeğer" mutant artık öldürülüyor).
14. **Koşucu ile jest aynı dosyayı aynı okur.** `run.sh` bildirilmiş adları SQL dosyasını tek satıra düzleştirerek arar (`res(` + satır sonu + `'T..'` jest ile aynı sayılır); beklenen listede baştaki boşluğu da soyar (jest satırı `trim()` ediyordu: girintili bir satır jest'te yeşil, CI'da `MALFORMED` idi); `T02a_anon_execute.*` ve `T02b_search_path.*` aile varlığını zorunlu kılar (nokta taşıyan adlar sabit adlar kontrolüne girmez; `T02a` bloğu silinse CI yeşil kalırdı; bulunamazsa çıkış 4 `MISSING RESULT FAMILY`).
15. **Jest guard düzeltmeleri.** (a) `bash` çözümleyici: Windows'ta PowerShell/cmd/VS Code terminalinde düz `bash` WSL başlatıcısıdır (`C:\Windows\System32\bash.exe`, çıkış 1); `GIT_BASH` ya da `Program Files\Git\bin\bash.exe` kullanılır, probe testi çözülen yolu adıyla bildirir. (b) "son adım" iddiası kaldırıldı: F02 dört adımı bu adımın SONRASINA ekler; yalnız sıralama (028+ adımından sonra, gerçek `run:` satırı) ve iş üyeliği kalır. (c) Boş `expected_failures.txt` geçerli (F09 20 satırın hepsini siler): `entries.length > 0` ve koşulsuz başlık iddiası kalktı, başlık yalnız girdi varken istenir. (d) Guard adımları GERÇEKTEN çalıştırılır: gerçek guard'la üç adım geçer; her şeyi kabul eden guard'la olumlu adım geçer ve iki olumsuz kontrol çıkış 1 verir; `config.toml`'u yok sayan guard'la olumlu adım düşer; sürüklenmiş pin gerçek guard'a takılır. (e) `run.sh`'ın kendi yolları sahte `psql` ile çalıştırılır (17 senaryo + `05` reddi): `UNEXPECTED`, `STALE`, `MISSING`, `DUPLICATE`, `TOO FEW`, ayrıştırılamayan satır, aile yokluğu, harness hatası (3), ret (2), boş liste, girintili liste satırı, iki satıra bölünmüş bildirim; reddedilen hedefe yalnız parmak izi sorgusu gider. (f) `supabase db push` / `link` / `functions deploy` taraması `ci.yml`, yayın iş akışı ve `supabase/tests/**` ile sınırlı; sahip runbook'u (`SQL_FOR_OWNER.md`) komutları sahibe anlatmak zorunda olduğundan (F21 gibi sonraki fazlar oraya `supabase functions deploy` yazar) komut taramasından çıkarıldı, yasaklı ref taramasında kalır.
16. Yorum dili: üç yerde "F13" kapsam eki iptal ailesini anlatıyordu; faz kimliğiyle karışmasın diye "scope-addendum F13" yazıldı (anayasa H). `run.sh` başlığına ve SQL_FOR_OWNER.md §8'e "`supabase test db` bu dizine yöneltilmez" uyarısı eklendi (Supabase CLI'nin pgTAP koşucusu testleri geleneksel olarak `supabase/tests/` altında arar; buradaki dosyalar pgTAP değildir ve `01` ile `05` kalıcı satır yazar; CLI davranışı bu makinede doğrulanamadı, uzak CLI çağrısı yasak).

**Mutasyon kanıtı (taban yeşilken; hepsi geri alındı):**

| Katman | Mutant | Sonuç |
|---|---|---|
| SQL (26, harness veritabanında) | `weekly_xp` canlı deliği geri (politika + yetki); `spend_focus_points_v2`'de `FOR UPDATE` yok; anon'a `get_or_init_subscription` EXECUTE; `profiles.total_xp` sütun yetkisi; bayat XP'li profil; `trg_habit_log_award` kapalı; `habits`/`tasks` için `USING (true)`; anon'a `get_today_bootstrap`; `profiles` tablo INSERT yetkisi; `add_xp` / `xp_drift` authenticated'a; `credit_transactions` INSERT politikası; `user_subscriptions` yazma politikası; anon `weekly_xp` politikası; `ai_request_begin` kontrol-sonra-yaz; harcamada replay araması yok; `level`/`coins` yetkisi; anon `user_subscriptions` UPDATE; `SECURITY DEFINER` + süzgeçsiz bootstrap; `username` UPDATE yetkisi geri alındı; bootstrap sahibin satırlarını gizler; bakiye kontrolü yok; soğuk başlangıç temiz + bakiye kontrolü yok | 23 mutant ilgili `T0x` sonucunu kırmızı yaptı (örnek: `FOR UPDATE` yok -> `T05a winners=8`, `T05b balance=-175`; `trg_habit_log_award` kapalı -> `T03a-c drift=-30`; soğuk başlangıç mutantı -> `T05e balance=-10`); 2 mutant (bootstrap / `xp_drift` EXECUTE geri alındı) `HARNESS ERROR` çıkış 3; 1 mutant (bootstrap'ta kimlik bekçisi satırı yok) ilk turda sağ kaldı: `willpower_state` INSERT'inin RLS'i aynı 42501'i veriyordu; inceleme turunda `T04e` hata metnini sabitleyerek öldürüldü (aşağıda) |
| `run.sh` mantığı (13, scratch kopyada) | yeşil ad listeye eklendi (`STALE`); `T02b` satırı silindi (`UNEXPECTED`); listede olmayan ad (`STALE`); SQL sözdizimi ve `.sh` hatası (`HARNESS ERROR`); uzak `PGHOST`, `PGHOST` yok, `localhost.evil.example`, uzak `PGHOSTADDR`, `PGSERVICE` (hepsi `REFUSED` çıkış 2); tek dosya (`TOO FEW`); yinelenen ad; sıfır satır döndüren (sessizleşen) test (`MISSING`); `6_oops.sql`; bozuk liste satırı; ayrıştırılamayan `RESULT` satırı (hepsi çıkış 3 ya da 4); `10_` önekli dosya koşar | hepsi beklenen çıkış kodunu verdi |
| jest guard (33) | fixture `binary`; adım öne alındı / sona adım eklendi; guard yeniden totolojik; release'te düz `bash ...`; olumsuz kontrol silindi; yorumda `db push`; `case` her ana bilgisayarı kabul eder; `REFUSED` öncesi `psql`; `05`'te red yok; tek haneli glob; yinelenen ad; zorunlu test silindi; listede bulgu kimliksiz / P0'suz güvenlik satırı / olmayan fonksiyon / başlıksız kapatma fazı; test SQL'ine GRANT, meta-komut, doğrudan `total_xp`, COMMIT, geçersiz `tracking_type`; yasaklı kimlik (guard geçici olarak sentetik değere çevrildi); `SQL_FOR_OWNER.md`'de `db push`; `REFUSED` dalı çıkış 0; `./supabase/tests/run.sh` çağrısı; iş düzeyi `PGHOST` yerel değil; release iş düzeyi ref değişkeni silindi; `MIN_RESULTS` yok; `PGSERVICE` reddi yok; araya başka iş başlığı; aynı numaralı ve `6_oops.sql` adlı dosya | 33/33 öldürüldü, her dosya bayt düzeyinde geri alındı (sha256 + `Buffer.equals`), çalışma ağacı değişmedi |
| SQL, inceleme turu (5, harness veritabanında) | `user_subscriptions` için `FOR ALL` politikası; `credit_transactions` için `FOR ALL`; `ai_requests` için `FOR ALL`; `credit_transactions` için yalnız DELETE politikası; `get_today_bootstrap` kimlik bekçisi satırı yok (ilk turun eşdeğer mutantı) | 5/5 öldürüldü, `run.sh` çıkış 1: `T01m`; `T01j`+`T01n`+`T01o`; `T01p`+`T01q`; `T01o`; `T04e` ("42501 for another reason: new row violates row-level security policy for table willpower_state"). İnceleme öncesi kapıda `user_subscriptions` DELETE'i, `credit_transactions` UPDATE/DELETE'i ve `ai_requests` UPDATE/DELETE'i için probe yoktu (`user_subscriptions` için `FOR ALL` mutantının eski kapıda yeşil kaldığı incelemede gösterilmişti) |
| jest guard, inceleme turu (68 mutant, `sqlBehaviorTestsWired.test.ts` tek başına) | yayın adımı yalnız `env -u` / yalnız düz çağrı / iş düzeyi ref başka projeye / düz çağrıda ref elle verilir / iş düzeyi ref silindi; `ci.yml` olumsuz kontrollerden birinde `exit 1` silindi (iki kontrol), kontrol ters çevrildi, sürüklenmiş-`config.toml` kontrolü kanonik pin yazar; olumlu adım düz çağrı / yeniden totolojik; adım öne alındı / araya iş başlığı; `db push` yorumu (`ci.yml`), `functions deploy` (yayın), `supabase link` (`run.sh`); `expected_failures` bulgu kimliksiz / başlıksız / olmayan fonksiyon / P0'suz güvenlik satırı; `run.sh`: aile denetimi, parmak izi karşılaştırması, erken tuzak, STALE, UNEXPECTED, MISSING, DUPLICATE, TOO FEW, UNPARSEABLE, baştaki boşluk, düzleştirme, SQL hatası, `.sh` hatası, `NN_` reddi (çıkış kaldırıldı), parmak izi sorgusu hatası, `PGHOSTADDR`, `PGSERVICE`, `|| true` (boş liste), yardımcı `expect_no_effect`; `05`: parmak izi karşılaştırması / farklı sorgu / `PGHOSTADDR` / `PGSERVICE`; `02` `T02a` bloğu; `04` `T04e` mesajı; `01` probe ve kontrol adı; ilk turdan taşınan 16 mutant | 64 öldürüldü; 3 BİLEREK sağ kaldı (sondan sonra adım eklendi: F02 böyle yapar; `SQL_FOR_OWNER.md`'de `supabase db push` / `functions deploy`: sahip runbook'u; `expected_failures.txt` tamamen boş: F09'un bıraktığı durum); 1 mutant (`K28`, `NN_` reddi) yalnız ileti metnini değiştirdiği için eşdeğerdi ve gerçek karşılığıyla (`K28b`, çıkış kaldırıldı) değiştirilip öldürüldü. Her dosya bayt düzeyinde geri alındı (sha256 + `Buffer.equals`), `git status` değişmedi |

İlk turdaki jest tablosunun üç satırı inceleme turunda BİLEREK tersine döndü ve artık yeşil kalmalıdır: "sona adım eklendi" (F02 dört adımı bu adımın arkasına ekler), "release'te düz `bash ...`" (yayın adımında artık düz çağrı ve `env -u` çağrısı İKİSİ de zorunlu; yalnız `env -u` olan biçim kırmızıdır) ve `SQL_FOR_OWNER.md`'de `db push` (sahip runbook'u komutları anlatır). Karşılıkları yukarıdaki inceleme turu satırında.

Guard adımlarının kendisi: `config.toml` sürüklenmiş bir kopyada ESKİ adım (ref dışarıdan verilir) çıkış 0 (kör), YENİ adım (`env -u`) çıkış 1; guard her ref'i kabul edecek biçimde bozulursa olumsuz kontroller çıkış 1; guard `config.toml`'u yok sayarsa olumlu adım çıkış 1 verir (olumsuz (iii) tek başına yetmez, ikisi birlikte yakalar). İnceleme turundan beri aynı denemeler jest içinde GERÇEKTEN koşar (gerçek guard, her şeyi kabul eden guard, `config.toml`'u yok sayan guard, yayın adımı için yanlış iş düzeyi ref), elle değil.

**Mutasyon kanıtı, Gate+Commit tekrarı (her mutant öncesi tam `reset` ve yeşil taban doğrulaması; yukarıdaki tablodaki mutantlardan beşi bağımsız yeniden koşturuldu):** (1) `weekly_xp`'e izinli politika + INSERT/UPDATE/DELETE yetkisi (canlıdaki delik) -> `T01a`, `T01b`, `T01c`, `T01z2` kırmızı, `run.sh` çıkış 1 `UNEXPECTED FAILURES`; (2) `spend_focus_points_v2`'den `for update` çıkarıldı -> `T05a winners=8`, `T05b balance=-175 debits=8`, `T05d` kırmızı, çıkış 1 (yarışın gerçek olduğunu kanıtlar); (3) `GRANT EXECUTE ON FUNCTION public.get_or_init_subscription() TO anon` -> `T02a_anon_execute.get_or_init_subscription/0` kırmızı, çıkış 1; (4) `trg_habit_log_award` devre dışı -> `T03a-c drift=-30` kırmızı, çıkış 1; (5) `ci.yml` fixture'ı `'boolean'` -> `'binary'` -> `sqlBehaviorTestsWired` 1 başarısız / 73 geçti (`DB1-05: every habits fixture is valid against the live CHECK`), dosya sha256 eşitliğiyle geri alındı. `run.sh` uzlaştırması gerçek veritabanında iki yönlü: geçerli ama yeşil `T01a_weekly_xp_insert_denied` listeye eklenince `STALE` ve çıkış 1; `T02b_search_path.buy_shop_item/1` satırı silinince `UNEXPECTED FAILURES` ve çıkış 1; `PGHOST` yerel olmayan bir adrese çevrilince `REFUSED` ve çıkış 2, hiçbir bağlantı kurulmadan.

**Kapılar (Gate+Commit koşusu, commit anındaki ağaç; sırayla, `timeout` yok, çıkış kodları basıldı):** `npm run -s typecheck:ci` çıkış 0 (çıktı yok); `npm run -s lint:ci` çıkış 0 (çıktı yok); `npx jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB` çıkış 0, 268/268 suite, 3549/3549 test, 94,6 sn; bu STATE.md düzenlemesinden sonra tam jest ve `run-tests.js` bir kez daha: çıkış 0, 268/268, 3549/3549, 90,1 sn, 145/145 (önceki 267 suite / 3475 test: +1 suite, +74 test; guard dosyası uygulayıcının ilk turunda 43 testti); `sqlBehaviorTestsWired`, `crossProjectIsolation`, `ciGatesWired`, `migrationRlsGuard`, `lineEndings`, `scopeAddendum`, `liveSchemaAudit` dahil hiçbir suite kırmızı değil; `node run-tests.js` çıkış 0, 145/145; `git diff --check` izlenen dosyalarda temiz, yeni dosyalarda sondaki boşluk yok ve hepsi LF. `npx expo export --platform web` koşmadı: kullanıcı yüzeyi ve paketleme değişmedi. Uygulayıcı turunda guard dosyası hem Git Bash'ten hem PowerShell'den (orada `bash` WSL başlatıcısı) 74/74 geçti; `GIT_BASH` WSL başlatıcısına çevrilince probe testi çözülen yolu adıyla bildirip kırmızı olur. Edge: değişmedi (Deno bu makinede yok; CI `edge-deno-verify` aynı hedef listesi).

**SQL kapısı (Gate+Commit, yerel Postgres 17.6 harness, canlıya bağlantı yok):** `harness.js reset` (CI bootstrap + `live_schema.sql` + 037 + 028-037) çıkış 0; hemen ardından `bash supabase/tests/run.sh` çıkış 0: 62 sonuç, 41 PASS, 20 FAIL (hepsi `expected_failures.txt`'teki `T02b_search_path.*`), 1 INFO (`T05f`), `OK: the failing set equals expected_failures.txt`. Ayrıca `ci.yml` YAML'ından çıkarılan GERÇEK `run:` betikleriyle zincir (`baseline`, "Verify 037", "Apply forward migrations 028+" ile u1/u2 izolasyon bloğu, "Behavioural SQL tests"): üç adım da çıkış 0. Aynı zincir HEAD'deki `ci.yml` ile `Apply forward migrations 028+` adımında `new row for relation "habits" violates check constraint "habits_tracking_type_check"` ile çıkış 3 verir (DB1-05 önce/sonra bu koşuda yeniden üretildi). Canlıya eşdeğer taban çizgisi (`live_schema.sql` + 037; `04` yok çünkü `habit_pauses` yok): `run.sh` çıkış 1, 34 ek kırmızı: `T01a-c` ve `T01z2` (`weekly_xp`, TST-V01), `T01g`, `T01i`, `T01l` ve anon'un çalıştırabildiği 27 SECURITY DEFINER fonksiyon (`T02a.*`); `T03a-d` ve `T05a-e` orada da PASS. 036'nın canlıya uygulanması (OD-02) bu açıkları kapatır; uygulanana kadar canlıda açıktır. Test bunu CI'daki şemada kanıtlar, canlıyı denetlemez. Harness veritabanı koşu sonunda yeşil CI durumuna (`reset`) getirildi.

**Bulundu, düzeltilmedi:** (a) `T05f` gözlemi: `get_or_init_subscription_for` `ON CONFLICT`'siz INSERT yapıyor (`live_schema.sql:878-906`); hesabın ilk harcamasında 8 eşzamanlı oturumdan 7'si `23505 user_subscriptions_pkey` ile düştü (başka koşuda 1/8); bakiye ve borç değişmezleri korundu. Kredi bütünlüğü fazına (F07, 039) bırakıldı. (b) Dormant `deal_damage_to_active_boss` boss öldüğünde `profiles.total_xp`'i doğrudan artırır (drift üretebilecek tek yol); `global_bosses` boş, EXECUTE 036'da istemcilerden alınıyor; F03 tetikleyiciyi düşürür. (c) `T04f` (anon `get_today_bootstrap` çağıramaz) kimlik bekçisi satırının tek başına kalkmasını ayırt etmez; bekçiyi `T02e` (EXECUTE) ve RLS birlikte tutar. `T04e` ise inceleme turundan beri fonksiyonun KENDİ hata metnini sabitler ve bekçi satırı kalkarsa kırmızı olur.

**Açık:** (1) İlk gerçek CI koşusunda `expected_failures.txt` ile mutabakat (yerel çıktıda fark yok; gerçek `psql`'in NOTICE biçimi ve `-At` çıktısı ancak orada görülür). (2) `supabase/tests/run.sh` ve `05_concurrency_spend.sh` indekse `100755` olarak yazıldı (`git update-index --add --chmod=+x`; Windows'ta `core.fileMode` kapalı olduğundan düz `git add` 100644 yazardı), `git ls-files -s supabase/tests` ile doğrulandı. (3) Commit özeti bu başlıkta yok ("bu commit"); F00'daki gibi ayrı bir `docs(state)` commit'i eklenebilir. (4) `T02b` 20 satırını F09 siler. (5) Sahip kararına bağlı, bu faza ait yapılmamış adım yok; 036'nın (ve 028-035, 037'nin) canlıya uygulanması OD-02'dir, sahip `SQL_FOR_OWNER.md` ile yapar ve bu fazı bloklamaz. (6) Faz `featureGates.ts`'e dokunmadı, F13/F14/F15 yüzeyi eklenmedi; `docs/ADERYTH_360_AUDIT_AND_COMPETITOR_REPORT.md` içindeki sahibin 2 satırlık değişikliği commit'e alınmadı.

### F02 (2026-11-02) — bu commit

**Faz:** Geri alma sözleşmesi: 028-037 geri alma betikleri ve CI'da uygula, geri al, yeniden uygula döngüsü (G0; DB1-15, DB2-07). **Durum: DONE (CI KANITI BEKLİYOR).** Faz canlıya hiçbir şey yazmaz: sahip kararı yok; canlıya uygulama OD-02'ye (ve OD-04'e) bağlıdır ve bu fazı bloklamaz. Push yok (OD-21): gerçek GitHub CI koşusu sahip dalı taşıyınca üretilir. O zamana kadarki kanıt, F01'deki gibi, `ci.yml`'in `db-migrations-verify` işinin GERÇEK `run:` betikleridir: YAML'dan çıkarılıp `bash -e` ile, taze bir yerel tek kullanımlık Postgres 17.6'ya (embedded-postgres, 127.0.0.1) karşı, bootstrap adımı dahil sırayla koşturuldu; koşan 15 adımın hepsi çıkış 0. `psql` yerine F01 öykünücüsünün ardışık `-c`/`-f` ve `VERBOSITY=verbose` desteği eklenmiş hali kullanıldı (gerçek psql gibi aynı oturumda, sırayla). Bu çalışma ağacında `supabase/live_schema.sql` hâlâ CRLF (indeks LF): CRLF'li dosya `fn_habit_log_award` gövdesine `\r` sokar (849 yerine 877 bayt, `md5(prosrc)` değişir), bu yüzden dosyalar LF aynasına kopyalanarak koşturuldu; `.gitattributes` (`eol=lf`) sayesinde taze bir CI checkout'u LF'dir.

**Değişenler:** yeni `supabase/rollbacks/` (`README.md`, `catalog_fingerprint.sql`, `028`-`037` için on `NNN_<ad>.rollback.sql`), yeni `frontend/__tests__/repo/migrationRollbackPresent.test.ts` (115 test), `frontend/__tests__/repo/migrationRlsGuard.test.ts` (+3 test), `.github/workflows/ci.yml` (`db-migrations-verify` işine 10 adım; mevcut adım silinmedi, yeniden adlandırılmadı, yeniden sıralanmadı), `supabase/migrations/README.md` (`## Rollbacks`; tablo satırlarına dokunulmadı), `docs/implementation-v3/SQL_FOR_OWNER.md` (§1 tablosu 6 sütun + 037 satırı, "Geri alma nasıl çalıştırılır", §2.10). `supabase/migrations/*.sql` dosyalarının hiçbiri değişmedi (`git diff --stat -- 'supabase/migrations/*.sql'` boş). `featureGates.ts`, Edge Function, UI, kapsam eki F13/F14/F15 yüzeyi: dokunulmadı.

**CI döngüsü (yeni adımlar, sırayla):** taban parmak izi (`live_schema.sql` tek başına, 037 ve 028+ öncesi) -> mevcut 037 ön denetimi, 028+ ileri uygulama, F01 `run.sh` -> ileri parmak izi -> olumsuz kontroller (her betik onaysız ve komşu numarayla reddedilir; hatada DURMAYAN bir istemci de denenir; 038'in `fn_habit_log_guard`'ı varken 036 reddeder; hiçbiri katalogu değiştirmez) -> 037'den 028'e geri alma (her betik kendi numarasıyla) -> geri alınmış katalog taban ile `diff -u` eşit ve `xp_drift()` 0 satır -> ikinci geri alma turu (036 hariç no-op, 036 "not applied" ile reddeder) -> yeniden ileri uygulama, ikinci ileri parmak izi ilkine eşit, `run.sh` yeniden yeşil -> DB2-07 gerçek satırlarla -> kasıtlı yeni türde satırla 032/034/035 -> parmak izi öz-sınaması. Parmak izi: taban 1150 satır, ileri 1364 satır, aralarında 280 diff satırı (karşılaştırma boş değil); geri alınmış katalog tabana BİREBİR eşit çıktı: planın SQL'i (ACL'leri `acldefault` ile normalleştiren parmak izi dahil) olduğu gibi çalıştı. 036'nın 27 fonksiyonluk EXECUTE listesi canlı dökümle ve 036'nın kendi REVOKE satırlarıyla satır satır karşılaştırıldı (jest, türetilmiş): planın `anon` ayrıntısı (`get_weekly_leaderboard`, `get_or_init_subscription`) doğru çıktı.

**DB2-07 (gerçek satırlarla, CI adımı):** bir kullanıcı iki "done" günü yazar, ikisini siler, birini daha düşük ama sıfır olmayan ödülle (`partial`, `value 0`) yeniden yazar. Defter her günün en yüksek ödülünü tutar, `total_xp` bir kez artmıştır, `habit_logs` taşımaz: `xp_drift()` o kullanıcıyı +15 ile raporlar (fixture boş geçmiyor: `drift > 0` ve "yeniden yazılan gün defterin tuttuğundan düşük ama sıfır değil" ayrıca sınanır). (a) XP elle zaten düzeltilmişse (`purged_xp += 15`) geri alma yeni bir drift'li kullanıcı üreteceği için `would add xp_drift rows` ile reddeder ve tüm transaction geri sarılır (defter duruyor, `anon` EXECUTE kapalı, `purged_xp` değişmedi). (b) Düzeltme geri alınıp betik koşunca `purged_xp = 15`, `xp_drift()` 0 satır, defter yok. (c) 036 yeniden ileri uygulanınca `xp_drift()` yine 0 satır. Ek olarak betik dışı, rastgele özellik denemesi (6 tohum x 40 kullanıcı, gerçek tetikleyici zinciriyle rastgele ekle/yeniden yaz/sil/habit sil): her kullanıcıda `purged_xp` tam olarak defter fazlası kadar artar, `drift_sonra = drift_önce - fazla`, `total_xp` ve `sum(habit_logs.xp)` değişmez, negatif drift yok, yeniden ileri uygulamada hiçbir kullanıcının drift'i oynamaz; geri almadan sonra kalan drift'in tamamı (6 tohumda 28 kullanıcı) habit silinmesiyle açıklanır (aşağıda "Bulundu").

**Sapmalar (planın hatalı, eksik ya da kendiyle çelişen yerleri; her biri sınandı):**

1. **`migrationRlsGuard` rollback-dizini testi:** planın tek satırı `readdirSync(DIR).filter((f) => /rollback/i.test(f))` HEAD'de kırmızıydı: `014_recovery_vocabulary_compat_rollback.sql` canlıya `20260831015202` olarak uygulanmış bir İLERİ migration'dır (013'ün "compatibility rollback"i, ileri uygulandı). Tek dosyalık açık muafiyet eklendi; muafiyetin gerçek, uygulanmış ve 028 öncesi olması testle zorlanır, yani yeni bir ad muafiyet alamaz. Sahte dizin listeleriyle olumsuz durumlar sınandı (`036_..rollback.sql`, `038_rollback_036.sql`, `037_ROLLBACK.SQL` yakalanır).
2. **`git diff --stat supabase/migrations` boş olamaz:** plan hem `supabase/migrations/README.md`'ye `## Rollbacks` ister hem de bu komutun boş çıkmasını bekler. Niyet "hiçbir migration SQL'i değişmedi"dir; `git diff --stat -- 'supabase/migrations/*.sql'` ile doğrulandı (boş).
3. **`## Rollbacks` yeri:** planın "Keep this table" paragrafından hemen önce değil, `## Rules` başlığından önce: aksi hâlde tabloyu anlatan o paragraf Rollbacks başlığının altına düşerdi.
4. **036 betiğinin son doğrulaması:** `IF v_before = 0 AND v_after > 0` yerine `IF v_after > v_before`. İlk durumda zaten drift'li kullanıcı varken yeni bir drift'li kullanıcı üreten geri alma da reddedilmeli; eski koşulu kapsar.
5. **Plandaki CI adımlarının üstünde:** (a) olumsuz kontroller (plan Bölüm 5'te "CI'da ayrı adım" der, adım 8 YAML'ında yoktur) ve hatada durmayan istemci turu (onay bloğu transaction DIŞINDAYSA ON_ERROR_STOP vermeyen istemci betiğin kalanını çalıştırırdı; gerçek çalışma zamanı kanıtı); (b) ikinci geri alma turu (kenar durum 15a); (c) DB2-07'nin gerçek satırlı adımı: yalın döngüde XP satırı yok, `xp_drift() = 0` hiçbir şeyi ölçmezdi (doğrulayıcı uyarısı); (d) 032/034/035'in "veri silmez" sözleşmesinin gerçek satırlı adımı (yalnız `NOT VALID` metnini aramak sözleşmeyi kanıtlamaz; `NOT VALID`'siz mutant yalnız bu adımda kırmızı olur); (e) parmak izi öz-sınaması (sapma 9). Hepsi yalnız throwaway Postgres'e bağlanır.
6. **`rollbackProblems`:** `missing-transaction` ayrıca "onay bloğu BEGIN'den önce ya da COMMIT'ten sonra" durumunu yakalar; `uses-cascade` kuralı satır sonu/boşluk toleranslıdır (`ON\nDELETE\nCASCADE` yanlış alarm vermez); `touches-auth-schema` ALTER/DROP'a ek olarak `auth` nesnesine yönelik GRANT/REVOKE/TRUNCATE/DML'i yakalar, yalnız HEDEFE bakar (`auth.uid()` okumak ve `REFERENCES auth.users(id)` yanlış alarm vermez).
7. **Atıf kayması:** `habitLogService.ts:219-222` yerine `wirePatch` (223-227), `todayBootstrapRepository.ts:38-61` yerine `isMissingRpcError` (38-43) ve `fetchTodayBootstrap`; betik yorumları ve belgeler satır yerine işlev adıyla atıf yapar. `ciGatesWired.test.ts:45` yalnız yayın iş akışında `supabase db push` arar (`ci.yml` değil); `ci.yml` için komut/ref yasağını F01'in `sqlBehaviorTestsWired.test.ts` guard'ı ve yeni guard'ın "iş" ve "tüm dosya" denetimleri taşır.
8. **Türetilmiş denetimler (elle yazılmadı):** 036 EXECUTE listesi 036'nın 27 REVOKE satırından ve `live_schema.sql` GRANT satırlarından türetilip betikle karşılaştırılır (`anon` ve `authenticated` yalnız dökümde adı geçenlerde, `PUBLIC` dökümde `REVOKE ... FROM PUBLIC` olmayanlarda); `fn_habit_log_award` gövdesi dökümle bayt bayt, `weekly_xp` politikası karakter karakter eşit; tablo/sütun/kısıt/fonksiyon geri alma kapsamı migration'lardan türetilir; 032-034-035 CHECK listeleri zincir testiyle bağlanır (035 -> 034'ün listesi, 034 -> 032'nin listesi, 032 -> canlı liste). CI'daki SQL karşılaştırması yalnız SON durumu görür: 034 ve 035'in ara listelerini yalnız bu zincir testi tutar.
9. **`acldefault` normalleştirmesi bu şemada hiç devreye girmiyor (planın iddiası yeniden üretilemedi):** plan "`acldefault` eksikse CI taban karşılaştırması 036 geri alındıktan sonra yalancı fark verir" der. `ALTER DEFAULT PRIVILEGES` (dökümde) postgres'in `public` nesnelerinin hepsine açık ACL verir; CI veritabanında NULL ACL'li tablo da fonksiyon da YOK (0/52). Parmak izinden `acldefault` çıkaran mutantlar bu yüzden hayatta kaldı (SQL S3, S3b). Özellik yine de doğrudur ve gelecekte gerekebilir; ayrıca sınanması için son adım olarak öz-sınama eklendi: varsayılan ayrıcalığı olmayan geçici bir rol NULL ACL'li bir tablo ve fonksiyon sahiplenir, REVOKE/GRANT gidiş-dönüşü ACL'yi açık varsayılana çevirir ve iki parmak izi eşit çıkmalıdır (önce/sonra `relacl IS NULL`/`NOT NULL` ile kanıtlanır). Mutantlar bu adımda öldü.
10. **`SQL_FOR_OWNER.md`:** §2.10'un ikinci sorgusuna `m037` (`to_regprocedure('public.get_today_bootstrap(date)')`) eklendi; geri alma sütununda 037 için `isMissingRpcError` atfı.

**Mutasyon kanıtı (taban yeşilken; her mutant öncesi taban doğrulandı; hepsi bayt bayt geri alındı, sha256 + `Buffer.equals`, uyuşmazlık 0):**

| Katman | Mutant | Sonuç |
|---|---|---|
| jest guard (62, `migrationRollbackPresent` + `migrationRlsGuard`) | betik: STATUS işareti silindi, onay numarası başka numara, `COMMIT` silindi, `DROP ... CASCADE`, `DROP SCHEMA`, `auth` tablosuna `ALTER`, onay bloğu `BEGIN`'den önce, `service_role` grant'ı; dizin: eşsiz betik, öksüz 038 betiği, yabancı dosya, migrations içine gizlenmiş `.rollback.sql` ve `038_rollback_036.sql`; 036: `purged_xp` aktarımı `DROP`'tan sonra, bir EXECUTE grant'ı eksik, `anon` eksik, gövdede tek operatör farkı, `DO $assert$` bloğu silinmiş ya da hiç ateşlenmez, politika metni farklı, `profiles` INSERT grant'ı eksik, 038 denetimi başka ad arar, defter düşürülmez; 032/034/035: `NOT VALID` silindi, `DELETE` eklendi, liste eksik, `VALIDATE` koşulu ters; 028-031/033/037: ebeveyn çocuktan önce düşer, `IF EXISTS` yok, tablo geride kalır, `DROP COLUMN` yok, yanlış imza; belgeler: README / SQL_FOR_OWNER satırı, başlığı, 037 satırı, §2.10 / migrations README başlığı silindi; `ci.yml`: döngü en eskiden başlar, `diff` satırı yok, taban parmak izi 037'den sonra, adımda `set -euo pipefail` yok, `db push`, ileri parmak izi erkene alındı, olumsuz kontrol metni, `run.sh` ikinci kez koşmaz, DB2-07 fixture'ı boş, kanonik proje kimliği; parmak izi: `acldefault` yok (iki kez), yazma sızdı, ACL sıralanmadı, gövde özeti yok; guard mantığı: CASCADE kuralı her şeyi kabul eder ya da `ON DELETE CASCADE`'i de yakalar, `auth` kuralı aşırı hevesli ya da `DROP FUNCTION`'ı kaçırır, numara karşılaştırılmaz, BEGIN/COMMIT denetimi yok, transaction-dışı guard denetimi yok, `DROP SCHEMA` kuralı yok, STATUS kuralı yok | 62/62 öldürüldü; hayatta kalan yok |
| SQL (17, gerçek `ci.yml` adımları, taze Postgres) | DB2-07 aktarımı silindi (S1) ya da son doğrulama hiç ateşlenmez (S2): DB2-07 adımı; 033'te `DROP COLUMN` yok (S4), 036'da bir EXECUTE grant'ı eksik (S5), `weekly_xp` politikası geri kurulmadı (S7), 037 hiçbir şey düşürmez (S9), defter düşmez (S10), fonksiyon gövdesi tek operatör farklı (S11), 031'de tablo geride (S16): "geri alınmış katalog tabana eşit" adımı; 032'de `NOT VALID` yok (S6), 034 koşulsuz doğrular (S15): kasıtlı satır adımı; 028 betiği komşu numarayı kabul eder (S8), 036 onaysız çalışır (S12), 038 denetimi yok (S13), onay bloğu `BEGIN`'den önce (S17): olumsuz kontroller; 036 "uygulanmamış" iken reddetmez (S14): ikinci tur; parmak izinden `acldefault` çıkarıldı (S3, S3b): öz-sınama (ilk taslakta HAYATTA KALDI, sapma 9) | 17/17 öldürüldü (S1-S16 öz-sınama ve "hatada durmayan istemci" turu eklenmeden önceki `ci.yml` ile, S3, S3b, S17 nihai `ci.yml` ile; nihai `ci.yml` uçtan uca yeşil) |

**Kapılar (nihai ağaç, sırayla, `timeout` yok, çıkış kodları basıldı):** `npm run -s typecheck:ci` çıkış 0 (çıktı yok); `npm run -s lint:ci` çıkış 0 (0 uyarı); `npx jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB` çıkış 0, 269/269 suite, 3667/3667 test, 97,4 sn (önceki 268 suite / 3549 test: +1 suite, +118 test: yeni guard 115, `migrationRlsGuard` +3); `node run-tests.js` çıkış 0, 145/145; `git diff --stat -- 'supabase/migrations/*.sql'` boş; `git diff --check` çıkış 0, yeni dosyalarda sondaki boşluk ve CR yok. `npx expo export --platform web` koşmadı: paketleme ya da arayüz değişikliği yok. Görsel QA: uygulanamaz (arayüz değişikliği yok); tek gözlenebilir istemci davranışı (037 geri alınınca Bugün ekranı tablo okumalarına düşer) `todayBootstrapWired.test.ts` ile zaten sınanmıştır ve geri alma sonrası el ile bir kez doğrulanması sahibin branch denemesine bırakılmıştır.

**Bulundu, düzeltilmedi:** (a) 036'nın İLERİ davranışında, silinmiş ya da daha düşük ödülle yeniden yazılmış bir günün defter fazlası, o alışkanlık sonradan silinirse (defter satırları dış anahtar zinciriyle gider, `fn_habits_record_purged_xp` yalnız `habit_logs` toplamını yazar) kalıcı pozitif `xp_drift()` bırakır; rastgele denemede geri almadan sonra kalan her drift bununla açıklandı. Geri alma bunu ne üretir ne düzeltebilir (kanıt kaybolmuştur); kullanıcıya görünür etkisi yok, yalnız sağlık sorgusunu kirletir. F03 (038) için not. (b) `catalog_fingerprint.sql` yalnız tablo, sütun, ACL, kısıt, indeks, politika, tetikleyici ve fonksiyon (imza, definer, yapılandırma, ACL, gövde özeti) yönünü görür: görünüm, sıra, tür, yorum, sahip, fonksiyon değişkenliği ve tetikleyici etkinlik durumu parmak izinde yok. Bugünkü on betik yalnız görülenlere dokunur; ötesine dokunacak bir sonraki geri alma parmak izini genişletmelidir. (c) F03 (038) eklendiğinde DB2-07 adımı önce 038'i geri almak zorundadır (036 betiği `fn_habit_log_guard` varken reddeder, fixture da yalnız 036 tetikleyici zincirine dayanır); `ci.yml` adımında not düşüldü. (d) F01'den: `get_or_init_subscription_for` `ON CONFLICT`'siz INSERT (F07'ye bırakıldı), dormant `deal_damage_to_active_boss` `total_xp`'i doğrudan artırır (F03).

**Açık:** (1) İlk gerçek CI koşusu hâkimdir: gerçek `psql`'in `-c`/`-f` sıralaması, hata çıktısı biçimi, NOTICE'ların stderr'e gitmesi ve `-At` çıktısı ancak orada görülür (yerelde öykünücü kullanıldı; ardışık `-c`/`-f`, `VERBOSITY=verbose` ve çıkış kodlarını gerçek psql semantiğiyle uygular). (2) Sahibe bağlı, bu faza ait yapılmamış adım yok; 028-037'nin ve geri alma betiklerinin canlıya uygulanması OD-02'dir (`SQL_FOR_OWNER.md` sırasıyla, önce Supabase branch'inde; geri almadan önce ve sonra `catalog_fingerprint.sql` çıktılarını `diff` ile karşılaştırmak o veritabanında da kanıt verir). (3) Faz `featureGates.ts`'e dokunmadı, kapsam eki F13/F14/F15 yüzeyi eklenmedi. (4) Commit özeti bu başlıkta yok ("bu commit"); F00 ve F01'deki gibi ayrı bir `docs(state)` commit'i eklenebilir. (5) `docs/ADERYTH_360_AUDIT_AND_COMPETITOR_REPORT.md` içindeki sahibin 2 satırlık değişikliği commit'e alınmadı.

### F02 commit: `b6ba0f40`

F02'nin çalışma ağacı 2026-11-02'de bu başlıktaki kanıtla commit'lendi. Commit öncesi yeniden: `typecheck:ci` çıkış 0, `lint:ci` çıkış 0, `migrationRollbackPresent` + `migrationRlsGuard` 166/166, `git diff --check` temiz. Sahibin çalışma ağacındaki üç dosya (`docs/ADERYTH_360_AUDIT_AND_COMPETITOR_REPORT.md`, `frontend/app/screens/monthly-review.tsx` yalnız CRLF, `implementation.md` tek görünmez karakter) commit'e alınmadı.

### F03 (2026-11-02) — bu commit

**Faz:** 038: XP ve seri bütünlüğü (G0; DB1-01, DB2-04, REP-01, TST-V01, DB1-V01, DB2-01, DB1-02, DB2-02, DOM-01, REP-02, DB1-03, DOM-02, SYN-13, DB2-03, DB2-06, DB2-09, DB1-19, INT-24). **Durum: DONE (CI KANITI BEKLİYOR).** Ön koşul F02 DONE (`b6ba0f40`). Faz canlıya hiçbir şey yazmaz; 036 ve 038'in canlıya uygulanması OD-02, pencere (sunucu 15/istemci 14), günlük tavan (2000) ve çarpan basamakları (10 -> 1,2, 30 -> 1,5) OD-04 önerisidir ve tek yerde durur (038'deki üç sabit, `lib/date.ts`'teki iki sabit). Push yok (OD-21). Kanıt F01/F02'deki gibi `ci.yml` `db-migrations-verify` işinin GERÇEK `run:` betikleridir: YAML'dan çıkarılıp `bash -e` ile taze bir yerel tek kullanımlık Postgres 17.6'ya (embedded-postgres, 127.0.0.1) karşı, LF aynasından, F02 psql öykünücüsüyle sırayla koşturuldu.

**Değişenler.** Yeni: `supabase/migrations/038_xp_streak_integrity.sql`, `supabase/rollbacks/038_xp_streak_integrity.rollback.sql`, `supabase/tests/06_xp_integrity_038.sql` (24 sonuç), `frontend/__tests__/repo/xpStreakIntegrity038.test.ts` (54 test), `frontend/__tests__/lib/loggableDay.test.ts` (17 test), `frontend/__tests__/services/habitLogServiceRefusal.test.ts` (6 test), `frontend/__tests__/helpers/pinnedClock.ts`. Değişen: `frontend/lib/date.ts` (`LOGGABLE_DAYS_BACK = 14`, `LOGGABLE_DAYS_AHEAD = 0`, `loggableDayRange`, `isLoggableDay`), `frontend/lib/pgErrors.ts` (iki belirteç, iki Türkçe ileti, `isHabitLogDayOutOfRange`, `describeHabitLogError`), `frontend/services/habitLogService.ts` (dışa açık `persistCompletion` ince sarmalayıcı, gövde `persistCompletionRaw`), `frontend/store/logStore.ts` (`logHabit` önkontrolü), `frontend/lib/coachActions.ts` (`date out of range`), `frontend/repositories/profileRepository.ts` (yalnız açıklama), `.github/workflows/ci.yml` (iki yeni adım, üç adımda değişiklik), `supabase/migrations/README.md`, `supabase/rollbacks/README.md`, `docs/implementation-v3/MIGRATION_MAPPING.md`, `docs/implementation-v3/SQL_FOR_OWNER.md`; testler: `xpIsEarned.test.ts` (+3), `coachActions.test.ts` (+10), `logStore.test.ts` (+4), beş store suite'ine `pinToday`. DEĞİŞMEDİ: `supabase/live_schema.sql`, `036_live_audit_hardening.sql` (`git diff --stat` boş), `habitLogRepository.ts`, `migrationRlsGuard.test.ts`, `liveSchemaAudit.test.ts`, `scopeAddendum.test.ts`, `ciGatesWired.test.ts`, `run-tests.js`, `featureGates.ts`, Edge Function, arayüz dosyaları. `supabase/tests/expected_failures.txt`: gerekçesinde 036/038 geçen satır yoktu, silinen satır 0 (20 `T02b_search_path.*` F09'undur, dokunulmadı).

**Sapmalar (planın hatalı, eksik ya da kendiyle çelişen yerleri; her biri sınandı):**

1. **06 testinin protokolü.** Plandaki 06 metni `\set ON_ERROR_STOP on` ve `RAISE EXCEPTION` kullanır. F01 `run.sh` her SQL dosyasını `ON_ERROR_STOP` ile koşar ve bir istisnayı "test kırmızı" değil HARNESS ERROR (çıkış 3) sayar; F01 guard'ı (`sqlBehaviorTestsWired`) psql meta-komutunu da yasaklar. 06 bu yüzden F01'in `aderyth_test.res` / `expect_denied` / `expect_allowed` protokolüyle yazıldı: her senaryo bir `RESULT|T06_Tnn_…|PASS/FAIL` satırı üretir, `run.sh` iki yönlü mutabakatına girer. Sonuç adları `T06_T01a`…`T06_T18` (planın T1-T14 numarası korunarak). Profil satırları F01 03 gibi `session_replication_role = replica` ile yazılır: plandaki düz `INSERT INTO public.profiles` uykudaki `on_profile_created_pet` tetikleyicisini tohumsuz `pet_stages` dış anahtarına takardı. Plana ek olarak: T15 (log anahtarı taşınamaz, `habit_log_key_immutable`), T16a/b (pencere dışı günde not düzenleme serbest, durum değişikliği reddedilir), T17 (aşağıda sapma 2), T18 (her senaryodan sonra hiçbir kullanıcı drift'te değil); T8 done/miss/partial gidip gelmeyi birlikte sınar (anayasa A.7 "done -> partial -> done").
2. **Yeniden puanlama deliği (planın tasarımında).** Plandaki `fn_habit_log_set_xp` her UPDATE'te puanı yeniden hesaplar, guard ise pencereyi yalnız state/value değişiminde uygular. Sonuç: alışkanlığın zorluğunu 1'den 10'a çıkarıp eski günlerin notuna dokunmak bütün geçmişi 10 katına puanlatır (pencere dışı günler dahil; günlük tavan gün başına 2000'e kadar izin verir). 038'e tek kural eklendi: state ve value değişmeyen bir UPDATE puanlanmaz (`NEW.xp := v_old; return NEW;`, defter yazılmaz). T17 bunu ölçer (zorluk 1 -> 10, eski gün ve bugün not düzenleme, ikisi de 10 XP kalır); kural kalkınca T17 kırmızı (mutant M4).
3. **Seri yeniden hesabı.** Plan yalnız defterde sayılmış günü olan alışkanlıkları yeniden hesaplar; hiç sayılmış günü olmayan (bütün done logları silinmiş) alışkanlığın eski "ömür boyu geçiş sayacı" olduğu gibi kalırdı. Bunlar da `0/0` yapıldı (koşu yoksa seri yoktur).
4. **038 geri alması: defter `habit_logs`'a indirilir.** Plan betiği öksüz defter satırlarını siler ("XP zaten `purged_xp` içinde"), fakat aynı mantık habit'i yaşayan satırlara da uyar: 038 altında silinen bir logun XP'si silindiği anda `purged_xp`'ye taşınır, defter yine yüksek su işaretini tutar. Planın betiğiyle 038'den sonra 036 geri alınınca 036 betiği bu fazlayı ikinci kez `purged_xp`'ye taşır ve kendi drift denetimiyle REDDEDER (gerçek satırlarla yeniden üretildi: mutant R1). Betik artık her defter satırını logunun taşıdığı değere indirir; `total_xp`, `habit_logs`, `purged_xp`'ye dokunmaz. Bedeli betiğin başında yazılıdır: 038 döneminde silinmiş bir gün, yalnız 036 kalınca yeniden yazılırsa yeniden ödenir; defter dengede kalır. Yüksek su işaretini koruyup `purged_xp`'ye dokunmamak mümkün değil: korunursa o günün 036 altında yeniden yazılması negatif drift üretir (`habit_logs` + `purged_xp` aynı XP'yi iki kez taşır).
5. **038 geri alması ikinci çalıştırmada reddeder.** Plan betiği koşulsuzdur: 036 da geri alınmışken (CI'daki ikinci tur) ödül tetikleyicisine 036'nın defter yazan gövdesini verir ve olmayan `habit_xp_awards`'a `DELETE` ile düşer; düşmese her log yazımını kırardı. `fn_habit_log_guard` yoksa `038 is not applied` ile `P0001`; CI ikinci turu 036 gibi 038'i de ret olarak bekler. Son doğrulama F02 sapma 4'teki gibi `IF v_after > v_before` (plan: `v_before = 0 AND v_after > 0`).
6. **ci.yml'deki F02 adımları 038 ile bozulurdu.** (a) Olumsuz kontrol, 036'nın 038 varken reddettiğini SAHTE bir `fn_habit_log_guard` oluşturarak sınıyordu; 038 ileri uygulanınca `CREATE FUNCTION` "already exists" ile düşer ve adım kırmızı olurdu. Artık gerçek 038'in varlığı (`to_regprocedure(...) IS NOT NULL`) doğrulanıp 036 betiği ona karşı koşturulur. (b) İkinci tur 038'i de ret olarak bekler. (c) DB2-07 adımı (F02'nin notu) önce 038'i geri alır, sonda 036 ve 038'i yeniden uygular. (d) Planın "036 olmadan 038 düşmeli" negatif adımı, 037 ön denetiminin hemen ardından eklendi: `038 requires 036` iletisi ve öncesi/sonrası katalog parmak izi eşitliği (hiçbir şey değişmedi). (e) Yeni adım: 038 döneminde yazılmış gerçek satırlarla (silinmiş gün, silinip yeniden yazılmış gün, aynı adla yeniden oluşturulmuş alışkanlık) 038 sonra 036 geri alması; defter fazlası > 0 ve en az bir öksüz satır kanıtlanır, geri almalardan sonra `xp_drift()` 0 satır ve `purged_xp` değişmez. F02 guard'ının sabitlediği adım adları ve dizgeler korundu: `migrationRollbackPresent.test.ts` dosyası değişmedi ve 038'i parametreli vakalarına kendiliğinden alarak 119 testle (115 + 4) yeşil.
7. **Sabit saat.** Plan beş store suite'ine ayrı ayrı `jest.useFakeTimers({ now })` önerir. Tek yardımcı yazıldı (`__tests__/helpers/pinnedClock.ts`, `pinToday`): yalnız `Date` sahtelenir, zamanlayıcılar, mikro görevler ve `nextTick` gerçek kalır; beklentilere dokunulmadı. Planın onarım listesindeki `logHabitErrorsSurfaced`, `recoveryMakeupAsksAmount`, `coachActionsV2`, `coachScenarios` değişmeden yeşil kaldı (göreli tarih ya da `today` kullanıyorlar).
8. **Guard'ın kaynakları.** `xpStreakIntegrity038.test.ts` pencere sabitlerini `lib/date.ts` metninden değil modülün kendisinden okur (aynı değer, daha sıkı); geri alma gövdelerini yalnız anahtar dizgelerle değil `live_schema.sql` ve 036 gövdeleriyle bayt bayt karşılaştırır. Geri alma betiği bu yüzden elle değil, gövdeleri kaynaklardan kopyalayan bir betikle üretildi. `profileRepository.ts` sözleşme cümlesi dosyanın diliyle İngilizce yazıldı (`DB1-V01`, "`weekly_xp` is never read as a table"). `SQL_FOR_OWNER.md`'ye §2.11'e ek olarak §0.4 (038 öncesi drift ön kontrolü) ve §8 tablosuna 06 satırı eklendi.
9. **Atıf kayması:** yok denecek kadar az; `lib/date.ts` son satırı 162, `persistCompletion` 229, `logHabit` 526-527, `coachActions.ts` `resolveCoachDate` 278-297 ve log_habit doğrulaması 343-344 plan atıflarıyla eşleşti. `ci.yml` satırları F01/F02 ekleriyle kaydığı için adım adıyla atıf yapıldı.

**SQL kapısı (yerel Postgres 17.6, canlıya bağlantı yok, LF aynası).** (1) `harness.js reset` (bootstrap + `live_schema.sql` + 037 + 028-038) çıkış 0; hemen ardından `bash supabase/tests/run.sh` çıkış 0: 86 sonuç, 65 PASS, 20 FAIL (hepsi `expected_failures.txt`'teki `T02b_search_path.*`), 1 INFO (`T05f`), `OK: the failing set equals expected_failures.txt`. 06'nın 24 sonucunun hepsi PASS; F01'in 01-05 testleri 038 uygulanmışken değişmeden yeşil (`T03a-c` gerçek tetikleyici zinciriyle, `T01a-c` `weekly_xp` yazım yasağı). (2) `ci.yml` `db-migrations-verify` işinin GERÇEK `run:` betikleri taze bir veritabanında sırayla: 17 adımın hepsi çıkış 0 (yeni iki adım dahil). Taban parmak izi 1150 satır, 036'sız 038 reddinden önce/sonra 1151 = 1151 (037 sonrası), ileri parmak izi 1371 satır (F02'de 1364; 038 +7), geri alınmış katalog tabana birebir eşit, ikinci tur tabana eşit, ikinci ileri parmak izi ilkine eşit, `run.sh` iki kez yeşil. DB2-07 adımı 038'i önce geri alıp 036 zincirinde `drift = 15` ile sınar, sonda 036 ve 038 yeniden uygulanır, `xp_drift()` 0 satır. Yeni adımda 038 dönemi defter fazlası 40 (silinmiş gün 10, silinip yeniden yazılmış gün 10, aynı adla yeniden oluşturulan alışkanlığın günü 10 + öksüz satırı 10), 038 geri alınınca fazla 0, 036 geri alınınca `xp_drift()` 0 satır ve `purged_xp` değişmedi. (3) Plan bölüm 5'in beklenen değerleri gerçek veritabanında tuttu: T3 sunucu XP 10 (istemci 99999 gönderdi), T6 25 x 100 -> 2000, T9 9 x 100 + 5 x 120 = 1500 ve 14 günlük koşu, T10 log silme 120, alışkanlık silme kalan 1380 (iki kez değil).

**Mutasyon kanıtı (taban yeşilken; her katman önce mutantsız koşturuldu; her dosya bayt bayt geri yüklendi, sha256 + `Buffer.equals`, uyuşmazlık 0):**

| Katman | Mutant | Sonuç |
|---|---|---|
| SQL, 06 + `run.sh` (18; taban 86 sonuç, çıkış 0) | M1 pencere hiç reddetmez (`T02a` + 5 sonuç); M2 log anahtarı taşınabilir (`T15`); M3 pencere her UPDATE'e uygulanır (`T16a`, `T17a`, `T17b`); M4 değişmeyen state/value yeniden puanlanır (`T17b`); M5 günlük tavan yok (`T06`, `T14`); M6 yeniden oluşturulan alışkanlığın öksüz kardeşi yok sayılır (`T05`); M7 ödenmiş gün yok sayılır (`T04`, `T05`, `T08`); M8 koşu hiç sayılmaz (`T09b`); M9 boşluk koşuyu sıfırlamaz (`T09a`); M10 silme tetikleyicisi yok (`T04` ve drift sonuçları); M11 alışkanlık silmede çift sayım (`T10`, `T18`, F01 `T03c`); M12 seri koruma tetikleyicisi yok (`T07`); M13 boss tetikleyicisi kalır (`T11`); M14 guard EXECUTE açık (`T12`); M15 `weekly_xp` kısıtı yok (`T13`); M16 defter dış anahtarı kalır (`T05`); M18 parmak izi büyük/küçük harf katlamaz (`T05`) | 17/18 öldürüldü (`run.sh` çıkış 1, ilk turda M2 çıkış 4 ve M3 çıkış 3 ile öldü; 06'da T8 loguna sabit kimlik verilip T17 ikiye bölündükten sonra ikisi de doğrudan FAIL). **M17 hayatta (eşdeğer):** guard'ın `NEW.xp` sıfırlaması silinse de sonuç değişmez, çünkü `fn_habit_log_set_xp` `NEW.xp`'yi hiç okumaz (aşağıda "Bulundu" b) |
| SQL, gerçek `ci.yml` adımları (9; taban 17 adım yeşil) | R1 geri almada defter kesilmez -> yeni adım ("fazla 0" denetimi; o denetim çıkarılınca 036 geri alması `would add xp_drift rows (1 users, was 0)` ile reddeder: sapma 4'ün kanıtı); R2 öksüz satırlar kalır -> yeni adım (dış anahtar kurulamaz); R3 set_xp gövdesinde tek operatör -> katalog tabana eşit değil; R4 uygulanmamışken ret yok -> ikinci tur; R5 boss tetikleyicisi geri gelmez -> katalog; R7 `weekly_xp` kısıtı kalır -> katalog; C1 038'in 036 önkoşulu silinir -> "038 refuses to run before 036"; C2 DB2-07 önce 038'i geri almaz -> DB2-07 | 8/9 öldürüldü. **R6 SQL'de hayatta:** 036 ödül gövdesinde `v_delta > 0` -> `>= 0`; 036'nın kendi geri alması gövdeyi zaten canlıya döndürür ve fark yalnız 0 XP'lik bir `add_xp` çağrısıdır, döngü göremez. Aynı mutant `xpStreakIntegrity038` guard'ının bayt bayt gövde karşılaştırmasıyla öldü (1 test kırmızı) |
| jest, kaynak (12; taban 171/171) | J1 istemci penceresi 15 gün; J2 en eski gün dışlanır; J3 dizgenin gerçek tarih denetimi yok (`'2026-07-32'` sözlük sırasıyla pencere içinde: bu vaka bu yüzden teste eklendi); J4 yarın serbest; J5 pencere belirteci çevrilmez; J6 ret yalnız `22023` koduyla tanınır; J7 suçlayıcı ileti ("Hata:"); J8 sarmalayıcı çevirmez; J9 sarmalayıcı `offline`'ı düşürür; J10 store önkontrolü yok; J11 önkontrol kuyruğa yazımdan sonra; J12 koç tarih aralığı denetimi yok | 12/12 öldürüldü |
| jest, guard içi (29 sentetik) | `xpStreakIntegrity038` her kuralı gerçek metne ve bellekte bozulmuş metne uygular: planın altı mutantı (guard tetikleyicisi `trg_habit_log_zz_guard`, `c_days_back := 3`, `'weekly' then 13` tek yerde silinmiş, award REVOKE silinmiş, set_xp `streak_current` okur, yorum dışı `GRANT`; yedinci maddesi, bilinmeyen hata metninin olduğu gibi dönmesi, doğrudan test) ve 23 ek (istemci penceresi sunucu toleransından geniş, pencere ileri günü 0, backfill eşiği, ikinci `add_xp` yolu, `purge` `total_xp` yazar, yeniden puanlama kuralı, tavan, çift sayım, guard definer olur, `search_path` sabitlenmemiş, önkoşul yok, boss tetikleyicisi kalır, ret belirteci; geri almada gövde farkları, defter kesilmez, öksüzler kalır, ikinci çalıştırma reddedilmez, drift denetimi ateşlenmez, weekly kısıtı kalır, boss geri gelmez, tetikleyiciden önce fonksiyon düşer, `profiles` yazılır) | 29/29 yakalandı |

**Kapılar (nihai ağaç, sırayla, `timeout` yok, çıkış kodları basıldı):** `npm run -s typecheck:ci` çıkış 0 (çıktı yok); `npm run -s lint:ci` çıkış 0 (0 uyarı; ilk denemede yeni guard'da iki `Array<T>` uyarısı vardı, `T[]` yapıldı); `npx jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB` çıkış 0, 272/272 suite, 3768/3768 test, 251,8 sn (F02 sonrası 269 suite / 3667 test: +3 suite, +101 test). Aynı nihai ağaçta önceki iki tam koşu kırmızıydı: 2 suite / 5 test ve 3 suite / 7 test, ikisinde farklı UI suite'leri (`formFeedback`, `journalArchive`, `todayScreen`), hepsi `Exceeded timeout of 5000 ms` ve ona bağlı beklentiler; makinede sahibin IDE'si yoğun CPU kullanıyordu. Düşenler tek başına yeşil (5/5, 2/2, 7/7) ve F03'ün değiştirdiği hiçbir dosyayı okumuyor: anayasa C'ye göre host yükü, yeniden koşu kabul edildi. `node run-tests.js` çıkış 0, 145/145; `git diff --check` çıkış 0; `git diff --stat -- supabase/live_schema.sql supabase/migrations/036_live_audit_hardening.sql` boş. `npx expo export --platform web` koşmadı: yeni rota, paket ya da arayüz bileşeni yok (yalnız mevcut Alert'in metni).

**Bulundu, düzeltilmedi:** (a) BEFORE aşamasındaki defter yazımı ve istemci upsert'i: `fn_habit_log_set_xp` defteri BEFORE INSERT'te yazar (toplu ifade içinde tavan uygulanabilsin diye, plan bilinen sınır 2). Düz INSERT çakışırsa ifade geri sarılır ve defter de geri gider (uygulama yalnız düz `insert` yapar, 23505'te bul+güncelle), fakat PostgREST'in `ON CONFLICT` upsert'iyle (`Prefer: resolution=...`) yazan elle hazırlanmış bir istemci, satır yazılmadan defteri yükseltebilir. Etki yalnız o kullanıcının aleyhinedir (o gün ve tavan için daha az ödeme; XP kazandırmaz) ve 038 geri alması defteri loglara indirdiği için 036 geri almasını bozmaz. (b) Guard'ın `NEW.xp` sıfırlaması eşdeğerdir: `fn_habit_log_set_xp` `NEW.xp`'yi hiç okumaz, canlı gövde de okumuyordu (istemcinin `xp` değeri canlıda da yok sayılıyordu); mutant M17 bu yüzden hayatta kaldı. Savunma derinliği olarak bırakıldı. (c) Aynı adla yeniden oluşturulan alışkanlığın defter satırı öksüz kardeşinin ödülünü de taşır (`v_ext + NEW.xp`); o günün defter toplamı gerçekte ödenenden büyük görünür ve tavan diğer alışkanlıklar için o kadar erken dolar (muhafazakâr yön; ödeme ve drift doğru). (d) `habit_fp` yalnız aynı adı yakalar (plan bilinen sınır 1); asıl sınır günlük tavan. (e) Geri yükleme (`restoreRepository`) `habits` satırlarını istemci rolüyle yazar: `streak_current`/`streak_best` artık 0 gelir ve ilk `done` ile defterden yeniden hesaplanır (kullanıcıya görünen seri istemcide hesaplanır, etkisi yok). (f) F02 bulgusu (a) ileri yönde kapandı: 038 altında silinen log ve ardından silinen alışkanlık drift bırakmaz (T10, T18). F01'den: `get_or_init_subscription_for` `ON CONFLICT`'siz INSERT (F07) sürüyor.

**Görsel QA: yapılmadı.** Kullanıcıya görünen tek değişiklik mevcut `Alert.alert('Kaydedilemedi', res.error)` iletisinin metnidir (Zaman Çizelgesi ve Telafi ekranı); yeni ekran, düğme ya da animasyon yok. O Alert'e ulaşmak için oturum açmış bir kullanıcıyla 15 gün öncesine işaret koymak gerekir; ajan canlı projeye bağlanan bir oturum kullanmaz. İletinin metni testlerle sabittir (suçlamasız, ünlemsiz, ne yapılabileceğini söyler, iki kısa cümle). 375x812 / 768x1024 / 1366x900 kontrolü ve Telafi ekranında 14 gün önceki günün kabulü sahibin branch denemesine bırakıldı.

**Açık:** (1) İlk gerçek CI koşusu hâkimdir (gerçek `psql`; yerelde öykünücü). (2) Canlıya uygulama OD-02 (036 → 037 → 038, §0.4 drift ön kontrolü boş değilse 038 uygulanmaz) ve değerler OD-04; bu faza ait sahip kararı bekleyen başka adım yok. (3) Yayın sırası: istemci 038'den ÖNCE yayınlanmalıdır (sunucu eskiyken yalnız ek bir önkontrol yapar, zararsız). 038 eski istemciden önce uygulanırsa o istemci pencere dışı günde Türkçe ileti yerine ham `habit_log_day_out_of_range` belirtecini gösterir (çeviri yeni istemcidedir); veri ve XP açısından fark yoktur. (4) Görsel QA sahipte (yukarıda). (5) Commit özeti bu başlıkta yok ("bu commit"). (6) Sahibin çalışma ağacındaki üç dosya commit'e alınmadı.

### F03 commit: `5049fb57`

### F04 (2026-11-02) — bu commit

**Faz:** Oturum yaşam döngüsü: hesap kapsamı sıfırlama kayıt defteri ve kullanıcıya açık "Oturumu Kapat" (G0; STO-01, SYN-08, STO-03, SYN-07, TST-05, STO-13, INT-16, STO-20, STO-21, STO-22, STO-V02, GAP2-07, NAV-02, SYN-22, STO-V01). **Durum: DONE (görsel QA ve iki hesaplı elle senaryo SAHİPTE).** Ön koşul F00 DONE. DB, Edge, yeni native bağımlılık ve `featureGates.ts` değişikliği yok; kapsam eki F13/F14/F15 yüzeyi eklenmedi. Push yok (OD-21).

**Değişenler.** Yeni: `frontend/lib/accountScope.ts` (kayıt defteri: `registerAccountScoped`, `registerAccountStorage`, `accountEpoch`, `resetAccountMemory`, `wipeAccountDevice`, `endAccountScope`; `lib` hiçbir store'u import etmez, store'lar kendini kaydeder), `frontend/components/SignOutConfirmModal.tsx`, testler `__tests__/store/sessionAccountIsolation.test.ts` (39), `__tests__/repo/accountScopeRegistry.test.ts` (14), `__tests__/services/signOut.test.ts` (10), `__tests__/ui/signOutConfirmModal.test.tsx` (6). Kayıt: 26 hesap kapsamlı store'un hepsi (habit, goal, project, okr, readingList, lifeAreas, routine, profile, subscription, insights, deepWork, notion, googleCalendar, spotify, willpower, task, mood, routineRunner, notionSession; modül durumuyla journal `serverContent`, note `serverVersion`, recovery `completionMeta`, log `chains`/`optimisticGen`/bellekteki kuyruk, onboarding `installInFlight`/`startedEmitted`; focus, aiConversation) ve `coreOutbox`; cihaz düzeyi üç store (theme, drawer, command) bilerek dışarıda. `lib/localReadCache.ts`: `clearAllReadCache()` (yeni), `clearReadCacheMemory` açık veritabanını kapatır. `app/_layout.tsx`: `lastUidRef`; `SIGNED_OUT` -> `endAccountScope('signed_out', prevUid)`, farklı kullanıcı -> `endAccountScope('user_changed', prevUid)` + `hydrateSyncQueue()`. `services/accountService.ts`: hesap silme `endAccountScope('account_deleted', uid)` + mevcut AsyncStorage süpürmesi (elle yazılmış store listesi kalktı); yeni `signOutLocal`, `signOutCurrentAccount` (önce eşitle, en çok 6 sn), `signOutNotice`. `app/(auth)/reset-password.tsx`: `signOutLocal()` (başarısızsa hata gösterilir, yönlendirme yok). `store/focusStore.ts`: `focus.session.v1.<uid>` / `focus.settings.v1.<uid>`, `normaliseFocusSettings` ve `FOCUS_SETTING_BOUNDS` (Stepper sınırları), eski anahtar: oturum bırakılır, ayar bir kez benimsenir. `store/aiConversationStore.ts`: `aderyth.coach.lastConversationId:<uid>`, `listSeq` + `accountEpoch()` (STO-V02). `components/BadHabitsTracker.tsx`: `aderyth.deflected_urges_count:<uid>` (eski anahtar silinir, benimsenmez). `lib/deviceExport.ts`: yedek allowlist'i `focus.settings.v1.<uid>`. `app/tabs/settings.tsx`: "Hesabı Sil"in üstünde "Oturumu Kapat" (e-posta alt satırda) ve modal. `app/screens/privacy.tsx`: iki doğrulanmış cümle (mobilde Keychain/Keystore, web'de localStorage; çıkışta önbellek ve hatırlatıcılar temizlenir, gönderilmemiş iş cihazda kalır; `lib/authStorage.ts` ve `lib/supabase.ts:12` ile doğrulandı). Güncellenen testler: `taskOutboxWired` (:46 iddiası, aşağıda), `focusTimerKd03` (+20: 6 hesap/anahtar vakası ve 14 `normaliseFocusSettings` vakası), `backupFullAccount` (anahtar + iki olumsuz), `accountDeletionLocal` (+2), `aiCoachConversations` (anahtar duyarlı depolama ve oturum mock'u, +5), `notionSessionIsolation` (+2), `localReadCache` (+2), `logStoreOfflineSync` (+1), `focusSmallStep` (yalnız oturum mock'u).

**Sapmalar (her biri sınandı):**

1. **AI Koç `reset()` son konuşma anahtarını SİLMEZ** (plan 2.2 madde 5 siler der). Üretimde `reset()` çağıran yok; mevcut test sözleşmesi (`aiCoachConversations`: "ekrandan çıkıp dönünce aynı konuşma açılır", sahibin bildirdiği kusurun tersi) `reset()` + `hydrate()` ile ekrandan çıkışı taklit eder ve plan metniyle kırmızı olurdu. Anahtar hesap sınırında kayıt defterinin geçici depolama girdisiyle (`coach.lastConversation`, `transient: true`) ve `newChat`'te silinir; `signOut.test` ve koç testi bunu ayrı ayrı sınar ("reset() alone keeps it").
2. **Eski, kullanıcısız koç anahtarı okunmaz ama silinmez** (planda yok): sahibi bilinmeyen bir konuşma kimliğidir, okuma yolunda silmek anahtar duyarsız eski test mock'larını da bozardı. Odak oturumu ve dürtü sayacının eski anahtarları ise plan gereği silinir.
3. **Odak kalıcılığına epoch denetimi eklendi** (planda yok): `persistSession`, `loadSettings`, `restoreSession` `accountEpoch()` yakalar; kullanıcı kimliği çözülene kadar bir hesap sınırı geçmişse yazma/okuma atılır. Doğrudan A->B geçişinde A'nın anlık görüntüsünün B'nin anahtarına yazılmasını önler.
4. **Testlerin kapsamı plan listesinden geniş:** (a) `sessionAccountIsolation` store'ları ad listesiyle değil, `store/` dizinindeki her dosyayı gerçekten yükleyip dışa aktarılan Zustand hook'larını biçimden bularak sınar (yeni store testi düzenlemeden kapsanır); plandaki alan adlarından `readingListStore.items` yoktur (`counts`/`tabs` kullanıldı), `taskStore.tasks` eklendi. (b) Plan dışı: `logStoreOfflineSync` kuyruk belleği vakası (yoksa `resetQueueMemory` kaldırılınca hiçbir test kırmızı olmuyordu: mutant K16), `signOutConfirmModal.test.tsx` (render düzeyi erişilebilirlik ve durumlar), koçta aynı hesapta "daha fazla yükle" sürerken sıfırlama vakası (yoksa STO-V02 bekçisi kaldırılınca test kırmızı olmuyordu, çünkü kayıt defteri `loadingConversations`'ı zaten sıfırlıyor: mutant K10). (c) `deleteAccount`'un okuma önbelleği iddiaları plan "signOut.test" der; silme mock'larının zaten durduğu `accountDeletionLocal.test.ts`'e yazıldı.
5. **`focusSmallStep.test.ts`'e yalnız `lib/session` mock'u eklendi:** odak oturumu artık yalnız oturum açmış kullanıcı için kaydedilir (F04'ün kendisi); suite kullanıcısız koşuyordu. Beklentilere dokunulmadı.
6. **Birincil düğme metni koyu (`colors.bg`):** planın metin rengi belirtilmemişti; açık metin kil zeminde 2,59:1 (AA altı), koyu metin 5,91:1. Modal alttan çıkan sayfa değil ortalanmış kart (`maxWidth: 440`, web masaüstünde okunur genişlik).
7. **`signOutLocal` fırlatılan hatayı da başarısızlık sayar** (plan yalnız `{ error }` dönüşünü ele alır); `signOutCurrentAccount`'ın 6 sn sınırı `setTimeout` ile kurulur ve her durumda temizlenir (askıda zamanlayıcı kalmaz).
8. **Guard yeniden yazımı (`taskOutboxWired.test.ts:46`).** Anayasa A.5 var olan bir iddiayı yeniden yazmayı sahip kararına bağlar; bu değişiklik F04'ün onaylı metninde (bölüm 5.3 madde 1, adım 25) açıkça listelidir ve gevşetme değildir: eski satır "çıkışta görev store'u ve çekirdek outbox sıfırlanır" der; yeni iddialar `_layout`'un çıkışta kayıt defterini çağırdığını VE `taskStore`'un ile `coreOutbox`'ın kayıt defterinde olduğunu sabitler, davranışı da `sessionAccountIsolation`/`signOut.test` ölçer. `:47` `TOKEN_REFRESHED || SIGNED_IN` iddiası değişmeden geçer.
9. **Atıf kayması:** `_layout.tsx:110` (`SIGNED_OUT` satırı), `accountService.ts:61-86` (`clearLocalState`), `settings.tsx:498-548` (Hesap bölümü), `focusStore.ts:50-52` (anahtarlar), `aiConversationStore.ts:34` (anahtar), `BadHabitsTracker.tsx:25` eşleşti; `logStore.ts` `chains` 211, `optimisticGen` 313 (F03 sonrası +1).

**Mutasyon kanıtı (taban 172/172 yeşilken; her mutant bayt bayt geri yüklendi, sha256 + `Buffer.equals`, uyuşmazlık 0):**

| Mutant | Öldüren suite |
|---|---|
| K1 kayıtlı store'lar başlangıç durumuna döndürülmez | sessionAccountIsolation, signOut, accountDeletionLocal (34 test) |
| K2 epoch hiç ilerlemez | sessionAccountIsolation |
| K3 çıkış kalıcı (transient olmayan) anahtarları da siler | signOut (TST-05) |
| K4 kullanıcının okuma önbelleği silinmez | signOut, accountDeletionLocal, accountScopeRegistry |
| K5 her çıkış bütün kullanıcıların önbelleğini siler | signOut |
| K6 hatırlatıcılar iptal edilmez | signOut, accountDeletionLocal |
| K7 kullanıcı değişimi sınır sayılmaz (`_layout`) | accountScopeRegistry |
| K8 başarısız çıkış yine temizler (sahte başarı) | signOut |
| K9 "önce eşitle"nin süre sınırı yok | signOut (sahte zamanlayıcı) |
| K10 sıfırlama isteği uçuştaki yüklemeye yutulur (STO-V02) | aiCoachConversations (ilk turda HAYATTA KALDI; aynı hesap vakası eklendi) |
| K11 geç gelen liste yanıtı atılmaz | aiCoachConversations |
| K12b eski kullanıcısız odak oturumu silinmez | focusTimerKd03 |
| K13 ayarlar sınırlanmaz | focusTimerKd03 (5 test) |
| K14 bir store kaydı unutulur (`lifeAreasStore`) | accountScopeRegistry, sessionAccountIsolation |
| K15 günlük çakışma tabanı sınırı aşar (STO-20) | sessionAccountIsolation |
| K16 bellekteki kuyruk sınırı aşar | logStoreOfflineSync (bu vaka eklenmeden hayatta kalırdı) |
| K17 "Önce eşitle" eşitlenmemiş iş yokken de görünür | signOutConfirmModal |
| K18 odak oturumu anahtarı geçici değil | signOut |

18/19 öldürüldü. **K12 eşdeğer (hayatta):** `restoreSession` önce eski anahtarı okuyacak biçimde bozuldu, ama kod eski anahtarı okumadan hemen önce siliyor; davranış değişmez. Silme satırını kaldıran K12b öldü.

**Kapılar (nihai ağaç, sırayla, `timeout` yok):** `npm run -s typecheck:ci` çıkış 0; `npm run -s lint:ci` çıkış 0 (0 uyarı); `npx jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB` çıkış 0, 276/276 suite, 3869/3869 test, 148,8 sn (F03 sonrası 272 suite / 3768 test: +4 suite, +101 test); `node run-tests.js` çıkış 0, 145/145 (`run-tests.js` değişmedi; `settings.tsx` ve `focusStore.ts` dize kontrolleri geçer); `git diff --check` çıkış 0. Ara koşularda kırmızı yok (ilk tam koşuda `focusSmallStep` düştü: sapma 5). `syncLifecycleWired`, `layerBoundary`, `dataLayerBoundary`, `freeMvpReleaseShape`, `designTokens*`, `scopeAddendum` değişmeden yeşil. `npx expo export --platform web` koşmadı: yeni rota ve native paket yok (yeni bileşen yalnız `react-native` çekirdeği ve `@expo/vector-icons`).

**Görsel QA: yapılmadı (sahipte).** Ajan canlı projeye oturum açmaz; modal ve Ayarlar satırı ancak oturum açmış bir kullanıcıyla görülebilir. Yerine koyulan, görsel QA'nın yerini TUTMAYAN kanıt: `signOutConfirmModal.test.tsx` render düzeyinde üç düğmenin 48 pt hedefini, `accessibilityRole`/etiket/ipucunu, başlığın `header` rolünü, `accessibilityViewIsModal`'ı, meşgulken devre dışılığı, hatanın `polite` canlı bölgede duyurulmasını, "hareketi azalt" açıkken `animationType="none"`ı ve geri/Esc ile kapanmayı sınar; kontrastlar hesaplandı (birincil düğme koyu metin/kil 5,91:1, bilgi rengi/yüzey 5,76:1, uyarı/yüzey 7,72:1, soluk metin/yüzey 8,88:1; ilk taslaktaki açık metin/kil 2,59:1 idi ve düzeltildi); `Alert.alert` kullanılmaz (guard). 375x812 / 768x1024 / 1366x900, %200 yazı ölçeği, VoiceOver/TalkBack ve web klavyesi kontrolü sahibin branch denemesine bırakıldı.

**İki hesaplı elle senaryo (plan 5.5): yapılmadı (sahipte).** Aynı nedenle. Otomatik karşılıkları: `sessionAccountIsolation` (her store A'nın işaretini B'ye taşımaz, üç neden için), `signOut.test` TST-05 (A'nın bellek ve geçici anahtarları gider; `outbox.v1.core.A`, `atlas_sync_queue_v1:A`, `focus.settings.v1.A`, sayaç ve `moods.v1.A` kalır; B'de A verisi yok), `logStoreOfflineSync` (A'nın kuyruktaki yazımı sınırdan sonra bu oturumda yeniden oynatılmaz, aynı hesap diskten geri alıp gönderir), `localReadCache` (`clearAllReadCache` her kullanıcıyı siler). Cihazda `aderyth_read_cache.db` sayımı ve web DevTools anahtar kontrolü sahipte.

**Bulundu, düzeltilmedi:** (a) `user_changed` dalında (`SIGNED_OUT` olmadan doğrudan başka kullanıcı) görev ve çekirdek outbox için `authRefreshed()` çağrılmaz; plan metni de böyledir. Yeni hesabın görev outbox'ı ilk `flush`/ön plan tetikleyicisinde yüklenir; F05'in `rebindSyncQueue` işi ile birlikte ele alınmalı. (b) `taskStore` uçuştaki `fetchTasks` yanıtı sınırdan sonra yeni hesabın listesine yazabilir (epoch yalnız AI Koç ve odakta tüketiliyor): F18/STO-09. (c) `logStore` `queueOwnerId === null` iken sahte başarı (SYN-01): F05; F04 yalnız bellek kuyruğunu temizler ve `hydrateSyncQueue()` ile pencereyi daraltır. (d) Ayarlar'daki "Hesabı Sil" onayı hâlâ `Alert.alert` kullanır (web'de işlevsiz, GAP2-01): F24 kapsamı; bu fazın modali bunu kullanmaz. (e) Eski kullanıcısız odak ayarları, güncellemeden sonra Odak'ı ilk açan hesap tarafından benimsenir (paylaşılan cihazda başkasının ayarı olabilir; zararsız tercih verisi, plan gereği). (f) Web'de oturum belirteçleri `localStorage`'da kalır (supabase-js standardı, GAP2-07): yalnız Gizlilik metninde belgelendi.

**Açık:** (1) Görsel QA ve iki hesaplı elle senaryo sahipte (yukarıda). (2) Commit özeti bu başlıkta yok ("bu commit"). (3) Sahibin çalışma ağacındaki üç dosya commit'e alınmadı. (4) Plan 5.8: odak ayarlarının kullanıcıya bağlanması bir ürün kararıdır; sahip cihaz düzeyi isterse `settingsKey` sabit anahtara döner ve `deviceExport.ts` değişikliği geri alınır.

### F04 commit: `2f75a276`

**Sahip onayı (2026-11-02):** F02, F03 ve F04'teki bütün düzeltmeler, bu dosyadaki sapma kayıtları ve `taskOutboxWired.test.ts:46` güncellemesi sahip tarafından onaylandı.

### F05 (2026-11-02) — bu commit

**Faz:** Senkron kuyruğunun yeniden bağlanması, hata sınıflandırması, flush koordinatörü ve dürüst arayüz (G0; SYN-01, STO-02, SYN-V01, SYN-03, REP-13, SYN-15, SYN-16, DOM-21, SYN-26, REP-14). **Durum: DONE (görsel QA ve plan 5.5'in beş elle senaryosu SAHİPTE).** Ön koşul F04 DONE (`2f75a276`). DB, Edge, `supabase/`, yeni native bağımlılık ve `featureGates.ts` değişikliği yok. Push yok (OD-21).

**Değişenler.** Yeni: `frontend/lib/syncCoordinator.ts` (tek `setTimeout`, `nextDelayMs` saf, `AppState`/zamanlayıcı/sinyaller enjekte edilebilir), `frontend/lib/networkSignal.ts` (`markNetworkSuccess` 1 sn kısmalı, `onNetworkSuccess`, `signalOnSuccess`; bağımlılıksız), testler `__tests__/store/logQueueOwnerRebind.test.ts` (18), `__tests__/services/outboxErrorClassification.test.ts` (48), `__tests__/services/webhookDispatchOnce.test.ts` (34), `__tests__/lib/syncCoordinator.test.ts` (31), `__tests__/ui/outboxStatusModal.test.tsx` (8), `__tests__/lib/networkSignal.test.ts` (7). Değişen: `lib/syncQueue.ts` (op'a `priorState`/`retryableCount`/`firstRetryableAt`; `enqueue` sahip ve ilk taban damgası; `markFailed` `retryable` sınıfı; `RETRYABLE_GIVE_UP_MS`, `retryableDelayMs`; `saveSyncQueue(): Promise<boolean>`; yükleme karantinası `atlas_sync_quarantine_v1` en çok 200 op; saf `partitionByOwner`, `mergeOps`, `revive`, `deadOps`, `nextReadyAt`), `lib/outbox.ts` (`retryable` sonucu, aynı sabitler, `retry()` sayaçları sıfırlar, `nextReadyAt`), `services/outboxRunner.ts` (`classifyFailure`: offline → auth (`Oturum bulunamadı.` dahil) → `isTransientStatus` → retryable → rejected; `retryable` turu durdurur), `repositories/shared.ts` (`isTransportFailure(status, error?)`, `isTransientStatus`, `currentUserId` `offline`), 12 repository'de 42 çağrı yeri iki argümanlı kalıba, `habitLogRepository.ts` (başarısızlıklara `status`), `services/habitLogService.ts` (`retryable`, `announce` `priorState`/`deliveryKey`), `services/webhookService.ts` (en çok 3 deneme 1 sn/4 sn, 15 sn bütçe, `redirect: 'manual'`, tek `delivery_id`, `X-Aderyth-Delivery` yalnız native, `toggleWebhook` silindi), `services/taskService.ts` (iki `notify` yolundan `title` çıktı), `store/logStore.ts` (`rebindSyncQueue`, `reviveSyncOp`, `dropSyncOp`, `deadSyncOps`, `nextSyncReadyAt`, `queueEpoch`, `rebindChain`, `NO_SESSION_ERROR`; ayrıntı sapmalarda), `services/unifiedOutbox.ts` (`OutboxIssue`, `listOutboxIssues`, `retryOutboxIssue`, `discardOutboxIssue`, `describeFlushOutcome`, `syncFlushers`, `CORE_ENTITY_LABELS`), `components/OutboxStatusModal.tsx` (dürüst ileti `polite`, "Gönderilemeyenler", satır içi iki aşamalı bırak 4 sn, çakışmada yalnız bilgi, 44 pt, Reduce Motion), `components/OutboxIssues.tsx` ("Yeniden dene", "Bu değişikliği bırak", 44 pt, `hitSlop`; `retryChange(c.operationId)` / `discardChange(c.operationId)` aynen), `components/ui/SyncStatusBadge.tsx` (yalnız yorum), `app/_layout.tsx` (`rebindSyncQueue` seçicisi ve olay dalları, F04'ün geçici `hydrateSyncQueue()` satırı kalktı, koordinatör effect'i yalnız oturum varken, boot `await Promise.all([... hydrateSyncQueue()])` aynen), `lib/supabase.ts` (`global: { fetch: signalOnSuccess(() => fetch) }`). Güncellenen testler: `syncLifecycleWired` (başlık yorumu, AC-W03/W04 başlığı, yeni AC-W09 7 vaka), `accountScopeRegistry` (izin listesine `atlas_sync_quarantine_v1`), `webhookDispatch` (üç çağrıya yalnız `sleep: noSleep`; beklentiler aynı), eklemeler `syncQueue` (+9), `outbox` (+3), `logStoreOfflineSync` (+3), `logStoreFlushGuard` (+1).

**Sapmalar (her biri sınandı):**

1. **`hydrateSyncQueue` zorlamalı yeniden yüklemedir, `rebindSyncQueue` aynı kullanıcıda no-op'tur.** Plan "hydrate, `currentUser()` sonucunu `rebindSyncQueue` ile uygular" der; birebir uygulanınca boot hidrasyonu aynı kullanıcı için no-op olur ve `syncLifecycleWired` AC-W01'in sabitlediği "bellek diskle DEĞİŞTİRİLİR" sözleşmesi bozulurdu. İkisi aynı sıraya giren tek işlevi (`applyOwner(userId, force)`) paylaşır; hydrate `force` ile diskten yeniden yükler ve kendiliğinden flush ETMEZ (boot hidrasyondan hemen sonra açıkça flush eder, AC-W03), gerçek sahip değişimi flush eder. İlk sürümde hydrate de flush ediyordu: `offlineQueueAccountIsolation` "signing out leaves no queue loaded" ve `logStoreFlushGuard` AC-G04 kırmızıydı; beklentilere dokunulmadan davranış düzeltildi (mutant Q5).
2. **REP-13 çağrı yeri sayısı 56 değil 42.** Plan `rg "isTransportFailure\(status\)"` için 56 der; çalışma ağacında 12 repository'de 42 yer vardı. Hepsi iki argümanlı; değişken adı farklı olanlar elle (`okrRes.status, okrRes.error`, `krRes.status, krRes.error`, `httpStatus, error`, `probe.status, probe.error`). `rg -n "isTransportFailure\(status\)" frontend/repositories frontend/services frontend/store` boş; `outboxErrorClassification` tek argümanlı hiçbir çağrı kalmadığını ve en az 40 iki argümanlı yer olduğunu sabitler.
3. **`dropSyncOp` günün listesini yeniden yüklemez, yalnız o anahtarı uzlaştırır.** Plan `await get().fetchLogsForDate(date)` der; bu `logs`'u bütünüyle o günün satırlarıyla DEĞİŞTİRİR: 3 gün önceki bir değişiklik bırakıldığında Bugün ekranının listesi o günün satırlarına dönerdi. `loadDay(op.date)` okunur ve yalnız `(habitId, date)` satırı sunucununkiyle değiştirilir ya da (sunucuda yoksa) kaldırılır; diğer günler dokunulmaz (test + mutant Q8).
4. **Kuyruk sıfırlaması hesap silmede diske yazmaz** (planda yok). Plan sıfırlamada "önce `saveSyncQueue(queueState, queueOwnerId)`" der; hesap silmede bu, silinen hesabın kuyruğunu süpürmeyle yarışarak geri yazabilirdi. `resetQueueMemory(keepOnDisk)` kayıt defterinin `reason`'ını alır: `account_deleted` iken yazmaz (test + mutant Q6), çıkış ve kullanıcı değişiminde yazar (test + mutant Q7).
5. **Koordinatörün "ilerleme" kuralı** (plan içinde çelişki). Plan madde 2 "zamanı belirsiz bekleyen iş → 60 sn" der, madde 4 ise "`limit` dolunca `MIN_DELAY_MS` ile hemen ikinci tur, 120 komut 3 turda" der; tur sonrası kalan komutlar anında-uygun olduğu için `nextReadyAt` null döner ve madde 2 ile 60 sn beklenirdi. `nextDelayMs`'e isteğe bağlı `lastRoundProgressed` eklendi: son tur `pending`'i azalttıysa ve iş kaldıysa `MIN_DELAY_MS`. Ayrıca geçmişte kalmış bir `readyAt` yalnız ilk turda "hemen" sayılır; bir tur hiçbir şey taşımadıysa boşta geri çekilme uygulanır (aksi hâlde hiçbir flusher'ın tüketmediği geçmiş bir zaman 250 ms'lik döngü olurdu). `lib/outbox.nextReadyAt` plan gereği geçmiş zamanları da döndürür. `AppState` `unknown` (iOS ilk olaydan önce) ön plan sayılır.
6. **Ağ sinyali sarmalayıcısı test edilebilir biçimde.** Plan `lib/supabase.ts` içine satır içi `fetch(...).then(...)` yazar; o kod yalnız gerçek istemciyle çalıştığı için hiçbir test ona ulaşamazdı. Aynı davranış `networkSignal.signalOnSuccess(() => fetch)` olarak bağımlılıksız modülde; `networkSignal.test.ts` yanıtın değişmediğini, hatanın aynen yayıldığını, `fetch`'in çağrı anında okunduğunu ve `lib/supabase.ts`'in tam bunu verdiğini sabitler.
7. **F04 bulgusu (a) kapatıldı.** `SIGNED_OUT` olmadan doğrudan başka hesaba geçişte görev ve çekirdek outbox `authRefreshed()` ile yeni hesap için yüklenip gönderilir (F04 notu "F05 ile ele alınmalı" diyordu). `taskOutboxWired:47` (`TOKEN_REFRESHED || SIGNED_IN` satırı) ve `accountScopeRegistry` `_layout` iddiaları değişmeden geçer; AC-W09'a bir vaka eklendi.
8. **`retryable` yalnız `true` iken taşınır** (plan: "her başarısızlık yolu `retryable: isTransientStatus(...)` taşır"). Birebir uygulanınca F03'ün iki testinin tam eşitlik beklentisi kırmızıydı (`logStore.test` 1 vaka, `habitLogServiceRefusal` 5 vaka; ilk tam koşu); plan bu testleri güncellenecekler listesine koymaz. `habitLogService.transient(status)` alanı yalnız geçici durumda ekler, store da yalnız doğruysa geçirir; diğer bütün başarısızlıkların şekli F05 öncesiyle aynıdır.
9. **Ek bağlama:** `runAttempt` epoch farkını hem `try` hem `catch` dalında denetler (plan yalnız "her await sonrası" der); `flushPendingSync`'in `finally`'si `flushInFlight`'ı yalnız hâlâ kendisiyse temizler (sahip değişimi uçuştaki geçişi bırakıp yeni geçiş başlatabildiği için eski geçişin `finally`'si yenisini silerdi). Disk yazımı başarısız olursa `reportError(..., 'manual', 'queue-save')` (plan); dokunuş bellekte kalır ve hemen denenir.
10. **Test ekleri plan listesinden geniş:** `networkSignal.test.ts` (sapma 6); `logQueueOwnerRebind`'de 503'ün dokunuşu koruduğu ve 403'ün hâlâ ret olduğu, `revive`/`drop` eylemleri ve hesap sınırı vakaları; `outboxStatusModal` `jest.setTimeout(30_000)` (`uiPrimitivesAccessibility` ile aynı gerekçe: ilk render tek başına ~2 sn). Bir test tuzağı kayda geçti: AsyncStorage mock'unun `getItem`/`setItem`'ı zaten `jest.fn`; `jest.spyOn(...).mockRestore()` onların implementasyonunu SİLER ve sonraki testleri sessizce bozar. Testler `mockClear`/`mockRejectedValueOnce` kullanır.
11. **Atıf kayması:** F04 sonrası `logStore.ts` satırları plan atıflarından ~+15 kaydı (işlev adlarıyla doğrulandı); `_layout.tsx` `onAuthStateChange` F04 sonrası `:116-133`; `OutboxStatusModal.tsx` ve `unifiedOutbox.ts` atıfları eşleşti.
12. **`OutboxIssues` "bırak" düğmesinin erişilebilirlik etiketi eski haliyle kaldı.** Plan yalnız görünen metni değiştirir ("Vazgeç" -> "Bu değişikliği bırak"); ilk sürümde etiketi de "…: bu değişikliği bırak" yapmıştım ve `coreSheets.test.tsx:116` (`'Rapor: değişiklikten vazgeç'`) kırmızıydı. Var olan iddia yeniden yazılmadı (anayasa A.5): etiket `"<başlık>: değişiklikten vazgeç"`. Bedeli: görünen metin etiketin içinde geçmiyor (WCAG 2.5.3 "Label in Name"; sesli komutla "Bu değişikliği bırak" demek düğmeyi bulamaz). **Sahip kararı:** `coreSheets.test.tsx:116` beklentisinin `'Rapor: bu değişikliği bırak'` olarak güncellenmesine izin verilirse etiket görünen metinle eşitlenir. `dead` satırın "Yeniden dene" etiketi "…: yeniden dene" oldu (eski "benim değişikliğimi uygula" `dead` için yanlıştı; çakışma satırında aynen kaldı, test etmez).

**Mutasyon kanıtı (taban yeşilken; her mutant bayt bayt geri yüklendi, sha256 + `Buffer.equals`, uyuşmazlık 0):**

Taban: 12 suite, 266/266, çıkış 0 (`logQueueOwnerRebind`, `outboxErrorClassification`, `webhookDispatchOnce`, `syncCoordinator`, `outboxStatusModal`, `networkSignal`, `syncLifecycleWired`, `syncQueue`, `outbox`, `logStoreOfflineSync`, `logStoreFlushGuard`, `offlineQueueAccountIsolation`).

| Mutant | Öldüren suite |
|---|---|
| Q1 aynı kullanıcıya rebind diskten yeniden yükler | logQueueOwnerRebind |
| Q2 sahip değişimini aşan uçuştaki yazım yeni kuyruğa dokunur (epoch yok) | logQueueOwnerRebind |
| Q3 sahipsizken yapılan dokunuş benimsenmez | logQueueOwnerRebind (2 test) |
| Q4 sahip ve oturum yokken dokunuş yine denenir (dürüst hata yok) | logQueueOwnerRebind |
| Q5 boot hidrasyonu kendiliğinden flush eder | logStoreFlushGuard, offlineQueueAccountIsolation |
| Q6 hesap silmede silinen kuyruk diske geri yazılır | logQueueOwnerRebind |
| Q7 çıkışta ayrılan sahibin borcu kendi anahtarına yazılmaz | logQueueOwnerRebind |
| Q8 bırakılan değişiklik bütün gün listesini değiştirir | logQueueOwnerRebind |
| C1 geçici sunucu hatası ret sayılır (store) | logQueueOwnerRebind, logStoreOfflineSync |
| C2 alışkanlık kuyruğunda geçici hata hiç vazgeçmez (72 sa yok) | outboxErrorClassification |
| C3 outbox'ta geçici hata hiç vazgeçmez | outbox, outboxErrorClassification |
| C4 `classifyFailure`'da `retryable` sınıfı yok | outboxErrorClassification (8 test) |
| C5 gerçek HTTP durumu hata biçimine üstün gelmez | outboxErrorClassification |
| W1 done -> done yeniden duyurulur | webhookDispatchOnce (3 test) |
| W2 23505 kurtarması sunucudaki durumu yok sayar | webhookDispatchOnce |
| W3 yönlendirme izlenir | webhookDispatchOnce |
| W4 her HTTP hatası (4xx dahil) yeniden denenir | webhookDispatchOnce (4 test) |
| W5 toplam bütçe yok | webhookDispatchOnce |
| W6 teslim üstbilgisi web'de de gider | webhookDispatchOnce |
| W7 verilen teslim kimliği yok sayılır | webhookDispatchOnce |
| W8 görev başlığı yeniden dışarı gider | webhookDispatchOnce |
| S1 arka plana geçişte zamanlayıcı kalır | syncCoordinator (2 test) |
| S2 bekleyen yokken sinyal flush eder | syncCoordinator |
| S3 ilerleme sonrası hemen devam yok (toplu sınır yavaş boşalır) | syncCoordinator (3 test) |
| S4 boşta geri çekilme üç katlamayla sınırlanmaz | syncCoordinator (2 test) |
| S5 `flushNow` yeniden girişe korumasız | syncCoordinator |
| S6 sinyal kısılmaz | networkSignal |
| S7 başarısız yanıt da başarı sinyali verir | networkSignal |
| S8 koordinatör hiç başlatılmaz | syncLifecycleWired (2 test) |
| S9 çıkış kuyruğu bırakmaz | syncLifecycleWired |
| U1 bekleyen iş "başarı" okunur | outboxErrorClassification, outboxStatusModal |
| U2 çekirdek çakışma sayfadan yeniden denenir | outboxErrorClassification |
| U3 ilk dokunuşta bırakılır (onay yok) | outboxStatusModal (2 test) |

33/33 öldürüldü. Eşdeğer olduğu için listeye alınmayan mutant: "`runFlushPass` damgasız op'u da oynatır" (bulgu c).

**Kapılar (nihai ağaç, sırayla, `timeout` yok, çıkış kodları basıldı):** `npm run -s typecheck:ci` çıkış 0; `npm run -s lint:ci` çıkış 0 (0 uyarı; ilk denemede iki `Array<T>` uyarısı vardı, `T[]` yapıldı); `npx jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB` çıkış 0, 282/282 suite, 4039/4039 test, 226,3 sn (F04 sonrası 276 suite / 3869 test: +6 suite, +170 test). Önceki tam koşu kırmızıydı: 2 suite / 6 test (`habitLogServiceRefusal` 5, `coreSheets` 1); ikisi de host yükü değil, bu fazın değişikliğinden: sapma 8 ve 12 ile düzeltildi, beklentilere dokunulmadı. `node run-tests.js` çıkış 0, 145/145; `git diff --check` çıkış 0; `rg -n "isTransportFailure\(status\)" frontend/repositories frontend/services frontend/store` boş; `setInterval` `lib/syncCoordinator.ts` ve `app/_layout.tsx` içinde yok; `git diff --stat -- supabase` boş. `npx expo export --platform web` koşmadı: yeni rota ya da native paket yok (yeni modüller yalnız `react-native` çekirdeğini kullanır).

**Görsel QA: yapılmadı (sahipte).** Ajan canlı projeye oturum açmaz; modal ancak oturum açmış bir kullanıcıyla görülebilir. Yerine koyulan, görsel QA'nın yerini TUTMAYAN kanıt: `outboxStatusModal.test.tsx` render düzeyinde çevrimdışı iletinin "bekliyor" olduğunu ve başarı ikonunun yalnız gerçekten boş kuyrukta çıktığını, iletinin `polite` canlı bölgede duyurulduğunu, satır düğmelerinin 44 pt + `hitSlop`'unu, satır etiketinin `<etiket>. <sebep>` okunduğunu, iki aşamalı bırakmayı ve 4 sn sıfırlamayı, çakışma satırında eylem olmadığını, `Alert.alert`'in hiç çağrılmadığını sınar. Tonlar yalnız `colors.*` (başarı yosun, bekleme arduvaz, dikkat kehribar; F04'te kart yüzeyinde ölçülen oranlar: bilgi 5,76:1, uyarı 7,72:1). 375x812 / 768x1024 / 1366x900, %200 yazı, VoiceOver/TalkBack, web klavye sırası sahipte.

**Elle senaryolar (plan 5.5, 1-5): yapılmadı (sahipte).** Aynı nedenle; otomatik karşılıkları: 1 → `logQueueOwnerRebind` SYN-01 (oturumsuz açılış, giriş, çevrimdışı dokunuş A anahtarında, bağlantıyla gönderim) + `syncCoordinator` (sinyalden 1,5 sn sonra / 60 sn boşta yoklama); 2 → SYN-V01 vakaları; 3 → 503 vakaları (`logQueueOwnerRebind`, `logStoreOfflineSync`, `outboxErrorClassification`: 5/10/20 sn ... 15 dk, 72 saat); 4 → `revive`/`drop` vakaları ve modal; 5 → `webhookDispatchOnce`.

**Bulundu, düzeltilmedi:** (a) `habit_completed` için sunucu tarafı tekilleştirme yok (plan 5.8): yanıtı kaybolan ve `priorState`'i `done` olmayan bir op yeniden oynatıldığında UPDATE dalı bir kez daha duyurabilir; alıcı `delivery_id` ile ayıklayabilir (aynı op aynı kimliği taşır). (b) `status` taşımayan repository sonuçları (plan 5.8 listesi) `rejected` sayılmaya devam eder; çekirdek kanalda 5xx'in `retryable` sayılması şimdilik yalnız `status` taşıyan repository'ler için: F18/F22. (c) Sahipsiz (eski, damgasız) op'un sahibi olan hesaptaki `runFlushPass` istisnası kalktı; bellekte damgasız op yalnız sahip yokken var olabilir ve sahip gelince damgalanır, bu yüzden "damgasız op'u da oynat" mutantı eşdeğerdir ve listeye alınmadı. (d) Koordinatör yalnız ön planda çalışır; arka plan görevi (expo-background-fetch) yeni native bağımlılık olurdu: plan 5.8 OWNER DECISION. (e) `webhookService.deliver` her hedef için tam 15 sn'ye kadar sürebilir; `notify` beklenmediği için arayüzü bekletmez.

**OWNER DECISION (plan 5.8, uygulanmadı; ve sapma 12):** (0) `coreSheets.test.tsx:116` erişilebilirlik etiketi beklentisinin güncellenmesi (sapma 12). (1) Webhook yük imzası (`X-Aderyth-Signature`, `webhooks.secret` sütunu = migrasyon) ve `webhooks.headers`'ın açık metin saklanması. (2) `task_completed` yükünden `title` çıkarıldı: başlığa bağlı mevcut n8n akışları KIRILIR; "başlığı da gönder" seçeneği (`include_titles`, migrasyon) ayrı bir karardır. (3) NetInfo / `expo-network` gerekirse sahip kararı.

**Açık:** (1) Görsel QA ve elle senaryolar sahipte. (2) Commit özeti bu başlıkta yok ("bu commit"). (3) Sahibin çalışma ağacındaki üç dosya commit'e alınmadı.

### F05 commit: `17611778`

**Sahip kararları (2026-11-02), F05 OWNER DECISION maddeleri:**

1. **Sapma 12 / madde (0) ONAYLANDI ve UYGULANDI** (ayrı küçük commit, F06'dan önce): `OutboxIssues` "bırak" düğmesinin erişilebilirlik etiketi görünen metinle eşitlendi: `"<başlık>: bu değişikliği bırak"` (WCAG 2.5.3 Label in Name; `OutboxStatusModal` ile aynı biçim). `coreSheets.test.tsx:116` beklentisi sahip izniyle `'Rapor: bu değişikliği bırak'` oldu; aynı vakadaki `:115` ("benim değişikliğimi uygula") ve `retryChange`/`discardChange('op1')` iddiaları değişmedi. Mutant L1 (etiket eski haline döner) `coreSheets` tarafından öldürüldü; taban 10/10 yeşil, dosya bayt bayt geri yüklendi. Bulundu, düzeltilmedi: çakışma satırının birincil düğmesi görünürde "Benimkini uygula" der, etiketi "<başlık>: benim değişikliğimi uygula"dır; aynı Label in Name açığı, fakat `coreSheets.test.tsx:115` onu sabitler ve sahip izni yalnız `:116` içindir.
2. **Madde (1) webhook imzası: ERTELENDİ** (sahip onayı). `X-Aderyth-Signature` ve `webhooks.secret` sütunu migrasyon gerektirir; `webhooks.headers`'ın açık metin saklanması da aynı karara bağlı. Bu dalda kod değişikliği yok.
3. **Madde (2) `task_completed` yükünden `title` çıkarılması: ONAYLANDI** (F05'te uygulanmıştı; `webhookDispatchOnce` W8 sabitler). Başlığa bağlı n8n akışları kırılır; `include_titles` seçeneği ayrı bir karar olarak açık.
4. Madde (3) NetInfo / `expo-network`: karar istenmedi, açık kalır.

### F06 (2026-11-02) — `ae6cc580` (authStorage) + bu commit

**Faz:** Açılış kapısı ve oturum dayanıklılığı; üretimde demo atlatmanın kaldırılması (G0; STO-04, NAV-04, PRF-06, SYN-02, SYN-23, SYN-09, TST-08, NAV-01, PRF-03). **Durum: DONE (görsel QA, plan 5'in beş elle senaryosu ve `__DEV__` derlemesinde demo düğmesinin görünürlüğü SAHİPTE).** Ön koşul F04 DONE (`2f75a276`), F05 DONE (`17611778`). DB, Edge, `supabase/`, yeni native bağımlılık ve `featureGates.ts` değişikliği yok; kapsam eki F13/F14/F15 yüzeyi yok; `NOTION_INTEGRATION_ENABLED` girişi değişmedi. Push yok (OD-21).

**Commit'ler.** (1) `6cf4fb83` F05 sahip kararı 1 (bkz. "F05 commit" başlığı). (2) `ae6cc580` Blok B: `authStorage` atomik yazım (plan 5 "Geri alma denetimi": ayrı commit; geri alınırsa kullanıcılar bir kez yeniden giriş yapar). (3) Bu commit: Blok A, C, D, E, F ve bu kanıt.

**Değişenler.** Yeni: `lib/authStorageKey.ts` (`deriveAuthStorageKey`, `AUTH_STORAGE_KEY`, `AUTH_STORAGE_KEY_FALLBACK`, `CONFIG_MISSING_URL`), `lib/bootSession.ts` (`resolveBootSession`, `boundSession`, `isRetryableAuthError`, `BOOT_SESSION_TIMEOUT_MS` 8 sn, `BOOT_WATCHDOG_MS` 12 sn, `LOCAL_USER_TIMEOUT_MS` 2 sn), `lib/authLifecycle.ts` (`bindAuthAutoRefresh`), `lib/onboardingCache.ts` (`aderyth.onboarding.status.v1:<uid>`, kayıt defterinde `transient`), `lib/demoSeedGate.ts`, `components/BootGate.tsx`, `components/auth/DevDemoLoginButton.tsx`; testler `__tests__/lib/authStorageFailure.test.ts` (18, `ae6cc580`), `__tests__/lib/sessionOfflineExpiry.test.ts` (42), `__tests__/store/onboardingOfflineStart.test.ts` (28), `__tests__/repo/loginNoBypassInRelease.test.ts` (13), `__tests__/ui/onboardingGate.test.tsx` (16). Değişen: `lib/authStorage.ts` (`ae6cc580`), `lib/session.ts` (`currentUser` sınırlı + depodaki oturum; `readStoredSession`, `getSessionBounded`), `lib/supabase.ts` (`SUPABASE_CONFIG_ERROR`, yer tutucu URL/anahtar, `storageKey: AUTH_STORAGE_KEY`; `global.fetch` F05 satırı aynen), `repositories/shared.ts` (`currentUserId` sınırlı; `OFFLINE_SESSION_ERROR`), `repositories/onboardingRepository.ts` (`offline`/`status`/`code`), `store/onboardingStore.ts` (`ownerId`, `staleStatus`, `hydrateEpoch`, `hydrate` yeniden yazıldı, `resetForAccount` ve kayıt defteri sıfırlaması dönemi artırır; `resolveOnboardingRouting` DEĞİŞMEDİ), `components/onboarding/OnboardingGate.tsx` (`classifyGateError`, `onSignOut`, `signingOut`, iki varyant, `maxWidth: 480`, `header` rolü, `polite` hata kutusu), `app/_layout.tsx` (boot: abonelik önce, `try/catch/finally`, `Promise.allSettled`, `resolveBootSession`, 12 sn bekçi, `bootAttempt`; `INITIAL_SESSION(null)` yok sayılır; onboarding/hatırlatıcı/yönlendirme etkileri `sessionUid`/`hasSupabaseSession`; ön planda `staleStatus` ise sessiz yeniden okuma; `bindAuthAutoRefresh` yalnız native; render sırası config → stalled → kapı (kaçışlı) → spinner), `app/(auth)/login.tsx` (demo düğmesi ve `handleBypassLogin` gitti; `__DEV__ ? require(...) : null`), `app/tabs/settings.tsx` (yalnız üç demo noktası), `lib/demoSeed.ts` (yalnız belge cümlesi), `services/accountService.ts` (çevrimdışı yerel çıkış, sapma 9), `run-tests.js` (+2 kontrol: 147). Güncellenen testler: `authStorage.test.ts` (yeni şema, `ae6cc580`), `onboardingFlow.test.ts` (+6 F06 iddiası AC-OF08 altında), `onboardingPersistence.test.ts` (+4, AC-OP05), `signOut.test.ts` (+3; sahte `signOut`'a çağrı başına yanıt kuyruğu), `__tests__/helpers/supabaseMock.ts` (`failNextRead`'e isteğe bağlı `status`/`code`), `jest.setup.js` (SecureStore sahtesi: hata enjeksiyonu + 2048 bayt, `ae6cc580`).

**Kırmızı taban (anayasa B.4).** `authStorageFailure.test.ts` eski `authStorage.ts` ile: 16 vakanın 11'i kırmızı (gerekli en az 4). `onboardingGate.test.tsx` eski kapıyla 14 vakanın 13'ü kırmızı. `onboardingOfflineStart`, `loginNoBypassInRelease`, `sessionOfflineExpiry` yeni modüller olmadan yüklenemedi (beklenen kırmızı).

**Sapmalar (her biri sınandı):**

1. **Sınırlı oturum okumasının çekirdeği `lib/bootSession.ts`'te.** Plan `getSessionBounded`/`isRetryableAuthError`'ı `lib/session.ts`'e koyar ve `shared.currentUserId` onu çağırır. 25 test dosyası `lib/session`'ı yalnız `currentUser` ile taklit ediyor; `shared.ts` oradan içe aktarsaydı bu dosyalardaki her repository çağrısı `undefined` çağırırdı. Bağımlılıksız `boundSession` `lib/bootSession.ts`'te; `lib/session.ts` onu sarar ve yeniden dışa aktarır (plan imzaları aynen), `shared.ts` kendi istemcisiyle doğrudan çağırır. `BoundedSession`'a `rejected` eklendi (reddedilen `getSession` = `storage-error`; plan tablosunun 7. satırı ve `currentUser`'ın "reddedilir → null" kuralı ancak böyle ayrılır).
2. **`currentUserId` çevrimdışı koşulu F05'i korur.** Plan `timedOut || isRetryableAuthError`; F05'in `isTransportFailure(null, error)` dalı da kaldı (TypeError/AbortError adları). Çevrimdışı iletisi planın cümlesi: "Çevrimdışısın; oturum bağlantı gelince yenilenecek." Reddedilen `getSession` artık repository'ye fırlatılmaz, hata değeri döner (`outboxErrorClassification` F05 vakaları değişmeden geçer).
3. **`fetchOnboarding` iki argümanlı `isTransportFailure(status, error)`.** Plan tek argüman yazar; F05 guard'ı (`outboxErrorClassification`, REP-13) tek argümanlı çağrıyı yasaklar.
4. **Ayarlar satırı `{__DEV__ && loadDemoSeed()?.isSeedingAllowed() === true && (`.** Plan `{__DEV__ && (` der; `demoSeed.test.ts` AC-S05 (`isSeedingAllowed()` metni satırdan önce) planın kendi "demoSeed.test korunur" kuralıyla çelişirdi. İddia gevşetilmedi; satır yine `__DEV__` ile başlar (Metro katlar).
5. **`loginNoBypassInRelease` içe aktaranlar kümesi daha sıkı.** Plan `{demoSeedGate, demoSeed.test, DevDemoLoginButton}` der; düğme modülü değil kapıyı içe aktarır. Test: üretim kodunda `lib/demoSeed`'i yükleyen tek dosya `lib/demoSeedGate.ts`; kapıyı kullananlar tam olarak `app/tabs/settings.tsx` ve `components/auth/DevDemoLoginButton.tsx`.
6. **Anahtar türetimi.** `AUTH_STORAGE_KEY_FALLBACK` dize sabiti değil, `CONFIG_MISSING_URL`'den türetilir ve `lib/supabase.ts` aynı yer tutucu URL'yi kullanır (iki değer ayrışamaz). `accountScopeRegistry`'nin anahtar sabiti taraması ve izin listesi DEĞİŞMEDİ (bu anahtar auth-js'in kendi oturum anahtarıdır, çıkışta auth-js siler). Kütüphane formülü kaynak kapısı UMD yerine `dist/index.cjs` ve `index.mjs`'te aranır (UMD küçültülmüş: `r.hostname`); ayrıca gerçek bir `createClient` örneğinin `storageKey`'i beş URL biçimi için karşılaştırılır (davranış kanıtı).
7. **Onboarding önbelleği `transient: true`.** Plan 2.3 hem "kullanıcıya bağlı kalıcı anahtar" hem "çıkışta `clearCachedOnboardingStatus(uid)` çağrılır" der; ikincisi kayıt defterinin `transient` anlamıdır. Tek yol: çıkış, kullanıcı değişimi ve hesap silmede kayıt defteri siler (test: `endAccountScope('signed_out')` sonrası anahtar yok).
8. **`hydrate` önbellek yazımını bekler** (plan `void`). Durum önce yazılır, ekran beklemez; sıralama belirleyici olur (eski bir `completed` yazımı yeni bir `pending` silmesini geçemez). Dönem denetimi ayrıca `countHabitsForInstall` sonrasına ve kayıt defteri sıfırlamasına (`onReset`) eklendi: çıkış `resetForAccount` çağırmaz, yalnız kayıt defterini (mutant O5 bunu ayrıca sınar).
9. **F04 çıkış hizmeti çevrimdışı çalışır hale getirildi (plan dosya listesinde yok).** auth-js 2.107 `signOut({ scope: 'local' })` için de `POST /logout` çağırır (`GoTrueClient._signOut` → `admin.signOut`); süresi dolmuş jetonda önce yenilemeyi dener. Çevrimdışı sonuç `AuthRetryableFetchError` ve F04'ün `signOutLocal`'ı "Oturum kapatılamadı" diyordu: kapıdaki kaçış (plan 5 elle senaryo 2: "uçak modu ... Oturumu kapat girişe götürür") çalışmazdı. `signOutLocal` yalnız bu hata türünde depodaki oturumu siler ve `signOut`'u bir kez daha çağırır (oturum yokken istek atılmaz, auth-js kendi durumunu temizler ve SIGNED_OUT yayar). Sunucunun reddi (`AuthApiError`) eskisi gibi başarısızlıktır. Bedeli: yenileme jetonu sunucuda iptal edilmez (ağ yok); cihazda artık yoktur. `accountScopeRegistry` iddiaları (`supabase.auth.signOut({ scope: 'local' })`, `endAccountScope('signed_out', uid)`, `auth.signOut(` yalnız accountService'te) değişmeden geçer.
10. **Kapı ayrıntıları.** `classifyGateError` önce bağlantı desenini dener (planın kendi test vakası "Çevrimdışısın; oturum ..." → network; plan metnindeki sırayla session olurdu). Ağ varyantında çıkış sürerken dönen gösterge "Oturumu kapat" düğmesinde (planda "birincil loading": birincil "Tekrar dene"dir, orada dönen gösterge yeniden deneme yapılıyor sanılırdı); iki düğme de `disabled`. Kaçış `signOutCurrentAccount()` (Ayarlar'daki ile aynı: gönderilmemiş iş varsa en çok 6 sn bir teslim denemesi, sonra yerel çıkış).
11. **`bindAuthAutoRefresh`:** iOS `unknown` ön plan sayılır (F05 koordinatörüyle aynı; aksi hâlde etkin başlayan uygulama hiç olay almadan durdurulmuş kalırdı); `onActive` yalnız `active`'e geçişte, kurulumda değil; tekrarlanan `active` geçiş değildir.
12. **Ad ve yer:** planın `userId`'si F05'in `sessionUid`'idir (AC-W09 deseni `!session\w*`); `onAuthStateChange` parametresi `session` kaldı (guard'lar `nextUid`/`prevUid` satırlarını birebir arar); abonelik IIFE'den önce kurulur (plan).
13. **`authStorage` (`ae6cc580`) plan dışı ayrıntılar:** kuyruğa girmeyen hızlı okuma yolu (bekleyen yazım/silme yokken; auth-js her `getSession`'da okur) ve parçaların paralel okunması; günlükteki nesil işaretçiden büyükse yeni nesil ondan sonra seçilir; reddedilen bir değer bir kez bildirilir (yeniden denemeler bildirmez); test için `__resetAuthStorageForTests` (`crashReporting.__resetGlobalHandlersForTest` emsali). Plan vakası "2. parça reddedilirse getItem ÖNCEKİ değeri döndürür" planın kendi okuma algoritmasıyla (adım 2: bekleyen değer bellekten) çelişir: süreç içi okuma YENİ değeri, yeni süreç (çökme) ÖNCEKİ tam değeri okur; ikisi de sınanır.
15. **Planın paket mekanizması iddiası bu kurulumda YANLIŞTI; kapı biçimi değişti.** Plan "Metro sabit katlamadan SONRA bağımlılık toplar, `if (!__DEV__) return null;` sonrasındaki `require` pakete girmez" der. İlk paket denetiminde `lib/demoSeed.ts`'in tamamı release web paketindeydi: kapı modülü `e.loadDemoSeed=function(){return null}` olmuş ama bağımlılık listesi hâlâ `[2753]` (demoSeed) idi; katlama `if (!false) return null;`'u `return null;` yapar, ardındaki deyimleri silmez; onları terser bağımlılıklar toplandıktan SONRA siler. Giriş ekranının `__DEV__ ? require(...) : null` biçimi ise doğru düşmüştü ("Aderyth Demo" release'te yok). Düzeltme: kapıda `require` de bir `__DEV__ ?` dalında (`if (!__DEV__) return null;` plan ve `run-tests.js` metni için korunur). Yeni guard: üretim kodunda `demoSeed`/`DevDemoLoginButton` `require`'larının her biri `__DEV__ ?` dalında (mutant D4 = eski biçim, öldürüldü). Not: `store/subscriptionStore.ts`'in `if (!__DEV__) return false;` deseni modül `require` etmediği için bu kusuru taşımaz.
16. **Plan dışı testler:** `BootGate` render vakaları; `onboardingFlow` AC-OF08 altında F06 bağlantı iddiaları (kök düzen jest'te render edilemez: bekçi, `finally`, render sırası, kapı kaçışı, `sessionUid` bağımlılıkları, `staleStatus` yeniden okuması, `bindAuthAutoRefresh`); `lib/supabase` gerçek modülünün ortam değişkenleri yokken fırlatmadan yüklendiği (`jest.isolateModules` + `requireActual`); sign-out ile (yeni hidrasyon olmadan) hesap yarışı, hem `resetForAccount` hem kayıt defteri yolu.

**Mutasyon kanıtı (taban yeşilken; her mutant bayt bayt geri yüklendi, sha256 + `Buffer.equals`, uyuşmazlık 0).**

Blok B (`ae6cc580`, taban 2 suite 22/22 → 23/23): A1 işaretçi parçalardan önce · A2 reddedilen yazım düz metne · A3 okuma hatasında düz metin · A4 checksum yok · A5 önceki nesle düşme yok · A6 günlük temizliği yok · A7 işaretçi silme hatası yutulur · A8 tombstone yok · A9 bayat SecureStore her zaman kazanır · A10 eski anahtarlar taşıma kesinleşmeden silinir · A11 reddedilen değer bellekte tutulmaz · A12 bildirim yok · A13 aynı anahtara yazımlar sıralı değil (ilk turda HAYATTA; "işlem sürerken başlayan yazım" vakası eklendi) · A14 hızlı yol bekleyen değeri yok sayar · A15 iki önceki nesil silinmez · A16 `flushPendingAuthStorage` boş · A17 parça 4096 bayt. **17/17 öldürüldü.**

Blok A/C/D/E/F (taban 7 suite 161/161):

| Mutant | Öldüren suite |
|---|---|
| S1 reddedilen `getSession` `storage-error` değil | sessionOfflineExpiry |
| S2 boot: zaman aşımında depodaki oturum yok | sessionOfflineExpiry |
| S3 boot: `AuthRetryableFetchError`'da depodaki oturum yok | sessionOfflineExpiry (2) |
| S4 boot: kalıcı hata da depodaki oturumu kullanır | sessionOfflineExpiry |
| S5 yarış zamanlayıcısı temizlenmez | sessionOfflineExpiry (2) |
| S6 yerel kullanıcı sınırı 25 sn | sessionOfflineExpiry (ilk turda HAYATTA: test sabiti içe aktarıyordu; değer 2 sn olarak sabitlendi) |
| S7 `currentUser` depoya düşmez (F06 öncesi) | sessionOfflineExpiry, onboardingOfflineStart |
| S8 temiz "oturum yok"ta da depo kullanılır | sessionOfflineExpiry |
| S9 yenileme jetonsuz depolanmış oturum kabul | sessionOfflineExpiry |
| K1 türetilen anahtar supabase-js varsayılanından farklı | sessionOfflineExpiry (3) |
| K2 `storageKey` verilmez | sessionOfflineExpiry |
| K3 yapılandırma eksikliği bildirilmez | sessionOfflineExpiry (2) |
| K4 `createClient` modül yüklenirken fırlatır | sessionOfflineExpiry |
| R1 `currentUserId`: zaman aşımı çevrimdışı değil | sessionOfflineExpiry |
| R2 `fetchOnboarding` `offline` taşımaz | onboardingPersistence, onboardingOfflineStart (6) |
| O1 STO-04: `ready` yeniden `loading`e düşer | onboardingOfflineStart (3) |
| O2 başarısız sessiz yenileme ekranı söker | onboardingOfflineStart |
| O3 okumadan sonra dönem denetimi yok | onboardingOfflineStart (3) |
| O4 `resetForAccount` dönemi artırmaz | onboardingOfflineStart |
| O5 kayıt defteri sıfırlaması dönemi artırmaz | onboardingOfflineStart |
| O6 önbellek ret (401/RLS) için de kullanılır | onboardingOfflineStart (3) |
| O7 5xx "ulaşılamıyor" sayılmaz | onboardingOfflineStart |
| O8 başarı önbelleğe yazılmaz | onboardingOfflineStart (3) |
| O9 sahip denetimi yok | onboardingOfflineStart |
| O10 kaydederken sessiz yenileme okur | onboardingOfflineStart |
| O11 `installing` sayımı okunamazsa hazır ekran kapıya düşer | onboardingOfflineStart |
| C1 `pending` eski terminal kaydı silmez | onboardingOfflineStart |
| C2 başka kullanıcının kaydı kabul | onboardingOfflineStart |
| C3 önbellek çıkıştan sağ çıkar | onboardingOfflineStart |
| C4 elle yazılmış `pending` önbelleklenebilir | onboardingOfflineStart (3) |
| C5 bilinmeyen sürüm kabul | onboardingOfflineStart |
| T1 arka planda yenileme durmaz | sessionOfflineExpiry |
| T2 tekrarlanan `active`'de `onActive` | sessionOfflineExpiry |
| T3 bağ sökülmez | sessionOfflineExpiry |
| T4 arka planda kurulumda durdurulmaz | sessionOfflineExpiry |
| G1 sınıflama önce "oturum" | onboardingGate |
| G2 çıkışta "Tekrar dene" etkin | onboardingGate |
| G3 oturum varyantında giriş düğmesi yok | onboardingGate |
| L1 `INITIAL_SESSION(null)` yine çıkış yaptırır | onboardingFlow |
| L2 boot'ta depodaki oturum yok | onboardingFlow |
| L3 bekçi yok | onboardingFlow |
| L4 onboarding etkisi yine `Session` nesnesine bağlı | onboardingFlow |
| L5 `staleStatus` ön planda yeniden okunmaz | onboardingFlow |
| L6 yenileme AppState'e bağlı değil | onboardingFlow |
| L7 kapının kaçışı yok | onboardingFlow |
| L8 takılan açılış ekranı yok | onboardingFlow |
| D1 tohumlayıcı kapısı release'te modülü yükler | loginNoBypassInRelease (2) |
| D2 demo düğmesi statik içe aktarılır | loginNoBypassInRelease |
| D3 Ayarlar satırı `__DEV__` dışında | loginNoBypassInRelease |
| X1 çevrimdışı çıkış yine başarısız | signOut |
| X2 her çıkış hatası çevrimdışı sayılır | signOut |
| X3 yedek yol depodaki oturumu silmeden çıkar | signOut |

**52/52 öldürüldü** (S6 test sabitlendikten sonra); ek olarak D4 (kapıda `require` eski düz biçimde, paket kaçağının kendisi) loginNoBypassInRelease tarafından öldürüldü: **53/53**. L1-L8 kaynak iddiasıyla öldürülür: kök düzen expo-router gezgini olmadan render edilemez.

**Paket (bundle) denetimi — release'te dizge yok (NAV-01, PRF-03).** `scratchpad/bundle.sh` (depo dışı çıktı dizinleri, `--dev` yok = üretim dönüşümü). İğneler YALNIZ ASCII: web paketi ASCII dışı karakterleri kaçışlar (`Girişi`, `yükleyici`), Hermes ASCII dışı dizgeleri UTF-16 saklar; planın "Girişi Geç" iğnesi iki pakette de ASCII ile var olsa bile bulunamazdı (ilk denetimde "Demo veri yükleyici" iğnesi bu yüzden kaçtı). İğneler: `demo-local | Aderyth Demo | demo-project-1 | seedDemoData | isSeedingAllowed | DevDemoLoginButton | handleBypassLogin | Demo Modu`.

| Paket | Sonuç |
|---|---|
| İlk denetim (kapı eski biçimde), web release | `demo-local` 1, `seedDemoData` 1, `isSeedingAllowed` 1: demoSeed modülü pakette (sapma 15); Android `.hbc` `demo-local` 1 |
| Düzeltme sonrası `npx expo export --platform web` | çıkış 0; iğne grep çıkış 1 (eşleşme yok); kapı modülü `e.loadDemoSeed=function(){return null}},2752,[]` (bağımlılık listesi boş); pozitif kontrol `onboarding.statusCache` var |
| Düzeltme sonrası `npx expo export --platform android` | çıkış 0; `entry-*.hbc` iğne sayısı 0 (grep çıkış 1); pozitif kontrol (`onboarding.statusCache` / `resolveBootSession` / `config-missing`) 3 |
| Kontrol: `npx expo export --platform web --dev` | çıkış 0; iğneler VAR (`Aderyth Demo` 1, `Demo Modu` 1, `demo-local` 2, `demo-project-1` 4, `isSeedingAllowed` 2, `seedDemoData` 3): grep kaçırmıyor, geliştirme derlemesinde düğme ve tohumlayıcı duruyor |

iOS paketi dışa aktarılmadı (Android ile aynı Metro/Hermes dönüşümü; plan iOS istemez).

**Kapılar (nihai ağaç, sırayla, `timeout` yok, çıkış kodları basıldı):** `npm run -s typecheck:ci` çıkış 0; `npm run -s lint:ci` çıkış 0 (0 uyarı); `npx jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB` çıkış 0, 287/287 suite, 4169/4169 test, 161,8 sn (`ae6cc580` sonrası 283 suite / 4057 test: +4 suite, +112 test; F05 sonrası 282 / 4039); `node run-tests.js` çıkış 0, **147/147** (+2 F06 kontrolü: "Login ekranında demo bypass dizgesi yok", "demoSeed yalnızca demoSeedGate üzerinden yüklenir"); `git diff --check` çıkış 0; `git diff --stat -- supabase frontend/lib/featureGates.ts frontend/package.json` boş. Ara koşularda kırmızı: ilk hedefli koşuda `onboardingGate` 4 vaka (test bulucusu `Button`'ın iç içe iki düğümünü ikişer sayıyordu; bulucu en dıştaki eşleşmeyi alacak şekilde düzeltildi, ürün kodu değişmedi). Aynı commit öncesi tam koşu (ek testler ve kapı düzeltmesinden önce) de yeşildi: 287/287, 4163/4163, 147/147. Host yükü kaynaklı rastgele kırmızı görülmedi. Guard'lar (`syncLifecycleWired`, `accountScopeRegistry`, `taskOutboxWired`, `crashReportingWired`, `remindersWired`, `freeMvpReleaseShape` :118-124, `scopeAddendum`, `demoSeed.test` AC-S05, `sessionLocalRead`, `onboardingRecovery`, `databaseTypesWired`, `networkSignal`) değişmeden yeşil.

**Görsel QA: yapılmadı (sahipte).** Ajan canlı projeye oturum açmaz; onboarding kapısı ancak oturum açmış bir kullanıcıyla, takılan açılış ekranı ancak 12 sn'yi aşan bir açılışla görülür. Yerine koyulan, görsel QA'nın yerini TUTMAYAN kanıt: `onboardingGate.test.tsx` render düzeyinde iki varyantın düğme sırasını ve işleyicilerini, `signingOut` iken iki düğmenin `disabled` + `accessibilityState.disabled` olduğunu, `onSignOut` yokken çıkış düğmesinin çizilmediğini, başlığın `header` rolünü, hata kutusunun `polite` canlı bölgesini, her düğmenin rol/etiket/ipucunu, metinlerde ünlem ve suçlama olmadığını; `BootGate` için `stalled` (tek "Tekrar dene", ipucu "Açılışı yeniden başlatır.") ve `config` (düğme yok) varyantlarını sınar. Düğmeler `Button size="lg"` (54 pt, `minHeight` 44 pt güvencesi bileşende). Kontrastlar (koyu tema, `lib/tokens.ts`): başlık `text`/`bg` 15,32:1, gövde `textDim`/`bg` 9,60:1, hata kutusu `textDim`/`surface` 8,88:1, "Hata" etiketi `textFaint`/`surface` 5,21:1, birincil düğme koyu metin/kil 5,91:1 (`onColor` beyazı 3,12:1 olduğu için koyu seçer), hayalet düğme etiketi `accent`/`bg` 5,91:1, uyarı ikonu `warning`/`surfaceAlt` 6,85:1. Hayalet düğmenin çerçevesi `border`/`bg` 1,50:1 (mevcut `Button` varyantı; düğmeyi etiket tanımlar; bu faz değiştirmedi). Animasyon eklenmedi (Reduce Motion etkilenmez). 375x812 / 768x1024 / 1366x900, %200 yazı, VoiceOver/TalkBack, web Tab sırası ("Tekrar dene" → "Oturumu kapat") ve giriş ekranının demo düğmesi çıktıktan sonraki boşluğu sahibin branch denemesine bırakıldı.

**Elle senaryolar (plan 5, 1-5): yapılmadı (sahipte).** Otomatik karşılıkları: 1 → `onboardingOfflineStart` "cached completed + status 0" (+ legacy/skipped/503); 2 → `onboardingOfflineStart` "no cache + no connection: gate" + `onboardingGate` kaçış düğmeleri + `signOut` "without a connection" (çevrimdışı çıkış, sapma 9); 3 → `onboardingOfflineStart` "offline with an EXPIRED token" + `sessionOfflineExpiry` (`currentUser`/`resolveBootSession`/`currentUserId`) + `onboardingFlow` `INITIAL_SESSION` iddiası; 4 → `onboardingOfflineStart` STO-04 vakaları + `onboardingFlow` `sessionUid` bağımlılıkları; 5 → `sessionOfflineExpiry` "lib/supabase without a configuration" (gerçek modül fırlatmadan yüklenir, `SUPABASE_CONFIG_ERROR` dolu) + `BootGate` config render vakası + render sırası iddiası.

**Bulundu, düzeltilmedi:** (a) Çevrimdışı + süresi dolmuş jetonla en kötü soğuk açılış yaklaşık 2 + 8 + 2 + 2 = 14 sn'de Bugün'e varır (kuyruk hidrasyonundaki `currentUser`, boot sınırı, onboarding'in `currentUser`'ı ve `currentUserId`; auth-js çevrimdışı yenilemeyi ~25 sn dener). Plan elle senaryo 3 "≤ 10 sn" bekler; planın kendi sabitleriyle tutmaz. Bekçi tetiklenmez (boot ~10 sn'de biter), kullanıcı spinner görür. Çare: açılış başına tek sınırlı okuma paylaşmak (F18/F22 veya sahip kararı). (b) Çevrimdışı çıkışta yenileme jetonu sunucuda iptal edilmez (sapma 9). (c) `store/notionSessionStore.ts:24` depolama anahtarını doğrudan `supabase.auth.getSession()` ile bulur; çevrimdışı + süresi dolmuşta anahtar `null` olur (Notion girişi kapsam eki ile kapalı; F06 dışı). (d) Release giriş ekranında "Giriş Yap" artık ilk düğme ama `variant="secondary"` kaldı (F22 giriş akışları). (e) Çakışma satırındaki "Benimkini uygula" etiket/metin farkı (F05 sahip kararı başlığında). (f) `authStorage` yeni şemasıyla yazılmış oturum eski kodla okunamaz; `ae6cc580` geri alınırsa kullanıcılar bir kez yeniden giriş yapar (commit mesajında).

**Açık:** (1) Görsel QA, elle senaryolar ve `npx expo start --web` ile `__DEV__` derlemesinde demo düğmesinin GÖRÜNDÜĞÜNÜN elle doğrulanması sahipte (otomatik karşılığı: `--dev` web paketinde dizgeler var, yukarıda). (2) Commit özeti bu başlıkta yok ("bu commit"). (3) Sahibin çalışma ağacındaki üç dosya commit'e alınmadı.

### F06 commit: `6924a6a5`

### Push ve CI düzeltmesi (2026-11-02)

**Push:** `feature/claude-360-implementation` sahip talimatıyla 2026-11-02'de `origin`'e push edildi (OD-21'in push kısmı; PR ve merge sahipte). İlk CI koşusu (run 41462368315): `verify` ✅, `db-migrations-verify` ✅ (F01-F03'ün ilk gerçek CI kanıtı; `main`'de kırmızıydı), `edge-deno-verify` ❌.

**`edge-deno-verify` neden kırmızıydı:** iş 2026-11-01'de (`a2fb9c51`, `main`) eklendi ve bir kez bile yeşil olmadı (bu dal `supabase/functions`'a dokunmamıştı). İki katman: (1) Depo kökündeki `package.json` (yalnız `playwright`) Deno 2'yi "manual node_modules" kipine sokuyor; sabitlenmemiş `jsr:@supabase/supabase-js@2` 2.118.0'a çözülüyor ve onun istediği `npm:@supabase/realtime-js@2.118.0` `node_modules`'ta olmadığı için `deno check` kodumuzu okumadan düşüyordu. (2) Bu aşılınca arkasında gerçek bir tip hatası vardı: `generate-routine/index.ts:394` `client: ReturnType<typeof createClient>` 2.118 tiplerinde varsayılan jeneriklere (`<unknown, ..., never>`) çözülüyor, gerçek istemci uymuyor (TS2345, `:535`).

**Düzeltme (bu commit):** `ci.yml` `edge-deno-verify` işine `env: DENO_NO_PACKAGE_JSON: '1'` (Edge Function'lar o `package.json`'ı kullanmaz; Deno `npm:` paketlerini kendi önbelleğinden çözer, Supabase Edge çalışma zamanı gibi). `generate-routine/index.ts`: parametre `SupabaseClient` tipiyle (`import type`); yalnız tip, çalışma zamanı değişmez. `ciGatesWired.test.ts` (+1): ortam değişkeni işte ve `deno check` komutundan önce (mutant "env kaldırıldı" bu testle kırmızı; dosya bayt bayt geri yüklendi). Edge hedef listesi ve fonksiyon sayısı değişmedi.

**Yerel kanıt (Deno 2.9.6, npm `deno` paketi, scratchpad; `DENO_DIR` scratchpad):** CI'daki birebir `deno check` komutu depo kökünden: değişkensiz çıkış 1 (aynı `realtime-js` hatası), değişkenle ve tip düzeltmesinden önce çıkış 1 (TS2345, tek hata), ikisiyle çıkış 0 (11 hedef); `deno test supabase/functions/_shared/aiIdempotency_test.ts` 5/5. Gerçek CI sonucu bir sonraki push'ta.

**Bulundu, düzeltilmedi:** Edge içe aktarımları sürüm sabitlemiyor (`jsr:@supabase/supabase-js@2` ve `https://esm.sh/@supabase/supabase-js@2`, iki farklı kaynak); kütüphanenin bir sonraki yayını CI'ı yine kırabilir ve deploy edilen kod CI'da denetlenenden farklı bir sürüme çözülebilir. Tam sabitleme (ve tek kaynak) çalışma zamanını değiştirir; F08 (tedarik zinciri) ya da sahip kararıyla. Edge deploy sahipte (bu tip düzeltmesi deploy gerektirmez).

### F07 (2026-11-02) — bu commit

**Faz:** 039: Focus Point kredi bütünlüğü (G0; EDG-02, INT-03, EDG-01, INT-11, REP-15, DB2-V01, EDG-16). **Durum: DONE (CI KANITI BEKLİYOR; görsel QA SAHİPTE).** Ön koşul F02 (`b6ba0f40`), F03 (`5049fb57`). İlk uygulama (`e1093088`, plandan 12 noktada sapıyordu) sahip tarafından 2026-11-02'de reddedildi ve `git reset --soft HEAD~1` ile geri alındı; F07 dosyaları HEAD'e (`7cd05a4c`) döndürülüp baştan, planın metniyle yeniden yazıldı. Sahibin çalışma ağacındaki üç dosyaya dokunulmadı (sha256 her adımda doğrulandı). Canlıya hiçbir şey uygulanmadı (039 OD-02/S1-S2, `generate-routine` deploy'u OD-03/S3). OD-05 BEKLİYOR: 039 fonksiyon tanımlamaz, yetki vermez; `migrationRlsGuard.test.ts` değişmedi. FP miktarları, `PAID_SUBSCRIPTIONS_ENABLED` (false) ve `featureGates.ts` değişmedi. Yeni Edge Function/handler/`_test.ts` yok: `ci.yml` ve `ciGatesWired.test.ts` değişmedi. Push yok.

**Plana göre yazılanlar (metin birebir):** `supabase/migrations/039_focus_point_hardening.sql` (bölüm 3'teki blok, `implementation.md`'den satır satır kopyalandı), `aiIdempotency.ts` (`IdempotencyDeps.refund: Promise<boolean>`, zorunlu `expireLease`, `REFUND_PENDING`, `REFUND_PENDING_NOTE`, `failAndRefund`, dosya başı paragrafı), `generate-routine/index.ts` (`refund` iki deneme + `true`/`false`, `expireLease`), `edgeCall.ts` (`REQUEST_IN_PROGRESS_RETRY_DELAYS_MS` ve yorumu), `aiAttempt.ts` (`REQUEST_IN_PROGRESS_CODE`, `IN_PROGRESS_NOTE`, `AttemptKeeper` ve `rebind`, `InvokeOutcome`/`InvokeErrorInfo`/`RetryOutcome`, `retryWhileInProgress`), `ai-coach.tsx` (`:569` aynen, `startedKey`, `onConversationCreated` -> `rebind`, `send` ve `summarize` adım 12'deki kodla, `mountedRef` bileşen başında ve mevcut unmount temizliğiyle birleşik), `journal-insights.tsx` ve `routineStore.ts` (adım 13), `aiConversationStore.ts` (adım 11), `aiConversationRepository.ts` (adım 15'teki kod), `aiCoachService.ts` (yalnız yorum), `supabase/migrations/README.md` (madde 12'deki satır), `SQL_FOR_OWNER.md` (§0 ön kontrol ve §2 doğrulama blokları plandan kopyalandı, §1 satırı, §5 sıra notu birebir). Testler bölüm 5'in vaka listeleriyle: `aiIdempotency_test.ts` (Deno: `:60`/`:103`/`:123-125` sahteleri `true` döner, her `deps`'e `expireLease`, yeni (i)-(iv)), `aiIdempotency.test.ts` (harness: `refund` boolean, `expireLease` sahtesi, `refundFails`, CASE J'nin üç maddesi; "kira dolmuş taklidi" için `begin` önce kirası bitirilmiş talepleri SQL uzlaştırması gibi iade eder), `aiAttempt.test.ts` (mevcut vakalar aynı; `rebind`, sahte `sleep`li `retryWhileInProgress`, `IN_PROGRESS_NOTE`), yeni `aiRetrySameRequestId.test.ts` (anahtar yaşam döngüsü 7, INT-03 5, bütünleşik 1, INT-03+INT-11 zinciri sahte repository ile 2, gerçek repository 23505 yalnız `lib/supabase` taklidiyle 5), yeni `focusPointHardening039.test.ts` (planın beş maddesi), `aiCoachConversations.test.ts` (sahte `insertMessage` kullanıcı rolünde de idempotent; aynı `requestId` ile iki `send` -> tek kullanıcı satırı), `aiOneChargeWired.test.ts` (+2), `focusPointAtomicity.test.ts` (+2).

**Sapmalar (sahip kararı 2026-11-02, "Sözleşmeleri koru, 2 sapma"): yalnız iki.**
1. **`039_focus_point_hardening.rollback.sql` F02 onay sözleşmesini taşır.** Planın metni (DROP INDEX ve "Deliberately NOT reverted" notları) aynen içeride; etrafına `BEGIN;`, `aderyth.rollback_confirm = '039'` bekçisi ve `COMMIT;` eklendi. Sebep: planın metni onaysız çalışır; `migrationRollbackPresent.test.ts` (3 vaka) ve `ci.yml` F02 negatif kontrol adımı ("ran without any confirmation") kırmızı olur. Plana birebir ağaçta yerelde doğrulandı (aşağıda).
2. **`supabase/tests/07_focus_point_039.sql` F01 protokolünde, meta-komutsuz.** Planın vaka 1, 2, 6, 7 ve 8'i aynı fixture'larla `aderyth_test.res`/`expect_allowed`/`expect_denied` sonuçlarına çevrildi (`T07a`-`T07h`, 8 sonuç). Sebep: plan metni `\set` ve `\i` kullanır, `sqlBehaviorTestsWired.test.ts:944` bunu yasaklar. **Sonucu:** planın vaka 3-5'i (039'u `\i` ile yeniden çalıştırıp 039'dan önce yazılmış satırları onarması: yinelenen kopyaların silinmesi, tek iade, ikinci çalıştırmanın idempotent olması, talepten eski ücretin iade edilmemesi) bu protokolde ifade edilemez ve CI'da otomatik kanıtı YOKTUR (sahip CI'a adım eklenmesini reddetti). Yerel kanıt: planın birebir 07'si, `\set`/`\i` destekleyen bir psql öykünücü kopyasıyla gerçek `ci.yml` adımlarında koşturuldu, `run.sh` adımı yeşil (vaka 3-5 dahil, hiçbir `RAISE EXCEPTION` tetiklenmedi); dosya ve günlük scratchpad'de `plan_verbatim/`.

**Sahip kararıyla güncellenen guard ve belgeler (aynı karar; iddia gevşetilmedi, planın biçimine uyarlandı):** `focusPointAtomicity.test.ts` üç iddiası (`:146-153` reddedilen sonuç `failAndRefund`'a gider ve yardımcıda iade `fail`'den önce; `:160` `catch (err)` -> `failAndRefund({ reason: 'ai_error'`; `:180` tek iade çağrısı, `if (charged)` içinde), `aiRequestLeaseAndPrivileges.test.ts` sahtesi (`refund` `true` döner, `expireLease: async () => {}`; kuralları değişmedi), `MIGRATION_MAPPING.md` 039 satırı (`migrationMapping.test.ts` ister), `supabase/rollbacks/README.md` 039 satırı, sıra ve sayı (`migrationRollbackPresent` ister), `SQL_FOR_OWNER.md` §1 geri alma sırasına 039.

**Yorum gerektiren yerler (sapma değil):** `focusPointHardening039`'un "(-) habit_logs, profiles, xp içermez" maddesi yorumsuz kodda uygulanır; planın kendi migrasyon başlığı bu adları "dokunmaz" diye anar. §0 ve §2 bloklarına numara başlığı (`-- 0.5 039 öncesi (F07)`, `-- 2.12 (039) sonrası doğrulama`); §1 satırının metni planda yok, yazıldı. Planın `summarize` parçasındaki `// :656 satırı AYNEN` bir talimattır, koda yazılmadı. `mountedRef`/`isCancelled` plan gereği yalnız `ai-coach.tsx`'te. `routineStore` hata gövdesi mevcut yapı korunarak `outcome.errorInfo`'dan okunur.

**Kırmızı taban (anayasa B.4), üretim koduna dokunmadan önce:** 7 suite'ten 6'sı kırmızı, 137 vakanın 35'i (Blok A: CASE J 2/3; Deno tip denetimi 7 hata; Blok C: `rebind`, `retryWhileInProgress`, anahtar yaşam döngüsü, INT-03; Blok D: gerçek repository 23505 vakalarından 2'si; `aiOneChargeWired` 2, `focusPointAtomicity` 2, `focusPointHardening039` 5). `aiCoachConversations`'ın yeni vakası planın tarifiyle tabanda da yeşil (sahte depo idempotent olduğu için).

**Mutasyon (planın üç mutantı; taban yeşil: jest 64/64, Deno check 0 / test 9/9; her dosya bayt bayt geri yüklendi):** (i) `failAndRefund` `refunded`'ı yok sayıp her zaman `fail` çağırır -> Deno (i) ve (ii) kırmızı, CASE J 2 vaka kırmızı; (ii) `rebind` boş -> `aiAttempt` ve `aiRetrySameRequestId` 4 vaka kırmızı; (iii) `retryWhileInProgress` kodu karşılaştırmaz -> 402 ve 500 negatifleri dahil 6 vaka kırmızı. **3/3 öldürüldü.**

**Kapılar (nihai ağaç, sırayla, `timeout` yok):** `npm run -s typecheck:ci` 0; `npm run -s lint:ci` 0 (0 uyarı); `npx jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB` 0, 289/289 suite, 4230/4230 test (287/4170'ten +2/+60); `node run-tests.js` 0, 147/147; `git diff --check` 0. Deno 2.9.6 (CI komutları, depo kökünden, `DENO_NO_PACKAGE_JSON=1`): 11 hedefli `deno check` 0, `deno test` 9/9. SQL: `ci.yml` `db-migrations-verify`'ın gerçek `run:` adımları taze yerel Postgres 17'de, 17/17 adım 0; `run.sh` 94 sonuç (73 PASS, 20 beklenen `T02b`, 1 INFO; 07'nin 8'i PASS) iki kez; taban parmak izi 1150, ileri 1372 (+1 indeks), geri alınmış ve ikinci tur 1150 (tabana eşit), ikinci ileri ilkine eşit. Plana birebir ağaçtaki ara ölçüm (sahip kararından önce): typecheck 2 (TS2322), jest 9 vaka, run-tests 146/147, yerel CI adım 9 kırmızı; karar bu ölçümle verildi.

**`docs/QUERY_BOUNDING_MATRIX.md`:** `queryBounding.test.ts` her jest koşusunda bu dosyayı koddan yeniden yazar; planın repository ön okuması yeni bir sorgu olduğu için (98 -> 99) her koşu dosyayı değiştirir. Sahip talimatıyla commit'e alınmadı ve her koşudan sonra geri yüklendi; depodaki kopya bu sorguyu içermez.

**Görsel QA: yapılmadı (sahipte).** Görünen tek değişiklik `IN_PROGRESS_NOTE` (AI Koç hata balonu, günlük içgörüsü ve rutin hata alanı) ve sunucu hata iletisinin sonundaki `REFUND_PENDING_NOTE`; yeni ekran, düğme, animasyon yok. 375x812 / 768x1024 / 1366x900, %200 yazı, ekran okuyucu sahipte.

**Bulundu, düzeltilmedi:** (a) Harcama sunucuda yazılıp yanıtı Edge'e ulaşmazsa (`spend` `unavailable` -> `release`) ve sağlayıcı da başarısız olursa ücret iade edilmez; 039'un iyileştirmesi de `created_at` koşuluyla onu almaz (F21 ya da sahip kararı). (b) `ai_request_reconcile_stale` iletisi koç için de "Kurulum yarida kaldi" der (SQL fonksiyonu değişikliği, OD-05). (c) Deneme saklayıcıları hesap değişiminde kapanmaz (plan F04'e yazar; ücret/veri sızıntısı yok). (d) 039 istemci güncellenmeden uygulanırsa eski sürüm yeniden gönderimde ham 23505 iletisini gösterir (sıra §5'te). (e) Planın `expireLease` kodu fırlatabilir (try yok; tip yorumu "Fırlatmaz" der); fırlatırsa istisna `runIdempotentAiRequest`'ten çıkar, yanıt `REFUND_PENDING` yerine handler'ın genel 500 iletisi olur; talep yine `in_progress` kalır (kira 5 dk'da biter, para kaybı yok). (f) Edge içe aktarımları sürüm sabitlemiyor. (g) 039'un veri onarımının CI'da otomatik kanıtı yok (sapma 2).

**Açık:** (1) 039'un uygulanması ve `generate-routine` deploy'u sahipte; sıra: istemci sürümü -> 039; Edge deploy'u bağımsız. (2) Görsel QA sahipte. (3) İlk gerçek CI koşusu (push sahipte). (4) Commit özeti bu başlıkta yok ("bu commit").

### F07 commit: `7dd028f0`

### Wave 0A — Sahip Grup Onayları, OD Kararları ve Çalışma Ağacı Hijyeni (2026-11-21)

```yaml
final_plan_approval: G1 2026-11-21 owner
final_plan_approval: G2 2026-11-21 owner
final_plan_approval: G3 (F36, F37; OD-02/08/09/10 kapılı fazlar kapalı kalır) 2026-11-21 owner
final_plan_approval: G4 (F44, F46, F48, F49; OD-11/12/13 kapılı fazlar kapalı kalır) 2026-11-21 owner
owner_decision: F07.1 2026-11-21 Wave 0A (çalışma ağacı + QUERY_BOUNDING_MATRIX.md 99 sorgu) ve Wave 0B (spend.unavailable -> expireLease, expireLease try/catch, AttemptKeeper accountEpoch sıfırlaması, ci.yml 039 dedupe+heal testi) onaylandı
owner_decision: OD-05 2026-11-21 migrationRlsGuard.test.ts daraltıcı REVOKE+GRANT, sabit search_path'li argümanlı SECURITY DEFINER, sütun düzeyi SELECT grant ve var olan tabloda owner-only politika biçimleri onaylandı
owner_decision: OD-06 2026-11-21 Keşfet "finance" kategorisi ve onboarding hedefi etiketi "Ev & Evrak Düzeni" olarak belirlendi
owner_decision: OD-07 2026-11-21 Kırılgan metin guard'larının davranış testleri ve Türkçe i18n katalog anahtarlarıyla değiştirilmesi onaylandı (F44 ve F48 tam kapsam)
```

- **Alıntılanan sahip onay yanıtları (2026-11-21):**
  - `A1: (Recommended) Doğrudan burada (Antigravity paralel subagent dalgaları ile uygula)`
  - `A2: (Recommended) Evet — Wave 0A (çalışma ağacı + sorgu matrisi) ve Wave 0B (F07.1 kredi/istisna/hesap-sınırı + 039 CI testi) uygulansın`
  - `A3: (Recommended) G1 (F08–F22) + OD-05 VE G2 (F23–F34) + OD-06 ("Ev & Evrak Düzeni") onaylı`
  - `A4: (Recommended) OD-07: Metin guard'larının dönüşümü ve Türkçe i18n altyapısı (F44 ve F48 tam kapsam)`
- **Çalışma ağacı hijyeni:** `frontend/app/screens/monthly-review.tsx` CRLF -> LF normalleştirildi; `docs/QUERY_BOUNDING_MATRIX.md` (98 -> 99 sorgu, F07 `aiConversationRepository` ön okuması dahil), `docs/ADERYTH_360_AUDIT_AND_COMPETITOR_REPORT.md` ve `implementation.md` (0.1 ve Ek C onay kayıtlarıyla) bu `docs:` commit'ine (`204c156`) alındı.

### F07.1 (2026-11-21) — Wave 0B Focus Point kredi sızıntısı, istisna güvenliği, hesap sınırı ve 039 CI kanıtı

- **Kapsam (sahip kararı 2026-11-21):** F07'de tespit edilip "0 sapma" kısıtı nedeniyle açık bırakılan 4 maddenin kapatılması:
  1. **Dar kredi sızıntısı (`supabase/functions/_shared/aiIdempotency.ts`):** `spend.kind === 'unavailable'` dalında `deps.release` yerine `try { await deps.expireLease({ requestId }); } catch {}` çağrılır ve `503 REFUND_PENDING` döner. Sunucuda `spend_focus_points_v2` yazılıp HTTP yanıtı düşmüşse talep silinmez; `ai_request_reconcile_stale` ücreti eksiksiz iade eder (yazılmamışsa 0 FP ile `failed` işaretler).
  2. **`expireLease` istisna koruması (`aiIdempotency.ts`, `supabase/functions/generate-routine/index.ts`):** `expireLease` içindeki iki `admin` çağrısı ve `failAndRefund`/`spend.unavailable` çağrı noktaları `try/catch` içine alındı ("Fırlatmaz" sözleşmesi garanti).
  3. **Hesap sınırında `AttemptKeeper` sıfırlaması (`frontend/lib/aiAttempt.ts`):** `createAttemptKeeper` `accountEpoch()` damgası taşır; `resetAccountMemory` sonrasında eski hesabın açık `requestId` ve `rebind` kayıtları geçersizleşir.
  4. **`039` veri onarımının CI kanıtı (`.github/workflows/ci.yml`, `ciGatesWired.test.ts`):** `db-migrations-verify` işine `039` geri alma -> çift kullanıcı mesajı + iadesiz `failed` talep + talepten eski meşru harcama tohumlama -> `039` uygulama -> tekilleştirme + yalnız talep sonrası harcamaya tek iade + ikinci çalıştırmada idempotent 0 ek iade + `xp_drift() = 0` doğrulama adımı eklendi (`sqlBehaviorTestsWired.test.ts:944` meta-komut yasağı gevşetilmedi).
- **Kırmızı taban:** Üretim kodundan önce 3 suite / 6 yeni iddia kırmızı doğrulandı (`CASE K` 3 vaka, `aiAttempt` 2 vaka, `focusPointAtomicity` 1 vaka).
- **Mutasyon kanıtı (`sha256` bayt bayt geri yükleme doğrulamalı):** `M1` (`spend.unavailable` -> `release`), `M2` (`failAndRefund` `expireLease` korumasız), `M3` (`AttemptKeeper` `accountEpoch` yok sayar), `M4` (`generate-routine` `expireLease` `try` eksik) -> **4/4 KILLED**.
- **Kapılar:** `typecheck:ci` çıkış 0; `lint:ci` çıkış 0 (0 uyarı); `jest` **289/289 suite · 4235/4235 test** yeşil (ilk soğuk Babel önbelleğinde zaman aşımına takılan 4 UI suite ve `PATH` üzerinde Git Bash araçlarıyla 2 repo suite izole koşuda 6/6 yeşil, Anayasa 0.C); `node run-tests.js` **147/147**; Deno 2 (`DENO_NO_PACKAGE_JSON=1`) 11 hedef `deno check` çıkış 0 ve `deno test` **10/10**; `git diff --check` çıkış 0.


### F08 (2026-11-21) — `922a291b..620895f5` (`faz/F08-tedarik-ci-hijyen`)

- **Durum:** DONE. **Kapsanan bulgular:** BLD-02, BLD-03, BLD-04, BLD-05, BLD-07, BLD-08, BLD-09, BLD-10, BLD-12, BLD-13, BLD-22, BLD-23, BLD-25, PRF-22, GAP2-04.
- **Özet değişiklikler:**
  - Örtük araç/tip bağımlılıkları beyan edildi (`declaredDependencies.test.ts`); `postinstall`, `expo-module-scripts`, `fix-expo-tsconfig.js` ve `reset-project.js` kaldırıldı (`noInstallTimePatching.test.ts`).
  - Güvenlik açığı bütçesi (`frontend/audit-budget.json`, `lockfileAdvisoryBudget.test.ts`) ve `.github/dependabot.yml` kuruldu; toplam `npm audit` açığı 48'den (1 kritik, 10 yüksek) prod ağacında 6'ya (0 kritik, 3 yüksek — `decode-uri-component` ESM uyumsuzluğu nedeniyle `2027-01-31` vadeli triage) indirildi.
  - `.nvmrc` (`22.13.0`), `frontend/.npmrc` (`engine-strict=true`), `frontend/package.json#engines`, `frontend/eas.json` ve CI iş akışları tek Node sözleşmesinde birleştirildi (`nodeContract.test.ts`).
  - `.github/workflows/ci.yml` ve `supabase-release-verify.yml` `permissions: contents: read`, `concurrency`, `timeout-minutes`, 40-hex aksiyon SHA sabitlemeleri ve Android/iOS/Web export + `expo install --check` + `expo prebuild --no-install` + `expo-doctor` + `npm audit` adımlarıyla sertleştirildi (`ciGatesWired.test.ts`).
  - `configure-supabase-recovery-template.mjs` için kanonik proje bekçisi (`canonicalProjectRef.mjs`, `recoveryTemplateGuard.test.ts`), genel `linked-project.json` taraması (`supabase/predeploy_guard.sh`) ve canlıya yazan betiklerin kaldırılması (`noLiveScriptsTracked.test.ts`) tamamlandı.
  - Genel ortam değişkeni doğrulaması (`lib/env.ts`, `env.test.ts`), sakin `ConfigErrorScreen` (`ConfigErrorScreen.test.tsx`), `frontend/.env.example` ve `run-tests.js` taşıması tamamlandı.
  - 7 ölü bağımlılık ve `SpaceMono-Regular.ttf` kaldırıldı; toast animasyonları `FadeInUpView` bileşenine taşındı (`FadeInUpView.test.tsx`, `noDeadDependencies.test.ts`).
  - 70+ kök artık (`awwwards-loop/`, `frontend/awwwards-loop/`, `ss_*.png`, `.gitconfig`, `model.patch`, kök `package*.json` vb.) temizlendi ve kök izin listesi kapısı (`repoRootAllowlist.test.ts`) eklendi.
- **Mutasyon kanıtı:** M1–M6 (`env.ts`, `ConfigErrorScreen.tsx`, `canonicalProjectRef.mjs`, `ci.yml` SHA, `package.json#engines`, `FadeInUpView.tsx` unmount stop) -> **6/6 KILLED** (`sha256` geri yükleme doğrulandı).
- **Açık sahip adımları:** EAS `production` ortam değişkenleri kontrolü, GitHub Actions izin/`SUPABASE_ACCESS_TOKEN` onaylayıcısı kontrolü, `SQL_FOR_OWNER.md` §3'teki eski test hesapları salt-okunur sorgusu.

### F09 + F07-R3 (2026-11-21) — `596d733d` (`faz/F09-040-ayricalik-hijyeni`)

- **Durum:** DONE (CI `db-migrations-verify` kanıtı ve görsel QA sahipte). **Kapsanan bulgular:** DB2-13, DB1-07, DB1-08, DB2-18, DB1-06, DB1-04, DB2-05, REP-03, DB1-12, DB2-16, DB1-11, GEM-02, EDG-08, DB1-09, DB2-15, DB2-08, DB2-12, DB1-10, DB1-20, DB1-13, F07-R3. `OWNER DECISION OD-05 (2026-11-21)` onaylı.
- **Özet değişiklikler:**
  - Yeni: `supabase/migrations/040_privilege_hygiene.sql` (20 SECURITY DEFINER `search_path` sabitlemesi; 12 iptal edilmiş F13 fonksiyonunda istemci EXECUTE iptali; anon yazma/`MAINTAIN` ve küresel `PUBLIC EXECUTE` kapatılması; liderlik RPC'lerinde oturum zorunluluğu + `1..100` sınırı + yalnız çağıranın sırası; `profiles` `(id, email, username)` dar INSERT + `archive_040.profiles_username_backup` yedeğiyle kullanıcı adı onarımı + `profiles_username_shape` `NOT VALID` + `handle_new_user` temizliği; `028..031` 10 tablosuna dar CRUD yetkisi; OAuth tablolarında gizli sütun yalıtımı; `add_xp`, `get_or_init_subscription`, `get_or_init_subscription_for` `FOR UPDATE` satır kilidi; **F07-R3** `ai_request_reconcile_stale` mod-duyarlı Türkçe ileti + `SET search_path TO ''` + `service_role`-only; zombi tetikleyicilerin düşürülmesi, 17 F13 tablosunda yazma iptali ve 6 tablonun `archive_f13`'e taşınması; `archive_040.acl_snapshot` ve bölüm 9 öz-denetimi), `supabase/rollbacks/040_privilege_hygiene.rollback.sql`, `supabase/tests/08_privilege_hygiene_040.sql` (37 sonuç), `privilegeHygiene040.test.ts`, `profileRepository.test.ts`.
  - Güncellenen: `037_today_bootstrap_rpc.sql` (DB1-20 salt-okunur `STABLE`), `profileRepository.ts` (`updateUsername` sanitizasyon + `<3`/`>24` sınırı), `migrationRlsGuard.test.ts` (OD-05 + negatif kontroller), `expected_failures.txt` (0 beklenen kırmızı), `run.sh` (`MIN_RESULTS=80`), `ci.yml` (`040` önkoşul, ikinci geri alma turu ve kullanıcı adı onarım/geri alma adımları), `README.md`, `MIGRATION_MAPPING.md` (`20261010001300`), `SQL_FOR_OWNER.md`.
- **Mutasyon kanıtı:** M01–M11 (`profileRepository` 4, `040` 5 [F07-R3 dahil], `040.rollback` 1, `037` 1) -> **11/11 KILLED** (`sha256` geri yükleme doğrulandı).

### F13 (2026-11-21) — `68904d7b` (`faz/F13-aliskanlik-motoru`)

- **Durum:** DONE (görsel QA sahipte). **Kapsanan bulgular:** INT-01, INT-06, DOM-20, INT-07, DOM-06, DOM-07, DOM-09, DOM-17, DOM-08, DOM-10, DOM-13, DOM-16, STO-14, DOM-22, GEM-10, DOM-23.
- **Özet değişiklikler:**
  - Tek tamamlanma sözleşmesi (`frontend/lib/completionMetric.ts`: `judgeDay`, `weighted` vs `strict_done`, `asOf` `pending`, `skip` `excused`, olumsuz kayıtsız `unknown`, veri yokluğunda uydurma `0` yerine `null`) ve sakin Türkçe metinler (`frontend/lib/metricCopy.ts`).
  - Takvim-farkında alışkanlık gücü (`habitStrengthFor`) ve `habit-detail.tsx` memo + ekran okuyucu etiketleri; takvim-farkında seriler (`behaviorIntelligence.ts`) ve `streakSingleSource.test.ts` bekçisi; 56 günlük içgörü geçerlilik kapıları (`insightDigest.ts`, `insights.tsx`, `DIGEST_PREAMBLE`).
  - Telafi ve değerlendirme ekranları (`recovery.ts`, `recoveryBacklog.ts`, `recoveryStore.ts`, `recovery.tsx`, `weekly-review.tsx`, `monthly-review.tsx`): `skippedSet` dışlaması, `BACKLOG_PAGE_SIZE = 7` + 44pt `"Daha fazla göster"`, yön duyarlı `deficitFor`, `completePlan` hata koruması (`Promise<boolean>`), utandırıcı dilden arındırılmış dönüş metinleri.
- **Kırmızı taban ve mutasyon kanıtı:** 9 yeni test paketi `bc4e82cb`'ye karşı `9/9 FAIL`; M1–M6 (`judgeDay` `pending`, `currentStreak` `asOf`, `recoveryBacklog` `skippedSet`, `completePlan` `return false`, `habitStrengthFor` `isDueOn`, `BACKLOG_PAGE_SIZE` 7->112) -> **6/6 KILLED** (`sha256` geri yükleme doğrulandı).

### F22 (2026-11-21) — `ba71ff09` (`faz/F22-kimlik-akislari`)

- **Durum:** DONE (canlı Redirect URL izin listesi OD-19 ve görsel/derin bağlantı QA sahipte). **Kapsanan bulgular:** NAV-05, NAV-06, NAV-07, GAP2-08, GAP2-09, DSA-03.
- **Özet değişiklikler:**
  - Yeni: `frontend/lib/authErrors.ts`, `frontend/lib/authDeepLink.ts` (Hermes-güvenli ayrıştırıcı + 4 kayıtlık de-dup tek tüketici), `frontend/hooks/useResendCooldown.ts`, `frontend/components/auth/PasswordToggle.tsx` (44x44 pt), `frontend/vercel.json` (`/(.*)` -> `/index.html` SPA rewrite) ve 8 yeni test paketi.
  - Güncellenen: `lib/supabase.ts` (`detectSessionInUrl: false`), `login.tsx` (`SignupPending variant="unconfirmed"` + yeniden gönderme + `type=signup` başarı şeridi + `PasswordToggle`), `register.tsx`, `forgot-password.tsx`, `reset-password.tsx` (`newPassword` + 2x `PasswordToggle`), `SignupPending.tsx`, `onboardingStore.ts` (`inPasswordRecovery -> stay`), `_layout.tsx` (`loading || !inPasswordRecovery` spinner muafiyeti), `SUPABASE_PASSWORD_RECOVERY_SETUP.md`.
- **Mutasyon kanıtı:** M1–M13 -> **13/13 KILLED** (`sha256` geri yükleme doğrulandı).

### Wave 1 Seri Birleştirme Kapısı (2026-11-21)

- **Birleştirilen dallar:** `faz/F08-tedarik-ci-hijyen` (`620895f5`), `faz/F09-040-ayricalik-hijyeni` (`596d733d`), `faz/F13-aliskanlik-motoru` (`68904d7b`), `faz/F22-kimlik-akislari` (`ba71ff09`) — `0` birleştirme çakışması.
- **Birleştirme kapısında yakalanıp düzeltilen 4 çapraz-faz etkileşimi:** `reportMetrics.test.ts` (`habitAveragePercent` `number | null` tip daraltması), `profileRepository.ts` (`xpIsEarned` bekçisiyle `trimmed` değişken adı uyumu), `noRawConsole.test.ts` (`ConfigErrorScreen` ön-açılış yalnız-isim logu izin listesi + tek-çağrı kilidi), `accountScopeRegistry.test.ts` (`lib/env.ts` depolama olmayan sabit izin listesi).
- **Nihai seri kapılar:** `npm ci` `exit=0`; `typecheck:ci` `exit=0`; `lint:ci` `exit=0` (0 uyarı); `node run-tests.js` **147/147** `exit=0`; `npm audit --omit=dev --audit-level=critical` `exit=0` (0 kritik); `npx expo install --check` `exit=0`; `npx expo-doctor` **21/21** `exit=0`; tam `jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB` **319/319 suite · 4514/4514 test** yeşil (Wave 0B'deki 289/4235'ten +30 suite, +279 test); Wave 1 toplam mutasyon **36/36 KILLED**; `git diff --check` `exit=0`.
