# Supabase şifre kurtarma kodu kurulumu

Uygulama, Supabase Auth recovery OTP akışını kullanır:

1. `resetPasswordForEmail(email)` kurtarma e-postasını gönderir.
2. Kullanıcı e-postadaki 6 haneli kodu girer.
3. `verifyOtp({ email, token, type: 'recovery' })` geçici recovery session oluşturur.
4. `updateUser({ password })` yeni şifreyi kaydeder.
5. Recovery session yerel olarak kapatılır ve kullanıcı login ekranına döner.

## Zorunlu e-posta şablonu

[Bu projenin e-posta şablonlarını aç](https://supabase.com/dashboard/project/zdqiujpeewtyhtcqhdcj/auth/templates) → **Reset Password** şablonunu seçin.

Konu:

```text
Atlas şifre kurtarma kodun
```

Gövde:

```html
<h2>Atlas şifre kurtarma kodun</h2>
<p>Şifreni yenilemek için aşağıdaki tek kullanımlık kodu uygulamaya gir:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px">{{ .Token }}</p>
<p>Bu kod kısa süre sonra geçersiz olur. Bu isteği sen yapmadıysan e-postayı yok say.</p>
<p>Bağlantıyı tercih edersen: <a href="{{ .ConfirmationURL }}">şifreni yenile</a></p>
```

Hem `Token` hem `ConfirmationURL` tutulduğu için kullanıcı kod veya bağlantı yolundan ilerleyebilir.

> Gmail ekranında yalnızca “Reset Password” bağlantısı görünüyorsa hâlâ Supabase'in varsayılan şablonu kullanılmaktadır. `{{ .Token }}` kaydedilmeden 6 haneli kod e-postada gösterilmez.

## Redirect URL

Supabase Dashboard → Authentication → URL Configuration bölümüne web uygulamasının reset adresini ekleyin:

```text
https://uygulama-domaininiz.com/reset-password
```

Yerel geliştirme adresini de ayrıca ekleyin. Production gönderimleri için Supabase’in varsayılan e-posta hizmeti yerine doğrulanmış bir custom SMTP sağlayıcısı kullanın.
