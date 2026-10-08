# R10.09 — Çekirdek kabul raporu

> Kaynak: **yalnız** `docs/implementation-v3/CORE_AUDIT.md` (2026-10-07 denetimi ve sonrasında her
> kartın satırına yazılan dosya + test + commit kanıtı). Bu raporun önceki sürümü bir alt kümeye
> dayanıyordu ve kanıt sayılmadı; bu sürüm onun yerine geçer.
> **Bağımsız reviewer yok** — bu yüzden hiçbir yerde "bağımsız PASS" yazılmaz. Store hold kararı
> değişmedi.

## Okuma anahtarı

| Etiket | Anlamı |
|---|---|
| DONE | dosya + davranış testi + commit; kartın kabul cümlesi testte |
| DONE (S2 canlı) | kod + test tamam; canlı etkinlik yazılmış ama **uygulanmamış** migration'a bağlı (SQL_FOR_OWNER.md sırası) |
| BLOCKED (Sx) | sahip kararı gerekiyor; gerekçe satırda |
| N/R | cihaz / kullanıcı / canlı sağlayıcı ölçümü; uydurulmadı |
| DEFERRED / CANCELLED | kapsam eki (2026-09-13) ve PDF iptalleri |

## 1. Sonuç

| | Sayı |
|---|---:|
| Kart (R00.01 – R11.06) | 86 |
| DONE (dosya + test + commit) | 78 |
| BLOCKED — sahip kararı | 3 (R01.03-b S11, R02.07 S7, R05.05 S13) |
| N/R — cihaz/kullanıcı | 5 (R03.08, R04.05, R11.03, R11.04, R11.05) |
| PARTIAL / NOT_STARTED | **0** |

DONE satırlarının bir kısmı ayrıca kısmi N/R taşır (ör. R02.08 cihaz, R06.04 cihazda odak gezintisi,
R07.07 kullanıcı anlaşılabilirliği, R09.07 model yarısı, R10.06 cihaz profili); satırda yazılıdır.

## 2. Kapı (geriye dönük, son commit'te art arda iki kez)

`npm run typecheck:ci` 0 hata · `npm run lint:ci` 0 uyarı · `node run-tests.js` 145/145 ·
`npx jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB` **253 suite / 3404 test** ·
`git diff --check` temiz. Her davranış değişikliği mutasyon kanıtı taşır (byte-identical geri alma +
sha256); hayatta kalan her mutant ya ayırt edici testle öldürüldü ya da eşdeğer diye gerekçelendirildi
(satırlarda). Yeniden hedeflenen testlerin gerekçesi `STATE.md` "CORE_AUDIT aşaması" bölümünde.

## 3. Paket paket — biten işler ve kanıt yeri

| Paket | Biten | Öne çıkan kanıt (ayrıntı CORE_AUDIT satırında) |
|---|---|---|
| R00 Zemin | 7/7 | kapsam eki + kapılar `scopeAddendum.test.ts`; boşluk envanteri, yolculuk haritası, test matrisi |
| R01 Hedef/takvim/kayıt | 6/7 (+1 BLOCKED) | ayın günleri + yıllık tarih; dönem durumu; duraklatma/tatil + sürümlü hedef (028); tek yerel-gün sözleşmesi + saat dilimi (033, kapı kapalı); 134 tüketici-çapraz fixture |
| R02 Yerel veri/sync | 7/8 (+1 BLOCKED) | görev + core outbox (günlük, not, telafi planı, odak oturumu); idempotent yeniden teslim (23505), sürüm çatışması, hesap başına kuyruk + nesil koruması; uçak modu/kill/out-of-order fixture |
| R03 Kapasite/küçük adım/telafi | 7/8 (+1 N/R) | tek sıradaki eylem; hafif gün; küçük başlama; aktivasyon gerekçesi; telafi yük önizlemesi; tek yönlü ilerleme modeli |
| R04 Bildirim | 5/6 (+1 N/R) | takvimden hatırlatma planı; çoklu saat/gün; bildirimden tek etkili eylem; kanal; ertelenmiş tetik yok |
| R05 Rutin/odak | 7/8 (+1 BLOCKED) | şablon/sürüm/oturum (030); kill-dayanıklı zamanlayıcı; tek süre sözleşmesi; rutin → alışkanlık bir kez, rapor aynı özetten; sağlayıcı bağımsızlığı testi |
| R06 Sadelik/erişilebilirlik | 6/6 | tasarım sistemi; tek baskın eylem; ortak form geri bildirimi; kontrast ölçümü; gizlilik örtüsü; 9 ekran durumu |
| R07 Günlük/duygu/analiz | 7/7 | arama + takvim; miktar/süre raporu; duygu–alışkanlık ilişkisi (eşikler, nedensellik yok); sonraki eylem (031); erişilebilir grafik metni |
| R08 Yedek/geri yükleme | 7/7 (R08.06 adaptörler S6) | 31 koleksiyon; manifest ilişki + anlık görüntü; koruma kararı; aynı işle sürdürme; yetki ayıklama; 10 tatbikat (5.200 kayıt, sayım+sağlama uzlaşması) |
| R09 Uygulama içi AI | 7/7 | 7 eylemlik ikinci set (CHECK 032/034/035, kapı kapalı); belirsiz adayda soru; haftalık hafifletme planı; günlük bağlamı kullanıcı kontrolünde; kaybolan yanıt ikinci tahsilat üretmez; 100 senaryo (araç/argüman/yan etki ayrı) |
| R10 Kalite kabulü | 9/9 | tek etki tablosu (3 çift etki bulundu, düzeltildi); ham log yok (tüm uygulama taraması); TR ondalık/tarih/hafta; 10.000 satır sayfalama; migration RLS statik koruması; bu rapor |
| R11 CP/CE | 3/6 (+3 N/R) | dondurma (plana karşı test), iki tur planı, kapanış belgesi |

