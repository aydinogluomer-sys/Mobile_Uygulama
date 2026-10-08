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
| R03.07 | DONE | üç akış metni tek kaynakta `lib/flowCopy.ts` (`FLOW_COPY`): "ilk adımı seç" (`components/SmallStartSheet.tsx`), "yükü hafiflet" (Bugün hafif gün sayfası), **"mola sonrası dön"**: Bugün'de tatil / listedeki alışkanlığın tarihli arası biteli ≤2 gün olunca kart (`recentlyEndedBreak`), odak ekranında mola bitip işe dönülünce satır (`isBackFromFocusBreak`, `accessibilityLiveRegion`); klinik iddia yok (yasak sözcük testi) · `__tests__/lib/flowCopy.test.ts` (6), `ui/todayScreen.test.tsx` (+1 render) · mutasyon 6/6 · commit R03.07 |
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
| R05.07 | PARTIAL | rutin → alışkanlık bir kez DONE; **eksik: rutin oturum özeti rapor/review'e girmiyor (tek etkiden besleme)** |
| R05.08 | PARTIAL | şablonlar + yaşam döngüsü testi DONE; kullanıcı testi N/R |

## R06 — Sadelik, erişilebilirlik, mahremiyet
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R06.01 | NOT_STARTED | tasarım sistemi/referans ekran tespiti belgesi yok |
| R06.02 | NOT_STARTED | Bugün'de üç CTA var (`today.tsx` TodayHero ctas); tek baskın "başla/devam et" yok |
| R06.03 | NOT_STARTED | checklist/hedef/recovery/review için ortak form-önizleme-hata bileşeni yok |
| R06.04 | PARTIAL | etiketler yaygın; **büyük yazı / dokunma alanı / kontrast / azaltılmış hareket doğrulaması yok** |
| R06.05 | PARTIAL | bildirim başlık gizleme DONE; **uygulama önizlemesi (arka plan anlık görüntüsü) gizleme yok; günlük/AI metni hata loguna girmiyor doğrulaması yok** |
| R06.06 | NOT_STARTED | §8.1 ekran durumları (ilk kullanım/boş/hata/offline/çatışma) render ortamında doğrulanmadı |

## R07 — Günlük, duygu, review
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R07.01 | DONE | `lib/journalText.ts`, `app/screens/journal.tsx` · `lib/journalAndMoods.test.ts`, `repo/journalP6Wired.test.ts` (T13) · `4904dd8` |
| R07.02 | DONE (S2 canlı) | `lib/moods.ts`, `store/moodStore.ts` · `journalAndMoods.test.ts` · `4904dd8` · migration 031 |
| R07.03 | PARTIAL | etiket süzgeci DONE; **arama UI ve takvim görünümü yok** (`searchJournalEntries` repo'da var, ekranda değil) |
| R07.04 | PARTIAL | başarı oranları R01'den (`reportMetrics.ts`); **miktar ve süre raporları R01'den üretilmiyor** |
| R07.05 | DONE | `lib/moodHabitRelation.ts` · `journalAndMoods.test.ts` (T14, 14/5 eşikleri, nedensellik yok) · `4904dd8` |
| R07.06 | DONE (S2 canlı) | `components/NextActionPicker.tsx` · `journalP6Wired.test.ts` · `4904dd8` |
| R07.07 | PARTIAL | sayısal fixture DONE; **erişilebilir grafik metni ve paylaşım öncesi özel içerik seçimi yok**; kullanıcı testi N/R |

## R08 — Yedek ve restore
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R08.01 | PARTIAL | registry 10 koleksiyon (`lib/backupFormat.ts`); **eksik: okrs, key_results, reading_list, life_area_logs, recovery_plans, deep_work, weekly/monthly reviews, focus_tasks, konuşmalar, ayarlar ve yerel veriler** |
| R08.02 | PARTIAL | manifest DONE (`b3f445b`); **eksik: yerel otomatik rotasyon + son başarı durumu; ilişki haritası** |
| R08.03 | PARTIAL | dry-run DONE; **dosya koruma/şifreleme kararı belgelenmedi** |
| R08.04 | PARTIAL | güvenli birleştirme + dedup + iptal DONE; **yarım kalan restore'un aynı job kimliğiyle sürmesi yok** |
| R08.05 | DONE | `stripAuthority`, registry · `lib/backupRestore.test.ts` · `b3f445b` |
| R08.06 | DONE (genel CSV) / BLOCKED (S6) adaptörler | `lib/csvImport.ts` · `lib/csvImport.test.ts` · `b3f445b` |
| R08.07 | NOT_STARTED | 5.000+ kayıt, eski format, yarım ağ, bozuk parça, tekrar, başka hesap tatbikatları test olarak yok |

## R09 — AI
| Kart | Durum | Kanıt / eksik |
|---|---|---|
| R09.01 | DONE | `__tests__/repo/aiIdempotency.test.ts`, `aiRequestLeaseAndPrivileges.test.ts`, `aiGateD.test.ts`, `focusPointAtomicity.test.ts` (önceki fazlar) |
| R09.02 | PARTIAL (gated) | 5 eylem `lib/coachActionsV2.ts` (`f39d972`); **eksik: hatırlatıcı SAATİ düzenleme eylemi** |
| R09.03 | PARTIAL | sürüm kontrolü DONE (`repo/coachV2Wired.test.ts`); **v2 belirsiz görevde aday seçimi yok (yalnız metin)** |
| R09.04 | PARTIAL | `lighten_today` yalnız bugün; **haftalık, süre/kapasite temelli düzenlenebilir öneri yok** |
| R09.05 | NOT_STARTED | AI bağlamında içgörü açıklaması + günlüğü bağlamdan çıkarma kontrolü yok |
| R09.06 | PARTIAL | timeout/lease mevcut (R09.01 testleri); **yerel şablon fallback'inin AI cevabı gibi sunulmadığı + offline davranışı testi yok** |
| R09.07 | NOT_STARTED | 60/20/10/10 senaryo değerlendirmesi yok (model içeren kısmı N/R; istemci tarafı fixture yapılabilir) |

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
