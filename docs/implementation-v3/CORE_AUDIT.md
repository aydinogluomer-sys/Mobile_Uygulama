# CORE_AUDIT — R00..R11 + PDF faz denetimi (aktif plan)

Tarih: 2026-10-07 · Taban: `2f92ff5` · Kaynak: `docs/plan/22_ADERYTH_CORE_IMPLEMENTATION_V3.md` (§6 kartları, §9 T01–T20), `docs/plan/Aderyth Çekirdek Kapsam ve Budama.pdf`.
`R10_ACCEPTANCE_REPORT.md` bu denetimde KANIT SAYILMADI; her satır koda/teste yeniden bakılarak yazıldı.

Durumlar: **DONE** (dosya + test + commit; test kabul cümlesini karşılıyor) · **PARTIAL** (eksik kısım somut) · **NOT_STARTED** · **BLOCKED (Sx)** · **N/R** (cihaz/kullanıcı ölçümü; uydurulmaz) · **DEFERRED / CANCELLED** (belgeyle).
"S2 canlı" notu: kod + test tamam, canlı etkinlik yazılmış ama uygulanmamış migration'a bağlı; kart DONE sayılır, canlı açılış SQL_FOR_OWNER.md sırasına bağlıdır.

## R00 — Zemin
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R00.01 | DONE | `docs/implementation-v3/STATE.md` (scope_addendum, newer_owner_decision) · `__tests__/repo/scopeAddendum.test.ts` · `897dee3` |
| R00.02 | DONE | `docs/implementation-v3/R00_GAP_INVENTORY.md` (REUSE/EXTEND/NEW/DEFERRED) · `897dee3` |
| R00.03 | DONE | `docs/implementation-v3/R00_CORE_JOURNEY_MAP.md` §"İlk anlaşılabilirlik turu (plan)" · `897dee3`; turun YÜRÜTÜLMESİ R11.02/N/R |
| R00.04 | DONE | `docs/implementation-v3/R00_TEST_MATRIX.md` · `897dee3` |
| R00.05 | DONE | `STATE.md` toolchain kaydı · `897dee3` |
| R00.06 | DONE | `STATE.md` + `lib/featureGates.ts` · `scopeAddendum.test.ts` · `897dee3` |
| R00.07 | DONE | `STATE.md` `timing:` bloğu · `897dee3` |

## R01 — Hedef, takvim, kayıt, geçmiş
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R01.01 | DONE | `lib/habitSchedule.ts` `periodStatus` · `__tests__/lib/habitPeriod.test.ts` (T01/T03: açık dönem başarısız değil) · `f6be768`, `b155588` |
| R01.02 | DONE | günlük/hafta günü/esnek hafta-ay/her N gün/tarih aralığı (`5ef17bd`, `1cd0bc9`, `70bd0d6`) + **ayın günleri ve yıllık tarih**: `lib/habitSchedule.ts` `monthDayMatches` (29/30/31: açık `skip`/`last_day`), `yearlyDateMatches` (29 Şubat: açık `feb28`/`mar1`/`skip`, 100/400 kuralı), `dueOnExtended` zarf içinde; `lib/routineProposal.ts` doğrulayıcı politika olmadan geç gün/29 Şubat'ı reddeder; `components/FrequencyEditor.tsx` Yıllık + Ayın günleri + kural seçimi; hafta başı Pazartesi · `__tests__/lib/monthYearRules.test.ts` (25), `__tests__/ui/frequencyEditor.test.tsx` (+4 render) · mutasyon 30/31 (1 eşdeğer: `x > last`↔`x >= last`, `includes` dalı önce döner) · `2f26c78` |
| R01.03 | BLOCKED (S11) | ölçüm/yön/kısmi DONE (`habitEngine.test.ts`, `f6721bf`); **geri alma**: DELETE XP'yi geri almıyor, tetikleyici tanımı repoda yok |
| R01.04 | DONE (S2 canlı) | `lib/habitChecklist.ts` · `__tests__/lib/habitChecklist.test.ts`, `store/habitStoreChecklist.test.ts` · `c665ce9` · migration 029 |
| R01.05 | DONE (S2 canlı) | `lib/habitPauses.ts` · `lib/habitScheduleTimeOff.test.ts` ("bugünkü hedef değişimi geçmişi bozmaz") · `9e220f0` · migration 028 |
| R01.06 | DONE (S2 canlı) | tüketiciler aynı motoru okuyor (`96de9be`, `fc6ddff`, `ce50f32`); **tek sözleşme**: `lib/date.ts` `localDayStamp`/`deviceTimeZone` (yerel gün + IANA bölge aynı anda; bölgeyi yalnız bu dosya sorar), `store/logStore.ts` bölgeyi DOKUNUŞTA yakalar ve kuyruğa niyetle yazar, `services/habitLogService.ts` `wirePatch` yalnız `LOG_TIMEZONE_ENABLED` (false) iken gönderir; migration `033_habit_log_timezone.sql` NOT APPLIED · `__tests__/lib/logTimeZone.test.ts` (8), `__tests__/store/logStoreTimeZone.test.ts` (6: kapı kapalı/açık tel yükü, kuyruk persist+hydrate, bozuk bölge) · mutasyon 11/11 · `09e3e53` |
| R01.07 | DONE | `__tests__/lib/crossConsumerFixtures.test.ts` (134): 8 alışkanlık × 16 tarih (yılbaşı, ay sonları, 2026/2027/2028 Şubat, AB DST günleri) × 3 saat (00:00:30/12:00/23:59:30) — Bugün `selectTodayHabits`, hatırlatma `planReminders`, rapor `habitAveragePercent`, recovery `recoveryBacklog` (yeni saf `lib/recoveryBacklog.ts`, ekrandan taşındı), kapasite `carriesDayLoad` hepsi `isEligibleOn` ile aynı; sayı-tabanlı hafta Bugün/yük/hatırlatma 'dönem doldu'da uzlaşır; eklemeli şema: `tz`'li ve `tz`'siz log aynı sayılır · mutasyon 10/10 · not: jest TZ=Europe/Istanbul (DST yok) — DST günleri bileşen-tabanlı aritmetiği pinler, gerçek DST bölgesi koşusu iddia edilmez · `668b10a` |

