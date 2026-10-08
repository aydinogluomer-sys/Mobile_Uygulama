# R08.03 — Yedek dosyasının korunması: seçilen sınır

> Kart: "Hassas yedek dosyası için OS koruması/uygun şifreleme ve anahtar kurtarma sınırını açıkça
> seç; özel kripto algoritması yazma."

## Karar

**Uygulama içinde şifreleme YOK; koruma işletim sistemine ve kullanıcının seçtiği hedefe bırakılır.**
Bu bir eksiklik değil, açıkça seçilmiş bir sınırdır:

| Seçenek | Neden seçilmedi / seçildi |
|---|---|
| Kendi şifreleme algoritmamız | **Yasak** (kart). Yazılmadı; `repo/backupProtection.test.ts` kaynakta şifre/çözme ilkeli kod olmadığını denetler. |
| Platform kripto kütüphanesi (`expo-crypto`/`react-native-quick-crypto` + parola türetme) | Yeni native bağımlılık = sahip kararı (S7/S13/S14 ile aynı sınıf). Ayrıca **anahtar kurtarma** sorunu: parolayı unutan kullanıcı yedeğini kalıcı kaybeder; bu uygulamada parola sıfırlama ile yedek anahtarını bağlayan bir sunucu yok. |
| **OS koruması (seçildi)** | Yerel kopyalar uygulamanın kendi deposunda (`AsyncStorage`: Android'de uygulamaya özel veritabanı, iOS'ta uygulama kabı ve cihaz kilidine bağlı Veri Koruması). Başka uygulamalar okuyamaz; cihaz kilitliyken iOS'ta şifreli durur. |

## Bunun anlamı (kullanıcıya söylenen)

- **Paylaşılan dosya şifrelenmez.** Ayarlar → Verileri Dışa Aktar metni bunu paylaşmadan önce söyler:
  "Dosya şifrelenmez; içinde günlüğün ve notların var — yalnız güvendiğin bir yere kaydet."
- **Oturum ve erişim anahtarları dosyaya hiç girmez** (R08.01 cihaz izin listesi, webhook başlıkları
  çıkarılır, `AUTHORITY_FIELDS` geri yüklemede atılır).
- **Anahtar kurtarma sınırı:** şifre olmadığı için kaybedilecek anahtar da yok; buna karşılık dosyayı
  ele geçiren onu okuyabilir. Bu takas bilinçlidir ve yukarıdaki uyarıyla görünür kılınır.
- **Hesap silinince** cihazdaki tüm yerel kopyalar da silinir (R10.04: görünüm tercihleri dışındaki
  bütün anahtarlar).
- **Android son uygulamalar / iOS önizleme:** R06.05 gizlilik örtüsü.

## Değişmesi için

Şifreli yedek istenirse: (1) sahip yeni native bağımlılığı onaylar; (2) parola türetme (PBKDF2/Argon2,
platformun) + AES-GCM (platformun) kullanılır, **kendi algoritması değil**; (3) anahtar kurtarma
yolu yazılı bir sınırla seçilir ("parolayı unutursan yedek açılmaz" ya da sunucu tarafı emanet).
