# R00.04 — Test / Veri Matrisi (Implementation v3.0)

**Baseline:** `0ff1c74`. Bu oturumda çalıştırılan gerçek sonuçlar en altta.
Kanıt sınıfları rehber §9: `OBSERVED_SOURCE`, `TESTED_UNIT`,
`TESTED_INTEGRATION`, `OBSERVED_UI`, `OBSERVED_DEVICE`, `REPORTED_PRIOR`,
`NOT_VERIFIED`, `DEFERRED`.

## Katmanlar

| Katman | Ne kanıtlar | Mevcut araç / konum | Bugünkü kapsama | R01+ için kural |
|---|---|---|---|---|
| **L1 Domain** | Saf hesap: takvim, dönem, ceiling, streak, recovery deficit, kapasite | jest (`__tests__/lib/*`, 26 dosya): `habitSchedule`, `phase1Adversarial`, `ceilingSemantics`, `habitEngine`, `habitStrength`, `recovery`, `capacity*`, `date*` | Güçlü. Pencere fonksiyonları test edilmiş ama **üretimde tüketilmiyor** (bkz. envanter) | Her kart önce L1 fixture; T01–T04 kanonik fixture'ları `__tests__/lib/habitPeriod.test.ts` (yeni) altında toplanır ve **tüm tüketiciler aynı fixture'ı** kullanır |
| **L2 Service / Repository** | Katman sınırı, tek etki, hata sözleşmesi | `__tests__/repo/*` (51): `layerBoundary`, `edgeCallDeadline`, `queryBounding`, `xpIsEarned`, `focusPointAtomicity`, `syncLifecycleWired`; `__tests__/services/*` (4); `__tests__/store/*` (28) | Güçlü guard'lar; servis davranış testleri az (4) | Yeni service davranışı = davranış testi + gerekirse mutation kontrolü; guard'lar korunur |
| **L3 DB / RLS** | Sahiplik, cascade, grant, idempotent RPC | **Otomatik test yok.** Kanıt: `docs/FINAL_RLS_MATRIX.md` (127 canlı kontrol), 11B canlı probe'lar (delete-account A/B), `__tests__/edge/*` (14, Deno kodunu Node'da ayna) | `REPORTED_PRIOR` — bu oturumda canlı yazma yapılmadı | Yeni tablo/RPC → salt-okunur `execute_sql` ile A/B negatif probe + `get_advisors`; kanıt sınıfı `TESTED_INTEGRATION` ancak canlı çalıştırıldığında |
| **L4 Render / Integration** | Ekran state'leri, bileşen davranışı | `__tests__/ui/*` (8, RNTL: aiCoach*); `run-tests.js` yapısal 145 kontrol | Dar: yalnız AI Coach ekranları render testli | R03/R05/R06/R07 ekranları için RNTL render testi zorunlu; "ekran var" ≠ PASS |
| **L5 Kontrollü etkileşim** | Gerçek akış: kesinti, yeniden açılış, offline replay | Development build / EAS `validation` APK; **emülatör/simülatör bu makinede yok** | `DEFERRED` (D07 fiziksel profiling ayrı); önceki Step 11A.2 cihaz kabulü de bekliyor | Kontrollü senaryo (uçak modu, app kill) elde olan ortamda; sonuç `OBSERVED_DEVICE` yalnız gerçek gözlemde |

## Test hedefi ve veri sınırı

- **Yetkili ortam:** Supabase `kbcuolhjjnmhjaarxxmu` (tek proje; ayrı staging yok — EAS profil adı staging değildir). Canlı yazma yalnız açık onaylı adımda ve **disposable** hesapla.
- **Sentetik A/B hesapları:** 11B'de kullanılan yöntem — `auth.users`+`auth.identities`'e SQL ile eklenen `del-probe-*@example.com` tarzı kullanıcılar, password grant ile gerçek JWT; iş bitince satırlar silinir. Üretim sahibi hesabı **hiçbir teste** kullanılmaz. Mevcut 6 kullanıcı (4 onaylı) dokunulmaz.
- **Veri sınırı:** ekran/AI/telemetri testlerinde gerçek günlük/AI metni kullanılmaz; fixture'lar sentetik. Sırlar ve DSN çıktıya yazılmaz.
- **Canlı yazma yoksa:** ilgili L3 kanıtı `NOT_VERIFIED` olarak açık bırakılır; L1/L2 kart yine kapanabilir (rehber §12).