## R02 — Kalıcı veri ve senkronizasyon
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R02.01 | DONE | `docs/implementation-v3/R02_OFFLINE_MATRIX.md` · `repo/taskOutboxWired.test.ts` · `e58fc6a` |
| R02.02 | DONE | aynı belge §R02.02 (ölçüm + aday); kurulum kararı S7 |
| R02.03 | DONE (cihaz-yerel tek kayıt; SQLite S7) | görevler (`e58fc6a`) + **günlük, not, recovery planı, odak oturumu**: `services/outboxChannel.ts` (değişiklik+komut tek cihaz kaydı, istekten önce), `services/coreOutbox.ts` (ayrı anahtar `outbox.v1.core.<uid>`; istemci id'li create → 23505 = uygulandı; delete-if-present), `journalService`/`noteService`/`recoveryService`/`focusService` yazmaları buradan; analitik/kredi yalnız sunucu uyguladığında (`onApplied`) · `services/coreOutboxChannel.test.ts` (11: çevrimdışı+yeniden başlatma, 5 kez teslim = tek etki, yarıda kalan gönderim), `store/noteJournalOutbox.test.ts` (10), `store/recoveryOutbox.test.ts` (2), `ui/todayScreen` (+1 rozet) · mutasyon 20/21 (1 eşdeğer: not güncellemesinde `!exists` dalı, ardından gelen fetch de `gone` döner) · `e8c3166` |
| R02.04 | DONE | `services/outboxRunner.ts` · `services/outboxRunner.test.ts` · `e58fc6a` |
| R02.05 | DONE | görev çakışması + tombstone (`e58fc6a`); **T08 aynı notta çatışan sürüm korunur**: not sürümü `updated_at`, günlük sürümü içerik hash'i (`contentVersion`); taşınmış sürüm = `conflict`, sunucu metni ezilmez, yerel metin komutta kalır; `components/ConflictChoice.tsx` (Bu cihazdakini / Diğerini / İkisini de tut) not ve günlük ekranında; 'İkisi' notta "(çakışan sürüm)" kopyası, günlükte iki metin birlikte · `store/noteJournalOutbox.test.ts`, `ui/conflictChoice.test.tsx` (2 render), `services/coreOutboxChannel.test.ts` (tombstone: silinen not geç düzenlemeyle dönmez) · `e8c3166` |
| R02.06 | DONE | logout/hesap değişimi (`e58fc6a`) + core outbox hesap başına anahtar, oturum kapanınca `coreOutbox.reset()` (`app/_layout.tsx`); reset nesli (`gen`): yarıda kalan teslim eski hesabın kuyruğunu geri YAZAMAZ (görev outbox'ında da aynı koruma); **hesap silme onayı gönderilmemiş değişiklik sayısını söyler** (`accountService.unsentChangeCount`, `app/tabs/settings.tsx`) · `services/accountDeletionLocal.test.ts` (6), `fixtures/taskOutboxScenarios.test.ts` (+1) · mutasyon gen/guard 4/4 · `e8c3166` |
| R02.07 | BLOCKED (S7) | hedef depo (SQLite) yok; taşıma yapılacak yer yok |
| R02.08 | DONE (fixture) / N/R (cihaz) | `fixtures/taskOutboxScenarios.test.ts` (uçak modu, kill, timeout, out-of-order, iki cihaz) · cihaz S8 |

## R03 — Bugün, küçük başlangıç, kapasite, telafi
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R03.01 | DONE | hero/metrik/sıradaki (mevcut), rutin kartı (`29b32af`) + **ŞİMDİ kartı: tek sıradaki uygulanabilir adım** `lib/todayNext.ts` `nextActionable` (açık/duraklatılmış odak oturumu → süren rutin → bugünkü telafi → gecikmiş görev → bugünün açık alışkanlığı → bugünün görevi), `app/tabs/today.tsx` kartı ilgili ekrana götürür; proje/OKR/not/okuma/yaşam alanlarına erişim yan menüde kaldı, ana ekrana yığılmadı · `__tests__/lib/todayNext.test.ts` (5), `ui/todayScreen.test.tsx` (+1 render: devam eden odak oturumu kartı devralır) · mutasyon 7/7 · `48f3076` |
| R03.02 | DONE | `app/tabs/today.tsx` confirmLightDay · `lib/todayLightDay.test.ts` · `bcf973b` |
| R03.03 | DONE | `lib/smallStart.ts` · `store/focusSmallStep.test.ts`, `ui/coreSheets.test.tsx` · `8dbcb2a` |
| R03.04 | DONE | `services/capacityService.ts` `explainActivation` (neden: bütçe sayıları / yük `X/100 +Y, sınır 85` / eski slot kuralı / veri yok; nasıl: beklemeye al · yarın · yenile) — bekleme odası kartında ve ret diyaloğunda (`app/tabs/habits.tsx`); **açık geçersiz kılma** "Yine de etkinleştir" yalnız YÜK önerisini aşar (bütçe ve eksik/bayat veri reddeder) — `evaluateActivation({override})` → `habitService.activateHabit` → `habitStore.activateHabit(id, cost, {override})`; **R01 bağı**: tarihli ara/tatildeki aktif alışkanlık bugün yük taşımaz (Bugün listesiyle aynı kural) · `__tests__/services/capacityExplain.test.ts` (10), `store/habitActivateOverride.test.ts` (2) · mutasyon 7/8 (1 eşdeğer: yalnız boşluk değiştiren mutant) · `e7c03c7` |
| R03.05 | DONE | `services/recoveryService.ts`, `lib/capacity.ts` makeupLoadPreview · `services/recoveryMakeup.test.ts`, `lib/makeupLoadPreview.test.ts`, `ui/recoveryScreen.test.tsx` · `d0fdddb`, `182e958` |
| R03.06 | DONE (mevcut ilişkiler) | `lib/progressModel.ts`: tek yönlü kenarlar (odak oturumu→görev→proje, log→alışkanlık, KR→OKR), hedefe otomatik kenar YOK, döngü dedektörü; **hesaplanan** proje ilerlemesi kendi görevlerinden (iptal sayılmaz, her görev bir kez) — `app/screens/projects.tsx` "Kayıtlardan %X · n/m görev"; **elle** hedef yüzdesi "Elle girilen %X" etiketli (`app/screens/goals.tsx`), hiçbir hesap onu yazmaz (tek yazma yolu hedef ekranı) · `__tests__/lib/progressModel.test.ts` (8), `ui/progressLabels.test.tsx` (2 render) · mutasyon 8/8 · not: hedef↔proje/alışkanlık BAĞI şemada yok; `goals` tanımı repoda değil (S12) — bağ tablosu sahip kararı · `72d0b4f` |
| R03.07 | DONE | üç akış metni tek kaynakta `lib/flowCopy.ts` (`FLOW_COPY`): "ilk adımı seç" (`components/SmallStartSheet.tsx`), "yükü hafiflet" (Bugün hafif gün sayfası), **"mola sonrası dön"**: Bugün'de tatil / listedeki alışkanlığın tarihli arası biteli ≤2 gün olunca kart (`recentlyEndedBreak`), odak ekranında mola bitip işe dönülünce satır (`isBackFromFocusBreak`, `accessibilityLiveRegion`); klinik iddia yok (yasak sözcük testi) · `__tests__/lib/flowCopy.test.ts` (6), `ui/todayScreen.test.tsx` (+1 render) · mutasyon 6/6 · `11f8433` |
| R03.08 | N/R | kullanıcı denemesi (S8) |

## R04 — Hatırlatıcılar
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R04.01 | DONE | `lib/reminderPlan.ts` · `lib/reminderPlan.test.ts` ("Mon/Thu not reminded Tuesday", "3 a week met") · `ce50f32` |
| R04.02 | DONE | `components/ReminderEditor.tsx`, `NotificationSettingsCard.tsx` · `reminderPlan.test.ts`, `ui/coreSheets.test.tsx` · `ce50f32` |
| R04.03 | DONE | `services/reminderService.ts` handleReminderResponse · `services/reminderService.test.ts` ("delivered twice → one log") · `ce50f32` |
| R04.04 | DONE | `lib/notifications.ts` ensureChannel · `repo/remindersWired.test.ts` · `ce50f32` |
| R04.05 | N/R | cihaz matrisi S8 (başlık gizleme DONE: `reminderTitle`) |
| R04.06 | DONE | `repo/remindersWired.test.ts` "no deferred trigger" · `ce50f32` |

## R05 — Rutin ve odak
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R05.01 | DONE (S2 canlı) | `lib/routineRunner.ts` · `lib/routineRunner.test.ts` · `29b32af`, `f601447` · migration 030 |
| R05.02 | DONE | `app/screens/routine-runner.tsx` · `store/routineRunnerStore.test.ts`, `repo/routineRunnerWired.test.ts` · `29b32af` |
| R05.03 | DONE | `lib/focusTimer.ts` · `store/focusTimerKd03.test.ts` (T11) · `895063f` |
| R05.04 | DONE | `lib/routineRunner.ts` add/remove/move/setDuration/applySessionToTemplate · `lib/routineRunner.test.ts` · `29b32af` |
| R05.05 | BLOCKED (S13) | sesli duyuru `expo-speech` gerektirir; ekran okuyucu + titreşim DONE (`routine-runner.tsx`) |
| R05.06 | DONE | `lib/focusDuration.ts` · `repo/focusDurationContract.test.ts` · `d9d1775` |
| R05.07 | DONE | rutin → alışkanlık bir kez (`habitLogsToWrite`, mevcut) + **rapor aynı etkiden**: `lib/routineReport.ts` oturumun bitince sakladığı `summarize()` özetinden (oturum bir kez, alışkanlık bir kez — alışkanlık oranına yeniden eklenmez; gün = bittiği yerel gün) → haftalık review "Rutinler" kutucuğu, aylık review özet satırı; süre dolması tamamlanma değil (`timeUp` yalnız uyarı) · `__tests__/lib/routineReport.test.ts` (6) · mutasyon 6/6 (3'ü ek ayırt edici testlerle) · `d4f9824` |
| R05.08 | PARTIAL | şablonlar + yaşam döngüsü testi DONE; kullanıcı testi N/R |

## R06 — Sadelik, erişilebilirlik, mahremiyet
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R06.01 | DONE | `docs/implementation-v3/R06_DESIGN_SYSTEM.md`: mevcut sistem (`lib/tokens.ts`, `components/ui/*`), referans ekranlar (Today, Recovery, Routine runner — 0 ham hex); token değerine birebir eşit ham hex'ler token'a çevrildi (38 dosya, 266 değişim, 407 → 141; görünüm aynı); yeni UI kit/yeniden tasarım yok · `__tests__/repo/designTokensRatchet.test.ts` (token-eşit ham hex 0, toplam ≤ 141, referans ekranlar 0) · mutasyon 2/2 · `22dee6c` |
| R06.02 | DONE | Bugün hero'sunda **tek baskın eylem** `lib/todayNext.ts` `primaryAction` (açık odak/rutin → "Devam et: …", diğer → "Başla: …", boşsa "Başla: odak"); ikincil işler (Odağa geç, Haftayı değerlendir, Denge planı, Projeler, Notlar) "Diğer" bağlam menüsünde — erişim korunur; kısa özet satırı `todaySummaryLine` ("İrade 6/15 · 2 alışkanlık, 3 görev kaldı"); ayrı ŞİMDİ kartı bu eyleme birleşti · `__tests__/lib/todayNext.test.ts` (+2), `ui/todayScreen.test.tsx` (+1 render: tek birincil düğme, menü seçenekleri, özet; R03.01 render testi hero eylemine yeniden hedeflendi) · mutasyon 6/6 · `0ac689f` |
| R06.03 | DONE | ortak `components/ui/FormFeedback.tsx` (`FormError` role=alert + live region, `FormPreview`): checklist editörü, hedef düzenleme, recovery plan sayfası, review sonraki-eylem seçicisi aynı bileşeni kullanır; **başarısız kayıt formu kapatmaz, girdi kaybolmaz** (hedef, recovery); **iptal edilen yeni hedef taslağı korunur**, ek onay ekranı yok; hedef formunda "Kaydedilecek: Elle girilen %X" önizlemesi · `__tests__/ui/formFeedback.test.tsx` (5 render+guard), `ui/recoveryScreen.test.tsx` (+1) · mutasyon 6/6 · `b530012` |
| R06.04 | DONE (cihazda odak gezintisi N/R, S8) | `docs/implementation-v3/R06_ACCESSIBILITY.md` ölçüm tablosu: **kontrast** `contrastRatio` — `textFaint` #827E72→#928E82 (kartta 4.21→5.21), 23 placeholder textGhost→textFaint, dolu düğme etiketi `onColor` (her vurgu teması + danger ≥4.5; clay'de koyu mürekkep 5.91); **dokunma** Button `minHeight`+`hitSlop` ≥44pt, Chip hitSlop; **büyük yazı** ölçek kapatma yok, sabit yükseklik yok; **azaltılmış hareket** Drawer/HabitListView/FloatingLabelInput/alışkanlık+timeline toast'ları sistem ayarını okur · `__tests__/repo/accessibilityMeasured.test.tsx` (8: kontrast, dokunma, ölçek, hareket ratchet'i) · mutasyon 7/7 · `8cb6771` |
| R06.05 | DONE (Android önizleme en iyi çaba; cihaz N/R S8) | bildirim gizleme (mevcut) + **uygulama önizlemesi**: aynı tercih açıkken uygulama öne değilken tam ekran örtü `components/PrivacyCover.tsx` (kökte, `app/_layout.tsx`), anahtar metni "Kilit ekranında ve uygulama önizlemesinde içeriği gizle"; native kilit yok; **hata logları**: günlük/koç dosyalarında `console.*` ve metinden hata mesajı yok (guard), çökme hunisi **yığın satırlarını da** temizler (tırnaklı metin `stack` üzerinden sızıyordu — düzeltildi, `lib/crashReporting.ts`) · `__tests__/ui/privacyCover.test.tsx` (4), `repo/noContentInLogs.test.ts` (5) · mutasyon 4/4 · `185c335` |
| R06.06 | DONE (render ortamı; cihaz/animasyon/performans N/R S8) | `docs/implementation-v3/R06_SCREEN_STATES.md`: §8.1'in 9 durumu × ekran × veri seti × gözlenen test; **bu kartta düzeltilen**: bağlantı hatası "Henüz … yok" gibi görünüyordu → `components/ui/LoadErrorState.tsx` (`listState` kuralı; "yüklenemedi · kayıtların silinmedi" + Tekrar dene) Notlar/Hedefler/Projeler/Okuma listesinde · `__tests__/ui/screenStates.test.tsx` (8: ilk kullanım, hata≠boş ×3, yükleniyor≠boş, uzun içerik, okuma listesi guard) · mutasyon 5/5 · `0a66bbb` (+ lint düzeltmesi `206d420`) |

## R07 — Günlük, duygu, review
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R07.01 | DONE | `lib/journalText.ts`, `app/screens/journal.tsx` · `lib/journalAndMoods.test.ts`, `repo/journalP6Wired.test.ts` (T13) · `4904dd8` |
| R07.02 | DONE (S2 canlı) | `lib/moods.ts`, `store/moodStore.ts` · `journalAndMoods.test.ts` · `4904dd8` · migration 031 |
| R07.03 | DONE | tarihçe + etiket süzgeci (mevcut) + **arama ve takvim** `lib/journalBrowse.ts` (`searchEntries` Türkçe harf katlama, tüm kelimeler; `monthGrid` Pazartesi başlangıçlı ay, kayıtlı gün işaretli; `shiftMonth`) → `app/screens/journal-archive.tsx` arama kutusu, Liste/Takvim seçimi, takvimden günü açma; yeni ses/foto/dosya altyapısı yok · bulunan hata: `toUpperCase()` "EKIM" yazıyordu → tr-TR (arşiv, review rozeti, hub) + `repo/turkishCase.test.ts` · `__tests__/lib/journalBrowse.test.ts` (6), `ui/journalArchive.test.tsx` (2 render) · mutasyon 9/9 · `71863f7` |
| R07.04 | DONE | başarı oranları (mevcut) + **miktar ve süre** `lib/periodReport.ts`: aralıktaki her R01 dönemi `periodStatus`'tan okunur — açık dönem başarısızlık değil ('açık'), ara/tatil sayım dışı ('arada'), eksik kayıt kapanmış dönemde karşılanmamış, kısmi ilerleme miktar olarak korunur; ikinci hesap yok (dosya `daily_goal`/`value` okumaz, günlük motor toplamıyla eşit) → `components/MeasuredReportSection.tsx` haftalık ve aylık review'de "MİKTAR VE SÜRE" (ör. "16/56 bardak · 4 açık · 2 kısmi") · `__tests__/lib/periodReport.test.ts` (6), `ui/measuredReportSection.test.tsx` (2) · mutasyon 7/7 · `4e43bb7` |
| R07.05 | DONE | `lib/moodHabitRelation.ts` · `journalAndMoods.test.ts` (T14, 14/5 eşikleri, nedensellik yok) · `4904dd8` |
| R07.06 | DONE (S2 canlı) | `components/NextActionPicker.tsx` · `journalP6Wired.test.ts` · `4904dd8` |
| R07.07 | DONE (kullanıcı anlaşılabilirlik testi N/R, S8) | sayısal fixture (mevcut) + **erişilebilir grafik metni** `lib/chartText.ts` (`seriesText`/`heatmapText`/`radarText`: en yüksek/en düşük/toplam/ortalama, Türkçe ondalık) → İstatistik 14 gün grafiği, yıllık ısı haritası, yaşam alanı radarı, odak raporu grafiği `accessibilityRole=image` + metin; **neden-sonuç yok** (`CAUSAL_WORDS` dedektörü, MoodHabitCard dahil); **paylaşım öncesi özel içerik seçimi**: odak raporu dışa aktarımında görev adları varsayılan olarak "Görev" (`redactSessionsForShare`), "Görev adlarını dahil et" anahtarıyla eklenir · `__tests__/lib/chartText.test.ts` (8), `ui/chartAccessibility.test.tsx` (3 render) · mutasyon 7/7 · `4b6068b` |

## R08 — Yedek ve restore
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R08.01 | DONE | registry 10 → **31 koleksiyon** (`lib/backupFormat.ts`): okrs, key_results, reading_list, focus_tasks, recovery_plans, weekly/monthly_reviews, habit_pauses/goal_versions/checklist_items/checks (geri yüklenebilir; 028/029 uygulanana dek yok sayılır), life_area_logs, deep_work_sessions, ai_conversations/messages/actions, journal_insights, routines, habit_deletions (yalnız dışa aktarım, gerekçeli) + **cihaz verisi** (`lib/deviceExport.ts` izin listesi: duygular, rutinler, review eylemleri, taslaklar, ayarlar — oturum/token/kuyruk ASLA); `NOT_BACKED_UP` gerekçeli dışlamalar (profiles, badges, willpower, FP, onboarding); tam tablo okuma `fetchOwnedTable` (id ile keyset, tavan raporlanır); geri yüklemede tablo yoksa yalnız o bölüm bekletilir, başarısız ebeveynin çocukları her ilişki için bekletilir · `__tests__/repo/backupRegistryComplete.test.ts` (6: uygulamanın dokunduğu her tablo kayıtta ya da gerekçeli dışlamada), `services/backupFullAccount.test.ts` (6), `services/fetchOwnedTable.test.ts` (2) · mutasyon 9/9 · `d18c348` |
| R08.02 | DONE | manifest (`b3f445b`) + **ilişki haritası** (`manifest.relations`, kayıttan) ve **tutarlılık penceresi** (`manifest.snapshot` başlangıç/bitiş + kural: sayım/sağlama dosyadakini birebir tanımlar); **5.000 sınırı sessiz değil**: kesilen koleksiyon `truncated`, elle dışa aktarımda uyarı, geri yüklemede ret; **yerel otomatik rotasyon** `lib/backupRotation.ts` + `services/localBackupService.ts` (uygulama açılınca günde ≤1, son 3 kopya, son TAM kopya hiç atılmaz, başarı yalnız tam kopya yazılıp geri okunup doğrulanınca; başarısız deneme 1 saat bekler) → `components/RestorePanel.tsx` dürüst durum satırı ("Henüz tam bir yerel yedek yok" / "Son tam yerel yedek: 3 gün önce" / "Son deneme başarısız: …"), "Şimdi yerel yedek al", "Son yerel yedeği doğrula" (aynı kuru çalıştırma) · `__tests__/services/localBackup.test.ts` (9), `ui/restorePanelLocal.test.tsx` (2 render) · mutasyon 9/9 · `11dd8e6` |
| R08.03 | DONE | dry-run (bütünlük, sürüm, sahiplik, kimlik eşleme, çakışma — veri değiştirmeden, `b3f445b`) + **koruma kararı** `docs/implementation-v3/R08_BACKUP_PROTECTION.md`: uygulama içi şifreleme YOK (özel kripto yasak; platform kriptosu yeni native bağımlılık = sahip kararı), OS sandbox koruması, anahtar kurtarma sınırı yazılı; paylaşmadan önce kullanıcıya "Dosya şifrelenmez …" (`app/tabs/settings.tsx`); oturum/erişim anahtarları dosyaya girmez, yerel kopya kendisi dışa aktarılmaz · `__tests__/repo/backupProtection.test.ts` (4: karar belgesi, uyarı, kendi kripto yok taraması, yerel kopya izin listesi dışı) · mutasyon 2/2 · `987c74c` |
| R08.04 | DONE | güvenli birleştirme + dedup + iptal (`b3f445b`) + **aynı job kimliğiyle sürdürme** `lib/restoreJob.ts` (`jobIdFor`: dosyanın hesap+sayım+sağlamasından; aynı dosya = aynı iş) → `services/restoreService.ts` iş kaydını ilk eklemeden ÖNCE ve her parçadan sonra yazar (öldürülürse `running` + o ana kadar eklenen), iptal `cancelled`, hata `failed`, bitiş `done`; dry-run `job.resumes` → `components/RestorePanel.tsx` "Yarım kalan bir geri yükleme var …" + "Sürdür"; zaten eklenenler tekrar eklenmez (id), aynı dosya yeniden = 0 ekleme; istemci trigger kapatmaz/tablo temizlemez · `__tests__/services/restoreJob.test.ts` (4: ilk parçadan sonra öldür → sürdür → 120 kayıt bir kez → `done`; ilk parçadan önce öldür; iptal→sürdür), `ui/restorePanelResume.test.tsx` (1 render) · mutasyon 8/8 · `2d14790` |
| R08.05 | DONE | `stripAuthority`, registry · `lib/backupRestore.test.ts` · `b3f445b` |
| R08.06 | DONE (genel CSV) / BLOCKED (S6) adaptörler | `lib/csvImport.ts` · `lib/csvImport.test.ts` · `b3f445b` |
| R08.07 | DONE (jest; canlı DB tatbikatı S1/S2) | `docs/implementation-v3/R08_RESTORE_DRILLS.md` + `__tests__/fixtures/backupDrills.test.ts` (10): 5.200 kayıtlı hesap tam kayıp → geri yükleme → yeniden dışa aktarımda **sayım ve sağlama aynı**, ilişki korunur; tavan ötesi ret; eski biçim ret; yarım ağ → aynı iş sürer; tek parça reddi boşluk bırakmaz; bozuk parça ret; aynı yedek 2. kez 0 ekleme, XP'li kayıt geri gelmez; başka hesap ret; yetim bekletilir · **bulunan/düzeltilen**: tavan 5.000 → 20.000, kuru çalıştırma mevcut satırları anahtar sıralı tam okur (tavan aşılırsa ret — önceden sınır ötesi satırlar yeniden planlanabilirdi), tam tavanda yanlış "kesildi" (off-by-one) · mutasyon 6/6 · `a610d6a` |

## R09 — AI
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R09.01 | DONE | `__tests__/repo/aiIdempotency.test.ts`, `aiRequestLeaseAndPrivileges.test.ts`, `aiGateD.test.ts`, `focusPointAtomicity.test.ts` (önceki fazlar) |
| R09.02 | DONE (gated: `COACH_ACTIONS_V2_ENABLED=false`; CHECK 034 NOT APPLIED) | 6 eylem `lib/coachActionsV2.ts` (`f39d972` + R09.02): yeni `edit_reminder_time` hatırlatıcı düzenleyicisinin KENDİ kuralıyla (`buildReminderConfig`) doğrulanır, kart eski → yeni saati gösterir ve `updateHabit` ile uygular; önizlemeden sonra hatırlatma değiştiyse yazmaz (parmak izine `reminders` eklendi). Dört yer aynı liste: istemci, edge şeması, `034_coach_reminder_action.sql`, repo tipi (`coachV2Wired`). Test: `__tests__/ui/coachReminderAction.test.tsx` (4) · mutasyon 4/5 + 1 eşdeğer (`cur!.id` ↔ `target.habit.id`: staleness aynı varlığı doğruladıktan sonra iki kimlik eşittir) · `075711a` |
| R09.03 | DONE (gated) | sürüm kontrolü (`repo/coachV2Wired.test.ts`) + **belirsiz aday sorusu**: v2 kartı belirsiz alışkanlık/görev eşleşmesinde adayları seçenek (radio) olarak sunar, seçilene kadar "Uygula" yok; seçilen aday önizlenir ve uygulanır, diğeri dokunulmaz; seçim geri alınabilir; seçilen adayın parmak izi kartın göründüğü ANA aittir (sonradan değiştiyse uygulanmaz); Vazgeç dört eylem türünde hiçbir komut çağırmaz. Test: `__tests__/ui/coachCandidatePick.test.tsx` (9) · mutasyon 6/7 + 1 eşdeğer (useMemo içinde canlı/anlık parmak izi aynı an) + seçim-anı parmak izi mutantı öldürüldü · `b8e32db` |
| R09.04 | DONE (gated; CHECK 035 NOT APPLIED) | yeni `lighten_week` eylemi (argümansız — hangi alışkanlık, modelden değil uygulamadan): `lib/weekLighten.ts` haftanın kalan günleri × kapasite motorunun KENDİ yükü (`habitLoadPoints`: zorluk × sıklık × süre), tarih aralığı dışı / pasif / bu hafta zaten molada olanlar hariç; en ağırdan başlayarak yükü ⅓ düşürene kadar önerir — kullanıcıya göre farklı liste; kart önce→sonra yükü gösterir, kullanıcı seçimi düzenler; uygulama YALNIZ bugün→Pazar tarihli mola (`addTimeOff`), hedef/takvim/log yazılmaz; uygulama anında canlı yeniden kontrol. Görev yükü (ve görev bağımlılığı) bu planda yok: görevler `move_task` ile taşınır. Dört yer aynı liste (035). Test: `__tests__/lib/weekLighten.test.ts` (6) + `__tests__/ui/coachLightenWeek.test.tsx` (6) · mutasyon 11/11 · `734a1f5` |
| R09.05 | DONE | `lib/journalInsightContext.ts` + `app/screens/journal-insights.tsx`: günlük içgörüsüne gidecek kayıtlar dönem içinde **kullanıcı seçimiyle** (onay kutuları; dönem değişince sıfırlanır); istem yalnız ekrandaki GÜNCEL kayıtlardan kurulur (silinen kayıt giremez), boş kayıt gitmez, sınır aşılırsa kayıt bölünmez — en eskiler düşer ve sayılır; kaydedilen sayı gerçekten gidenlerdir. İçgörü kartı dayanağını söyler ("N kayıttan · dönem · gün"), model metni "AI yorumu — içindeki sayılar uygulamanın hesabı değildir" etiketiyle, yanında uygulamanın kendi hesabı (kayıt sayısı, ruh hali ort., tarih aralığı); sonradan yeni kayıt / seçim değişince "değişti" uyarısı. Koç turunun bağlamı günlük içermez (`repo/coachContextNoJournal.test.ts`). Sınır: bir kaydın sonradan DÜZENLENMESİ (satırda `updated_at` yok) değişti uyarısı üretmez — sayı ve yeni kayıt yakalanır. Test: `__tests__/lib/journalInsightContext.test.ts` (6) + `__tests__/ui/journalInsightsContext.test.tsx` (4) + repo (2) · mutasyon 9/9 · `00756bb` |
| R09.06 | DONE (sunucu yarısı R09.01; canlı sağlayıcı N/R) | timeout/lease/kredi sınırı R09.01 testleriyle; **eklenen**: (1) yanıtı kaybolan istek ikinci tahsilat üretmez — `lib/aiAttempt.ts` yanıtsız denemenin (`EdgeTimeoutError`, çevrimdışı `FunctionsFetchError`, relay, abort, RN ağ hatası) `request_id`'sini saklar, aynı istek tekrar gönderilince aynı kimlik gider (sunucu ilk sonucu yeniden oynatır); sunucunun verdiği her yanıt (başarı ya da kesin ret, ör. yetersiz FP) denemeyi kapatır; farklı istek hep yenidir. Bağlı: rutin üretici (`store/routineStore.ts`), günlük içgörüsü, koç mesajı + özet. Kullanıcıya "Yanıt alınamadı. Aynı isteği tekrar gönderirsen ikinci kez ücret alınmaz." (2) yerel şablon AI cevabı gibi sunulmaz — rutin önizlemesi kaynağını söyler ("Hazır paket — uygulamanın kendi şablonu; AI üretmedi, FP harcanmadı."). İlk-çalışma planı zaten deterministik/çevrimdışı (`starterPlan`). Test: `__tests__/lib/aiAttempt.test.ts` (6) + `__tests__/store/routineGenerateOneCharge.test.ts` (4) + `ui/journalInsightsContext` (+1) + `__tests__/ui/routineSourceLine.test.ts` (2) + `__tests__/repo/aiOneChargeWired.test.ts` (3, koç ekranı yapısal) · mutasyon 13/13 (1 hayatta kalan ayırt edici testle öldürüldü) · `d899474` |
| R09.07 | DONE (istemci yarısı) / N/R (model yarısı, S3) | `__tests__/scenarios/coachScenarios.test.tsx`: 100 senaryo (60 geçerli = v2 42 + v1 18, 20 belirsiz/bilinmeyen, 10 yetki/enjeksiyon, 10 iptal/retry/çökme) gerçek doğrulayıcı → çözümleyici → kart → komut zincirinden geçer; **araç / argüman / yan etki** ayrı eksenler, her biri 100/100; akıcılık ölçülmez ve puana karışmaz. Model yarısı (cümle → doğru çağrı, akıcılık) canlı sağlayıcı + edge deploy ister → N/R. Rapor: `docs/implementation-v3/R09_SCENARIO_EVAL.md` · harness mutasyonu 6/6 · commit R09.07 |

## R10 — Kalite kabulü
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R10.01 | DONE | `PAID_SUBSCRIPTIONS_ENABLED=false` · `repo/freeMvpReleaseShape.test.ts`; FP gerçek bakiye `credit-history.tsx:87` |
| R10.02 | PARTIAL | log XP tek etki (sunucu), outbox tek etki DONE; **yeni eylemlerin (rutin, telafi, koç v2, restore) tek etki tablosu ve testi toplu yok** |
| R10.03 | PARTIAL | Sentry scrubber mevcut; **yeni kodun hassas log yazmadığı taraması yok** |
| R10.04 | DONE | hesap silme sunucu onayından sonra: cihazdaki tüm anahtarlar (görünüm tercihleri hariç; outbox'lar, runner, duygular, taslaklar) + bellekteki core/görev outbox'ı, günlük/not/recovery/log/runner/duygu durumları + **zamanlanmış tüm hatırlatıcılar** iptal; reddedilen silmede hiçbir şey silinmez · `services/accountDeletionLocal.test.ts` · mutasyon 4/4 · `e8c3166` |
| R10.05 | PARTIAL | uygulama yalnız Türkçe; **TR tarih/birim/hafta başı/boş durum kontrolü testi yok; EN desteği yok (mevcut değil)** |
| R10.06 | PARTIAL | CI komutları yeşil; **büyük liste sayfalama + restore yük testi yok** |
| R10.07 | PARTIAL | 028–032 RLS yazıldı; **migration'lar için statik RLS/owner guard testi toplu değil** |
| R10.08 | DONE | `repo/scopeAddendum.test.ts`, `repo/coachV2Wired.test.ts` (5 kapı + yeni kapı false) |
| R10.09 | PARTIAL | eski rapor alt kümeye dayalı; bu denetime göre yeniden yazılacak |

## R11 — Ölçüm ve kapanış
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R11.01 | NOT_STARTED | CP/CE ağırlık/görev dondurma belgesi yok (belge işi, yapılabilir) |
| R11.02 | NOT_STARTED | iki tur planı belgesi yok (plan yapılabilir; yürütme N/R) |
| R11.03 | N/R | kullanıcı görevi ölçümü (S8) |
| R11.04 | N/R | CP/CE gözlemi yok |
| R11.05 | N/R | kullanıcı turu bulgusu yok |
| R11.06 | NOT_STARTED | CORE_IMPLEMENTATION / CORE_QUALITY / RELEASE_READINESS ayrı kapanış belgesi |

## PDF fazları
| Faz | Durum | Not |
|---|---|---|
| F00 | DONE | R00 |
| F01 | PARTIAL | R01.02 yıllık/ay günü, R01.06 timezone, R01.07 |
| F02 | PARTIAL | R03.01/04/06/07 |
| F03 | PARTIAL / BLOCKED (S7) | SQLite S7; outbox yalnız görevler |
| F04 | DONE (bildirim) / DEFERRED (widget, Live Activity, kilit ekranı) | `docs/plan/21_KAPSAM_EKI_2026-09-13.md` |
| F05 | PARTIAL / BLOCKED (S13) | sesli rehber S13; R05.07 |
| F06 | PARTIAL | ısı haritası mevcut (`app/tabs/stats.tsx`); R07.03/04/07 |
| F07 | PARTIAL / BLOCKED (S6, S11, S14) | R08.01/02/04/07 |
| F08 | PARTIAL (gated, S2+S3) | R09 |
| F09–F11 Watch/Wear | DEFERRED | kapsam eki |
| F12 harici MCP | CANCELLED | PDF §2 |
| F13 / F14 / F15 | CANCELLED | `scopeAddendum.test.ts` |
| F09 (eski F16) store | DEFERRED | kapsam eki |

## Özet sayım (başlangıç)
DONE 36 · PARTIAL 31 · NOT_STARTED 15 · BLOCKED 4 · N/R 6 (kart bazında; çift durumlu satırlar ilk durumla sayıldı).
Uygulama sırası: R01.02 → R01.06 → R01.07 → R02.03/05/06 → R03.01/04/06/07 → R05.07 → R06.* → R07.03/04/07 → R08.01/02/03/04/07 → R09.02/03/04/05/06/07 → R10.* → R11.01/02/06.
