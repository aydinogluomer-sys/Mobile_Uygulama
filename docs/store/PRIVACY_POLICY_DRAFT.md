# Aderyth — Gizlilik Politikası (TASLAK)

> **DRAFT — OWNER/LEGAL REVIEW REQUIRED.**
> This text is an engineering description of what the application actually does,
> written from the database schema, the network paths and the dependency list.
> It is accurate; it is **not** legally reviewed and must not be published as
> the policy until it has been.

The canonical wording ships in the app at `app/screens/privacy.tsx`
(Ayarlar → Hesap → Gizlilik Politikası). This file is the same content in a
form the owner can host at the public HTTPS URL the stores require. **Keep the
two in step** — if one changes, change both.

Son güncelleme: 8 Eylül 2026

---

## Kısaca

Aderyth, alışkanlıklarını ve odağını takip etmen için verilerini saklar. Bu
verileri satmıyoruz, reklam için kullanmıyoruz ve üçüncü taraf reklam/izleme
(tracking) SDK'sı içermiyoruz.

Hesabını ve verilerini uygulama içinden kalıcı olarak silebilirsin:
**Ayarlar → Hesap → Hesabı Sil**.

## Hesap bilgileri

Kayıt olurken e-posta adresin ve parolan alınır. Parola, kimlik doğrulama
sağlayıcımız Supabase tarafından şifrelenmiş (hash) olarak saklanır; Aderyth
parolanı düz metin olarak görmez. Ayrıca bir kullanıcı kimliği (id) ve isteğe
bağlı bir kullanıcı adı tutulur.

## Uygulamada oluşturduğun içerik

Alışkanlıkların ve tamamlama kayıtların, görevlerin, projelerin, notların,
hedeflerin ve OKR'ların, rutinlerin, telafi planların, odak ve derin çalışma
seansların, irade/kapasite kayıtların, bıraktığın alışkanlıklar, okuma listen,
yaşam alanı kayıtların, takvim etkinliklerin ve haftalık/aylık
değerlendirmelerin hesabına bağlı olarak saklanır. Günlük (journal) kayıtların
serbest metindir ve hesabına bağlı saklanır.

Bu verilere yalnızca sen erişebilirsin. Veritabanı satır düzeyinde güvenlik
(RLS) ile korunur.

## AI Koç

AI Koç'a yazdığın mesajlar ve koçun yanıtları hesabına bağlı olarak saklanır.

Bir mesaj gönderdiğinde sunucumuz, yalnızca o sohbetin son mesajlarından oluşan
sınırlı bir bağlam (en fazla 16 mesaj ve 6000 karakter) ile birlikte mesajını
yapay zekâ sağlayıcımız **Anthropic**'e iletir. Buna ek olarak uygulamanın kendi
özeti gönderilir: aktif alışkanlık adların, alışkanlık ve bekleyen görev sayın,
günlük irade kullanımın.

Sağlayıcı anahtarı yalnızca sunucudadır. Bir sohbetin içeriği yalnızca o sohbet
için gönderilir. Anthropic'in bu içeriği kendi tarafında ne kadar süre
işlediği/sakladığı Aderyth'in kontrolünde değildir ve burada bir taahhüt olarak
sunulmaz. Aderyth'in sakladığı sohbetler hesabını sildiğinde silinir.

Her AI isteği için teknik bir kayıt (istek kimliği, mod, durum, harcanan Focus
Point) tutulur; bu kayıt faturalandırma ve tekrar koruması içindir.

## Sesle yazdırma

Mikrofon yalnızca sen mikrofon düğmesine bastığında açılır; sürekli dinleme
yoktur. Konuşmayı yazıya çevirme işini cihazının işletim sistemi yapar ve cihaz
ayarlarına bağlı olarak bu işlem cihazda ya da işletim sistemi sağlayıcısının
sunucusunda gerçekleşebilir; bu kısım Aderyth'in kontrolünde değildir.

Aderyth ses kaydı tutmaz ve ses dosyası sunucuya göndermez.

## Çökme raporları

