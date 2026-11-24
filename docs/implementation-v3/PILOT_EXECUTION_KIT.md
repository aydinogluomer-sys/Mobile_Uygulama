# Aderyth — İki Turlu Kullanıcı Pilotu ve Fiziksel Cihaz Doğrulama Kiti (`Y05` & `Y12`)

- **Kapsam:** Faz F5 (`Y05` Fiziksel Cihaz ve Düşük Bağlantı Doğrulama Matrisi — Playbook §8) ve Faz F6 (`Y12` İki Turlu Moderasyonlu Kullanıcı Pilotu — Playbook §9).
- **İlişkili Dondurulmuş Belgeler:** [`R11_USER_ROUNDS_PLAN.md`](./R11_USER_ROUNDS_PLAN.md), [`R11_EVALUATION_FREEZE.md`](./R11_EVALUATION_FREEZE.md), [`R02_OFFLINE_MATRIX.md`](./R02_OFFLINE_MATRIX.md), [`PLAYBOOK_EXECUTION_LEDGER.md`](./PLAYBOOK_EXECUTION_LEDGER.md).
- **Mevcut Kanıt Durumu (24 Kasım 2026):** Hermetik kod, 1 yıllık ölçek/performans bütçesi (`E12`) ve simülasyon testleri **GEÇTİ**; gerçek fiziksel Android/iPhone donanım koşusu (`Y05`) ve gerçek insanlı iki tur pilot (`Y12`) henüz yürütülmediği için açıkça **`BLOKE` / `N/R`** durumundadır.
- **Bağlayıcı Yayın Kuralı:** Otomatik test veya simülasyon başarısı fiziksel cihaz ya da insanlı pilot kanıtı yerine yazılmaz. **Açık P0 canlı/cihaz kapısı varken "yayına hazır" ilan edilmez.**

---

## 1. Kohort, Örneklem ve Veri Güvenliği Kuralları (`P02` & `Y12`)

### 1.1. İki Turlu Örneklem ve Aday SHA Kilidi

