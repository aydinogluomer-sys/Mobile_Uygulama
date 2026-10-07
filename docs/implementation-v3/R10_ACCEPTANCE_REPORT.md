# R10.09 — Çekirdek kabul raporu (F01–F08)

Tarih: 2026-10-07 · Dal: `feature/r01-period-status` · Taban: `f6721bf` · Bu rapor: 21 commit (`a574e51` … `eafc86a`), push edilmedi.

## Okuma anahtarı

| Durum | Anlamı |
|---|---|
| **DONE** | Kod + test + mutasyon kanıtı; bugünkü veritabanıyla çalışır |
| **DONE-PENDING-MIGRATION** | Kod hazır; yeni tablo/kolon gerektiren kısım migration dosyası olarak YAZILDI, UYGULANMADI (S1/S2). O zamana kadar istemci yalnız eksik tabloda fail-open: davranış önceki gibi ve ekran "sunucu güncellemesi bekleniyor" der |
| **DONE-LOCAL** | Sunucu tablosu yokken cihazda (hesap başına) çalışır; migration yazıldı, uygulanmadı |
| **DONE-GATED** | Kod hazır, yeni bir `false` kapı arkasında; sunucu adımları (S2 + S3) sonrası açılır |
| **PARTIAL** | Kapsamın bir kısmı; kalan kısım ve nedeni yazılı |
| **BLOCKED** | Bir durma noktasına bağlı; hiçbir şey uydurulmadı |
| **N/R** | Ölçülmedi: gereken ortam (cihaz/kullanıcı) bu makinede yok |

## Kapı (geriye dönük tek tur — bkz. en alttaki koşu)

`typecheck:ci` 0 hata · `lint:ci` 0 uyarı · `run-tests.js` 145/145 · Jest **195 suite / 2894 test** (`--maxWorkers=2`, iki ardışık tam koşu) · `git diff --check` temiz.
Başlangıç (f6721bf): 146 suite / 2444 test → +49 suite, +450 test. Hiçbir mevcut test zayıflatılmadı; yeniden hedeflenenler gerekçesiyle STATE.md'de (habitFormFrequency, syncLifecycleWired rozet, exportIsNotABackup karar kapısı, exportBackup biçim 3, focusDurationContract).

Mutasyon kanıtı (bayt-bayt geri yükleme + sha256): her davranış değişikliği için; bu plan boyunca ≈175 mutant (P1 ≈48, P2–P8 129), son turlarda hayatta kalan **0** (ilk turlarda sağ kalanlar ayırt eden testle kapatıldı; bir eşdeğer mutant belgelendi). P8'de bir guard'ın baştan kırmızı olduğu ve "öldü" sonucunun geçersiz olduğu tam geçitte yakalandı; o tarihten sonra koşucular **taban yeşil** kontrolüyle çalışır.

## Faz faz

### F01 — Takvim motoru
| Kart | Durum | Kanıt |
|---|---|---|
| KD-12 telafi değer sözleşmesi | DONE | `services/recoveryMakeup`, `repo/recoveryMakeupAsksAmount`, `ui/recoveryScreen` |
| KD-08 aralık zarfı kapasitede | DONE | `lib/capacityRangeEnvelope`, `repo/capacityGatesRespectRange` |
| KD-09 kurulu alışkanlığın sıklığını düzenleme | DONE | `lib/frequencyEdit`, `repo/habitDetailEditsFrequency`, `ui/frequencyEditor`, `ui/habitDetailScreen` |
| R01.06-b dönemi dolan sayı hedefi | DONE | `lib/todayPeriodDone`, `repo/todayPeriodDoneWired` |
| R01.03-b log geri alma | **BLOCKED (S11)** | XP tetikleyicisi silmede XP'yi geri almıyor; tanımı repoda yok |
| KD-01 `isDueOn` count dalı | Sahip kararı: DURUR, guard yeterli | `repo/periodConsumerMigration` |

