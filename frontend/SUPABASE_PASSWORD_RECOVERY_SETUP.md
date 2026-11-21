# Supabase şifre kurtarma kodu kurulumu

Uygulama, Supabase Auth recovery OTP akışını kullanır:

1. `resetPasswordForEmail(email)` kurtarma e-postasını gönderir.
2. Kullanıcı e-postadaki 6 haneli kodu girer.
3. `verifyOtp({ email, token, type: 'recovery' })` geçici recovery session oluşturur.
4. `updateUser({ password })` yeni şifreyi kaydeder.
5. Recovery session yerel olarak kapatılır ve kullanıcı login ekranına döner.

## Zorunlu e-posta şablonu

[Atlas'ın e-posta şablonlarını aç](https://supabase.com/dashboard/project/kbcuolhjjnmhjaarxxmu/auth/templates) → **Reset Password** şablonunu seçin.

> Bu bağlantı Atlas'ın kanonik Supabase projesine (`kbcuolhjjnmhjaarxxmu`,
> "Alışkanlık Uygulaması") gider. Bu belge bir dönem BAŞKA bir projenin
> panosuna bağlanıyordu; o proje Atlas'a ait değildir ve buradan hiçbir
> şekilde yapılandırılmamalıdır. Doğru hedef `supabase/config.toml` içinde
> sabitlenmiştir ve `supabase/predeploy_guard.sh` tarafından zorlanır.

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

Supabase Dashboard → Authentication → URL Configuration → Redirect URLs izin listesine şunları ekleyin (F22):

```text
atlas://**                      # üretim derlemesi (native): kurtarma ve kayıt onayı bağlantıları
exp://**                        # YALNIZ geliştirme projesinde (Expo Go)
https://<web-sitesi>/reset-password   # web barındırma kararından (OD-12 / D15) sonra
https://<web-sitesi>/login            # web barındırma kararından (OD-12 / D15) sonra
```

Uygulama hedefleri kendisi üretir (`frontend/lib/authDeepLink.ts`): kurtarma postası `reset-password`, kayıt onayı ve yeniden gönderme `login` rotasına döner (`emailRedirectTo`). Bir hedef izin listesinde yoksa Supabase hata vermez, "Site URL"e düşer; bu yüzden "Site URL" üretimde çalışan bir web adresi olmalıdır.

Web için SPA yönlendirme kuralı `frontend/vercel.json` dosyasındadır (`/(.*)` → `/index.html`); dosya bir barındırma kararı değildir, başka bir sağlayıcı seçilirse eşdeğer kural (ör. `/* /index.html 200`) eklenir.

Kalan risk: özel şema (`atlas://`) bağlantıları Android'de başka bir uygulama tarafından yakalanabilir. Belirteç kısa ömürlü ve tek kullanımlıktır; asıl yol 6 haneli koddur (`{{ .Token }}` şablonda önde kalır).

Yerel geliştirme adresini de ayrıca ekleyin. Production gönderimleri için Supabase’in varsayılan e-posta hizmeti yerine doğrulanmış bir custom SMTP sağlayıcısı kullanın.
