# R11.01 — Değerlendirme dondurması (CP/CE)

> Kart: "CP/CE ağırlıkları, görevler ve değerlendirme ortamını dondur. Eski P/E tablosuyla payda
> farkını kaydet; kullanıcı testinde bulunmayan ölçümü N/R bırak."
> Dondurma tarihi: **2026-10-08**, sonuçlar görülmeden önce. Ağırlıklar ve hedefler kaynak
> plandaki (`docs/plan/22_ADERYTH_CORE_IMPLEMENTATION_V3.md` §2.1–2.3) değerlerle **aynıdır**;
> `frontend/__tests__/repo/evaluationFreeze.test.ts` bu tabloyu plana karşı doğrular. Sonuç kötü
> çıkarsa ağırlık değiştirilmez.

## 1. Çekirdek ürün matrisi (CP) — dondurulmuş

| Modül | Ağırlık | Hedef | Ölçüm durumu (2026-10-08) |
|---|---:|---:|---|
| CP01 Esnek hedef ve geçmiş | 16 | 9,5 | Uygulama kanıtı: R01 kartları (CORE_AUDIT). Kullanıcı görevi: **N/R** |
| CP02 Kapasite, küçük adım, recovery | 18 | 9,5 | Uygulama kanıtı: R03, R09.04. Kullanıcı görevi: **N/R** |
| CP03 Rutin yürütme | 16 | 9,5 | Uygulama kanıtı: R05. Kullanıcı görevi: **N/R** |
| CP04 Odak ve temel bildirim | 12 | 9,0 | Uygulama kanıtı: R04/R05. Fiziksel OS kanıtı: **N/R** (S8) |
| CP05 Günlük, duygu, review | 12 | 9,0 | Uygulama kanıtı: R07, R09.05. Kullanıcı görevi: **N/R** |
| CP06 Yerel veri ve veri taşıma | 12 | 9,5 | Uygulama kanıtı: R02, R08. Büyük hesap: jest tatbikatı; cihaz: **N/R** |
| CP07 Uygulama içi AI | 8 | 9,0 | Uygulama kanıtı: R09 (istemci senaryoları 100/100). Model turu: **N/R** (S3) |
| CP08 Sadelik ve erişilebilirlik | 6 | 9,0 | Uygulama kanıtı: R06. Yardımsız görev: **N/R** |

Ağırlıklı tasarım hedefi: **9,31**. Bu bir ölçüm değil, hedeftir.

## 2. Çekirdek mühendislik matrisi (CE) — dondurulmuş

| Modül | Ağırlık | Hedef | Kabul kanıtı (plan) |
|---|---:|---:|---|
| CE01 Domain/tarih doğruluğu | 20 | 9,5 | Kanonik fixture, geçmiş sürümü, tüketici eşleşmesi |
| CE02 Kalıcı veri/sync | 20 | 9,5 | Outbox, retry, çatışma, hesap izolasyonu |
| CE03 Yedek/restore | 15 | 9,5 | Sayım, ilişki, bütünlük, tekrar restore |
| CE04 Yetki/mahremiyet | 15 | 9,0 | A/B negatif test; yeni veri lifecycle |
| CE05 AI tek etkisi ve ekonomi | 10 | 9,0 | Geçerli/başarısız/replay maliyet uzlaşması |
| CE06 Test ve sınırların korunması | 10 | 9,0 | Davranış testi, ilgili CI, mevcut katman sınırı |
| CE07 Uygulama oturum lifecycle | 10 | 9,0 | Kontrollü kesinti ve yeniden açılış sonucu |

Ağırlıklı hedef: **9,275**.

## 3. Puanlama kuralı (dondurulmuş, plan §2.3)

Her modülde kapsam %30, davranış derinliği %30, kullanıcı akışı %20, tutarlılık %20. Alt boyut
ölçeği 0/2/4/6/8/9/10. Gözlenmeyen boyut **N/R**; eksik boyut çıkarılıp kalanlar 10'a
**ölçeklenmez**. Kritik veri kaybı, başka hesaba erişim veya yanlış FP etkisi varsa modül kabul
edilmez.

## 4. Değerlendirme ortamı

| Öğe | Değer |
|---|---|
| Kod | `feature/r01-period-status` (bu kartın commit'i) |
| Otomatik ortam | Node + jest (`--maxWorkers=2`), `run-tests.js`, `tsc`, `eslint` — Windows 11 geliştirme makinesi |
| Veritabanı | **Dondurulmuş** (S1/S2): 028–035 yazıldı, uygulanmadı; canlı okuma/yazma yok |
| Cihaz | **Yok** (S8): iOS/Android fiziksel ve emülatör kanıtı N/R |
| AI sağlayıcı | Canlı tur yok (S3): model yarısı N/R |
| Kullanıcı turu | Yapılmadı: R11.02 planı, R11.03–05 N/R |

## 5. Eski P/E tablosuyla payda farkı

Eski puan tablosu (P01–P12 ürün, E-serisi mühendislik; 10 Eylül rakip bantları) **bu repoda
bulunmuyor** — yalnız plan metninde anılıyor. Bu yüzden modül-modül sayısal fark yazılamaz;
kayda geçen fark kapsam ve paydadır:

| | Eski (P/E) | Yeni (CP/CE) |
|---|---|---|
| Ürün modülü sayısı | 12 (P01–P12) | 8 (CP01–CP08) |
| Paydadan çıkan | — | store/web yayını, IAP/paywall, widget/Live Activity/kilit ekranı, Spotify/Notion/GCal, Watch/Wear, harici MCP, F13/F14/F15 (kalıcı iptal) |
| Ağırlık | (repoda yok) | toplam 100, yukarıdaki tablo |
| Ölçek | eski puanlar "birebir aynı ölçek değildir" (plan §2.1) | 0–10, §3 kuralı |

Sonuç: eski puanlar yeni ölçeğe **taşınmaz**; karşılaştırma yalnız yeni ölçekte, aynı görev ve
ortamda yapılan ölçümle yapılır.