### F02 — Kapasite, telafi, checklist
| Kart | Durum | Kanıt |
|---|---|---|
| R01.04 alışkanlık kontrol listesi | DONE-PENDING-MIGRATION (029) | `lib/habitChecklist`, `store/habitStoreChecklist`, `repo/habitChecklistWired` |
| R01.05 skip / ara / tatil + hedef sürümleme | DONE-PENDING-MIGRATION (028) | `lib/habitPauses`, `lib/habitScheduleTimeOff`, `store/habitStoreTimeOff`, `ui/todayScreen` |
| R03.02 "Bugün daha az" | DONE | `lib/todayLightDay`, `repo/todayLightDayWired` |
| R03.03 küçük başlama | DONE | `lib/smallStart`, `store/focusSmallStep`, `ui/coreSheets` |
| R03.05 telafi yük önizlemesi | DONE | `lib/makeupLoadPreview`, `ui/recoveryScreen` |

### F03 — Kalıcı yerel veri & sync
| Kart | Durum | Kanıt |
|---|---|---|
| R02.01 offline matris | DONE | `docs/implementation-v3/R02_OFFLINE_MATRIX.md` |
| R02.02 depo ölçümü | DONE (ölçüm); **SQLite kararı S7** | aynı belge |
| R02.03 outbox (görevler) | DONE | `lib/outbox`, `fixtures/taskOutboxScenarios` |
| R02.04 retry/auth/sıra/görünürlük | DONE | `services/outboxRunner`, `ui/coreSheets` (OutboxIssues) |
| R02.05 çakışma + tombstone (görevler) | DONE | fixture "iki cihaz" senaryoları |
| R02.06 hesap ayrımı | DONE | fixture "accounts" (A'nın görevinin B'ye yazılması yakalandı ve iki katmanda düzeltildi) |
| R02.07 SQLite taşıması | **BLOCKED (S7)** | — |
| R02.08 fixture testleri | DONE (fixture); cihaz **N/R (S8)** | 8 senaryo, 5 ardışık koşu kararlı |
| Alışkanlık kaydı / checklist / telafi / günlük outbox'ta | PARTIAL | log kuyruğu mevcut `syncQueue`; diğerleri S7 + migration sonrası |

### F04 — Dinamik bildirim (widget / Live Activity HARİÇ — kapsam eki)
| Kart | Durum | Kanıt |
|---|---|---|
| R04.01 takvimli planlayıcı (KD-04) | DONE | `lib/reminderPlan`, `services/reminderService` |
| R04.02 çoklu saat / gün grubu / sessiz saat / kapatma | DONE | aynı + `ui/coreSheets` (ReminderEditor) |
| R04.03 bildirimden işlem, tek kayıt | DONE | `services/reminderService` |
| R04.04 temizlik / TZ-DST / OS limiti / Android kanal | DONE | `repo/remindersWired` |
| R04.05 cihaz matrisi | **N/R (S8)**; başlık gizleme DONE | — |
| R04.06 ertelenen tetikler UI'da yok | DONE | guard |

### F05 — Rutin yürütücü & odak
| Kart | Durum | Kanıt |
|---|---|---|
| R05.01 şablon / sürüm / oturum | DONE-LOCAL (030) | `lib/routineRunner` |
| R05.01-a paket alan kaybı | DONE | `store/routinePackInstallKeepsFields` |
| R05.02 yürütücü ekranı | DONE-LOCAL | `store/routineRunnerStore`, `repo/routineRunnerWired` |
| R05.03 odak zamanlayıcı (KD-03) | DONE | `lib/focusTimer`, `store/focusTimerKd03` |
| R05.04 oturum içi düzenleme + şablona uygula | DONE-LOCAL | `lib/routineRunner` |
| R05.05 duyuru / titreşim / sessiz | PARTIAL — ekran okuyucu + titreşim; **sesli duyuru S13** | — |
| R05.06 ortak süre sözleşmesi | DONE | `lib/focusDuration`, `repo/focusDurationContract` |
| R05.07 oturum ↔ alışkanlık/görev | DONE (rutin adımı → alışkanlık bir kez; küçük adım → görev, tamamlamadan) | `store/routineRunnerStore` |
| R05.08 şablonlar; kullanıcı testi | Şablonlar DONE; kullanıcı testi **N/R** | — |

