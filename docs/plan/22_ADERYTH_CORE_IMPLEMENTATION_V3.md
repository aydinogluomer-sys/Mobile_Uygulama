# Aderyth — Odaklı Çekirdek Implementation Rehberi

> **Sürüm 3.0 · 13 Eylül 2026**
> Kullanıcı sonucu: Kapasitene uygun bir plan seç, başlayabileceğin adımı bul, yürüt ve aksadığında geri dön.
> Hedef: seçilen çekirdek deneyimde **9–9,5/10 kalite**. Bu bir sonuç garantisi, mevcut ürün puanı, klinik etkinlik veya yatırım alma puanı değildir.

| Başlık | Karar |
|---|---|
| Repo | `aydinogluomer-sys/Mobile_Uygulama` |
| İncelenen main | `0ff1c74b0d8d922fd9bef46d3631a1cf443677e2` |
| Güncel kapsam otoritesi | `docs/plan/21_KAPSAM_EKI_2026-09-13.md` |
| Rapor | Kullanıcının eklediği dört sayfalık “Aderyth Çekirdek Kapsam ve Budama.pdf” |
| Revizyon | Önceki v2 yol haritasının yerine geçer; eski R kart kimliklerinin kapsamı bu sürümde değişmiştir |
| Geliştirme | 12 faz, 86 üst iş paketi; yalnız doğrulanmış farklar uygulanır |
| Mevcut durum | Kısmi kaynak incelemesi yapıldı; uygulama, canlı DB ve cihaz testleri bu belge hazırlanırken çalıştırılmadı |
| Dağıtım | Store/web, IAP, widget ve ertelenmiş cihaz QA mevcut çekirdek tamamlanma hesabının dışında |
| Ticari durum | Güncel MVP ücretsiz; önceki abonelik/gelir senaryoları bu döngüye ödeme geliştirme yetkisi vermez |

## İçindekiler

