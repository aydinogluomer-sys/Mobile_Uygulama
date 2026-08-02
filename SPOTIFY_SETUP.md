# Spotify Kurulumu (tek seferlik — yönetici)

Odak sekmesindeki Spotify oynatıcısı hazır; çalışması için aşağıdaki **tek seferlik** adımları yap.
Son kullanıcı hiçbir şey yapmaz — sadece "Spotify ile Bağlan"a basıp Google/Gmail ile giriş yapar.

## 1. Spotify Developer uygulaması oluştur
1. https://developer.spotify.com/dashboard → **Create app**.
2. App adı/açıklaması gir. **Which API/SDKs**: *Web API* seç.
3. Oluşturduktan sonra **Settings**'ten **Client ID** ve **Client Secret**'ı kopyala.

## 2. Redirect URI ekle
Uygulamadaki redirect = `Linking.createURL('spotify-callback')`. Settings → **Redirect URIs**'e şunları ekle:

| Ortam | Redirect URI |
|---|---|
| Production / standalone build (scheme: `frontend`) | `frontend://spotify-callback` |
| Expo Go (geliştirme) | `exp://<LAN-IP>:8081/--/spotify-callback` (Metro'nun gösterdiği IP ile) |

> İpucu: Geliştirmede en sağlıklısı bir **dev build** (`npx expo run:android` / `run:ios`) kullanmaktır; o zaman `frontend://spotify-callback` sabit kalır. Expo Go'da IP değiştikçe redirect URI'yi güncellemen gerekir.

## 3. Kendi Spotify hesabını "User Management"a ekle
Spotify app'i **Development Mode**'dayken yalnızca izinli hesaplar giriş yapabilir.
Settings → **User Management** → kendi Spotify hesabının e-postasını ekle (kota uzatma onayına kadar 25 kullanıcı sınırı).

## 4. Supabase Edge secrets'ı ayarla
Token değişimi sunucu tarafında (edge fonksiyon `spotify-auth`) yapılır. İki gizli anahtarı ayarla:

```bash
supabase secrets set SPOTIFY_CLIENT_ID=xxxxxxxx SPOTIFY_CLIENT_SECRET=yyyyyyyy --project-ref kbcuolhjjnmhjaarxxmu
```

Veya Supabase Dashboard → Project Settings → **Edge Functions → Secrets** → `SPOTIFY_CLIENT_ID` ve `SPOTIFY_CLIENT_SECRET` ekle.
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` platformca otomatik sağlanır.)

## 5. Premium notu
Uygulama içi **çal / duraklat / atla** ve "odak çalma listesini başlat" Spotify'ın **Premium** gerektirdiği özelliklerdir.
Ücretsiz hesapta bu kontroller "Spotify'da aç" deep-link'ine düşer; "çalan şarkı" bilgisi yine görünür.
Oynatma için Spotify'ın bir cihazda **aktif** olması gerekir (telefonun Spotify uygulaması açık/arka planda) — "aktif cihaz yok" uyarısı gelirse Spotify'ı bir kez aç.

---
**Mimari:** `spotify_accounts` tablosu (RLS kilitli, token'lara yalnız service-role edge erişir) · edge fonksiyon `spotify-auth` (`?action=url|callback|status|disconnect|now-playing|play|pause|next|previous|play-context`, token otomatik yenilenir) · `store/spotifyStore.ts` + `components/focus/FocusSpotifyCard.tsx`. Notion/Google entegrasyonlarıyla aynı desen.