## 4. Bu turda bulunan ve düzeltilen gerçek kusurlar (seçme)

| Kart | Kusur | Düzeltme |
|---|---|---|
| R10.02 | koç v2 kartı aynı karede / bittikten sonra ikinci basışta yeniden yazıyordu | tek atım ref koruması |
| R10.02 | koç v1 onayı aynı karede iki dokunuşta iki kez yazıyordu | ref koruması |
| R10.02 | rutin `finish()` iki kez → geçmişte iki kayıt | bitmiş oturum yeniden yazılmaz |
| R09.06 | zaman aşımı/çevrimdışı sonrası aynı istek yeni kimlikle → ikinci tahsilat | yanıtsız denemenin kimliği saklanır |
| R09.06 | hazır paket önizlemesi "Routine AI" içinde AI cevabı gibi görünüyordu | kaynak satırı |
| R10.03 | dışa aktarma / demo / görev bölme hataları cihaz loguna ham | kazıyan huniye |
| R10.05 | kullanıcıya görünen ondalıklar noktayla ("1.5") | `decimalTR` |
| R08.07 | 5.000+ hesap bütün dönmüyordu; tavanda off-by-one; kuru çalıştırma sınırlı okuma | tavan 20.000, anahtar sıralı tam okuma |

## 5. Gerçek açıklar

| Açık | Neden açık | Kim / ne |
|---|---|---|
| Log geri alma (R01.03-b) | DELETE XP'yi geri almıyor; tetikleyici tanımı repoda yok (S11) | sahip: §3 salt-okunur sorgu çıktısı |
| Kalıcı yerel depo / taşıma (R02.07) | `expo-sqlite` yeni native bağımlılık (S7) | sahip kararı |
| Sesli adım duyurusu (R05.05) | S13 sahip kararı; **not**: `expo-speech` zaten bağımlılık (`c14627d`) | sahip "aç" derse tek kart |
| Habitify/Daylio adaptörü (R08.06) | gerçek anonim export örneği yok (S6) | sahip örneği |
| 028–035 canlı değil | DB donuk (S1/S2) | sahip: `SQL_FOR_OWNER.md` sırası |
| `generate-routine` deploy edilmedi | S3 | sahip |
| `review_next_actions.task_id` FK'sız | `tasks` tanımı repoda yok (S12) — kabul edilen risk | yedekten tanım gelince |
| Cihaz/kullanıcı/model ölçümleri | S8, S3 | R11.02 planı |

## 6. Ertelenen ve kapsam dışı

Ertelenen (kapsam eki): widget, iOS Live Activities, Android ongoing, kilit ekranı, Spotify/Notion/GCal,
IAP/paywall, Watch/Wear, store/web yayını, harici MCP. Kalıcı iptal: F13 RPG-pet, F14 finans, F15 canlı
body doubling (`scopeAddendum.test.ts`). Hiçbiri açılmadı; beş mevcut kapı + `COACH_ACTIONS_V2_ENABLED` +
`LOG_TIMEZONE_ENABLED` `false`.

## 7. Durma noktaları (sahibin)

S1/S2 (DB, migration), S3 (edge deploy), S4 (KD-10/11 sayımları — `SQL_FOR_OWNER.md` §4), S6, S7, S8, S9
(push/PR/merge — yapılmadı), S11, S12, S13, S14 (dosyadan içe aktarma: yapıştırma ile çalışıyor).
