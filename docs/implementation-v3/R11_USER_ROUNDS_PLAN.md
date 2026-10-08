# R11.02 — İki küçük kullanıcı turu planı

> Kart: "Keşif ve düzeltme doğrulama olmak üzere iki küçük tur planla. Tur başına 5–8 hedef
> kullanıcı başlangıç örneklemidir; eksik kullanıcı erişimini klinik veya pazar genellemesiyle örtme."
> Durum: **plan yazıldı; yürütme N/R** (bu oturumda kullanıcı ve cihaz erişimi yok — S8).

## Turlar

| Tur | Amaç | Örneklem | Çıktı |
|---|---|---|---|
| **T1 — Keşif** | Görevlerde nerede takıldığını bulmak | 5–8 hedef kullanıcı (alışkanlık/rutin uygulaması kullanmış ya da bırakmış yetişkin) | Kusur listesi → her biri tek davranışlı kart (R11.05) |
| **T2 — Düzeltme doğrulama** | T1'de değişen kusurun tekrar testi | 5–8, T1'den en az yarısı yeni | Değişen her kusur için geçti/kaldı; geçtiyse yeni teorik QA döngüsü açılmaz |

Örneklem bir **başlangıç** örneklemidir: sonuç pazar ya da klinik genellemesi değildir; ulaşılamayan
kullanıcı grubu "ulaşılamadı" diye yazılır, başka bir grupla doldurulmaz.

## Görevler (R11.03 ile aynı set; dondurulmuş — R11_EVALUATION_FREEZE.md)

| # | Görev | Başlangıç durumu | Başarı ölçütü (yan etki dahil) |
|---|---|---|---|
| G1 | Haftalık hedef: "haftada 3 kez yürüyüş" kur, iki gün işaretle | Boş hesap | Hedef haftalık sayı olarak durur; ilerleme 2/3; başka gün "kaçırıldı" yazmaz |
| G2 | Küçük başlama: ertelenen bir görev için 5 dk'lık ilk adımı başlat | 1 gecikmiş görev | Odak oturumu adımla açılır; görev tamamlanmaz |
| G3 | Runner kesintisi: sabah rutinini başlat, 2. adımda uygulamayı kapat, geri dön | Hazır şablon | Aynı oturum aynı adımda sürer; süre kaybolmaz/şişmez |
| G4 | Recovery: kaçırılan ölçülebilir alışkanlığı telafi et | 1 kaçırılmış gün | Ölçüm sorulur, uydurulmaz; yük önizlemesi görülür |
| G5 | Review: haftalık değerlendirmede bir sonraki eylemi seç | 1 haftalık veri | Eylem saklanır, sonraki hafta görünür |
| G6 | Restore: yedekten geri yükle (test hesabı) | Yedek dosyası | Kuru çalıştırma sayıları gösterir; ikinci kez 0 ekler |
| G7 | AI onay: koça "Kitap hatırlatmasını akşam 9'a al" de | 2 "Kitap…" alışkanlığı | Hangisi diye sorar; seçilen tek kayıt değişir |

## Kayıt (her katılımcı × görev)

| Alan | Nasıl |
|---|---|
| Yardımsız başarı | evet / yardımla / hayır — **ayrı** kaydedilir |
| Süre | görev başlangıcından ölçüt sağlanana kadar, saniye |
| Yardım sayısı | moderatörün her müdahalesi |
| Yanlış yan etki | istenmeyen her yazma (yanlış kayıt, ikinci kayıt, yanlış gün) — **ayrı** kaydedilir |
| Sözlü not | yalnız gözlem; puana dönüştürülmez |

Toplama: görev başına medyan süre, yardımsız başarı oranı (pay/payda açık: "5/7"), yanlış yan
etki sayısı. Eksik katılımcı/görev **N/R**; payda küçültülerek oran şişirilmez.

## Etik ve veri

Gerçek kişisel veri yerine test hesabı; kayıtta ad yok (K1…K8); ekran kaydı katılımcının açık
izniyle, tur sonunda silinir. Sağlık/klinik iddia yok.