## T01–T20 → mevcut kanıt

| ID | Senaryo | Bugün | Kanıt sınıfı |
|---|---|---|---|
| T01 | Sal/Per/Paz haftada 3 gün | **FAIL** — `isDueOn` sabit gün (Pzt/Çar/Cmt) | `OBSERVED_SOURCE` |
| T02 | Aynı gün 3 kayıt | Gün hedefi 1 (UNIQUE habit_id+date); oturum hedefi **tanımsız** | `REPORTED_PRIOR`/`OBSERVED_SOURCE` |
| T03 | Ay ortası 4/10 | `streakBroken` doğru ("yetişilebilir → bozulmadı") ama tüketilmiyor; `isDueOn` aylık → 0 | `TESTED_UNIT` (evaluator) / `OBSERVED_SOURCE` (tüketici) |
| T04 | DST/ay sonu/timezone/hedef değişimi | Yerel gün `lib/date.ts` tek kaynak (V2 §4); hedef sürümleme **yok** | `TESTED_UNIT` / `NOT_VERIFIED` |
| T05 | 20 eksik → 10+10 | `deficitFor`+`split_two_days` var; ikinci onay dedup **NOT_VERIFIED** | `TESTED_UNIT` |
| T06 | 100 offline karışık işlem | Yalnız habit log kuyruğu; diğerleri kuyruksuz | `OBSERVED_SOURCE` |
| T07 | A offline → B login | hesap-bazlı kuyruk + replay filtresi (V2 §23) | `TESTED_UNIT` |
| T08 | İki cihaz aynı not | Politika yok | `NOT_VERIFIED` |
| T09 | Silme sonrası geç edit | Tombstone yok | `NOT_VERIFIED` |
| T10 | Pause/tamamlanan hedef bildirimi | Tek DAILY tetik; uzlaştırma yok | `OBSERVED_SOURCE` |
| T11 | 20 çalışma + 5 mola | **FAIL** — resume `sessionStartedAt`'i yeniler, pause ayrılmaz | `OBSERVED_SOURCE` |
| T12 | Runner process death | Runner yok; odak oturumu kalıcı değil | `OBSERVED_SOURCE` |
| T13 | Günlük taslağı | Taslak yok | `OBSERVED_SOURCE` |
| T14 | Yetersiz duygu verisi | İlişki kartı yok (dolayısıyla yanlış iddia da yok) | `OBSERVED_SOURCE` |
| T15 | 5.000+ / bozuk yedek / restore tekrarı | Restore yok | `OBSERVED_SOURCE` |
| T16 | AI belirsiz varlık / eski onay | Netleştirme + onay kartı var; `expectedVersion` yok | `TESTED_UNIT` (kısmi) |
| T17 | AI retry/timeout/lease | Step 11A kapanışı: request-id, lease, refund | `TESTED_UNIT`+`REPORTED_PRIOR` (canlı 11A) |
| T18 | Hesap silme sonrası bekleyen iş | Cascade canlı kanıtlı (11B); geç retry senaryosu **NOT_VERIFIED** | `REPORTED_PRIOR` |
| T19 | Büyük yazı/klavye | Render ölçümü yok | `N/R` |
| T20 | Kapalı gate/iptal aileleri | 54/54 guard | `TESTED_UNIT` (bu oturum) |

## Bu oturumda çalıştırılanlar (`0ff1c74`+docs, 2026-09-13)

| Komut | Sonuç |
|---|---|
| `npm run typecheck:ci` | 0 hata |
| `npm run lint:ci` | 0 uyarı |
| `npx jest --ci` | **131 suite / 2056 test PASS** |
| `node run-tests.js` | 145/145 |
| `git diff --check` | temiz |
| Kapsam guard'ları (3 suite) | 54/54 |
