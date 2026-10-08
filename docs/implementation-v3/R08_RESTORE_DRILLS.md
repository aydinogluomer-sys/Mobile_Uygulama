# R08.07 — Geri yükleme tatbikatları

> "Dosya indirmek geri yükleme kanıtı değildir." Her tatbikat gerçek dışa aktarma → doğrulama → kuru
> çalıştırma → geri yükleme kodundan geçer, iki hesaplı bellek-içi sunucuya yazar ve sonra **yeniden
> dışa aktarıp** sayım/ilişki/sağlama uzlaşmasını kaydeder.
> Test: `frontend/__tests__/fixtures/backupDrills.test.ts` (10). Ortam: jest (Node); canlı veritabanı
> YOK (S1/S2) — tatbikatın canlı karşılığı sahip kararıdır.

| # | Tatbikat | Veri | Sonuç (gözlenen) |
|---|---|---|---|
| 1 | 5.000+ kayıtlı hesap, tam kayıp sonrası geri yükleme | 5.200 görev (520'si projeye bağlı), 1 proje, 1 OKR + 1 KR, 2 alışkanlık | Eklenen: tasks 5.200, projects 1, okrs 1, key_results 1, habits 2. **Yeniden dışa aktarımda her geri yüklenebilir koleksiyonun sayısı VE sağlaması aynı** (alışkanlıklar tasarım gereği "bekleyen" döner; sayısı aynı). 520 görev projeye bağlı. |
| 1b | Tavanın ötesi | 20.001 görev | Dosya `truncated: ['tasks']` der; doğrulama "Dosya eksik (kesilmiş koleksiyonlar: tasks)" ile reddeder; hiçbir şey yazılmaz. |
| — | Sınır | tam 6 / 7 satır, tavan 6 | Tam tavan **eksik sayılmaz**, bir fazlası sayılır (bu tatbikatta bulunan off-by-one düzeltildi). |
| 2 | Eski biçim | `format_version: 2`, manifest yok | "Manifest yok …" ile reddedilir, okuma bile yapılmaz. |
| 3 | Yarım ağ | 130 not; ağ ilk parçadan sonra düşer | İş `failed`, 50 eklendi; aynı dosya → `resumes: true`, kalan 80; son sayım ve sağlama özgün dosyayla aynı; iş `done`, toplam 130. |
| 3b | Tek parça reddi | 130 not; 2. parça bir kez reddedilir | Koleksiyon o noktada durur (boşluklu ekleme yok, son kayıt n049); sürdürme kalan 80'i sırayla ekler. |
| 4 | Bozuk parça | bir notun içeriği elle değiştirildi | "\"notes\" sağlaması tutmuyor" ile reddedilir; hesap değişmez. |
| 5 | Aynı yedeğin tekrarı | 60 görev + XP'li bir alışkanlık kaydı | İkinci geri yükleme 0 ekler; XP taşıyan kayıt hiç geri yüklenmez (ödül üretmez). |
| 6 | Başka test hesabına | A'nın dosyası B'ye | "başka bir hesaba ait" ile reddedilir; B'nin notları aynen kalır. |
| 7 | Yetim kayıt | OKR'si dosyada olmayan KR | Yetim olarak bekletilir, eklenmez. |

**Bu tatbikatlarda bulunan ve düzeltilen:** (a) dışa aktarım tavanı 5.000 → 20.000 (5.000+ hesap bütün
dönmüyordu); (b) kuru çalıştırma mevcut satırları tek sınırlı okumayla alıyordu — sınırın ötesindeki
satırlar "eksik" sanılıp yeniden planlanabilirdi; artık anahtar sıralı tam okuma, tavan aşılırsa ret;
(c) tam tavanda "kesildi" diyen off-by-one (`drain`, `fetchOwnedTable`).
