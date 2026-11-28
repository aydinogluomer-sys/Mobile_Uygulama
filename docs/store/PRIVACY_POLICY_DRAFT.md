# Aderyth — Gizlilik Politikası (TASLAK)

> **DRAFT — OWNER/LEGAL REVIEW REQUIRED.**
> This text is an engineering description of what the application actually does,
> written from the database schema, the network paths and the dependency list.
> It is accurate; it is **not** legally reviewed and must not be published as
> the policy until it has been.

The canonical wording ships in the app at `app/screens/privacy.tsx`
(Profil → Ayarlar → Hesap → Gizlilik Politikası) and in the host-ready web page
at `docs/store/web/privacy.html`. This file is the same content in Markdown
form. **Keep all three in step** — if one changes, change all three.

Son güncelleme: 27 Kasım 2026

---

## Kısaca

Aderyth, alışkanlıklarını ve odağını takip etmen için verilerini saklar. Bu
verileri satmıyoruz, reklam için kullanmıyoruz ve üçüncü taraf reklam/izleme
(tracking) SDK'sı içermiyoruz.

Hesabını ve verilerini uygulama içinden kalıcı olarak silebilirsin:
**Profil → Ayarlar → Hesap → Hesabı Sil**.

## Hesap bilgileri

Kayıt olurken e-posta adresin ve parolan alınır. Parola, kimlik doğrulama
sağlayıcımız Supabase tarafından şifrelenmiş (hash) olarak saklanır; Aderyth
parolanı düz metin olarak görmez. Ayrıca hesabına bağlı bir kullanıcı kimliği
(id) ve isteğe bağlı bir kullanıcı adı tutulur.

Gün ve hafta sınırlarını senin saatine göre hesaplamak için cihazının saat
diliminin adı (örneğin `Europe/Istanbul`) hesabına kaydedilir; bu bir konum
bilgisi değildir.

## Uygulamada oluşturduğun içerik

Alışkanlıkların ve tamamlama kayıtların, görevlerin, projelerin, notların,
hedeflerin ve OKR'ların, rutinlerin, telafi planların, odak ve derin çalışma
seansların, irade/kapasite kayıtların, bıraktığın alışkanlıklar, okuma listen,
yaşam alanı kayıtların, takvim etkinliklerin ve haftalık/aylık
değerlendirmelerin hesabına bağlı olarak saklanır. Günlük (journal) kayıtların
serbest metindir ve hesabına bağlı saklanır.