Uygulama beklenmedik şekilde çökerse, teknik bir hata raporu çökme izleme
sağlayıcımız **Sentry**'ye gönderilir. Rapor yalnızca hatanın kendisini
içerir: hata türü, hata mesajı ve çağrı yığını ile cihaz modeli, işletim
sistemi sürümü ve uygulama sürümü.

Çökme raporunda şunlar bulunmaz: günlük metinlerin, notların ve AI Koç
sohbetlerin; alışkanlık, görev ve proje adların; e-posta adresin, kullanıcı
adın veya herhangi bir kullanıcı kimliği; oturum jetonların; ağ isteklerinin
gövdeleri ve adresleri. Ekran kaydı (session replay) kullanılmaz.

Hata mesajları gönderilmeden önce ayrıca temizlenir: tırnak içindeki değerler,
adres satırındaki parametre değerleri, e-posta adresleri ve jeton benzeri
diziler kaldırılır ve mesaj uzunluğu sınırlandırılır. Çökme raporları hiçbir
hesapla ilişkilendirilmez.

## Abonelik ve Focus Point

Plan durumun ve Focus Point bakiyen hesabına bağlı saklanır; harcamalar ve
iadeler işlem kaydı olarak tutulur. Aderyth bu sürümde ücretsizdir: uygulama
içi satın alma, abonelik ve reklam yoktur; ödeme bilgisi toplanmaz. Yapay zekâ
özellikleri her ay yenilenen ücretsiz Focus Point bakiyesiyle çalışır.

## Bildirimler

Hatırlatıcılar cihazında yerel olarak zamanlanır. Uzaktan bildirim (push)
gönderilmez ve cihazının push jetonu toplanmaz.

## Liderlik tablosu

Liderlik tablosuna katıldığında kullanıcı adın, seviyen, toplam XP'in ve
sıralaman diğer kullanıcılara görünür. E-posta adresin, içeriklerin ve
alışkanlık adların paylaşılmaz.

## Toplamadıklarımız

Reklam kimliği toplamıyoruz. Reklam ağı, analitik SDK'sı veya çapraz uygulama
izleme kullanmıyoruz. Konum, kişiler, fotoğraflar veya cihaz depolamandaki
dosyalar toplanmaz. Çökme raporlaması yalnızca teknik hata bilgisi gönderir;
içeriklerini ya da kimliğini göndermez (bkz. "Çökme raporları").

## Hizmet sağlayıcılar

- **Supabase** — barındırma, veritabanı ve kimlik doğrulama.
- **Anthropic** — AI Koç ve AI rutin oluşturma isteklerinin işlenmesi.
- **Sentry** — çökme raporlama.

## Veriler nerede saklanıyor

Supabase üzerinde barındırılan bir PostgreSQL veritabanında. Uygulama ile sunucu
arasındaki tüm trafik HTTPS/TLS ile şifrelenir. Cihazında ayrıca oturum bilgin,
çevrimdışı kayıt kuyruğun ve bazı tercihlerin yerel olarak saklanır.

## Verilerini dışa aktarma

Ayarlar → Veri ve Gizlilik bölümünden JSON, CSV veya Excel olarak dışa
aktarabilirsin. Bu tam bir yedek değildir: JSON dosyasını doğrulayıp eksik kayıtlarını hesabına ekleyebilirsin; alışkanlık kayıtların (tarihçe), odak oturumların ve webhook'ların geri yüklenemez.

## Hesabını silme

**Ayarlar → Hesap → Hesabı Sil.** Silme geri alınamaz. Onayladığında hesabın ve
yukarıda sayılan tüm kişisel verilerin veritabanından kaldırılır, cihazındaki
yerel veriler temizlenir ve oturumun kapatılır.

Uygulamaya erişemiyorsan: `<DESTEK_EPOSTA>`.

## Değişiklikler ve iletişim

Bu politika güncellendiğinde yukarıdaki tarih değişir. Sorular ve veri talepleri
için: `<DESTEK_EPOSTA>`.

---

## Owner TODO before publishing

1. Replace `<DESTEK_EPOSTA>` with the real support address (both occurrences,
   and in `app/screens/privacy.tsx` if an address is added there).
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
