# GoDaddy Websites + Marketing — sayfa yayınlama rehberi

> **Kapsam kararı (2026-09-13):** yayın **ERTELENDİ** (`docs/plan/21_KAPSAM_EKI_2026-09-13.md` §6.3).
> Bu rehber, web projesiyle birlikte yayın kararı verildiğinde kullanılmak
> üzere hazır tutulur; şimdilik hiçbir adımı uygulanmaz.

`aderyth.com`, GoDaddy **Websites + Marketing** (Website Builder) üzerinde
barındırılıyor (Step 11B.1 deployment discovery: `Server: DPS/2.0.0`,
`generator: Go Daddy Website Builder 8.0.0000`, NS `ns71/72.domaincontrol.com`).
Bu ürün dosya yüklemeye izin vermez — `privacy.html`'i `/privacy` yoluna
koyamazsın. Sayfalar editörde oluşturulur, her sayfaya bir URL slug'ı verilir
ve özel işaretleme sayfa gövdesindeki **"HTML" (Custom Code)** bölümüne
yapıştırılır.

Bu klasördeki üç `*.fragment.html` dosyası tam olarak o alana yapıştırılmak
için üretildi.

## Dosyalar

| Fragment | Sayfa adı | URL slug | Hedef URL |
|---|---|---|---|
| `privacy.fragment.html` | Gizlilik Politikası | `privacy` | `https://aderyth.com/privacy` |
| `support.fragment.html` | Destek | `support` | `https://aderyth.com/support` |
| `delete-account.fragment.html` | Hesap ve Veri Silme | `delete-account` | `https://aderyth.com/delete-account` |

Her fragment yalnızca iki şeyden oluşur: kök seçiciye (`#aderyth-…-page`)
tamamen scope edilmiş bir `<style>` bloğu ve sayfa içeriğinin wrapper'ı.
`<!doctype>`, `<html>`, `<head>`, `<body>` yok; `body`, `*` veya `:root`
seçicisi yok — GoDaddy'nin kendi başlık/menü/altbilgi stilleri etkilenmez.
Script, harici CSS/font/görsel, analytics yok.

**Canonical kaynak** üst dizindeki tam HTML dosyalarıdır
(`docs/store/web/privacy.html` vb.). Metin oradan birebir alınmıştır; bir
değişiklik gerekirse önce canonical dosyayı düzenle, sonra fragment'ı
yeniden üret. Fragment'ı elle düzenleme.

## Yayınlama adımları (owner)

- **A.** GoDaddy hesabına gir → **Websites + Marketing** → `aderyth.com`
  satırında **Manage** → **Edit Website**.
- **B.** Sol/üst araç çubuğundan **Add Page** (sayfa ekle).
- **C.** **New Page** seç (mevcut bir sayfayı kopyalama).
- **D.** Sayfa adını ve URL slug'ını tablodaki gibi ver. Slug'ı **birebir**
  yaz — `privacy-policy` değil `privacy`, `hesap-silme` değil
  `delete-account`. Slug alanı genelde sayfa ayarlarında (Page Settings →
  URL / Page URL) bulunur. Editör slug'ı yeniden yazarsa ya da kabul etmezse
  **devam etmeden önce** oluşan URL'yi bildir; uygulama ve mağaza kayıtları
  bu üç yola bağlı.
- **E.** Navigation görünürlüğü: tercihen **Hide in navigation / Not in
  navigation**. Gizli sayfa URL'den erişilebilir kalır; mağazaların ihtiyacı
  olan tek şey bu. Ana sayfadaki "Yakında" görünümü bozulmaz.
- **F.** Yeni sayfada **Add Section** → **HTML** (bazı sürümlerde "Custom
  Code" / "Embed HTML"). Bölüm bulunmuyorsa plan kademesi izin vermiyor
  olabilir — bu durumda DNS'e dokunmadan aynı yol geçerli: sayfayı editörün
  kendi Text bölümleriyle kur, aynı metni yapıştır, aynı slug'ı ver.
- **G.** İlgili `*.fragment.html` dosyasının **tamamını** (ilk `<!--`
  yorumundan son `</div>`'e kadar) Custom Code alanına yapıştır. Editör
  yorum satırını atarsa sorun değil; `<style>` ve `<div id="aderyth-…">`
  kısımlarının eksiksiz olduğundan emin ol.
- **H.** **Forced Height** alanını boş bırak (auto-height). Sabit yükseklik
  verirsen uzun sayfalar kesilir.
- **I.** **Preview** ile hem masaüstü hem mobil görünüme bak: metin okunuyor,
  kartlar görünüyor, sayfa yana taşmıyor.
- **J.** Üç sayfayı da aynı şekilde ekle ve **yayınlamadan önce** üçünü de
  preview'da kontrol et.
- **K.** **Publish**.
- **L.** Dışarıdan doğrula (aşağıdaki kabul listesi). Doğrulama geçmeden
  uygulamadaki `PUBLIC_SITE_URLS_LIVE` bayrağı ve mağaza konsolları
  **değiştirilmez**; bunlar ayrı adımlar.

## Kabul listesi (publish sonrası)

Terminalden:

```
curl -sI https://aderyth.com/privacy        | head -1
curl -sI https://aderyth.com/support        | head -1
curl -sI https://aderyth.com/delete-account | head -1
```

- [ ] `https://aderyth.com/privacy` → **HTTP 200**
- [ ] `https://aderyth.com/support` → **HTTP 200**
- [ ] `https://aderyth.com/delete-account` → **HTTP 200**
- [ ] Sayfalarda görünür `{{…}}` placeholder yok
- [ ] `support@aderyth.com` `mailto:` bağlantısı tıklanınca e-posta istemcisini açıyor
- [ ] Türkçe karakterler doğru görünüyor (ç, ğ, ı, İ, ö, ş, ü — özellikle
      "Gizlilik Politikası", "Sesle yazdırma", "Çökme raporları")
- [ ] Mobilde (dar ekran) yatay taşma yok, kartlar tek sütun
- [ ] Sayfa içi bağlantılar doğru: üstteki `Aderyth / Gizlilik / Destek /
      Hesap Silme` ve alttaki footer bağlantıları `/`, `/privacy`, `/support`,
      `/delete-account` yollarına gidiyor ve 200 dönüyor
- [ ] İçerik canonical dosyayla anlamlı fark taşımıyor (yayınlanan sayfayı
      `docs/store/web/<ad>.html` ile yan yana oku)

Hepsi tamamsa sıradaki iki adım, **ayrı ayrı ve ayrı onayla**:
`frontend/lib/featureGates.ts` → `PUBLIC_SITE_URLS_LIVE = true`; ardından
App Store Connect / Play Console'a URL'lerin girilmesi
(`docs/store/OWNER_DECISIONS.md` #4).

## Bilinen sınırlar

- Renk şeması ziyaretçinin sistem tercihine göre koyu/açık geçer
  (`prefers-color-scheme`), canonical ile aynı. GoDaddy temasının arka planı
  ile fragment'ın arka planı farklı olabilir; fragment kendi kartını çizer, bu
  beklenen görünümdür.
- Fragment içindeki `nav` ve `footer` GoDaddy'nin site menüsü/altbilgisi
  DEĞİLDİR; sayfa içeriğinin parçasıdır ve bilinçli olarak korunmuştur
  (üç sayfa birbirine bu bağlantılarla gider).
- `support@aderyth.com` için MX kaydı Amazon SES inbound'a işaret ediyor;
  adresin gerçekten bir kutuya düştüğünü yayın öncesi bir test e-postasıyla
  doğrula.
