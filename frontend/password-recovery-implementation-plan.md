# Atlas Password Recovery — Uçtan Uca Uygulama Planı

## 1. Hedef davranış

1. Kullanıcı `/forgot-password` ekranında hesabına bağlı e-posta adresini girer.
2. Supabase Auth recovery isteği oluşturur.
3. Gmail mesajında bağlantı yerine görünür, tek kullanımlık 6 haneli kod bulunur.
4. Kullanıcı kodu aynı ekranın 2/3 adımına girer.
5. `verifyOtp({ email, token, type: 'recovery' })` geçici recovery session üretir.
6. Kullanıcı 3/3 ekranında yeni şifresini belirler.
7. `updateUser({ password })` şifreyi günceller.
8. Recovery session yalnızca yerel cihazda kapatılır ve kullanıcı login ekranına gider.
9. Kullanıcı mevcut e-posta adresi ve yeni şifresiyle giriş yapar.

## 2. Kanıtlanmış mevcut durum

- Frontend proje referansı: `zdqiujpeewtyhtcqhdcj`.
- `resetPasswordForEmail()` başarılı; Gmail mesajı ulaşıyor.
- Gmail mesajında Supabase varsayılan içeriği görülüyor: “Follow this link…” ve `Reset Password` bağlantısı.
- Bu, SMTP/teslimat sorunu olmadığını; hosted Auth recovery şablonunda yalnızca `{{ .ConfirmationURL }}` bulunduğunu kanıtlar.
- Frontend 6 haneli kodu kabul ediyor ve `verifyOtp(... type: 'recovery')` çağrısı kurulu paket tipleriyle doğrulandı.
- Çalışma ortamında Supabase Management API access token, service-role key, bağlı MCP veya authenticated CLI yok.

## 3. Temel neden

`resetPasswordForEmail()` mesaj gövdesini frontend’den alamaz. Hosted Supabase, mesajı Dashboard’daki **Authentication → Email Templates → Reset Password** şablonundan üretir. Şablonda `{{ .Token }}` kaydedilmedikçe 6 haneli OTP Gmail’de görünmez. Frontend değişikliği mail gövdesini değiştiremez.

## 4. Seçilen mimari

### Birincil çözüm — Supabase native recovery OTP

- Gönderim: `resetPasswordForEmail(email)`
- Şablon değişkeni: `{{ .Token }}`
- Doğrulama: `verifyOtp({ email, token, type: 'recovery' })`
- Şifre güncelleme: `updateUser({ password })`
- Avantajlar: OTP üretimi, hash, süre sonu, tek kullanımlılık, rate limit ve session güvenliği Supabase tarafından yönetilir.

### Reddedilen çözüm — frontend’de rastgele kod üretmek

Kod frontend’de üretilemez. Böyle bir kod kullanıcı tarafından görülebilir/manipüle edilebilir; güvenilir hash, expiry, rate limit ve kullanıcı doğrulaması sağlamaz.

### Reddedilen çözüm — özel OTP tablosu + doğrudan Gmail

Bu yöntem service-role ve SMTP/Resend/Gmail secret gerektirir. Secret frontend’e konulamaz. Native recovery OTP varken gereksiz saldırı yüzeyi oluşturur.

## 5. İş paketleri

### WP-1 — Hosted Auth şablonunu yönetmek

- Atlas markalı recovery HTML dosyasını kaynak kontrolünde tut.
- Management API için token tabanlı, secret sızdırmayan otomasyon script’i oluştur.
- Script proje referansını `.env` içindeki Supabase URL’den türetsin.
- Access token yalnızca `SUPABASE_ACCESS_TOKEN` process environment değişkeninden okunsun.
- Dry-run modunda URL, proje ref ve değişecek alan adlarını göstersin; token veya template içeriğini loglamasın.
- Apply modunda recovery subject/content alanlarını güncellesin.

### WP-2 — Frontend recovery ekranını sağlamlaştırmak

- E-postayı normalize et.
- 6 haneli rakamsal input uygula.
- İstek sonucu kullanıcı hesabının varlığını ifşa etmeyen genel mesaj göster.
- Resend cooldown ekle; Supabase rate limit ile uyumlu davran.
- Kod doğrulama hatalarını expired/invalid/rate-limit olarak kullanıcı diline çevir.
- Recovery link fallback’ini koru.

### WP-3 — Recovery session routing

- `forgot-password` ve `reset-password` rotalarında recovery session’ın dashboard redirect’i tetiklemesini engelle.
- Yeni şifre sonrası yalnızca local session’ı kapat.
- Login ekranına deterministik `replace` yap.

### WP-4 — Supabase yapılandırma doğrulaması

- Site URL ve additional redirect URL içinde `http://localhost:3002/reset-password` bulunduğunu doğrula.
- Reset Password template subject/body içinde `{{ .Token }}` bulunduğunu doğrula.
- Yeni recovery isteği oluştur; eski e-postaları test verisi sayma.
- Gmail’de yeni mesajın 6 haneli kod içerdiğini doğrula.
- Kodu 2/3 ekranında doğrula; 3/3 ekranına geçişi doğrula.

## 6. Güvenlik kontrolleri

- `service_role`, SMTP parolası veya Management API token frontend’e yazılmayacak.
- OTP loglanmayacak veya analytics’e gönderilmeyecek.
- Hata mesajı hesabın var olup olmadığını açıklamayacak.
- Kod yalnızca Supabase Auth tarafından üretilecek ve doğrulanacak.
- Resend spam/rate-limit davranışı kullanıcı arayüzünde sınırlandırılacak.
- Şifre minimumu mevcut Supabase policy ile uyumlu olacak; iki alan eşleşmeden update çağrısı yapılmayacak.
- Şifre güncelleme sonrası recovery session açık bırakılmayacak.

## 7. Test matrisi

### Statik

- `npx tsc --noEmit`
- Hedefli ESLint
- `npx expo export --platform web`

### Fonksiyonel

- Geçersiz e-posta
- Mevcut hesap e-postası
- Var olmayan e-posta (enumeration kontrolü)
- Eksik/5 haneli/7 haneli kod
- Geçersiz kod
- Süresi dolmuş kod
- Doğru kod
- Eşleşmeyen yeni şifreler
- Başarılı güncelleme → login
- Yeni şifreyle login

### Teslimat

- Gmail Inbox
- Spam
- Yeni mesaj timestamp’i
- Mesaj gövdesinde gerçek 6 haneli token
- Eski link-only mesajın yanlışlıkla tekrar test edilmediğinin kontrolü

## 8. Rollback

- Recovery template HTML kaynak dosyada korunur.
- Hosted template başarısız olursa `{{ .ConfirmationURL }}` fallback bağlantısı mesajda kalır.
- Frontend link recovery parser’ı korunur.
- Management script yalnızca recovery subject/content alanlarını değiştirecek şekilde kapsamlandırılır.

## 9. Tamamlanma kriteri

- Yeni Gmail mesajında 6 haneli kod görünür.
- Kod `/forgot-password` 2/3 ekranında kabul edilir.
- Yeni şifre kaydedilir.
- Login’e otomatik dönüş gerçekleşir.
- Yeni şifreyle giriş yapılır.
- TypeScript/lint/export kontrolleri geçer.