| Tur | Katılımcı Sayısı | Örneklem Kuralı | Tur Arası Mühendislik Kapısı | Çıktı |
|---|---|---|---|---|
| **Tur 1 — Keşif** | `5–8` katılımcı | Alışkanlık/planlama uygulaması kullanmış veya yarıda bırakmış hedef yetişkinler (`start_blocked` ve `midday_derailed` davranış kohortları dengeli) | Tur 1 sürerken uygulama ikilisi değiştirilmez. Tespit edilen her hata tek davranışlı düzeltme kartına bağlanır, regresyon testi eklenir ve Tur 2 öncesinde **yeni aday SHA kilidi** alınır. | Kusur listesi + görev bazlı ham süre ve yan etki tablosu |
| **Tur 2 — Doğrulama** | `5–8` katılımcı | **En az yarısı yeni kullanıcı** (`>= %50` Tur 1'e katılmamış katılımcı); kalan katılımcılar Tur 1'de takılma yaşayan akışların yeniden doğrulaması için seçilebilir | Kilitlenen yeni aday SHA üzerinde koşulur; tüm `P0` yan etki ve görev engelleri kapanmadan sürüm kapısı açılmaz. | Doğrulama raporu + `PILOT-01..05` kapı kararı |

### 1.2. Davranışsal Kohortlama ve Sentetik Hesap Zorunluluğu

1. **Tıbbi/klinik etiket yasağı (`P02`):** Katılımcılar klinik tanı iddiasıyla değil, gözlemlenebilir kullanım davranışıyla (`start_blocked`: «Plan yapabiliyorum ama ilk adıma başlayamıyorum»; `midday_derailed`: «Gün ortasında plan aksayınca günü tamamen bırakıyorum») ve kurulum tercihiyle (`self_planner` vs `routine_starter`) kodlanır. Ulaşılamayan grup pazar veya klinik genellemesiyle örtülmez; açıkça `N/R` olarak yazılır.
2. **Yalnız sentetik test hesabı kullanılır:** Oturumlarda yalnızca önceden hazırlanmış sentetik test hesapları (`pilot-t1-k1` … `pilot-t2-k8`) ve sentetik başlangıç verileri (`buildStartFixture`, `buildRecoveryFixture` eşdeğeri) kullanılır.
3. **Katılımcı kişisel verisi toplanmaz:** Gerçek ad, e-posta, telefon, özel günlük metni, konum veya sağlık verisi kaydedilmez. Kayıt çizelgesinde katılımcılar yalnızca `K1..K8` rumuzuyla tutulur.

---

## 2. Dondurulmuş 7 Görev (`G1..G7`) ve 2 Çekirdek Ürün Vaadi Kayıt Şablonu

Moderatör görev yönergesini okuduktan sonra çözümü tarif etmez. Müdahale gerekirse sonuç `Yardımsız` yerine `Yardımlı` olarak işaretlenir. İstenmeyen her veri mutasyonu (yanlış kayıt, çift yazım, yanlış gün, ana görevin erken kapanması, başka hesaba sızıntı) `Yanlış Yan Etki` sütununa işlenir ve kabul eşiği **`0`**'dır.

### 2.1. Görev ve Çekirdek Vaat Tanımları

| Kod | Görev / Çekirdek Ürün Vaadi | Başlangıç Durumu (Sentetik Hesap) | Kabul ve Sıfır Yan Etki Ölçütü |
|---|---|---|---|
| `G1` | **Haftalık hedef** («haftada 3 kez yürüyüş» kur ve iki ayrı günü işaretle) | Boş/temiz sentetik hesap | Hedef haftalık sayı (`3`) olarak kalır; ilerleme `2/3` görünür; işaretlenmeyen ara günde sahte «kaçırıldı» oluşmaz (`0` yanlış yan etki). |
| `G2` | **Küçük başlama** («Nereden başlayacağımı bilmiyorum» — gecikmiş/büyük görev için `5 dk` ilk adımı başlat) | `1` gecikmiş veya süre tahminsiz açık görev («Teklifi hazırla») | Tek baskın öneriden `5 dk` odak oturumu ilk adımla başlar; mikro adım bittiğinde veya erken durduğunda **ana görev kendiliğinden tamamlanmaz** (`completesParentOnFinish: false`). |
| `G3` | **Rutin yürütücü kesintisi** (sabah rutinini başlat, 2. adımda uygulamayı kapatıp yeniden aç) | Hazır sabah rutini şablonu | Aynı rutin oturumu 2. adımda kaldığı yerden sürer; geçen süre sıfırlanmaz veya yapay şişmez; atlanan ile tamamlanan adım birbirine karışmaz. |
| `G4` | **Ölçülebilir telafi** («1,5 L» su hedefinde kaçırılan/kısmi günü telafi et) | `1,5 L` günlük hedef, `0,5 L` kısmi veya kaçırılmış kayıt | Uygulama gerçek miktarı sorar (sahte tam değer uydurmaz); kalan `1,0 L` açığı ve hedef güne eklenen kapasite/yük önizlemesini gösterir; «Telafi etme» seçilirse önceki `0,5 L` kısmi kaydı silinmez. |
| `G5` | **Haftalık değerlendirme eylemi** («Bu hafta ne işledi?» ekranında gelecek hafta için tek küçük ayar seç) | `1` haftalık sentetik aktivite verisi | Seçilen tek eylem kaydedilir ve yeni haftanın planında/değerlendirmesinde tekil olarak görünür; uydurma sıfır istatistik gösterilmez. |
| `G6` | **Kuru yedek/geri yükleme doğrulaması** (yedek dosyasını kuru çalıştır ve geri yükle) | Sentetik yedek JSON dosyası | Kuru çalıştırma (`dry-run`) eklenecek/atlanacak sayıları ve yetki alanı temizliğini açıkça gösterir; ikinci kez uygulandığında `0` mükerrer satır ekler. |
| `G7` | **AI ilk adım / onay sınırı + Aksayan günü aynı gün toparlama («Koru → Gör → Uygula»)** | İki «Kitap…» alışkanlığı + `16:00` sabit randevulu dağılmış gün (`buildRecoveryFixture`) | (a) AI belirsiz «Kitap hatırlatmasını akşam 9'a al» komutunda hangisi olduğunu sorar, onaysız yazmaz; sağlayıcı kapalıysa yerel ilk adım bölücü devreye girer. (b) **Aksayan günü aynı gün toparlama («Koru → Gör → Uygula»)** akışında `16:00` sabit randevu kilitli kalır, korunan tek odak işi yerinde tutulur, kalanlar küçültülür/yarına alınır ve makbuzlu geri alma (`Undo`) çalışır. |

### 2.2. Moderatör Oturum Kayıt Şablonu (Tur Başına Her Katılımcı İçin Çoğaltılır)

- **Tur:** `Tur 1 / Tur 2` · **Aday SHA:** `<git-sha>` · **Katılımcı Kodu:** `K_ (Yeni / Tekrar)`
- **Davranış Kohortu (`P02`):** `start_blocked` / `midday_derailed` · **Kurulum Alt Grubu:** `self_planner` / `routine_starter`
- **Cihaz ve OS:** `<Model + Android/iOS sürümü>`

| Görev | Yardımsız / Yardımlı / Başarısız | Süre (sn) | Yanlış Yan Etki (0 olmalı) | Gözlem Notu |
|---|---|---:|---:|---|
| `G1` Haftalık hedef (`haftada 3`) | `N/R` | `N/R` | `N/R` | Oturum yürütülmedi (`BLOKE` / `N/R`) |
| `G2` Küçük başlama («Nereden başlayacağımı bilmiyorum») | `N/R` | `N/R` | `N/R` | Oturum yürütülmedi (`BLOKE` / `N/R`) |
| `G3` Rutin yürütücü kesintisi | `N/R` | `N/R` | `N/R` | Oturum yürütülmedi (`BLOKE` / `N/R`) |
| `G4` Ölçülebilir telafi («1,5 L» / miktar sorma) | `N/R` | `N/R` | `N/R` | Oturum yürütülmedi (`BLOKE` / `N/R`) |
| `G5` Haftalık değerlendirme eylemi | `N/R` | `N/R` | `N/R` | Oturum yürütülmedi (`BLOKE` / `N/R`) |
| `G6` Kuru yedek/geri yükleme doğrulaması | `N/R` | `N/R` | `N/R` | Oturum yürütülmedi (`BLOKE` / `N/R`) |
| `G7` AI ilk adım / onay sınırı + «Koru → Gör → Uygula» | `N/R` | `N/R` | `N/R` | Oturum yürütülmedi (`BLOKE` / `N/R`) |
| `V1` Çekirdek Vaat 1 — İlk etkin eyleme geçiş (`G2` + boş/dolu Bugün) | `N/R` | `N/R` | `N/R` | Oturum yürütülmedi (`BLOKE` / `N/R`) |
| `V2` Çekirdek Vaat 2 — Aksayan günü aynı gün toparlama («Koru → Gör → Uygula») | `N/R` | `N/R` | `N/R` | Oturum yürütülmedi (`BLOKE` / `N/R`) |

---

## 3. İki Ana Ürün Metriği ve Dondurulmuş Payda Tanımı (§9.4)

Pilot değerlendirmesinde rakip özellik sayısı veya öznel beğeni puanı birincil başarı ölçütü olarak kullanılmaz; aşağıdaki iki davranışsal metrik dondurulmuş payda kurallarıyla raporlanır:

### 3.1. Metrik 1 — İlk Etkin Eyleme Kadar Süre (`time_to_first_action_sec`)

- **Başlangıç ve bitiş:** Katılımcının Bugün / Başlama yüzeyini gördüğü andan, onaylı ilk odak oturumunu (`startSmallStep` / odak sayacı) veya rutin adımını fiilen başlattığı ana kadar geçen saniye.
- **Raporlama biçimi:** **Medyan** ve **P90** değerleri birlikte verilir; başlatamayan katılımcılar süreden düşülerek gizlenmez, açık tamamlanma kesri (`k/n`) ile birlikte yazılır.
- **Küçük örneklem uyarısı (Zorunlu):** Tur başına örneklem `n = 5–8` (`n < 10`) olduğundan `P90` tek başına en yavaş tekil gözleme karşılık gelir ve pazar/klinik genellemesi olarak sunulamaz. Rapor tablosunda medyan ve `P90`'ın yanında tüm ham katılımcı süreleri (`[sn_1, sn_2, ...]`) açıkça listelenir.

### 3.2. Metrik 2 — Plan Aksadıktan Sonra Aynı Gün Yeniden Eyleme Geçme Oranı (`same_day_recovery_return_rate`)

- **Payda tanımı (`d`):** Tanımlı gözlem penceresinde plan aksaması yaşayan (ör. öğleden sonra birikmiş iş + `16:00` sabit randevu sıkışması veya kaçırılan/kısmi alışkanlık nedeniyle Toparlanma / Hafif Gün / Telafi akışına giren) katılımcılar. Gözlem penceresinde hiçbir aksama yaşamayan katılımcı paydaya dahil edilmez; aksama yaşayıp uygulamayı terk eden katılımcı ise **paydadan çıkarılmaz**.
- **Pay tanımı (`m`):** Paydadaki katılımcılar arasından, **aynı yerel gün (`04:00` Gün Kapanışı devir sınırı öncesi)** içinde «Koru → Gör → Uygula» planını onaylayıp veya küçültülmüş adımı seçip en az bir etkin eylemi fiilen başlatan katılımcılar.
- **Raporlama biçimi:** Açık `m/d` kesri ve yüzde karşılığı birlikte yazılır; `d = 0` ise oran `0` veya `%100` diye uydurulmaz, `N/R (payda = 0)` olarak kaydedilir.

---

## 4. `Y05` Fiziksel Cihaz ve Düşük Bağlantı Test Matrisi (§8)

Aşağıdaki matris en az **1 düşük/orta sınıf Android fiziksel cihaz** (kısıtlı RAM, agresif arka plan sonlandırma, dar depolama) ve **1 fiziksel iPhone (iOS)** üzerinde release/preview derlemesiyle koşulmadan kapatılmaz:

| Senaryo Kodu | Stres Senaryosu ve Adımlar | Kabul Ölçütü (`0` Veri Kaybı / `0` Çift Etki) | Hermetik CI / Simülasyon Kanıtı | Düşük/Orta Sınıf Android | Fiziksel iPhone (iOS) |
|---|---|---|---|---|---|
| `Y05-01` | **Yazım ortasında OS kill → geri açma:** Görev ekleme, alışkanlık kaydı veya «Koru → Gör → Uygula» yazımı sürerken (`sending: true`) uygulamayı işletim sistemi üzerinden zorla kapatıp yeniden açma | Açılışta askıda kalan `sending` bayrağı temizlenir (`clearSending`), kuyruk kaybolmaz ve ağ geldiğinde sunucuda tam 1 kez uygulanır. | `GEÇTİ` (`oneYearScaleBudget.test.ts`, `taskOutboxScenarios.test.ts`) | `BLOKE` / `N/R` | `BLOKE` / `N/R` |
| `Y05-02` | **Uçak moduna geçiş → dönüş:** Uçak modunda yeni görev + yeniden planlama kuyruğa alma, durumu kontrol etme ve bağlantıyı geri açma | Çevrimdışı iken sahte `committed` gösterilmez (`pending` dürüst durum); bağlantı döndüğünde tüm bekleyen komutlar sırayla ve tek yan etkiyle uzlaşır. | `GEÇTİ` (`f5f6PilotAndScaleReadiness.test.ts`, `outboxResilienceAndSyncOutcomes.test.ts`) | `BLOKE` / `N/R` | `BLOKE` / `N/R` |
| `Y05-03` | **Saat dilimi değişimi ve `04:00` gün sınırı:** Cihaz saat dilimini `Europe/Istanbul` → `America/New_York` → `Pacific/Auckland` arasında değiştirme ve `03:59` → `04:00` geçişi | Geçmiş alışkanlık kayıtlarının yerel günü kaymaz; `03:59` kapanmakta olan güne, `04:00` yeni güne yazılır; haftada-3 hedef serisi bozulmaz. | `GEÇTİ` (`f1f2IndependentAcceptance.test.ts`, `npm run test:tz`) | `BLOKE` / `N/R` | `BLOKE` / `N/R` |
| `Y05-04` | **Bildirime geç tıklama:** Planlanan hatırlatma saatinden saatler sonra veya ertesi yerel günde bildirime dokunma; sessiz saat kontrolü | Bayat bildirim yanlış güne otomatik tamamlandı yazmaz; ilgili güncel ekrana güvenli yönlendirir ve sessiz saat aralığında sesli uyarı üretmez. | `GEÇTİ` (`f3f4AcceptanceMatrix.test.ts`, bildirim/hatırlatıcı birim testleri) | `BLOKE` / `N/R` | `BLOKE` / `N/R` |
| `Y05-05` | **Hesap A → Hesap B geçişi:** Hesap A çevrimdışı görev + yeniden planlama kuyruklamışken çıkış yapıp çevrimiçi ortamda Hesap B ile oturum açma, ardından tekrar Hesap A'ya dönme | Hesap B ekranında ve sunucusunda **sıfır** Hesap A verisi görünür; `outbox.v1.<uidA>` korunur; Hesap A geri döndüğünde bekleyen işler tek yan etkiyle uzlaşır. | `GEÇTİ` (`f5f6PilotAndScaleReadiness.test.ts`, `f1f2IndependentAcceptance.test.ts`) | `BLOKE` / `N/R` | `BLOKE` / `N/R` |

---

## 5. Dürüst Kanıt Durumu ve Go/No-Go Kapısı (`PILOT-01..05`)

| Kapı Kodu | Kapı Tanımı | Hermetik CI / Simülasyon Durumu | Fiziksel Cihaz (`Y05`) Durumu | Canlı / İnsanlı Pilot (`Y12`) Durumu | Go/No-Go Hükmü |
|---|---|---|---|---|---|
| `PILOT-01` | `E12` 1 yıllık sentetik veri ölçeği (`12` alışkanlık, `4.380` kayıt, `160` görev, `60` telafi planı), deterministik çıktı ve `p95` gecikme/outbox bütçesi | `GEÇTİ` (`oneYearScaleBudget.test.ts`, `QUERY_BOUNDING_MATRIX.md`) | `N/R` (Cihaz profiler koşusu yapılmadı) | `N/R` | Hermetik bütçe yeşil; cihaz profillemesi açık (`N/R`) |
| `PILOT-02` | `Y05` Düşük/orta sınıf Android + fiziksel iPhone üzerinde OS kill, uçak modu, saat dilimi, geç bildirim ve Hesap A→B geçiş matrisi | `GEÇTİ` (`f5f6PilotAndScaleReadiness.test.ts`) | **`BLOKE` / `N/R`** (Fiziksel donanım erişimi yok) | `N/R` | **BLOKE** — Fiziksel Android ve iPhone kanıtı zorunlu |
| `PILOT-03` | Canlı/staging şema (`028..045`), Edge dağıtımı, geri dönüş provası ve izlenebilir aday SHA kilidi (`Y01`, `Y07`, `Y09`, `Y13`) | `GEÇTİ` (`verify-owner-rollout-readiness.mjs`, Postgres 17 CI) | `BLOKE` | **`BLOKE`** (Operatör canlı uygulaması bekliyor) | **BLOKE** — Operatör rollout tamamlanmadan canlı tur açılmaz |
| `PILOT-04` | `Y12` Tur 1 Keşif (`5–8` katılımcı, yalnız sentetik test hesabı, `G1..G7` + `V1..V2` şablonu) ve düzeltme sonrası yeni aday SHA kilidi | `GEÇTİ` (Protokol ve sentetik fixture hazır) | `BLOKE` / `N/R` | **`BLOKE` / `N/R`** (Gerçek katılımcılı oturum yürütülmedi) | **BLOKE** — Gerçek insanlı Tur 1 yürütülmedi |
| `PILOT-05` | `Y12` Tur 2 Doğrulama (`5–8` katılımcı, en az yarısı yeni kullanıcı, medyan + `P90` ilk eylem süresi, aynı gün toparlanma paydası, `0` yanlış yan etki) | `GEÇTİ` (Şablon ve kabul kapısı donduruldu) | `BLOKE` / `N/R` | **`BLOKE` / `N/R`** (Tur 1 ve cihaz önkoşuluna bağlı) | **BLOKE** — Gerçek insanlı Tur 2 yürütülmedi |

### Go/No-Go Karar Özeti

- **Hermetik Mühendislik Hazırlığı:** `GEÇTİ` (ölçek bütçesi, çevrimdışı/hesap izolasyonu simülasyonu ve pilot protokolü tamamlandı).
- **Fiziksel Cihaz (`Y05`) ve İnsanlı Pilot (`Y12`) Kapısı:** **`BLOKE` / `N/R`**.
- **Nihai Hüküm:** `PILOT-01..05` tablosundaki fiziksel cihaz ve canlı insanlı pilot sütunları gerçek kanıtlarla doldurulana dek sürüm kapısı kapalıdır; **açık P0 canlı/cihaz kapısı varken "yayına hazır" ilan edilmez.**