1. [Budama raporunun eleştirisi ve kararlar](#kararlar)
2. [9–9,5 hedefinin ölçülebilir karşılığı](#puanlama)
3. [Güncel başlangıç ve kapsam sınırı](#baslangic)
4. [Skill'ler ve çalışma yöntemi](#skills)
5. [Faz sırası ve geçişler](#fazlar)
6. [86 üst iş paketi](#isler)
7. [Derin uygulama sözleşmeleri](#sozlesmeler)
8. [Ekran ve deneyim rehberi](#deneyim)
9. [Kanıt ve test matrisi](#test)
10. [65 özelliğin yeni kapsam karşılığı](#izlenebilirlik)
11. [Ertelenen işler ve ayrı release aşaması](#ertelenen)
12. [Ajan uygulama prompt'u ve devam kaydı](#uygulama)

<a id="kararlar"></a>
## 1. Budama raporunu nasıl uyguluyoruz?

**Ana karar:** Ürün alanlarını azalt, korunmuş alandaki doğruluk ve bütünleşmeyi artır. Sadece sekme gizlemek budama değildir; gereksiz yeni veri modellerini, bağımlılıkları, servis işletimini ve kabul şartlarını da plandan çıkar. Mevcut kullanıcı verisini silmek ise ayrı ve geri dönüşü zor bir işlemdir; bu plan böyle bir yetki vermez.

Rapordaki sakin arayüz, kapasite ve yürütme odağı güçlü bir stratejik öneridir. Ancak rapor, kodda bir model bulunmasını kullanıcı faydası kanıtıyla; ürün hipotezini de kesin liderlikle karıştırmaktadır. Aşağıdaki düzeltmeler uygulayıcı için bağlayıcıdır.

| Rapordaki öneri/iddia | Değerlendirme | Uygulanacak karar | Kanıt veya sınır |
|---|---|---|---|
| Finans modülünü çıkar | Katılıyorum; ayrı problem alanı | Para hesabı, bütçe, banka ve döviz işi açma | FP defteri ve kapasite bütçesi finans modülü değildir |
| Canlı video/ses platformunu çıkar | Bu kapsam için doğru | WebRTC ve canlı oda altyapısı ekleme | Her sosyal ürünün mutlaka 7/24 ekibe ihtiyacı olduğu iddiası kanıtlanmış değil |
| Klinik hizmeti çıkar | Güncel owner kararıyla uyumlu | Tanı/tedavi/sertifikalı klinik program kurma | Kullanım rehberi ve kullanıcı kontrollü planlama korunur |
| Yetişkinler karakter/oyunlaştırma istemez | Genelleme kanıtsız | Owner kararı gereği karakter/bahçe iptal; XP/seviye korunur | Gerekçe kullanıcının ürün tercihi; yaşa ilişkin evrensel hüküm değil |
| MCP son kullanıcıya sıfır değer sağlar, %99,5 kullanmaz | Sayı ve sonuç dayanaksız | Bu döngüde MCP yok; iç AI güçlendirilir | Routinery resmî sayfası kod yazmadan kullanım anlatıyor; Aderyth talebi ayrıca doğrulanmalı |
| SQLite ile cihaz ve sunucu tek transaction'da uzlaşır | Teknik olarak yanlış genelleme | Yerel transaction + outbox + sunucuda tek etki | Ağ iki tarafı tek atomik transaction yapmaz |
| Timer ve recovery modelleri uygulamanın üstün olduğunu gösterir | Model varlığı yeterli değil | Erişim → eylem → kalıcı veri → geri dönüş zincirini ölç | Helper veya öneri ekranı gerçek runner değildir |
| Duygu/odak ilişkisinde %35 artış göster | Yalnız gerçek hesaptan türetilebilir | Eşleşmiş gün, payda, dönem ve eksik veri görünür olsun | Örnek yüzde ürünün içine sabit veri olarak konmaz; ilişki nedensellik değildir |
| Yorgunluk ifadesiyle kapasiteyi otomatik değiştir | Kullanıcı kontrolünü zayıflatır | Öneri, fark önizlemesi, açık onay, sürüm kontrolü | Sohbet metni tek başına veri değiştirme yetkisi değildir |
| Widget ve Live Activity çekirdek | PDF'den sonraki karar değişti | 13 Eylül kapsam eki gereği ertelenir | Temel bildirim ve in-app runner devam eder |
| 18–24 aydan 3–4 aya iner | Ekip/hız verisi yok | İlk kartların gerçek süresinden planla | Takvim garantisi yok |
| Dokuz faz | PDF haritasında F00–F08 ve final F09 var | Faz numarası yerine bağımlılık ve kabul kullan | Bu rehberde R00–R11 açıkça 12 fazdır |
| Hiçbir rakibin sunmadığı 9,2 ürün | Araştırma ve test bunu kanıtlamıyor | Çekirdek kalite hedefi ve geniş kapsam karşılaştırması ayrı | Rakibin bilinmeyen özelliği sıfır değildir |

**Budamanın işlemsel sırası:** kapsam envanteri → kullanıcı girişlerini belirle → kapalı alanı açma → çekirdek bağlantıları düzelt → veri/geri dönüşü koru → ilgili davranışı test et. Kullanılmayan şema kalıntılarını temizlemek çekirdeğin ön koşulu değildir.

<a id="puanlama"></a>
## 2. 9–9,5 ne anlama geliyor?

Üç ayrı sonuç tutulur:

- **CORE_IMPLEMENTATION:** Kabul edilmiş çekirdek işlerin işlevsel tamamlanması.
- **CORE_QUALITY:** Bu çekirdeğin gözlenmiş görev başarısı, anlaşılabilirliği, tutarlılığı ve hata toparlanması.
- **RELEASE_READINESS:** Dağıtım, mağaza/web, cihaz profiling ve ertelenmiş operasyon doğrulaması. Mevcut döngünün dışında; tamamlandı diye işaretlenmez.

Kod işleri bitmiş olabilir; cihaz kanıtı ertelenmişken tüm platformlarda 9,5/10 üretim kalitesi kanıtlandı denemez. Bilinmeyen bir kalite alt ölçümü tamamlanma hatası değildir, fakat kalite puanında gözlenmiş başarı da değildir. Uygulayıcı `CORE_IMPLEMENTATION: COMPLETE`, `CORE_QUALITY: PARTIALLY_MEASURED`, `RELEASE_READINESS: DEFERRED` gibi ayrı sonuç verebilir.

### 2.1 Çekirdek ürün hedef matrisi

Yeni kapsam için **CP** kimlikleri kullanılır; eski P01–P12 sayılarıyla birebir aynı ölçek değildir. Güncel tüm akışlar test edilmediği için mevcut sayısal puan yazılmamıştır. Ağırlıklar işe başlamadan sabitlenir; sonuç kötü çıktığında değiştirilmez.

| Modül | Ağırlık | Hedef /10 | 9 bandı için gereken | 9,5'e yaklaşmak için ilave kanıt |
|---|---:|---:|---|---|
| CP01 Esnek hedef ve geçmiş | %16 | 9,5 | Hafta/ay, gün/oturum/miktar, hedef sürümü tüm tüketicilerde aynı | Sınır senaryolarında ekran ve veri tam eşleşir |
| CP02 Kapasite, küçük adım, recovery | %18 | 9,5 | Kullanıcı yükü seçer; açık onayla uygulanır; eksik artmaz | İki kullanıcı turunda bağımsız başlama ve geri dönüş |
| CP03 Rutin yürütme | %16 | 9,5 | Kalıcı oturum, adım değişimi, kesintiden dönüş | Farklı rutinlerde görev başarısı ve anlaşılır toparlanma |
| CP04 Odak ve temel bildirim | %12 | 9,0 | Doğru aktif süre; programa uygun, tek etkili eylem | Desteklenen ortamda izin/hata akışları; fiziksel OS kanıtı ayrıca |
| CP05 Günlük, duygu, review | %12 | 9,0 | Güvenilir taslak, arama, dürüst istatistik, sonraki plan | Kullanıcı ilişkiyi yanlış nedensellik olarak okumaz |
| CP06 Yerel veri ve veri taşıma | %12 | 9,5 | Çekirdek offline, kuyruk/çatışma, tam restore | Büyük hesap ve kesintide veri uzlaşması |
| CP07 Uygulama içi AI | %8 | 9,0 | Doğru varlık, onay, süreklilik, maliyet kontrolü | Belirsiz niyet, eski onay ve retry setinde doğru davranış |
| CP08 Sadelik ve erişilebilirlik | %6 | 9,0 | Tek ana eylem, tutarlı bileşen, okunabilir hata/boş durum | Temsilî görevlerde yardımsız akış ve erişilebilir render |

Ağırlıklı **tasarım hedefi 9,31/10**. Bu matematik, ürünün bu notu aldığı anlamına gelmez. 9,5 üst sınıra ancak gerçekten ölçülen modüller o seviyeye çıktığında ulaşılır; bu belge bir 9,5 garantisi vermez.

### 2.2 Çekirdek mühendislik hedef matrisi

| Modül | Ağırlık | Hedef /10 | Kabul kanıtı |
|---|---:|---:|---|
| CE01 Domain/tarih doğruluğu | %20 | 9,5 | Kanonik fixture, geçmiş sürümü, tüketici eşleşmesi |
| CE02 Kalıcı veri/sync | %20 | 9,5 | Outbox, retry, çatışma, hesap izolasyonu |
| CE03 Yedek/restore | %15 | 9,5 | Sayım, ilişki, bütünlük, tekrar restore |
| CE04 Yetki/mahremiyet | %15 | 9,0 | A/B negatif test; yeni veri lifecycle |
| CE05 AI tek etkisi ve ekonomi | %10 | 9,0 | Geçerli/başarısız/replay maliyet uzlaşması |
| CE06 Test ve sınırların korunması | %10 | 9,0 | Davranış testi, ilgili CI, mevcut katman sınırı |
| CE07 Uygulama oturum lifecycle | %10 | 9,0 | Kontrollü kesinti ve yeniden açılış sonucu |

Ağırlıklı hedef **9,275 ≈ 9,28/10**. Bu tabloda store/IAP/widget/profiling yoktur; çıkarılan işler yapılmış gibi puan kazanılmaz. Tüm ürün engineering puanı yerine özellikle “çekirdek mühendislik hedefi” denir.

### 2.3 Puan nasıl hesaplanır?

Her modülde kapsam %30, davranış derinliği %30, kullanıcı akışı %20, tutarlılık %20. Alt boyutlar: 0 yok; 2 kabuk; 4 temel eksik; 6 ana akış çalışır; 8 hata/boş/geri dönüş dahil gelişmiş; 9 sınır senaryoları ve bütünleşme kanıtlı; 10 aynı görevde tekrarlanmış üstünlük kanıtlı. Ara değer gerekçeyle verilir.

Bir boyut gözlenmediyse `N/R` yazılır. Alt/üst olası aralık raporlanabilir; eksik boyutu çıkarıp kalanları 10'a ölçekleme. Kritik veri kaybı, başka hesaba erişim veya yanlış FP etkisi varsa ortalama ne olursa olsun ilgili modül kabul edilmez. Yeni ürün alanı eklemek bu kusuru kapatmaz.

Rakip görev seti: Habitify/HabitNow için esnek hedef ve hatırlatma; Routinery için runner; Daylio için duygu/review; HabitKit için basit kayıt ve veri kurtarma; HabitGenius için geniş kayıt çeşitleri. Aynı platform, sürüm, plan ve aynı görev kullanılır. İç backend'lerine erişim olmadan mühendislik notu verilmez. 10 Eylül'deki eski rakip puan bantları tarihsel ön değerlendirmedir; bu yeni kapsama taşınmış güncel ölçüm değildir.

<a id="baslangic"></a>
## 3. Güncel başlangıç: nerede yeniden yazmamalıyız?

13 Eylül main ve kapsam eki kontrol edildi. Tam repo denetimi yapılmadı; aşağıdaki ayrım uygulanır.

| Gözlem | Kanıt türü | Uygulama sonucu |
|---|---|---|
| Expo `~57.0.22`, RN `0.86.3`, Zustand `^5.0.10`, Sentry bağımlılığı | Güncel package.json okundu | Eski SDK veya “Sentry yok” varsayımıyla iş açma |
| Beş availability gate kapalı | Güncel featureGates.ts ve kapsam eki | Yeni OAuth, ücretli abonelik ve canlı URL bayraklarını açma |
| Paywall kaldırılmış, focus-points ekranına geçilmiş | Kapsam ekinin uygulama kaydı | Eski paywall açık bulgusunu otomatik tekrar etme |
| Haftalık count, `isDueOn` içinde sabit gün dağıtıyor; monthly false | Güncel habitSchedule.ts okundu | R01'de çağıran tüketicileri kontrol ederek gerçek farkı kapat |
| Daha geniş schedule helper'ları var | Aynı kaynak | Helper'ı yeniden yazmadan persistence ve consumer bağlantısını izle |
| Sentry source-map PASS, runtime ingest açık | Repo uygulama kaydı; bizim canlı testimiz değil | Yeni servis kurma; açık runtime işi DEFERRED |
| Kapanmış Step 4 AI kazanımları | Önceki kapanış ve yeni repo kaydı | Yalnız değişen eylemin regresyonunu doğrula |
| Eski RPG tabloları var, istemci bunları kullanmıyor | Kapsam eki raporu | Şema temizliği ayrı iş; pet/shop UI ekleme |
| Web içerikleri hazırlanmış, yayın yok | Kapsam eki raporu | İçeriği koru; bu döngüde hosting işi açma |

Tarihsel audit'teki SMTP, migration veya deploy açıkları bugün otomatik açık sayılmaz. Önce güncel kanıtla eşleştir. Güncel kapsam eki eski audit'ten üstündür; fakat bir raporda PASS yazması bu oturumda testi çalıştırdığımız anlamına gelmez.

### 3.1 Dört kapsam sınıfı

| Sınıf | İşler | Tamamlanma etkisi |
|---|---|---|
| CORE | Esnek motor, kapasite/recovery/checklist, yerel veri/sync, rutin/odak, temel bildirim, günlük/review, restore, iç AI, mevcut uygulama UX | Kabul ölçütleri zorunlu |
| PRESERVE | Görev/proje/OKR/not/okuma/yaşam alanı; mevcut XP/FP; hesap silme; mevcut güvenli bağlantıdan çıkış | Veri ve çalışan davranış korunur; yeni alt ürün kurulmaz |
| DEFERRED | Widget/Live Activity/saat, OAuth entegrasyonları, IAP, web/store, profiling ve store cihaz QA, Sentry runtime smoke | Çekirdek fazı bloke etmez; yapılmış sayılmaz |
| CANCELLED | Karakter/bahçe/RPG, finans, kendi canlı ses/video platformu, klinik hizmet | Yeni kod/bağımlılık/ekran eklenmez |

Mevcut MVP ücretsizdir. Plus/Pro/Premium fiyatlandırma konuşmaları ticari senaryolardır; bu rehber ödeme katmanını tekrar açmaz. FP limitleri, ücretsiz kullanım hakları ve hesap verileri korunur. DEHB dostu günlük destek konumlandırılır; ilaç/BDT yönetimi, doz önerisi veya klinik sonuç iddiası eklenmez.

<a id="skills"></a>
## 4. Skill'ler ve çalışma yöntemi


Skill'ler repo kökündeki gerçek dosyalardır; adı görmek uygulandıkları veya canlı erişim verdikleri anlamına gelmez. Her kart yalnız ilgili skill'i okur ve uyguladığı adımı kaydeder.

| Kod | Gerçek skill yolu | Kullanım |
|---|---|---|
| S01 | `.claude/skills/audit-expo-react-native-project/SKILL.md` | Başlangıç SHA/build/bağımlılık kanıtı |
| S02 | `.claude/skills/design-habit-domain-model/SKILL.md` | Hedef, kayıt, takvim, seri ve telafi |
| S03 | `.claude/skills/verify-date-time-and-streak-logic/SKILL.md` | Yerel gün, timezone ve sınır tarihleri |
| S04 | `.claude/skills/verify-feature-end-to-end/SKILL.md` | UI → veri → gerçek sonuç |
| S05 | `.claude/skills/audit-supabase-security/SKILL.md` | Doğru projede RLS/grant/sahiplik incelemesi |
| S06 | `.claude/skills/design-mobile-product-system/SKILL.md` | Mevcut tasarım sistemi, erişilebilirlik ve akış |
| S07 | `.claude/skills/research-and-adapt-github-repositories/SKILL.md` | Yeni bağımlılıkta uyumluluk/lisans/bakım |
| S08 | `.claude/skills/plan-small-agent-tasks/SKILL.md` | Tek sonuçlu küçük iş kartı |
| S09 | `.claude/skills/review-mobile-release-quality/SKILL.md` | Yazar dışında inceleme ve yayın kararı |
| S10 | `.claude/skills/map-reference-html-to-mobile-features/SKILL.md` | Yalnız gerçek referans verildiğinde gereksinim eşleme |

`.agents/skills/supabase/` ve `.agents/skills/supabase-postgres-best-practices/` ilgili DB işinde yardımcıdır. Skill manifesti ile başlık durumları farklıysa R00'da mevcut kanıtla uzlaştır; bütün proje için uygulanmış varsayma.

Aşağıdaki U kodları gömülü uzman çalışma talimatlarıdır; yeni kurulmuş skill dosyaları değildir. Eski kodlar anlamlarını korur.

| Kod | Girdi → çalışma → çıktı | Revizyon durumu |
|---|---|---|
| U01 Native | SDK/OS → mevcut uygun test ortamı → izin/lifecycle → gözlenen sonuç | Temel bildirim/runner CORE; fiziksel release QA D07 |
| U02 Sync | İşlem anlamı → atomik yerel kayıt → dedup/çatışma → hata enjeksiyonu | CORE |
| U03 Restore | Veri registry'si → sürümlü format → dry-run → kontrollü restore → sayım/hash | CORE |
| U04 İstatistik | Pay/payda → örneklem/eksik veri → fixture → açıklanabilir sonuç | CORE |
| U05 OAuth/API/MCP | Scope/kimlik → token/iptal/replay → negatif test | LATER; mevcut erişim kontrolleri korunur |
| U06 AI | Niyet → doğru varlık → şema → önizleme/onay → tek uygulama → değerlendirme | CORE |
| U07 Finans | Para modeli ve muhasebe uzlaştırması | OUT; ilk sürümde uygulanmaz |
| U08 İçerik | Öğrenme hedefi → kaynak/hak → uygun uzman incelemesi → küçük kullanıcı denemesi | Yalnız kısa, klinik iddiasız rehberlikte sınırlı |
| U09 Topluluk | Üyelik/oda → paylaşım/moderasyon → gerçek operasyon | Yeni canlı toplulukta OUT; mevcut sosyal erişimde koruma |
| U10 Billing | Ürün kimliği → server doğrulama → yaşam döngüsü → sandbox/restore | DEFERRED; bu döngüde uygulanmaz |

Her U çıktısında somut dosya/kanıt ve açık engel bulunur. Bağımsız reviewer kendi yazdığı işe bağımsız onay vermez. Bu belge için bağımsız review yapıldığı iddia edilmez. Skill veya erişim yokluğu yalnız ilgili kartı engeller; diğer hazır işlerin ilerlemesini durdurmaz.

Her üst paket önce aşağıdaki küçük kart biçimine ayrılır. S/M/L bir takvim sözü değildir. Çalışmaya başlamadan kapsam dosyaları gerçek repoda çözülür; önerilen yeni dosya isimleri mevcut dosya kanıtı sayılmaz. Her kart tek davranış, mümkünse 1–5 dosya içerir. Migration ile büyük UI değişikliği aynı kartta birleştirilmez.

| Kart alanı | Doldurma kuralı |
|---|---|
| ID / durum | Örn. R01.02-a; READY / IN_PROGRESS / IN_REVIEW / DONE / BLOCKED |
| Öncelik / sorumlu | CORE MUST; uygulayıcı rolü ve dosya sahipliği |
| Bağımlılık | Somut önceki kart ve gerekli veri sözleşmesi |
| Scope | Gerçek 1–5 dosya; eklenecek dosya “yeni” olarak işaretli |
| Amaç / kabul | Tek kullanıcı sonucu ve başarısız olabilecek karşı örnek |
| Skill | Okunan S kodu, uygulanan adım ve ilgili U talimatı |
| Doğrulama | Çalıştırılacak gerçek komut veya etkileşim senaryosu |
| Risk / geri dönüş | Veri ve eski istemci etkisi; flag veya ileri düzeltme |
| Efor | XS/S/M/L; büyükse alt kartlara böl |
| Kanıt | SHA, test sonucu, ortam, gözlenen davranış; sır içermez |

<a id="fazlar"></a>
## 5. Faz sırası

| Faz | Sonuç | Bağımlılık | Skill |
|---|---|---|---|
| R00 | Güncel fark ve kapsam kaydı | Yok | S01 S06 S08 |
| R01 | Kanonik hedef/tarih | R00 | S02 S03 S04 |
| R02 | Kalıcı veri/komut | R01 | S05 S07 U02 |
| R03 | Bugün/küçük adım/recovery | R01 R02 | S02 S06 U04 |
| R04 | Temel hatırlatma/eylem | R01 R02 | S03 S04 U01 |
| R05 | Rutin ve odak | R02 R03 R04 | S02 S04 U01 |
| R06 | Uygulama içi sade ve erişilebilir deneyim | R03 R05 | S06 S04 |
| R07 | Günlük/duygu/review | R01 R02 R03 | S03 S06 U04 |
| R08 | Tam yedek/restore | R02 R07 | S05 U03 |
| R09 | Onaylı iç AI eylemleri | R02 R03 R07 | S04 S05 U06 |
| R10 | Çekirdek kalite ve kapsam kabulü | R00–R09 | S01 S04 S09 |
| R11 | Çekirdek kullanıcı değerlendirmesi ve kapanış | R10; erken denemeler R03/R05/R07'de | S04 S06 U04 |

Kilometre taşları: R00–R02 veri doğruluğu; R03–R05 gerçek davranış akışı; R06–R09 bütünleşmiş çekirdek; R10–R11 kapsam kabulü. R11'in başlangıcı store submission'a bağlı değildir. İşlevsel etkileşim testleri mevcut uygun test ortamında yürütülür. Ertelenmiş fiziksel cihaz performans/store QA paketi yeniden giriş şartı yapılmaz.

**İlk uygulama:** R00 fark kaydı, ardından R01 haftalık esnek hedefin gerçek tüketici düzeltmesi. İhtiyaç yoksa yapılmış işi tekrar yazma. İlgisiz kapalı denetimler yeniden açılmadan mevcut geçerli kanıt devralınır.

<a id="isler"></a>
## 6. Ayrıntılı iş paketleri

Aşağıdaki kutular “bugün hepsi eksik” anlamına gelmez; kabul envanteridir. R00'da güncel kod ve kanıt eşleşen kartlar devralınır; yalnız açık fark uygulanır. Fazın sorumlusu/skill/risk/geri dönüşü her alt karta miras kalır. Bölüm 7–9'daki ilgili sözleşmeler paketin kabulünün parçasıdır.


### R00 — Fark envanteri ve uygulama zemini

**Sorumlu:** Teknik/ürün sahibi. **Skill:** S01 S06 S08. **Risk:** Eski eksikleri yeniden geliştirmek. **Geri dönüş:** Plan/kart değişikliğini geri al; veri değişikliği yok.

- [ ] **R00.01 (S):** Çalışma SHA'sını, branch'i ve repo talimatlarını oku. 13 Eylül kapsam ekini uygulama kaydına bağla; daha yeni owner kararı varsa açıkça kaydet.
- [ ] **R00.02 (M):** Her R kartı için UI giriş noktası, service, repository, kalıcılık ve mevcut kanıtı eşle. Sonuç `REUSE`, `EXTEND`, `NEW`, `DEFERRED` olsun. Dosya adından PASS çıkarma.
- [ ] **R00.03 (M):** Bugün → küçük adım → rutin/odak → recovery → review yolculuğunu mevcut ekranlarda haritala. Ana navigasyonu çoğaltma. Beş ila sekiz hedef kullanıcıyla ilk anlaşılabilirlik turunu planla; bu sayı pazar veya klinik genelleme sağlamaz.
- [ ] **R00.04 (M):** Test hedefini, sentetik A/B hesaplarını ve veri sınırını belirle. Mevcut yetkili ortamı kullan; EAS profil adından staging sonucu çıkarma. Canlı yazma yoksa yalnız ilgili entegrasyon kanıtını beklet.
- [ ] **R00.05 (M):** Kurulu SDK, lockfile, Node/npm ve test komutlarını doğrula. Mevcut emülatör/simülatör/development build erişimini kaydet; fiziksel cihaz profiling veya store hesabını çekirdek başlangıç şartı yapma.
- [ ] **R00.06 (S):** Ücretsiz MVP, kapalı gate'ler, ertelenen dağıtım ve iptal edilen özellikleri tek kapsam kaydına bağla. Mevcut owner kararını tekrar sorarak işi durdurma.
- [ ] **R00.07 (S):** İlk üç küçük kartın geliştirme, test ve düzeltme sürelerini ayrı ölç. Eforu buradan tahmin et; eksik erişim süresini kod süresiyle karıştırma. Bir preview üzerinde çakışan yazıcı çalıştırma.

**Kabul:** Güncel envanter, korunacak veri, fark listesi ve ilk READY kart hazır. Kodda zaten karşılanan kabul tekrar kodlanmaz; çelişen eski test gerekçeli güncellenir, kusuru gizlemek için silinmez.


### R01 — Hedef, takvim, kayıt ve geçmiş

**Sorumlu:** Habit domain. **Skill:** S02 S03 S04. **Risk:** Geçmiş başarıların değişmesi. **Geri dönüş:** Eski veriyi koruyan sürümlü okuyucu ve yeni motor flag'i; kullanıcı kaydı silinmez.

- [ ] **R01.01 (M):** Günlük uygunluk ile haftalık/aylık dönem başarısını ayır. Gün, oturum ve miktar hedeflerini açık birimle tanımla; açık dönem başarısız sayılmasın.
- [ ] **R01.02 (L):** Günlük, sabit hafta günü, esnek hafta/ay, her N gün, tarih aralığı ve yıllık tarih kurallarını kanonik değerlendiricide tamamla. Ayın 29/30/31'i, yıllık 29 Şubat ve hafta başlangıcı davranışı açık olsun.
- [ ] **R01.03 (M):** Boolean/numeric/duration/abstinence ve `at_least/at_most` kurallarını, kısmi kayıt ve geri almayı tüm tüketicilerde birleştir. Kayıt yokluğu otomatik kaçınma başarısı değildir.
- [ ] **R01.04 (M):** Alışkanlık checklist'i, gün/oturum instance'ı, zorunlu/isteğe bağlı alt adım ve kısmi ilerleme ekle. Görev alt listesini aynı şey varsayma.
- [ ] **R01.05 (M):** Skip, alışkanlık pause ve tatil modunu ayrı modelle; hedef/payda/seri/bildirim etkisini göster. Hedef ve takvim değişiklikleri etkin tarihle sürümlensin.
- [ ] **R01.06 (L):** Bugün, detay, rapor, kapasite, recovery, AI planı ve bildirim planlayıcısını aynı hesap çıktısına geçir. Yerel gün ve timezone kaydı tek sözleşmeden gelsin.
- [ ] **R01.07 (M):** Aynı tarih fixture'larını bütün tüketicilerde doğrula; şema değişikliği eklemeli olsun, eski kayıt sayımları uzlaşsın.

**Kabul:** Salı/Perşembe/Pazar haftada üç farklı günü tamamlar; aynı gün üç kayıt üç farklı gün sayılmaz; ay ortasındaki eksik aylık hedef henüz başarısız değildir; 20 dakika hedefte 10 kısmi; en çok 2 hedefte 1 başarılı/3 başarısız; bugünkü hedef değişimi geçmişi bozmaz; DST/gece yarısı/Şubat tüm ekranlarda aynıdır.



### R02 — Kalıcı veri ve senkronizasyon

**Sorumlu:** Veri/platform. **Skill:** S05 S07 U02. **Risk:** Kayıp/çift işlem ve hesap karışması. **Geri dönüş:** Eski depo okunabilir kalır; yeni queue silinmez; geçiş ileri düzeltmeyle kurtarılır.

- [ ] **R02.01 (M):** Offline matrisi çıkar. Alışkanlık/kayıt, checklist/pause, Bugün görevleri, rutin/odak, günlük/review ve ayarlar çekirdekte yerel okunup yazılır; AI/provider çağrısı ağ gerektirir. Diğer mevcut modüllerin davranışı açık etiketlenir ve bozulmaz.
- [ ] **R02.02 (M):** Mevcut kuyruk/depo yeterliliğini ölç; ilişkisel kalıcı depo için SQLite adayını mevcut sürüm ve migration maliyetiyle seç. Toplu yeniden yazma veya bütün cihaz/sunucuyu tek transaction'da uzlaştırma vaadi yok.
- [ ] **R02.03 (L):** Yerel değişiklik + outbox aynı yerel transaction'da kaydedilsin. Kullanıcı/operationId/varlık sürümü kalıcı olsun; tekrar teslimat sunucuda tek iş etkisi üretsin.
- [ ] **R02.04 (M):** Artan beklemeli retry, auth yenileme, bağımlı komut sırası ve bekleyen/hatalı işlem görünürlüğü ekle. Aynı ID farklı payload ile reddedilsin.
- [ ] **R02.05 (M):** Veri türüne göre çatışma politikası kur: olayları kimlikle birleştir, aynı notta çatışan sürümü koru, hedef değişiminde eski onayı sessiz uygulama. Silmeler için tombstone ve geç olay kuralı yaz.
- [ ] **R02.06 (M):** Logout, hesap değişimi, token expiry ve hesap silmede A/B cache ve queue ayrımını uygula. Gönderilmemiş veriyi kullanıcıdan habersiz silme veya diğer hesapla gönderme.
- [ ] **R02.07 (M):** Mevcut AsyncStorage/queue verisini sayım ve sürüm kontrolüyle aşamalı taşı. Yeni sürüm doğrulanmadan eski kaydı kaldırma; yeni şemayı eski istemciyle güvenli çalıştır.
- [ ] **R02.08 (M):** Uçak modu, app kill, timeout, out-of-order teslim ve iki cihaz çatışmasını kontrollü fixture ile test et; tanılamada içerik/token tutma.

**Kabul:** 24 saat offline 100 karışık çekirdek eylem, yeniden başlatma ve ağ dönüşünde kayıpsız uzlaşır; aynı komut beş retry'da tek etki yaratır; A kuyruğu B hesabına taşınmaz; silinmiş öğe geç edit ile geri doğmaz. Bu dayanıklılık hedefidir, gerçek dünyada mutlak sıfır hata garantisi değildir.



### R03 — Bugün, küçük başlangıç, kapasite ve telafi

**Sorumlu:** Ürün/domain. **Skill:** S02 S06 U04. **Risk:** Kullanıcıyı aşırı planlamak veya planı izinsiz değiştirmek. **Geri dönüş:** Öneri katmanını kapat; gerçek görev/kayıt ve eski plan korunur.

- [ ] **R03.01 (M):** Bugün ekranını öncelik, mevcut yük, sıradaki uygulanabilir adım ve devam eden oturum etrafında düzenle. Mevcut proje/OKR/notes/reading/yaşam alanlarına bağlamsal erişim korunsun; hepsini ana ekrana yığma.
- [ ] **R03.02 (M):** “Bugün daha az yapabilirim” gibi kullanıcı kontrollü yük seçimi ekle. Kapasite skorunun nasıl üretildiğini kısa açıkla; bir tıbbi ölçüm veya kesin irade bütçesi olarak sunma.
- [ ] **R03.03 (M):** Küçük başlama eylemi: kullanıcı bir işi seçer, ilk somut adımını/süresini düzenler ve başlatır. Süreyi küçültmek görevi otomatik tamamlamaz; asıl hedef ve bugün seçilen alt adım ayrı kalır.
- [ ] **R03.04 (M):** Kapasite/kuyruk/ustalığı R01 dönem motoruyla bağla. Bekleyen alışkanlığın neden beklediğini ve nasıl aktive edileceğini göster; kullanıcı açıkça öneriyi geçersiz kılabilir.
- [ ] **R03.05 (M):** Recovery'de bugün yap, ileri tarihe taşı, miktarı böl, bilinçli atla seçeneklerini gerçek eksik kayıt/döneme bağla. Taşınan iş yeni güne ek yük yaratıyorsa önizlemede göster.
- [ ] **R03.06 (M):** Hedef/proje/görev/alışkanlık/odak ilişkisini tek yönlü ve açıklanabilir tut. Manuel hedef yüzdesi ile kayıttan hesaplanan ilerleme ayrıdır; döngü ve çift puan yoktur.
- [ ] **R03.07 (M):** Akış içinde kısa açıklamalar yaz: “ilk adımı seç”, “yükü hafiflet”, “mola sonrası dön”. Metinler klinik iddia taşımaz, ayrı içerik platformu gerektirmez; mevcut dil/erişilebilirlik sistemini kullanır.
- [ ] **R03.08 (M):** Kullanıcı denemesinde öncelik seçme, küçük adım başlatma ve telafi seçimini izle. Bulunan engeli somut ekran/eylem kartına dönüştür; soyut “UX iyileştir” işi açma.

**Kabul:** 30 birim eksik 15+15 olarak planlanır; toplam eksik büyümez, geçmişe sahte başarı yazılmaz. Hafif gün seçimi açık onay olmadan bütün hedefleri kalıcı değiştirmez. Kullanıcı öneriden çıkıp manuel planına dönebilir. Başlatma öncesinde yeni FP/XP kazanımı oluşmaz.



### R04 — Hatırlatıcılar ve bildirimden işlem

**Sorumlu:** Mobil/native. **Skill:** S03 S04 U01. **Risk:** Yanlış/tekrarlayan bildirim. **Geri dönüş:** Kendi tetik kimliklerini iptal et; kullanıcı kuralları kalır.

- [ ] **R04.01 (L):** Tek günlük tetik yerine R01 takvimini kullanan planlayıcı kur. Tamamlanan dönem, pause, tatil ve hedef/saat değişikliğinde bildirimleri uzlaştır.
- [ ] **R04.02 (M):** Çoklu saat, gün grubu, erteleme, sessiz saat ve kullanıcı tarafından kapatma ekle. OS gecikmesi veya izin reddi çalışıyor gibi gösterilmesin.
- [ ] **R04.03 (M):** Bildirimden tamamla, miktar ekranını aç, ertele ve bugünü atla eylemlerini R02 komutlarına bağla. Aynı bildirim iki kez işlendiğinde tek kayıt oluşsun.
- [ ] **R04.04 (M):** App açılışı, yeniden başlatma, timezone/DST ve plan değişiminde eski tetikleri temizle. OS bekleyen bildirim limitini doğrulayıp gerektiğinde ileri pencere planla.
- [ ] **R04.05 (M):** Uygun iOS/Android test ortamında izin yok, arka plan, app kill ve pil kısıtı matrisi uygula. Hassas başlıkları gizleme tercihi olsun; yerel bildirim için gereksiz uzak push altyapısı kurma.
- [ ] **R04.06 (S):** Konum/zincir/NFC gibi ertelenen tetikleri LATER kaydına bağla; UI'da çalışmayan seçenek sunma. Güncel resmî API ve alarm izinlerini uygulama sırasında doğrula.

**Kabul:** Pazartesi/Perşembe alışkanlığı Salı hatırlatılmaz; biten haftalık hedef gereksiz uyarı almaz; pause bütün ilgili tetikleri durdurur; iki kez dokunma tek kayıt yaratır. OS'nin gecikmesini sıfırlama garantisi verilmez. [Expo bildirimler](https://docs.expo.dev/versions/latest/sdk/notifications/)



### R05 — Rutin yürütme ve odak

**Sorumlu:** Mobil/domain. **Skill:** S02 S04 S06 U01. **Risk:** Kayıp oturum, yanlış aktif süre, sahte tamamlama. **Geri dönüş:** Yeni runner girişini kapat; kalıcı oturumları okunabilir tut.

- [ ] **R05.01 (M):** Şablon, şablon sürümü ve çalışan oturum snapshot'ını ayır. Önceki AI rutin önerisini çalıştırıcı varlığı sayma.
- [ ] **R05.02 (L):** Başlat/pause/sürdür/geç/geri dön/bitir ve sıradaki adım ekranını kur. Atlanan adım yapılmış sayılmaz; tamamlanan adımın düzenlenmesi açık olur.
- [ ] **R05.03 (M):** Başlangıç/bitiş, aktif süre, pause ve oturum durumunu kalıcı sakla. `setInterval` tek zaman kaynağı olmaz; app kill, resume ve cihaz saati değişiminde uzlaştır.
- [ ] **R05.04 (M):** Çalışan oturuma adım ekleme/çıkarma/sıralama ve süre düzeltme ekle. Şablona uygulama ayrıca seçilsin; bir oturum değişimi tüm rutinleri değiştirmesin.
- [ ] **R05.05 (M):** Sesli adım duyurusu, titreşim, sessiz ve ekran okuyucu uyumunu kur. Kulaklık/arama/audio focus kesintilerinde tekrar duyuru fırtınası olmasın.
- [ ] **R05.06 (M):** Geri sayım, kronometre, Pomodoro çalışma/mola ve mevcut deep-work akışını ortak süre sözleşmesine bağla. Mola aktif çalışmaya veya XP'ye katılmaz.
- [ ] **R05.07 (M):** Oturumu görev/alışkanlıkla bağla; özet, log ve rapor tek etkiden beslensin. Tamamlanma için kullanıcı eylemi gerekiyorsa salt sürenin dolmasını tamamlandı sayma.
- [ ] **R05.08 (M):** Mevcut test ortamında kesinti/yeniden açılış ve kullanıcı testi yap; fiziksel cihaz release QA paketini DEFERRED kaydında tut. Sabah/akşam/çalışma için az sayıda düzenlenebilir şablon sun; sağlayıcı/müzik bağlantısı temel runner'ın bağımlılığı olmasın.

**Kabul:** 20 dakikalık çalışmada 5 dakika mola aktif süreye katılmaz; kapanan uygulama tutarlı oturuma döner; oturum içi değişiklik şablonu izinsiz bozmaz; sessiz modda konuşmaz; bir süre kaydı iki kez puan üretmez.



### R06 — Uygulama içi sadelik, erişilebilirlik ve mahremiyet

**Sorumlu:** Ürün/mobil. **Skill:** S06 S04. **Risk:** Görsel cila adına işlev kaybı. **Geri dönüş:** Mevcut route ve veri korunarak bileşen değişikliği geri alınır. **Sınır:** Eski v2 R06 widget işleri D02'ye taşındı; burada native yüzey geliştirilmiyor.

- [ ] **R06.01 (M):** Mevcut tasarım sistemi ve en tutarlı ekranı tespit et. Token/bileşen kullanımını yay; yeni UI kit veya tüm ekranları yeniden tasarlama işi açma.
- [ ] **R06.02 (M):** Bugün ekranında tek baskın “başla/devam et” eylemi kur. Kapasite ve kalan süre özeti kısa olsun; ikincil yönetim işleri bağlamsal menüye taşınsın. Proje/not geçmişine erişim korunsun.
- [ ] **R06.03 (M):** Checklist, hedef düzenleme, recovery ve review için ortak form/önizleme/hata bileşenlerini kullan. İptal ve geri eylemi veri kaybetmesin; tekrarlanan onay ekranları gereksiz sürtünme yaratmasın.
- [ ] **R06.04 (M):** Büyük yazı, semantik roller, anlamlı etiketler, odak sırası, kontrast ve azaltılmış hareketi destekle. Dokunma alanları platforma uygun olsun; yalnız accessibilityLabel sayarak tamamlandı deme.
- [ ] **R06.05 (M):** Mevcut hassas içerik gizleme tercihlerini bildirim ve uygulama önizlemesine uygula. Yeni biyometrik/native lock altyapısını zorunlu genişleme yapma. Günlük ve AI metnini hata loglarında gösterme.
- [ ] **R06.06 (M):** Bölüm 8 ekran durumlarını uygun render/test ortamında doğrula. Sonuçta ekran, veri seti, metin taşması, odak ve eylem kanıtı yaz; gözlenmemiş animasyon/performance puanı verme.

**Kabul:** Aynı işlem aynı bileşen diliyle yapılır; ana akışta bozuk/ertelenmiş CTA yok; kullanıcı hata veya offline durumda ne olduğunu anlar; sadeleştirme kullanılan veriyi erişilemez yapmaz.


### R07 — Günlük, duygu ve haftalık değerlendirme

**Sorumlu:** Ürün/veri. **Skill:** S03 S06 U04. **Risk:** Geçmiş anlamını bozma, yetersiz veriden kesin sonuç çıkarma. **Geri dönüş:** Yeni analiz kartını kapat; ham kayıt ve eski okuyucu korunur.

- [ ] **R07.01 (M):** Metin günlüğü, temel biçimlendirme, etiket ve rutin/alışkanlık bağlantısını tamamla. Eski not/günlük kayıtları kayıpsız açılır; çevrimdışı taslak korunur.
- [ ] **R07.02 (M):** Özelleştirilebilir duygu adı/ikon/yoğunluk ve günde birden fazla kayıt ekle. Geçmiş duygu kimliği/sıralaması sürümlensin; ad değiştirmek geçmişi yeniden yorumlamasın.
- [ ] **R07.03 (M):** Tarihçe, takvim, arama ve etiket filtresi sun. Yeni ses/fotoğraf/dosya altyapısı açma; mevcut ekli kayıt varsa görünürlüğünü ve taşınmasını koru.
- [ ] **R07.04 (M):** Gün/hafta/ay başarı, miktar ve süre raporlarını R01'den üret. Açık dönem, pause, eksik kayıt ve kısmi başarı için ikinci hesap yazma.
- [ ] **R07.05 (L):** Duygu–alışkanlık ilişkisini açıklanabilir kur: zaman penceresi, geçerli eşleşmiş gün, aynı gündeki kayıt özeti ve eksik veriyi belirt. Başlangıçta 14 eşleştirilmiş gün, karşılaştırılan her grupta 5 gün altı için “yetersiz veri” ürün eşiği kullan; bu eşik istatistiksel/klinik kanıt değildir.
- [ ] **R07.06 (M):** Haftalık review'de ne işe yaradı, yük neydi, gelecek hafta ne değişecek sorularını kayıt ve planla bağla. Yalnız grafik göstermeyip kullanıcının seçtiği bir sonraki eylemi sakla.
- [ ] **R07.07 (M):** Sayısal fixture, erişilebilir grafik metni ve kullanıcı anlaşılabilirlik testi yap. “Birlikte görülüyor” ile neden-sonuç iddiasını ayır; paylaşım öncesi özel içerik seçimi olsun.

**Kabul:** Kayıtsız günler düşük duygu olarak doldurulmaz; üç günlük veri güçlü ilişki iddiası üretmez; rapor ve detay aynı sayıyı verir; duygu adı değişimi geçmişi bozmaz; haftalık öneri kullanıcı seçmeden planı değiştirmez.



### R08 — Tam yedek, restore ve veri taşıma

**Sorumlu:** Veri/platform. **Skill:** S05 U03. **Risk:** Eksik yedeğin tam sayılması veya restore ile puan/kayıt çoğalması. **Geri dönüş:** Dry-run ve staging; mevcut kullanılabilir veriyi koruyan kontrollü commit.

- [ ] **R08.01 (M):** Tam veri registry'si ve sürümlü yedek formatı tanımla. Mevcut alışkanlık, hedef geçmişi, log, görev/proje/OKR, not/okuma/yaşam alanı, recovery, rutin/focus, günlük/review, ayar ve kullanıcıya ait konuşma verisini kapsa.
- [ ] **R08.02 (M):** Koleksiyon sayısı, ilişki kimliği, format sürümü ve checksum içeren manifest üret. Büyük veride sayfalama kesilmesin; 5.000 kayıt sınırı tam yedek akışında sessiz veri kaybı yaratmasın. Eşzamanlı değişim için tutarlı snapshot/pencere kuralı olsun. Son başarılı yedeği koruyan sınırlı otomatik yerel rotasyon ve son başarı durumu ekle; OS çalıştırmadığında yedek alınmış gibi gösterme.
- [ ] **R08.03 (M):** Dosya bütünlüğü, sürüm, sahiplik, kimlik eşleme ve çakışmayı veri değiştirmeden dry-run ile göster. Hassas yedek dosyası için OS koruması/uygun şifreleme ve anahtar kurtarma sınırını açıkça seç; özel kripto algoritması yazma.
- [ ] **R08.04 (L):** Yetkili kontrollü restore: güvenli birleştirme, devam etme/iptal, tekrar aynı dosya dedup'ı ve tutarlı son durum. İstemciden trigger kapatma veya toplu tablo temizleme yok.
- [ ] **R08.05 (M):** XP/FP, abonelik hakkı ve OAuth/API sırları dosyadan otorite gibi içeri alınmasın. Kaynak geçmiş gösterimi sunucuda uzlaştırılsın; restore yeni kazanım üretmesin. Hesap silme ve saklama politikasıyla uyumlu olsun.
- [ ] **R08.06 (M):** Genel CSV alan eşleme/önizleme/duplicate raporu kur. Habitify/Daylio adaptörlerini yalnız gerçek anonim export örneği bulunursa doğrula; bulunmazsa ilgili adaptör LATER kalır ve destek iddiası yapılmaz. Genel CSV'nin kabulü bağımsızdır.
- [ ] **R08.07 (M):** 5.000 üzeri kayıtlı hesap, eski format, yarım ağ, bozuk parça, aynı yedeğin tekrarı ve başka test hesabına restore tatbikatı yap. Sayım/ilişki/hash uzlaşmasını kaydet; dosya indirmek geri yükleme kanıtı değildir.

**Kabul:** Yayımlanan bütün kullanıcı veri türleri geri döner; eksik/bozuk yedek mevcut veriyi bozmaz; ikinci restore kopya veya ödül üretmez. JSON/CSV dışa aktarma ile sürümlü tam yedek kullanıcıya farklı isimlerle sunulur.



### R09 — Uygulama içi eylem yapan AI

**Sorumlu:** AI/backend/domain. **Skill:** S04 S05 U06. **Risk:** Yanlış varlık/tarih, izinsiz plan değişimi, çift maliyet. **Geri dönüş:** Yeni eylemleri ayrı flag'le kapat; mevcut sohbet/öneri/log çalışır.

- [ ] **R09.01 (M):** Kapanmış request-id/replay/lease/FP maliyet davranışlarını koru. Yeni değişiklik dokunmadığı alanı tekrar denetim projesine çevirme; ilgili regresyon fixture'larını devral.
- [ ] **R09.02 (M):** Dar eylem listesi tanımla: kayıt, hedef/saat düzenleme, pause, görevi taşıma ve küçük adım önerme. Her eylem mevcut domain komutuna gider; serbest SQL veya geniş yetkili araç yok.
- [ ] **R09.03 (M):** Doğru varlık, tarih, birim ve etki önizlemesi sun. Belirsiz adayda soru sor; kullanıcı onayı ile sürüm değişmişse yeniden önizle. İptal geri dönülmez yan etki üretmesin.
- [ ] **R09.04 (L):** “Bu hafta yorgunum” niyetini düzenlenebilir yük azaltma önerisine dönüştür. Mevcut süre/bağımlılık/kapasiteyi kullan; aynı genel alt görev listesini her niyete basma; hiçbir hedef kendiliğinden değiştirilmez.
- [ ] **R09.05 (M):** R07 içgörülerini kayıt/dönem/örneklemle açıkla. Günlük bağlamı ayrıca kullanıcı kontrolünde olsun; modelin ürettiği sayı hesap otoritesi olmasın. Silinmiş/izin verilmemiş içerik yeni prompt'a girmez.
- [ ] **R09.06 (M):** Timeout, provider yok, offline ve maliyet sınırı akışlarını tamamla. Yerel şablon fallback'i AI cevabı gibi sunma; retry veya başarısız işlem ikinci tahsilat üretmesin.
- [ ] **R09.07 (M):** 60 geçerli, 20 belirsiz, 10 yetki/talimat enjeksiyonu, 10 iptal/retry/çökme senaryosuyla mevcut ve yeni araçları değerlendir. Metnin akıcılığını araç/argüman/yan etki doğruluğundan ayrı ölç.

**Kabul:** “Bunu yarına al” belirsizse sorar; onaylanan hedef/tarih uygulanır; eski onay yanlış sürüme yazmaz; retry ikinci iş/ücret üretmez; başka hesap verisi çıkmaz. MCP geliştirilmediği için bu faz bloklanmaz.



### R10 — Çekirdek kalite kabulü

**Sorumlu:** Teknik sahibi ve uygun reviewer. **Skill:** S01 S04 S05 S09. **Risk:** Implementation ile store yayınının karışması. **Geri dönüş:** Hatalı değişikliği sınırlı flag/ileri düzeltmeyle geri al, veri korunur.

- [ ] **R10.01 (S):** Mevcut ücretsiz MVP davranışını koru; paywall/IAP açma. Eski fiyat config'ini gelir kanıtı veya satın alınabilir ürün sayma. FP ekranı gerçek bakiyeyi göstersin.
- [ ] **R10.02 (M):** R01–R09 yeni eylemlerinde kayıt/XP/FP tek etkisini ve başarısız işlem geri dönüşünü doğrula. Burada satın alma sandbox'ı eklenmez; mevcut kredi ekonomisi korunur.
- [ ] **R10.03 (S):** Mevcut Sentry bağlantısı/source-map kazanımını devral. Yeni kodun hassas bilgi loglamadığını kontrol et. Runtime smoke kapanışını D07 olarak bırak; başarı üretmek için sentetik olayı canlıya kendiliğinden gönderme.
- [ ] **R10.04 (M):** Yeni tablo/cache/outbox/taslak/arka plan işlerini hesap silme ve hesap değiştirme kapsamına al. Silinmiş hesap geç retry ile yeniden oluşmasın.
- [ ] **R10.05 (M):** Türkçe/İngilizce metin, tarih, birim, hafta başlangıcı, boş durum ve erişilebilir etkileşimleri çekirdek akışta kontrol et. Mevcut dil desteğini veri göçü gerektiren key değişimiyle bozma.
- [ ] **R10.06 (M):** İlgili domain/component/integration testlerini ve mevcut CI komutlarını çalıştır. Büyük liste pagination ve restore yük testlerini kontrollü ortamda doğrula; gerçek cihaz performans profiling D07'de kalır.
- [ ] **R10.07 (M):** Yeni davranışın dokunduğu RLS/grant/owner/AI araç/restore risklerini doğrula. Kapanmış Step 4 veya tüm canlı güvenlik denetimini gerekçesiz tekrar açma.
- [ ] **R10.08 (S):** Beş kapalı gate ve iptal ailelerinin korunmasını mevcut testlerle kontrol et. PUBLIC_SITE_URLS_LIVE false kalır; store/web dosyalarını yayınlamadan koru.
- [ ] **R10.09 (M):** Çekirdek kabul raporu üret: biten işler, kanıt, gerçek açıklar, deferred işler ve kapsam dışı işler ayrı olsun. Bu turda bağımsız reviewer yoksa bağımsız PASS yazma. Store hold kararı değişmeden kalabilir.

**Kabul:** Çekirdek gerçek kullanıcı eylemleri uygun test ortamında çalışır; bilinen kritik veri/erişim/FP kusuru açık değildir. Ertelenmiş işlerin yapılmaması çekirdek tamamlanma oranını düşürmez; yayın hazır olduğuna dair iddia da üretmez.


### R11 — Kullanıcı sonucu, kalite ölçümü ve kapanış

**Sorumlu:** Ürün/QA. **Skill:** S04 S06 U04. **Risk:** Hedef notunu gerçekleşmiş saymak. **Geri dönüş:** Yanlış puan ve öncelik düzeltilir; ham kanıt saklanır.

- [ ] **R11.01 (S):** CP/CE ağırlıkları, görevler ve değerlendirme ortamını dondur. Eski P/E tablosuyla payda farkını kaydet; kullanıcı testinde bulunmayan ölçümü N/R bırak.
- [ ] **R11.02 (M):** Keşif ve düzeltme doğrulama olmak üzere iki küçük tur planla. Tur başına 5–8 hedef kullanıcı başlangıç örneklemidir; eksik kullanıcı erişimini klinik veya pazar genellemesiyle örtme.
- [ ] **R11.03 (M):** Haftalık hedef, küçük başlama, runner kesintisi, recovery, review, restore ve AI onay görevlerini ölç. Yardımsız başarı, süre, yardım sayısı ve yanlış yan etki ayrı kaydedilsin.
- [ ] **R11.04 (M):** CP/CE hedeflerinin hangi kabul ve gözlemle karşılandığını raporla. Fiziksel cihaz/operasyon kanıtı yoksa o alanı N/R tut; çekirdek implementation'ı store QA bekliyor diye eksik sayma.
- [ ] **R11.05 (M):** Bulunan her kusuru tek davranışlı küçük karta çevir; bu turda değişen kusuru tekrar test et. Kanıtlanan sonuç kabul edildiyse yeni teorik QA döngüsü başlatma.
- [ ] **R11.06 (S):** CORE_IMPLEMENTATION, CORE_QUALITY ve RELEASE_READINESS sonuçlarını ayrı kapat. Ertelenen feature'ı kendiliğinden açma. 9–9,5 hedefi ölçülmediyse “hedef, henüz kanıtlanmadı” yaz.

**Kabul:** Başka biri aynı verilerle hesapları tekrar üretebilir. Tamamlanma ve kalite kanıtı birbirinin yerine geçmez. Rakip uygulamalara erişim yoksa karşılaştırmalı üstünlük iddiası bekletilir; sırf rakip hesabı yok diye karşılanmış çekirdek kod işleri yeniden açılmaz.


<a id="sozlesmeler"></a>
## 7. Derin uygulama sözleşmeleri

Bu bölüm üst paketlerin nasıl uygulanacağını belirler. Bunlar yeni bağımsız modüller değil; R01–R09 kabul ayrıntılarıdır. Mevcut eşdeğer yapı varsa isim değiştirip ikinci bir sistem kurma. Önerilen varlık adları örnektir; güncel şemada varmış gibi kabul edilmez.

### 7.1 Kanonik hedef motoru — R01

**Girdi sözleşmesi:** alışkanlık kimliği, ölçüm türü, hedef yönü, hedef miktarı/birimi, dönem türü, timezone, hafta başlangıcı, etkin tarihli hedef sürümü, kayıtlar, skip/pause aralıkları. Tamamlanma tarihi ile sunucuya ulaşma tarihi ayrı tutulur. Gün `UTC string.slice(0,10)` ile türetilmez.

**Çıktı sözleşmesi:** dönem başlangıç/bitişi, uygunluk, sayılan birim, gerçekleşen miktar, kalan miktar, durum ve gerekçe. Durum en az `not_started`, `in_progress`, `satisfied`, `closed_unmet`, `paused`, `unknown` anlamlarını ayırır. Kullanıcıya gösterilen Türkçe etiketler API enum'uyla karıştırılmaz.

| Kural | Uygulama kararı | Karşı örnek |
|---|---|---|
| Haftada 3 farklı gün | Yerel günleri unique say | Salı üç kayıt, üç gün değildir |
| Haftada 3 oturum | Tamamlanan oturum kimliklerini say | Aynı retry ikinci oturum değildir |
| Ayda 10 kez | Açık ayda kalan sayıyı göster | Ayın 12'sinde eksik diye başarısız ay yazma |
| En az 20 dakika | Aktif süre toplamı; 10 dakika kısmi | Pause süresi hedefe eklenmez |
| En fazla 2 adet | Dönemin kapanış ve kullanıcı teyit anlamını belirle | Sabah 1 kayıt, gün sonunda 3 olduğunda eski başarı kesinleşmiş kalmaz |
| Kaçınma | Kullanıcı teyidi ile veri yokluğu ayrı | Hiç kayıt girmeyen güne otomatik başarı yazma |
| Her N gün | Başlangıç yerel günüyle takvim farkı | DST günü 24 saatten farklı diye kaydırma |
| Ayın 31'i | Atla/son güne taşı seçimini açıklaştır | Sessizce Şubat 28'e farklı politika uygulatma |
| Tatil/pause | Etkin günlere ve hedef paydasına açık politika | Geçmiş haftaların oranını sessiz değiştirip yükseltme |
| Hedef küçültme | Etkin tarihli yeni sürüm | Önceki 30 dakika hedefini bugünkü 10 dakika diye yeniden puanlama |

**Tüketici geçişi:** önce saf evaluator testleri; ardından service; sonra Bugün ve detay; sonra review/recovery; en son notification/AI araç doğrulaması. Eski ve yeni evaluator geçiş süresince aynı sentetik hesapta fark raporu üretebilir; çift yazma veya çift XP üretemez. `isDueOn` yorumlarını değiştirmenin tek başına davranış düzeltmesi olmadığını unutma.

**Checklist:** şablon adımı ile gün/oturum adım kaydı ayrıdır. Sonradan eklenen adım geçmiş tamamlanmış güne otomatik yüklenmez. Zorunlu adımlar başarıyı, isteğe bağlılar ayrıntıyı etkiler. Parent tamamlamanın child'ları tamamlayıp tamamlamadığı açık kullanıcı davranışı olarak seçilir; gizli bulk completion yoktur.

### 7.2 Recovery ve kapasite — R03

Kapasite, kullanıcının yükü yönetmesine yardımcı olan bir planlama modelidir. Tek bir puandan biyolojik irade, tükenmişlik veya DEHB şiddeti sonucu çıkarılmaz. Kullanıcı “öneri bana uymadı” diyerek yükü değiştirebilir.

**Recovery önerisinin alanları:** kaynak kayıt/dönem, eksik birim, önerilen dağılım, değişen günler, mevcut yük, kalan açık, oluşturulma ve onaylanan sürüm. İleri tarihe taşınan iş otomatik geçmiş başarısına dönüşmez.

**Örnek:** Pazartesi 30 dakika hedefte 10 dakika yapıldı. Eksik 20'dir. Salı/Çarşamba 10+10 önerisi toplam 20 olmalıdır; yeni 30+30 görev üretilemez. Salı 10 tamamlanınca açık 10 kalır. Önerinin tekrar onaylanması aynı işlere ikinci kez ekleme yapmaz. Kullanıcı Çarşamba planını zaten değiştirdiyse eski recovery onayı yeni önizleme ister.

**Dört yol:** bugün kalanını yap, başka güne taşı, parçalara böl, bilinçli atla. “Atla” geçmişte tamamlandı demek değildir. Süre hedefinde parçalama anlamlı olabilir; örneğin belirli bir etkinliğe katılma alışkanlığında anlamsız parçalama önerilmez.

**Başlama desteği:** görev bağlamı, eldeki zaman ve araçlar soruna uygunsa kullanılır. “Vergi belgelerini hazırla” için ilk adım “gerekli belgelerin listesini aç” olabilir; her görev için “araştır, planla, uygula” şablonu yeterli değildir. İki dakikalık başlangıç asıl görevin tamamı diye işaretlenmez. Kullanıcı öneriyi düzenleyip doğrudan başlatabilir.

### 7.3 Kalıcı kayıt ve senkronizasyon — R02

Ekran → store → service → repository sınırını koru. UI ve AI ayrı Supabase yazma yolları oluşturmasın. `operationId`, varlık kimliği, gerektiğinde `expectedVersion`, doğrulanan payload, yerel tarih/timezone ve kaynak bilgisi komut zarfında bulunur; sahiplik sunucuda oturumdan çözülür.

1. Girdiyi doğrula ve kimliği üret.
2. Yerel veri değişimini ve outbox kaydını aynı yerel transaction'da sakla.
3. Yerel kaydın durumunu kullanıcıya doğru göster: cihazda saklandı, eşitleme bekliyor.
4. Bağımlı komutları doğru sırayla gönder; auth problemi ile veri çatışmasını ayır.
5. Sunucu aynı operationId/payload için kayıtlı sonucu döndürür; farklı payload reddedilir.
6. Onay sonrası outbox durumunu kalıcı güncelle; uygulama kapanınca aynı işlemden devam et.
7. Çatışma varsa iki sürümü koru veya domain politikasını uygula; sessiz veri kaybı yok.

| Varlık | Çatışma stratejisi | Başarısızlıkta kullanıcı sonucu |
|---|---|---|
| Habit log / oturum olayı | Kimlikle birleştirme; tekrar tek etki | Kayıt cihazda kalır, pending görünür |
| Hedef/takvim | expectedVersion ve yeni önizleme | Eski hedef onayı sessiz uygulanmaz |
| Günlük/not | Çatışan içerik kopyasını koru | Kullanıcı iki sürümden seçim yapabilir |
| Silinmiş varlık | Tombstone ve eski edit reddi | Geç sync öğeyi yeniden doğurmaz |
| XP/FP | Sunucu otoritesi | İstemci hesabı puan/hak üretemez |
| Hesap A/B | Hesap bazlı DB/namespace/outbox | A verisi B oturumuyla gönderilmez |

**Göç:** mevcut depoyu oku → hedef şemaya dry-run dönüştür → sayım/kimlik/ilişki karşılaştır → yeni okuyucuyu aç → hata halinde eski veriyi hâlâ okuyabil. Göç tamamlanmadan eski kaydı silme. Şema versiyonu geri çevrilirken yeni kullanıcı verisi yok sayılmaz; ileri düzeltme gerekir.

SQLite bir adaydır, otomatik zorunluluk değildir. Güncel Expo dokümanı kurulu SDK ile karşılaştırılır. Veriyi ilişkisel saklamak tek başına sync motoru kurmuş olmak değildir. Özel bir sync servisi satın almak veya bütün store'ları yeniden yazmak, eksik outbox davranışının ilk çözümü sayılmaz.

### 7.4 Rutin ve süre state machine — R05

Şablon, şablon sürümü ve oturum snapshot'ı ayrı olur. Kullanıcının devam eden oturumdaki değişikliği şablona ancak ayrı seçimle uygulanır.

| Durum | İzinli eylem | Kalıcı sonuç |
|---|---|---|
| Hazır | Başlat | Oturum/snapshot ve ilk adım |
| Çalışıyor | Pause, adımı bitir, atla, oturumu sonlandır | Segment kapanışı ve yeni durum |
| Duraklatıldı | Sürdür, düzenle, sonlandır | Pause aralığı çalışma süresinden ayrılır |
| Kesinti sonrası belirsiz | Kaldığı yerden sürdür, süreyi gözden geçir, sonlandır | Kullanıcıya açıklanmış uzlaşma |
| Tamamlandı | Özeti gör; gerekiyorsa açık düzeltme | İkinci bitir çağrısı yeni log üretmez |
| İptal | Özeti gör; yeni oturum başlat | Yeni oturum yeni kimlikle başlar |

`setInterval` yalnız ekranı yeniler. Süre, segment başlangıç/bitiş ve pause olaylarından hesaplanır. Monoton saat süreç içinde yararlı olsa da process death sonrası tek başına yeterli değildir; kalıcı zaman ve yeniden açılış politikası gerekir. Cihaz saati oynadığında negatif veya sınırsız çalışma yazma.

**Kesinti politikası:** otomatik devam/pause varsayımı kullanıcıya görünürdür. Güvenilir biçimde bilinmeyen sürede sahte kesinlik üretme. Telefon görüşmesi/ses odağı kaybında sesli duyuru tekrar fırtınasına dönüşmez. Bu döngüde kontrollü lifecycle testi yapılır; ertelenen store cihaz QA ayrıca kayıtlı kalır.

**Pomodoro:** çalışma/mola/uzun mola geçişleri aynı oturum sözleşmesindedir. Mola XP veya aktif odak değildir. Süre dolunca tek bir durum geçişi oluşur. Oturum sonu; UI özeti, alışkanlık logu, görev ilerlemesi ve XP ledger'ında aynı kimliğe bağlanır.

### 7.5 Temel bildirim — R04

Bildirim planlayıcısı takvim motorunun tüketicisidir; ikinci bir frequency yorumlayıcısı değildir. İleri pencere için gereken tetikler hesaplanır, OS'de kayıtlı tetiklerle kimlik üzerinden uzlaştırılır. Güncellemede yalnız uygulamanın ilgili tetikleri iptal edilir.

- Tamamlanan dönem, pause, saat değişimi ve timezone değişimi eski planı geçersiz kılar.
- “Tamamla” Boolean kayda; miktar hedefi miktar girişine; “ertele” yeni tetik saatine gider.
- Eski bildirimde silinmiş hedef varsa güvenli bilgi gösterilir; hedef geri oluşturulmaz.
- İzin reddi açıkça gösterilir; kullanıcı ayara yönlendirilebilir, zorla tekrar tekrar izin istenmez.
- Widget/Live Activity/ongoing notification bu kartların gizli bağımlılığı olamaz.
- OS'nin uygulamayı zorla durdurması veya pil kısıtı altında dakikası dakikasına teslim garanti edilmez; kaynak testinden fiziksel teslim PASS'i çıkarılmaz.

### 7.6 Günlük ve analiz — R07

**Günlük:** hesap ve entry kimliğine bağlı taslak, kaydetme durumu, tekrar açılış, tarih, duygu, etiket ve temel biçim. Otomatik kaydetme varsa “cihazda kaydedildi” ile “sunucuya eşitlendi” farklıdır. Kayıt başarısızken başarı bildirimi yoktur. Uygulama kapandığında son doğrulanmış taslak geri gelir.

**Duygu:** duygu tanımı kalıcı kimlikle saklanır; ad/renk değişimi tarihçenin anlamını bozmaz. Silinen duygu geçmiş kayıtlarda tanınabilir kalır veya açık kullanıcı göçü yapılır. Aynı gün birden fazla kaydın özetlenme yöntemi belirtilir; eksik gün sıfır puan sayılmaz.

**İlişki kartı:** dönem, eşleşen gün sayısı, karşılaştırılan grupların büyüklüğü ve kullanılan ölçü gösterilir. R07'nin 14 eşleşmiş gün ve grup başına 5 gözlem eşiği yalnız aşırı erken yorumları engelleyen ürün filtresidir; istatistiksel anlamlılık garantisi değildir. Kullanıcının seçmediği onlarca ilişki arasından yalnız en çarpıcı sonucu gösterme. Başlangıçta birkaç önceden tanımlı ilişkiyle sınırla.

**Review:** “Ne tamamlandı?” yanında “Ne çok geldi?” ve “Gelecek hafta ne değişsin?” bulunur. Öneri planı otomatik değiştirmez; seçilen değişiklik preview ile R01/R03 komutuna gider. Kullanıcı önceki haftayı düzenlediğinde hesaplanan özet yenilenir; yazdığı değerlendirme metni yok olmaz.

### 7.7 Tam yedek ve restore — R08

Tam yedek ile CSV raporu ayrı ürün eylemleridir. Tam yedek, mevcut bütün kullanıcı verisinin dönmesine yarar; CSV raporu seçilen alanları analiz etmeye yarar. Yeni tablo her zaman registry'ye girer.

Önerilen manifest: formatVersion, oluşturulma zamanı, kaynak uygulama sürümü, koleksiyon listesi, kayıt sayısı, checksum, ilişki haritası, desteklenmeyen alanlar. Token/OAuth secret yedeğe konmaz; FP/XP ve abonelik hakkı dosyadan yeniden yetki olarak verilmez.

**Restore akışı:** dosyayı seç → şema/bütünlük denetle → ekle/güncelle/çakışma/atlanacak alan önizle → kullanıcı onayı → geçici staging veya iş günlüğü → kimlik eşleme → kontrollü uygulama → sonuç uzlaşması. Yarım kalan restore aynı job kimliğiyle sürer; yeniden başlatıldığında her şeyi ikinci kez eklemez.

Bozuk dosya mevcut veriyi silmez. Yerel backup rotasyonu son doğrulanmış yedeği başarısız yeni denemeyle değiştirmez. Şifreleme seçilecekse anahtar kaybının kurtarma sınırı açıklanır; kendi kriptografik algoritmanı yazma.

Import adaptörü ancak gerçek anonim örnekle doğrulanır. Habitify/Daylio formatı bilinmiyorsa hayali parser yok; genel CSV alan eşleme kullanılır. Tarih/birim/duygu kaybı önizlemede gösterilir. “Tam destek” sözü veri kaybı raporu saklanarak verilmez.

### 7.8 İç AI — R09

AI metin üretir, öneri oluşturur ve yalnız izinli domain komutlarını çağırır. Ham SQL veya geniş yetkili “her şeyi güncelle” aracı yoktur. Konuşma geçmişi kalıcıdır; seçilen thread'in bağlamı başka thread/hesapla karışmaz.

| Niyet | Doğru akış | Reddedilecek davranış |
|---|---|---|
| “Bu hafta yoruldum” | Süre/kapasite temelli hafifletme önerisi ve fark önizlemesi | Kalıcı hedefleri sessizce azaltmak |
| “Bunu yarına al” | Varlık belirsizse netleştir | Son görülen öğeyi tahminle değiştirmek |
| “10 dakika yaptım” | Alışkanlık, tarih, birim ve kayıt onayı | Her alışkanlığa 10 eklemek |
| “Sabah rutinini kısalt” | Seçili şablon mu aktif oturum mu ayrımı | İkisini aynı anda güncellemek |
| “Günlüğümü kullanma” | Yeni bağlam üretiminden çıkar | Özet cache'inden gizlice kullanmak |
| Aynı isteği tekrar gönder | Aynı requestId/payload sonucunu döndür | İkinci provider çağrısı/FP etkisi |

Onay önizlemesi süreli veya sürüm kontrollü olur. Kullanıcı onaylamadan önce hedef değiştiyse tekrar preview gerekir. “Geri al” yapılmışsa ters komut mevcut sürümle doğrulanır; arada başka değişiklik olduysa eski snapshot körlemesine basılmaz.

Başarısız provider çağrısı, timeout ve lease reconciliation mevcut Step 4 sözleşmesine uyar. Ücretsiz MVP sınırsız model maliyeti demek değildir; mevcut FP politikası korunur, gerçek bakiye gösterilir. Günlük içeriği telemetriye taşınmaz. Prompt injection içeren kullanıcı metni diğer hesaplara veya yeni yetkiye erişim vermez.

<a id="deneyim"></a>
## 8. Ekran bazında deneyim rehberi

Yeni görsel yön icat etmeden mevcut iyi ekranı referans al. “Premium” his; okunabilir hiyerarşi, hızlı eylem, tutarlı boşluk ve sakin geri bildirimle sağlanır. Altın renk, yoğun animasyon veya sürekli kutlama tek başına kalite değildir.

| Ekran | Birincil iş | Görünmesi gereken | Kaçınılacak |
|---|---|---|---|
| Bugün | Sıradaki işi başlat | Uygulanabilir adım, yük özeti, aktif oturum | Tüm modüllerin kart duvarı |
| Alışkanlık oluştur | Anlamı açık hedef kur | Tip, birim, dönem ve doğal dil özeti | “3 kez”in gün mü oturum mu olduğunun belirsizliği |
| Alışkanlık detay | Kayıt gir/ilerlemeyi anla | Dönem kalan miktarı, tarihçe, geri al | Sayı ile grafiğin farklı hesaplanması |
| Recovery | Gerçekçi dönüş seç | Kaynak eksik, dağılım ve yeni yük | Suçlayıcı dil, sahte geçmiş başarı |
| Runner | Şu anki adımı yürüt | Büyük süre/adım, pause, sıradaki iş | Oturum ortasında şablon yönetimi kalabalığı |
| Odak özeti | Ne yapıldığını doğrula | Aktif süre, mola, ilgili görev/log | Sırf sayaç bitti diye tam görev başarısı |
| Günlük | Düşünceyi kaybetmeden yaz | Taslak/kayıt durumu, duygu, tarih | Her cümlede modal veya zorunlu AI |
| Review | Sonraki planı seç | Kayıt özeti ve tek uygulanabilir değişiklik | Sadece dekoratif grafik |
| AI | İsteği doğru eyleme çevir | Thread, öneri farkı, onay ve gerçek sonuç | Akıcı metinle başarısız işlemi saklama |
| Veri yönetimi | Yedekle/geri yükle | Kapsam, son başarı, dry-run ve sonuç | CSV'yi tam yedek gibi adlandırma |

### 8.1 Her ekranda tamamlanacak durumlar

- İlk kullanım: ne yapılacağı belli; sahte geçmiş grafik yok.
- Veri var: gerçek kayıt ve birincil eylem görünür.
- Yükleniyor: yazılmış taslak silinmez; aynı işlem tekrar başlamaz.
- Boş sonuç: “kayıt yok” ile “erişim/bağlantı hatası” ayrıdır.
- Offline: yerel iş mümkünse yapılır, ağ gerektiren AI dürüstçe bekler.
- Kaydetme hatası: kullanıcı girdisi korunur, yeniden deneme tek etkilidir.
- Çatışma: hangi bilgi değiştiği ve çözüm seçeneği anlaşılır.
- Uzun içerik/büyük yazı: butonlar ve kaydetme eylemi erişilebilir kalır.
- İptal/geri: istemeden kayıt veya FP tüketimi yaratmaz.

### 8.2 Başlangıç kabul hedefleri

Hızlı alışkanlık kaydı için en fazla iki etkileşim, geri alma için tek görünür eylem; yerel kaydın p95 görünür tepkisi için 300 ms başlangıç hedefi. Bunlar mevcut ölçüm değildir. Fiziksel cihaz performansı D07'de kaldığı sürece gerçek cihazda hedef geçti denmez. Dokunma hedefi iOS için en az 44 pt, Android için 48 dp tasarım hedefi; yazı büyütmede taşma ve ekran okuyucu görevleri ilgili ortamda kontrol edilir.

Kullanıcı turunda önceden tanımlı görevlerin en az %90'ının yardımsız tamamlanması başlangıç kalite hedefidir; küçük örneklemde kişi ve görev sayıları da yazılır. 5/5 gibi küçük bir sonucun tüm pazarda %100 başarı anlamına gelmediği açık tutulur. Kritik yanlış veri etkisi hiçbir olumlu memnuniyet ortalamasıyla kapatılamaz.

<a id="test"></a>
## 9. Doğrulama ve kabul matrisi

Bu belge hazırlanırken aşağıdaki testler çalıştırılmadı. Komutlar güncel package.json'da doğrulanan başlangıç noktalarıdır; uygulayıcı erişebildiği ortam ve değişen risk kadar çalıştırır. Gereksiz tüm-proje QA tekrarı yapılmaz.

```bash
cd frontend
node --version
npm --version
npm ci
npm run typecheck:ci
npm run lint:ci
npm test -- --runInBand
node run-tests.js
```

`npm ci` geliştirme ortamını hazırlar; salt okunur inceleme değildir. Tek kartta ilgili Jest dosyasıyla başlanır; mevcut CI kapıları merge öncesinde korunur. Üretim DB'sinde deneme amacıyla veri silme, trigger kapatma veya ayrıcalıklı işlev çağırma yoktur.

| Test ID | Senaryo | Gözlenecek sonuç | İlgili faz |
|---|---|---|---|
| T01 | Salı/Perşembe/Pazar haftada 3 gün | Başarılı dönem, sahte Pazartesi eksiği yok | R01 |
| T02 | Aynı gün 3 kayıt | Gün hedefine 1; oturum hedefine gerçek unique sayısı | R01 |
| T03 | Ay ortası 4/10 | Açık dönem, 6 kalan; başarısız ay değil | R01 |
| T04 | DST, ay sonu, timezone, hedef değişimi | Bütün tüketiciler aynı tarih/ilerleme | R01 |
| T05 | 20 eksik, 10+10 recovery | Eksik büyümez; tekrar onay ikinci iş yaratmaz | R03 |
| T06 | 100 karışık offline işlem, kapanma, retry | Yerel kayıtlar ve server sonuçları uzlaşır | R02 |
| T07 | A offline kayıt → B login | A verisi B'ye görünmez/gönderilmez | R02 R10 |
| T08 | İki cihaz aynı notu değiştirir | Çatışan metin korunur | R02 |
| T09 | Silme sonrası eski edit gelir | Varlık yeniden oluşmaz | R02 R10 |
| T10 | Pause/tamamlanan hedef bildirimi | İlgili tetik iptal; tekrar eylem tek log | R04 |
| T11 | 20 çalışma + 5 mola | Çalışma 20; toplam geçen 25 ayrı | R05 |
| T12 | Runner process death ve tekrar bitir | Tutarlı oturum; tek log/ödül | R05 |
| T13 | Günlük taslağı kapanış/hata | Metin korunur; yanlış başarı yok | R07 |
| T14 | Yetersiz/eksik duygu verisi | İlişki iddiası yok; eksik gün sıfır değil | R07 |
| T15 | 5.000 üzeri veri, bozuk yedek, restore tekrarı | Kayıp yok; bozuk dosya mevcut veriyi bozmaz | R08 |
| T16 | AI belirsiz varlık/eski onay/iptal | Soru veya yeni önizleme; izinsiz etki yok | R09 |
| T17 | AI retry/timeout/lease | Mevcut tek etki ve FP sözleşmesi | R09 |
| T18 | Hesap silme sonrası bekleyen iş | Hesap ve veriler geri oluşmaz | R10 |
| T19 | Büyük yazı/klavye/uzun içerik | Ana eylem ve geri dönüş erişilebilir | R06 |
| T20 | Kapalı gate/iptal aileleri | Entegrasyon/IAP/widget/RPG geri gelmez | R10 |

**Kanıt sınıfları:** `OBSERVED_SOURCE`, `TESTED_UNIT`, `TESTED_INTEGRATION`, `OBSERVED_UI`, `OBSERVED_DEVICE`, `REPORTED_PRIOR`, `NOT_VERIFIED`, `DEFERRED`. Her sonuçta tarih, SHA/build, ortam, girdi ve gözlenen çıktı vardır. Birim test sonucu fiziksel cihaz sonucu olarak etiketlenmez.

**Durdurma kuralı:** Kabul başarısızsa ilgili kusuru düzelt, yalnız etkilediği seti yeniden çalıştır. Kabul geçip gerekli CI yeşilse sıradaki READY işe geç. Yeni kusur veya değişen sözleşme yoksa kapanmış güvenlik/review turunu baştan başlatma. Yeni tablo veya yetki değişimi gibi somut risk bağımsız review gerektirebilir; review bulunamıyorsa uydurma bağımsız PASS yerine açık review durumu yaz.

**Tamamlanma hesabı:** R00'da gerçekten gerekli küçük CORE kabul kartları sabitlenir. Tamamlanan CORE kabul / toplam CORE kabul gösterilir; yanında kritik açık sayısı ve kanıt kapsamı bulunur. DEFERRED işler ayrı sayılır. 86 üst paketin hepsini eşit zorlukta iş gibi kullanarak takvim tahmini yapılmaz. Kart sayısını bölerek tamamlanma oranı şişirilmez.


<a id="izlenebilirlik"></a>
## 10. K01–K65 tam kapsam eşlemesi

Bu matris önceki geniş karşılaştırmanın hiçbir alanını sessizce kaybetmemek içindir. CORE kalite puanı bu 65 alanın tamamında liderlik anlamına gelmez. PRESERVE kullanılmış veriyi korur; DEFERRED işi tamamlandı saymaz. Yeni R06 ve R10 kapsamları bu sürümde değişmiştir.




| ID | Önceki kullanıcı yeteneği | v3 kararı | Faz/koşul | Açıklama |
|---|---|---|---|---|
| K01 | Evet/hayır alışkanlığı | CORE | R01 | Tip ve gerçek kayıt |
| K02 | Miktar ve birim hedefi | CORE | R01 | Birim/kısmi/hedef yönü |
| K03 | Süre hedefi | CORE | R01/R05 | Aktif süre ve log |
| K04 | Bırakma/azaltma alışkanlığı | CORE | R01 | Kayıt yokluğu başarı değildir |
| K05 | Haftalık esnek gün/oturum hedefi | CORE | R01 | Gün/oturum hedefi |
| K06 | Aylık adet/miktar hedefi | CORE | R01 | Açık dönem |
| K07 | Sabit gün, yıllık tarih, her N gün, tarih aralığı | CORE | R01 | Tek değerlendirici |
| K08 | Alışkanlık içi alt adımlar | CORE | R01 | Günlük checklist |
| K09 | Skip, pause, tatil | CORE | R01/R04 | Pause/seri/bildirim |
| K10 | Seri, geçmiş ve ısı haritası | CORE | R01/R07 | Kanonik tarih ve hesap |
| K11 | Görev ve alt görev yönetimi | CORE | R02/R03 | Bugün akışı ve küçük adım |
| K12 | Proje ve kilometre taşları | PRESERVE | R03/R08 | Yeni proje platformu kurulmaz |
| K13 | Hedef/OKR/key result | PRESERVE | R03/R07/R08 | Mevcut ilişkiler ve veri korunur |
| K14 | Kapasite ve bekleme kuyruğu | CORE | R03 | Açıklanmış yük ve kuyruk |
| K15 | Ustalık/gelişim değerlendirmesi | PRESERVE | R03 | Mevcut hesap ve geçmiş |
| K16 | Aksama sonrası telafi | CORE | R03 | Gerçek eksik kayda bağlı |
| K17 | Notlar ve bilgi bağlantıları | PRESERVE | R03/R07/R08 | Mevcut notlara erişim ve yedek |
| K18 | Okuma/yaşam alanı planları | PRESERVE | R03/R08 | Mevcut okuma/yaşam alanları |
| K19 | Programa duyarlı hatırlatma | CORE | R04 | Takvime göre tetik |
| K20 | Çoklu saat ve erteleme | CORE | R04 | Çoklu saat ve sessiz saat |
| K21 | Bildirimden kayıt/skip/ertele | CORE | R04 | Tek iş etkisi |
| K22 | Konum tetikleyicisi | DEFERRED | D08 | Konum izni/arıza yükü sonraya |
| K23 | Alışkanlıktan alışkanlığa zincir | DEFERRED | D08 | Zincir/döngü kontrolü sonraya |
| K24 | Düzenlenebilir rutin şablonları | CORE | R05 | Az sayıda düzenlenebilir şablon |
| K25 | Adım adım rutin yürütme | CORE | R05 | Kalıcı runner oturumu |
| K26 | Ses/titreşimle adım rehberi | CORE | R05 | Ses/titreşim/sessiz |
| K27 | Oturum sırasında rutin değişimi | CORE | R05 | Oturum ve şablon ayrımı |
| K28 | Sayaç, kronometre, Pomodoro, odak | CORE | R05 | Ortak odak modeli |
| K29 | Canlı oturum yüzeyi | DEFERRED | D02 | Live Activity/ongoing yüzey ertelendi; in-app oturum R05 |
| K30 | Etkileşimli widget'lar | DEFERRED | D02 | Widget güncel owner kararıyla ertelendi |
| K31 | watchOS + Wear OS | DEFERRED | D03 | İki saat platformu ayrı |
| K32 | Sağlık otomasyonu | DEFERRED | D03 | Kontrollü otomatik kayıt |
| K33 | Haricî takvimler | DEFERRED | D01 | Sağlayıcı başına gerçek senaryo |
| K34 | Notion/Obsidian/müzik bağlantıları | PRESERVE/DEFERRED | D01 | Mevcut güvenli yol korunur; kapalı connector açılmaz |
| K35 | Kullanıcı API'si ve webhook | DEFERRED | D04 | API yetki ve işletim maliyeti |
| K36 | Kısayollar ve otomasyon örnekleri | DEFERRED | D04 | Çalışan otomasyon örneği şart |
| K37 | Özelleştirilebilir duygu kaydı | CORE | R07 | Sürümlü duygu tanımı |
| K38 | Zengin metinli günlük | CORE | R07 | Metin/temel biçim/etiket |
| K39 | Fotoğraf/dosya ekleri | DEFERRED | D09 | Mevcut ekler varsa korunur |
| K40 | Sesli günlük | DEFERRED | D09 | Yeni ses/transcription kapsamı yok |
| K41 | Görsel geçmiş ve arama | CORE | R07 | Takvim ve arama; medya galerisi sonra |
| K42 | Duygu–alışkanlık ilişkileri | CORE | R07 | Yeterli veri ve ilişki açıklaması |
| K43 | Rapor, review ve paylaşılabilir özet | CORE | R07 | Review sonucu sonraki plana bağlanır |
| K44 | Çevrimdışı okuma/yazma/sync | CORE | R02 | Çekirdek offline matrisi; diğer modüllerde dürüst durum |
| K45 | Tam yedek ve geri yükleme | CORE | R08 | Tüm mevcut kullanıcı verisi |
| K46 | Rakip/genel CSV içe alma | CORE/DEFERRED | R08/D09 | Genel CSV CORE; isimli adaptör kanıtla |
| K47 | PIN/biyometrik kilit | PRESERVE/DEFERRED | R06/D02 | Mevcut gizlilik korunur; yeni native kilit genişlemesi zorunlu değil |
| K48 | Veri kontrolü ve hesap lifecycle | CORE | R08/R10 | Veri lifecycle ve silme |
| K49 | Kalıcı AI koç konuşması | CORE | R09 | Mevcut konuşma korunur |
| K50 | AI alışkanlık/rutin/plan önerisi | CORE | R09 | Plan ve kapasite uyumu |
| K51 | Bağlamsal görev parçalama | CORE | R09 | Niyete özgü küçük adımlar |
| K52 | AI ile kayıt ve düzenleme | CORE | R09 | Önizleme/onay/sürüm |
| K53 | Açıklanabilir kişisel AI içgörüsü | CORE | R09 | Kanonik sayılar ve bağlam izni |
| K54 | MCP/haricî AI erişimi | DEFERRED | D04 | MCP tek kapsam satırı |
| K55 | Arkadaşlar ve leaderboard | PRESERVE/DEFERRED | R10/D09 | Mevcut leaderboard korunur; arkadaş ağı otomatik eklenmez |
| K56 | Sosyal challenge | DEFERRED | D09 | Talep ve moderasyon şart |
| K57 | XP/rozet/gelişim ödülleri | PRESERVE | R03/R09/R10 | XP/FP ekonomisi değiştirilmez |
| K58 | Bahçe/karakter/kozmetik gelişimi | CANCELLED | X01 | Karakter/bahçe/RPG geri eklenmez |
| K59 | Gelir/gider/hesap/transfer | CANCELLED | X02 | Finans bu ürün planında yok |
| K60 | Bütçe ve tasarruf hedefleri | CANCELLED | X02 | Bütçe çekirdekte puanlanmaz |
| K61 | Uzman denetimli eğitim programı | CANCELLED | X03 | Klinik program yok; kısa kullanım rehberi R03.07 korunur |
| K62 | Birlikte çalışma oturumları | CANCELLED | X03 | Kendi canlı platformunu kurma |
| K63 | İşletilen topluluk ve moderasyon | PRESERVE/DEFERRED | R10/D09 | Mevcut erişim güvenliği korunur |
| K64 | Tema, görünüm ve dil tercihleri | CORE | R06/R10 | Mevcut tema ve dil |
| K65 | İhtiyaca göre onboarding/modül seçimi | CORE | R00/R03 | İhtiyaca göre sade açılış |



<a id="ertelenen"></a>
## 11. Ertelenen ve iptal edilen işler

Aşağıdaki işler mevcut çekirdek tamamlanma hesabının dışında kalır. Bunları açmak R11'in otomatik çıktısı değildir. Güncel owner kapsam kararı olmadan bayrak değiştirme, deploy veya yeni bağımlılık işi başlatma.

| ID | İş | Şimdiki uygulama | İleride ele alma koşulu |
|---|---|---|---|
| D01 | Google Calendar, Notion, yeni Spotify OAuth; ek provider'lar | Kapalı kapılar korunur; mevcut veri/disconnect bozulmaz | Açık ürün kararı, gerçek provider erişimi, dar görev ve kanıt |
| D02 | Widget, Live Activity, ongoing/kilit ekranı genişlemesi; yeni native lock | Kodlama yok; in-app runner ve temel bildirim devam | Çekirdek sonrası açık kapsam kararı ve cihaz/OS kapasitesi |
| D03 | Watch/Wear OS ve sağlık otomasyonu | Yeni hedef/izin bağımlılığı yok | Açık ürün kararı, tek platform/tek veri türüyle başlama |
| D04 | MCP/public AI API/haricî otomasyon | Bu döngüde uygulanmaz | Somut B2B/geliştirici talebi ve açık karar |
| D05 | Abonelik/IAP/paywall | Ücretsiz MVP ve mevcut FP korunur | Monetizasyon kararı; fiyat/hak/maliyet birlikte tasarlanır |
| D06 | Web/public URL/store hesapları/submission | Hazır içerik korunur, yayın yok; URL gate false | Ayrı release görevi ve gereken erişim |
| D07 | Sentry runtime smoke, gerçek cihaz profiling, store cihaz QA | Açık kanıt kayıtlı; çekirdeği bloke etmez | Release aşamasında kalan somut prosedür tamamlanır |
| D08 | Konum ve alışkanlık zinciri tetikleri | Temel bildirimden ayrı tutulur | Tekrarlayan ihtiyaç ve açık kapsam kararı |
| D09 | Yeni medya/ses arşivi, ek import adaptörü, sosyal challenge, geniş klinik olmayan içerik | Mevcut veri/özellik korunur, yeni ürün alanı açılmaz | Talep, bakım kapasitesi, gerçek format/izin ve açık karar |

| ID | Kalıcı iptal | Korunacak sınır |
|---|---|---|
| X01 | Pet, bahçe, piksel karakter, RPG, kozmetik zırh | Mevcut XP/seviye/streak/rozet; eski veriyi silme otomatik değil |
| X02 | Finans, muhasebe, bütçe, transfer, banka/döviz | FP transaction ve kapasite budget aynı şey değildir |
| X03 | Kendi canlı ses/video topluluğu, klinik tanı/tedavi/sertifikalı program | Kısa kullanım rehberi ve DEHB dostu günlük destek |

### 11.1 Ayrı release görevi açıldığında

Bu liste hatırlatma amaçlıdır; bu turda uygulanacak iş emri değildir:

1. Kapsamın hâlâ ücretsiz mi ücretli mi olduğunu güncel kararla belirle; ücretli seçilirse IAP ve entitlement lifecycle'ını ayrıca doğrula.
2. Web gizlilik/destek/silme sayfalarını gerçek domain'de yayımla; URL'ler erişilebilir olmadan gate açma.
3. Mağaza hesabı, imzalama, metadata ve desteklenen cihazları gerçek build ile eşleştir.
4. Sentry runtime ingest, gerçek cihaz performansı, OS bildirim/lifecycle ve store cihaz QA kayıtlarını tamamla.
5. Güncel mağaza kuralları, veri beyanı ve izinler ile uygulama davranışını eşleştir.
6. Yetkili dağıtım öncesinde somut build, kanıt, açık kusur ve geri dönüş planı sun.

Bu sırada çekirdeğin geçmişte COMPLETE olması mağaza kabulü yerine geçmez. Aynı şekilde, web URL'sinin ertelenmiş olması haftalık hedef motorunun eksik sayılması için gerekçe değildir.

### 11.2 Ticari ölçüm çekirdekten nasıl ayrılır?

İlk değer: gerçek ilk adım/oturum tamamlanması; devam: tekrar kullanılan günler; toparlanma: aksama sonrası geri dönüş; ödeme: ancak D05 açıldığında gerçek doğrulanmış satın alma. Ücretsiz MVP'de FP işlemi veya test aktivasyonu gelir sayılmaz.

Influencer kanalında kullanıcı tarafından girilen davet kodu gibi sınırlı bir yöntem gelecekte seçilebilir; bu rehber otomatik affiliate platformu, kişilere mesaj gönderimi veya komisyon ödemesi başlatmaz. Toplam görüntülenme/indirme sayısı ürün kalitesi puanının yerine geçmez. Önceki konuşmadaki abone, ciro ve kişisel kazanç hesapları bu dosyanın başarı ölçütü değildir.

<a id="uygulama"></a>
## 12. Uygulama prompt'u ve devam protokolü

Aşağıdaki metin uygulayıcıya verilebilir. Kullanıcıdan alınmış yetkiler tekrar sorulmaz; gerçek erişim engeli yalnız bağlı işi durdurur. Bu dosyanın hazırlanması kendi başına üretim dağıtımı yetkisi değildir.

```text
Aderyth implementation.md v3.0 rehberini uygula.

Önce güncel repo talimatlarını ve docs/plan/21_KAPSAM_EKI_2026-09-13.md
kapsam kararını oku. Daha yeni owner kararı varsa açıkça kaydet.
Çalışma SHA'sını belirt. Eski audit açıklarını güncel kodla eşleştir;
mevcut doğru davranışı yeniden yazma.

Bu döngü ücretsiz MVP çekirdeğidir. Google/Notion/yeni Spotify OAuth,
IAP/paywall, widget/Live Activity/watch, web/store yayını ve ertelenmiş
cihaz profiling/Sentry runtime smoke işlerini başlatma. False gate'leri açma.
RPG/karakter/bahçe, finans veya klinik/canlı video ürünü ekleme.

R00 ile fark envanterini çıkar. Her paket REUSE/EXTEND/NEW/DEFERRED olsun.
Bağımlılığı hazır ilk CORE paketi tek davranışlı, 1–5 gerçek dosyalı karta böl.
Kartta skill, scope, amaç, gözlenebilir kabul, test, risk, geri dönüş ve efor olsun.
Yalnız ilgili skill'i oku. Migration ile büyük UI değişikliğini ayır.

R01'de kanonik hedef/tarih; R02'de kalıcı komut; R03–R05'te
seç-başla-yürüt-toparlan akışını tamamla. Ardından R06–R09'u bağla.
Her yeni veri türünü sync/backup/restore/delete/mahremiyet kaydına dahil et.
Ekran, notification ve AI aynı domain komutunu kullansın.
Kapanmış Step 4 idempotency/FP/lease kazanımlarını koru.

Önce ilgili davranış testini, sonra gereken mevcut CI kapısını çalıştır.
Kaynak gördüğün sonucu cihaz PASS'i diye yazma. Kabul geçince sıradaki
READY işe devam et; ilgisiz eski QA turunu yeniden başlatma.
Geçerli yetki kapsamındaki işi bitir. Canlı erişim gerçekten yoksa
hazırlanabilen kod/test/dry-run'ı tamamla; sadece bağlı kanıtı açık bırak.

Her teslimde: kart ID, SHA, değişen davranış, kanıt, açık kusur,
ertelenen iş ve sıradaki READY kartı yaz.
Sonuçları CORE_IMPLEMENTATION / CORE_QUALITY / RELEASE_READINESS
olarak ayrı raporla. Ölçülmemiş 9–9,5 puanını gerçekleşmiş ilan etme.
```

### 12.1 İlk örnek kart

```yaml
id: R01.02-a
status: READY
priority: MUST
owner_role: Habit domain
skills: [S02, S03, S08]
depends_on: [R00.02, R01.01]
scope:
  - frontend/lib/habitSchedule.ts
  - Güncel repoda çözülmüş ilgili davranış testi dosyası
size: M
goal: Haftada üç farklı gün hedefini sabit gün dağılımından ayırmak
acceptance:
  - Salı Perşembe Pazar kayıtları başarılı dönem verir
  - Aynı gün üç kayıt üç gün sayılmaz
  - Açık hafta erken başarısız değildir
validation:
  - İlgili Jest dosyasını gerçek path ile çalıştır
risk: Rapor ve recovery paydasının değişmesi
rollback: Eski veriyi koruyan okuyucu ve ileri düzeltme
next: R01.02-b tüketici bağlantısı
```

Bu kart yalnız evaluator farkını kapatır; UI, diğer tüketiciler veya şema işini bitti saydırmaz. Dosya sayısı sınırı ortak dosyaya ilgisiz kod yığmak için kullanılamaz.

### 12.2 Oturum sonunda bırakılacak kısa kayıt

```yaml
implementation_version: 3.0
baseline_sha: Gerçek çalışma SHA
completed_cards: []
active_card: null
next_ready_card: R00.01
critical_open_defects: []
deferred_ids: [D01, D02, D03, D04, D05, D06, D07, D08, D09]
core_implementation: NOT_ASSESSED
core_quality: NOT_MEASURED
release_readiness: DEFERRED
evidence_locations: []
```

### 12.3 Kaynaklar ve sınırlar

- Birincil kullanıcı raporu: “Aderyth Çekirdek Kapsam ve Budama.pdf”, 4 sayfa; içerik yeniden incelendi.
- [13 Eylül owner kapsam eki](https://github.com/aydinogluomer-sys/Mobile_Uygulama/blob/0ff1c74b0d8d922fd9bef46d3631a1cf443677e2/docs/plan/21_KAPSAM_EKI_2026-09-13.md): bu sürümün kapsam otoritesi ve repo uygulama kaydı.
- [Güncel baseline commit](https://github.com/aydinogluomer-sys/Mobile_Uygulama/commit/0ff1c74b0d8d922fd9bef46d3631a1cf443677e2).
- [Zamanlama kaynağı](https://github.com/aydinogluomer-sys/Mobile_Uygulama/blob/0ff1c74b0d8d922fd9bef46d3631a1cf443677e2/frontend/lib/habitSchedule.ts): sabit gün dağılımı ile dönem hedefinin ayrılması ihtiyacı.
- [Paket tanımı](https://github.com/aydinogluomer-sys/Mobile_Uygulama/blob/0ff1c74b0d8d922fd9bef46d3631a1cf443677e2/frontend/package.json) ve [feature gate'ler](https://github.com/aydinogluomer-sys/Mobile_Uygulama/blob/0ff1c74b0d8d922fd9bef46d3631a1cf443677e2/frontend/lib/featureGates.ts).
- [Skill manifesti](https://github.com/aydinogluomer-sys/Mobile_Uygulama/blob/0ff1c74b0d8d922fd9bef46d3631a1cf443677e2/docs/skills/00_SKILL_MANIFEST.md): skill dosyaları mevcut; hepsinin proje genelinde uygulandığı iddia edilmez.
- [Routinery MCP](https://www.routinery.app/mcp): haricî AI kullanımının yalnız geliştiricilerle sınırlı olmadığına dair resmî ürün açıklaması; Aderyth için talep kanıtı değil. 13 Eylül yeniden okundu.
- [HabitKit FAQ](https://habitkit.app/faq/): otomatik cihazlar arası eşitlemenin henüz tam sunulmadığı açıklaması; diğer teknik kalitesine hüküm değil. 13 Eylül yeniden okundu.
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/): kurulu SDK ile uyum kontrolü yapılacak yerel depo adayı. 13 Eylül yeniden okundu.
- [Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/), [Android alarm rehberi](https://developer.android.com/develop/background-work/services/alarms): R04 uygulamasında güncel API/OS sınırı kontrol edilecek resmî başvuru kaynakları.

Bu dosya kod değiştirmedi, migration/deploy/store submission yapmadı. 9,31 ve 9,28 sayıları hedef ağırlıklarının hesabıdır; kullanıcı testi sonucu değildir. Önceki v2'deki 5,2/5,9 başlangıç puanları güncel 13 Eylül ürününe otomatik taşınmaz. Ertelenen alanlarda rakip farkı kapanmış sayılmaz.