Veritabanı satır düzeyinde güvenlik (RLS) ile korunur: başka kullanıcılar bu
verilere erişemez; her sorgu oturumundaki kimliğe göre sınırlanır. Tek istisna
senin başlattığın yapay zekâ özellikleridir (aşağıdaki "AI Koç" ve "Günlük
İçgörüsü" bölümleri).

## AI Koç

AI Koç'a yazdığın mesajlar ve koçun yanıtları hesabına bağlı olarak saklanır;
böylece sohbetlerin uygulamayı kapatıp açtığında kaybolmaz.

Bir mesaj gönderdiğinde sunucumuz, yalnızca o sohbetin son mesajlarından oluşan
sınırlı bir bağlam (en fazla 16 mesaj ve 6000 karakter) ile birlikte mesajını
yapay zekâ sağlayıcımız **Anthropic**'e iletir. Buna ek olarak uygulamanın kendi
özeti gönderilir: aktif alışkanlık adların, alışkanlık ve bekleyen görev sayın,
günlük irade kullanımın.

Sağlayıcı anahtarı yalnızca sunucudadır; uygulamanın içinde bulunmaz. Bir
sohbetin içeriği yalnızca o sohbet için gönderilir, başka bir sohbete taşınmaz.
Anthropic'in bu içeriği kendi tarafında ne kadar süre işlediği/sakladığı
Aderyth'in kontrolünde değildir ve burada bir taahhüt olarak sunulmaz.
Aderyth'in kendi tarafında sakladığı sohbetler, hesabını sildiğinde silinir.

Ayrıca her AI isteği için faturalandırma, hız sınırı ve tekrar koruması amacıyla
teknik bir kayıt (istek kimliği, mod, durum, harcanan Focus Point) tutulur.
Otomatik saklama politikası (`7 / 30 / 400 gün`) kapsamında operasyonel çağrı
izleri **7 gün** sonra silinir, istek kayıtlarındaki yanıt ve hata içerikleri
**30 gün** sonra temizlenir, istek kimliği ve ilişkili Focus Point işlem
kayıtları ise **400 gün** sonunda kaldırılır (hesabını sildiğinde tümü anında
silinir).

## Günlük İçgörüsü

Günlük İçgörüsü'nü yalnızca sen başlattığında, seçtiğin dönemdeki günlük
kayıtlarının metni yapay zekâ sağlayıcımız **Anthropic**'e gönderilir. Hangi
günlerin gideceğini ekranda kendin seçersin; çıkardığın günlerin metni
gönderilmez.

Gönderilen alanlar: seçili günlük kayıtlarının metni (en fazla 8000 karakter),
dönem adı ve teknik bir istek kimliği.

Aderyth gönderilen günlük metnini veritabanında ayrıca saklamaz; AI isteğinin
teknik kaydında (istek kimliği, mod, durum, harcanan Focus Point) metnin
yalnızca tek yönlü özeti tutulur ve aynı `7 / 30 / 400 gün` teknik kayıt saklama
sürelerine tabidir. Üretilen içgörü hesabına bağlı saklanır ve hesabını
sildiğinde silinir.

Anthropic'in bu metni kendi tarafında ne kadar süre işlediği/sakladığı
Aderyth'in kontrolünde değildir ve burada bir taahhüt olarak sunulmaz. İçgörü
oluşturmazsan hiçbir şey gönderilmez.

## Sesle yazdırma

Mikrofon yalnızca sen mikrofon düğmesine bastığında açılır. Sürekli dinleme
yoktur. Konuşmayı yazıya çevirme işini cihazının işletim sistemi yapar (iOS
Speech, Android konuşma tanıma); cihaz ve sistem ayarlarına bağlı olarak bu
işlem cihaz üzerinde ya da işletim sistemi sağlayıcısının sunucusunda
gerçekleşebilir ve bu kısım Aderyth'in kontrolünde değildir.

Aderyth ses kaydı tutmaz ve ses dosyası sunucuya göndermez. Yalnızca ortaya
çıkan metin yazı kutusuna gelir; onu gönderip göndermemeye sen karar verirsin.
Gönderirsen, sohbet mesajı olarak saklanır.

## Çökme raporları

Uygulama beklenmedik şekilde çökerse, teknik bir hata raporu çökme izleme
sağlayıcımız **Sentry**'ye gönderilir. Bu rapor yalnızca hatanın kendisini
içerir: hata türü, hata mesajı ve çağrı yığını (stack trace) ile cihaz modeli,
işletim sistemi sürümü ve uygulama sürümü.

Çökme raporunda **bulunmayanlar**, uygulama tarafında açıkça engellenir:

- günlük (journal) metinlerin, notların ve AI Koç sohbetlerin;
- alışkanlık, görev ve proje adların;
- e-posta adresin, kullanıcı adın veya herhangi bir kullanıcı kimliği — çökme
  raporları hiçbir hesapla ilişkilendirilmez;
- oturum jetonların ve `Authorization` başlıkların;
- ağ isteklerinin gövdeleri, adresleri ve sorgu parametreleri;
- ekran kaydı / oturum tekrarı (session replay) — kullanılmıyor.

Hata mesajları gönderilmeden önce ayrıca temizlenir: tırnak içindeki değerler,
adres satırındaki parametre değerleri, e-posta adresleri ve jeton benzeri
diziler kaldırılır ve mesaj uzunluğu sınırlandırılır.

## Abonelik ve Focus Point

Plan durumun ve Focus Point bakiyen hesabına bağlı saklanır. Focus Point
harcamaların ve iadeleri bir işlem kaydı olarak tutulur.

Aderyth bu sürümde ücretsizdir. Uygulama içi satın alma, abonelik ve reklam
yoktur; ödeme bilgisi toplanmaz. Yapay zekâ özellikleri her ay yenilenen
ücretsiz Focus Point bakiyesiyle çalışır.

## Bildirimler

Hatırlatıcılar cihazında yerel olarak zamanlanır. Aderyth uzaktan bildirim
(push) göndermez ve cihazının push jetonunu toplamaz.

## Liderlik tablosu

Liderlik tablosuna katıldığında kullanıcı adın, seviyen, toplam XP'in ve
sıralaman diğer kullanıcılara görünür. E-posta adresin, içeriklerin ve
alışkanlık adların liderlik tablosunda paylaşılmaz.

## Toplamadıklarımız

- Reklam kimliği toplamıyoruz. Reklam ağı, analitik SDK'sı veya çapraz uygulama
  izleme (tracking) kullanmıyoruz.
- Konum verisi, kişiler, fotoğraflar veya cihaz depolamandaki dosyalar
  toplanmaz.
- Ödeme bilgisi toplanmaz.
- Çökme raporlaması yalnızca teknik hata bilgisi gönderir; içeriklerini ya da
  kimliğini göndermez (bkz. "Çökme raporları").

## Verilerin nerede saklanıyor

Veriler Supabase üzerinde barındırılan bir PostgreSQL veritabanında saklanır.
Uygulama ile sunucu arasındaki tüm trafik HTTPS/TLS ile şifrelenir. Cihazında
ayrıca oturum bilgin, çevrimdışı kayıt kuyruğun ve bazı tercihlerin yerel olarak
saklanır.

Mobilde oturum anahtarın cihazın güvenli deposunda (Keychain / Keystore)
saklanır; web'de tarayıcının yerel depolamasında (`localStorage`) tutulur.
Ortak bir bilgisayarda işin bitince **Profil → Ayarlar → Hesap → Oturumu Kapat**'ı
kullan.

Oturumu kapattığında bu cihazdaki önbellek temizlenir ve hatırlatıcıların iptal
edilir; henüz sunucuya gitmemiş değişikliklerin cihazda güvende kalır ve aynı
hesapla tekrar girdiğinde gönderilir.

## Hizmet sağlayıcılar

- **Supabase** — barındırma, veritabanı ve kimlik doğrulama.
- **Anthropic** — AI Koç, AI rutin oluşturma ve Günlük İçgörüsü isteklerinin
  işlenmesi.
- **Sentry** — çökme raporlama.

## Verilerini dışa aktarma

**Profil → Ayarlar → Veri ve Gizlilik** bölümünden verilerini JSON, CSV veya
Excel biçiminde dışa aktarabilirsin. Dosya tüm alışkanlık kayıtlarını (notlar
dahil), hesap kimliğini ve kurulum yanıtlarını içerir ve şifrelenmez. Bu tam bir
yedek değildir: JSON dosyasını aynı bölümde doğrulayıp eksik kayıtlarını
hesabına ekleyebilirsin; alışkanlık kayıtların (tarihçe), odak oturumların ve
webhook'ların geri yüklenemez. Uygulamayı açtığında günde en fazla bir kez,
cihazında son 3 yerel yedek kopyası tutulur; hesabını sildiğinde bu kopyalar da
silinir.

Obsidian (Markdown) aktarımı seçtiğin içeriği (günlük ve notlar dahil olabilir)
düz metin olarak cihazının panosuna kopyalar. Pano diğer uygulamalar ve klavye
yöneticileri tarafından okunabilir; Aderyth panoyu 60 saniye sonra, başka bir
şey kopyalamadıysan, otomatik temizlemeyi dener.

## Hesabını silme

**Profil → Ayarlar → Hesap → Hesabı Sil** ile hesabını kalıcı olarak
silebilirsin. Silme işlemi geri alınamaz. Silme onaylandığında hesabın ve
yukarıda sayılan tüm kişisel verilerin veritabanından kaldırılır, cihazındaki
yerel veriler temizlenir ve oturumun kapatılır.

Uygulamaya erişemiyorsan: `support@aderyth.com` (`https://aderyth.com/delete-account`).

## Çocukların gizliliği

Aderyth çocuklara yönelik değildir ve bilerek 13 yaşın altındaki kullanıcılardan
veri toplamaz.

## Değişiklikler ve iletişim

Bu politika güncellendiğinde yukarıdaki tarih değişir. Sorular ve veri talepleri
için: `support@aderyth.com` (Yayıncı: Ömer Aydınoğlu).

---

## Owner TODO before publishing

1. ~~Replace the support email placeholder with the real support address…~~
   **Done** — `support@aderyth.com` (and publisher `Ömer Aydınoğlu`) applied in
   this draft, `docs/store/web/privacy.html` and
   `docs/store/web/godaddy/privacy.fragment.html`.
2. Confirm the Supabase project's backup retention and state it, or state that
   backups are not retained.
3. Legal review.
4. Host at a stable HTTPS URL and record it in `OWNER_DECISIONS.md` item 4,
   `APP_STORE_METADATA.md` and `GOOGLE_PLAY_METADATA.md`.
5. ~~If a crash-reporting provider is later added…~~ **Done** — Sentry was
   added in Step 11B.1 and has its own "Çökme raporları" section.
6. **Parity note.** The host-ready HTML at `docs/store/web/privacy.html` is the
   version that goes on the website, and `app/screens/privacy.tsx` is the
   in-app one. All three must say the same thing; if you edit one, edit all.
7. **If the build ships without `EXPO_PUBLIC_SENTRY_DSN`,** Sentry is inert
   and no crash data is collected at all. The policy still describes crash
   reporting, which over-discloses rather than under-discloses — the safe
   direction, and the intended end state is that the DSN is configured.