### F06 — Günlük, duygu, analiz
| Kart | Durum | Kanıt |
|---|---|---|
| R07.01 etiket / biçim / alışkanlık bağı / çevrimdışı taslak | DONE (kaydetme başarısızken "Kaydedildi" kusuru düzeltildi) | `lib/journalAndMoods`, `repo/journalP6Wired`, `ui/coreSheets` |
| R07.02 özelleştirilebilir, sürümlü kimlikli duygular, çoklu kayıt | DONE-LOCAL (031) | aynı |
| R07.05 duygu–alışkanlık kartı (14 gün / 5 gün eşikleri, nedensellik yok) | DONE | aynı |
| R07.06 review'de sonraki eylem | DONE-LOCAL (031) — eylem gerçek komut (görev / alışkanlık ekranı) | aynı |

### F07 — Yedek & geri yükleme
| Kart | Durum | Kanıt |
|---|---|---|
| R08.01/02 kayıt defteri + biçim 3 manifest | DONE | `lib/backupRestore` |
| R08.03 kuru çalıştırma | DONE | aynı + `services/restoreService` |
| R08.04 güvenli birleştirme | DONE — **kısmi, tasarım gereği**: alışkanlık kayıtları (XP, S11), odak oturumları, webhook'lar geri yüklenmez | aynı |
| R08.05 otorite alanları dosyadan alınmaz | DONE | aynı |
| R08.06 genel CSV eşleme | DONE (görev / günlük); Habitify/Daylio **S6**; dosya seçici **S14** | `lib/csvImport` |

### F08 — Uygulama içi AI koç
| Kart | Durum | Kanıt |
|---|---|---|
| R09.02 eylem listesi genişletme | DONE-GATED (`COACH_ACTIONS_V2_ENABLED=false`; 032 + edge deploy = S2 + S3) | `lib/coachActionsV2`, `repo/coachV2Wired` (dört yer aynı liste) |
| R09.03 varlık sürüm kontrolü | DONE (mevcut log yolu dahil) | aynı |
| R09.04 "bu hafta yorgunum" | DONE-GATED (`lighten_today`, R03.02'ye bağlı) | aynı |

## R11 — CP / CE ölçümü

**N/R.** Cihaz, emülatör ve kullanıcı turu bu makinede yok (S8). Hiçbir CP/CE değeri uydurulmadı. Ölçüm için gereken: bir development build (S7/S13/S14 bağımlılıkları kararı sonrası), iOS + Android cihaz, ve R05.08/R03.08 kullanıcı denemesi.

## Bilinçli olarak yapılmayanlar (kapsam eki ve iptaller)

Widget, iOS Live Activities, Android ongoing, kilit ekranı; Spotify / Notion / Google Calendar; IAP / paywall; Watch / Wear; store / web yayını; harici MCP — ERTELENMİŞ. F13 RPG-pet, F14 finans, F15 canlı body doubling — KALICI İPTAL (`scopeAddendum.test.ts`). Var olan beş `false` kapı değişmedi; tek yeni kapı `COACH_ACTIONS_V2_ENABLED = false`.

## Açık durma noktaları (karar sahibin)

| # | Konu | Ne bekliyor |
|---|---|---|
| S1 | Supabase yedeği / şema | Veritabanı DONUK; hiçbir okuma/yazma yapılmadı |
| S2 | Migration 028–032 uygulaması | Yazıldı, `README.md`'de NOT APPLIED |
| S3 | `generate-routine` edge deploy | R09.02 şeması + istem kuralları kaynakta |
| S4 | KD-10/KD-11 backfill | Sayım yapılmadı (DB donuk) |
| S5 | `bypassPermissions` (`0828c8f`) | DEĞİŞTİRİLMEDİ — açık onay yok. Öneri: `.claude/settings.json` `defaultMode` → `default` (ileri commit, geçmiş yeniden yazılmaz) |
| S6 | Habitify/Daylio | Gerçek anonim export örneği |
| S7 | `expo-sqlite` | R02.07 |
| S8 | Cihaz / emülatör kanıtı | R02.08, R04.05, R05.08, R11 |
| S9 | Push / PR / merge | Senin "push et" deyişin; PR açıklaması `docs/implementation-v3/PR_DESCRIPTION.md` |
| S11 | Log geri alma | XP tetikleyicisinin gerçek tanımı + S2 |
| S12 | Şema repoda tam değil | Yedekten kurtarma ya da koddan yeniden türetme kararı |
| S13 | `expo-speech` | R05.05 sesli duyuru |
| S14 | `expo-document-picker` | R08 dosyadan içe aktarma |
| Açık karar | skip sınırı | Skip seride şeffaf; haftalık sınır gerekip gerekmediği |
