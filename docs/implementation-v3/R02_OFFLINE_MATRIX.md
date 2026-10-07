# R02 — Offline matrisi ve yerel depo ölçümü

Durum tarihi: 2026-10-07. Kaynak: kod (`store/*`, `lib/syncQueue.ts`, `lib/outbox.ts`),
`docs/QUERY_BOUNDING_MATRIX.md` (39 yazma yolu). Cihaz ölçümü YOK (S8): aşağıdaki
"davranış" sütunları koddan okunmuştur, cihazda gözlenmemiştir.

## R02.01 — Çekirdek yazma yolları

| Alan | İşlem | Bugün (çevrimdışı) | Mekanizma | Hedef / not |
|---|---|---|---|---|
| Alışkanlık kaydı | kaydet / değer / skip / miss | **Yerel-önce, kuyruklu** | `lib/syncQueue.ts` (habit\|gün başına tek op, geri çekilme, hesap başına anahtar) | Var. Genel outbox'a taşınması S7 sonrası |
| Bugün görevleri | ekle / tamamla / düzenle / sil / taşı / arşivle | **Yerel-önce, outbox** (R02, bu faz) | `lib/outbox.ts` + `lib/outboxStorage.ts` + `services/outboxRunner.ts` + `taskService.deliverTaskCommand` | Var. Çakışma ve ölü değişiklik kullanıcıya gösterilir (`OutboxIssues`) |
| Görev bölme (TaskSplitter) | toplu alt görev ekleme | Ağ gerekli | `taskService.createSubtasks` doğrudan | Outbox'a bağlanacak (dependsOn ile ana göreve) |
| Kontrol listesi | işaret / adım düzenleme | Ağ gerekli | `habitChecklistRepository` doğrudan | Migration 029 uygulanınca outbox'a |
| Ara / tatil | ekle / bitir | Ağ gerekli | `habitPauseRepository` doğrudan | Migration 028 uygulanınca outbox'a |
| Alışkanlık | oluştur / düzenle / etkinleştir | Ağ gerekli | `habitService` (kapasite + irade sırası sunucu yazımına bağlı) | Etkinleştirme irade bütçesi düşürür: çevrimdışı yapılırsa çift harcama riski; bilinçli olarak ağ gerekli |
| Rutin | kurulum | Ağ gerekli | `routineService.installProposal` | Toplu + kapasite kararı; ağ gerekli kalır |
| Odak | oturum / ayarlar | Oturum durumu yerel (`focus.session.v1`, KD-03); oturum satırı ağ | `focusService.completeWorkPhase` | Oturum satırı outbox'a (P4/R05.07 ile) |
| Derin çalışma | elle süre | Ağ gerekli | `deepWorkRepository` | Outbox adayı |
| Günlük / review | yaz | Ağ gerekli; taslak yok | `journalRepository`, `reviewRepository` | R07.01 çevrimdışı taslak |
| Telafi | plan / tamamla | Ağ gerekli | `recoveryService` (iki tablo sırası) | Outbox'a dependsOn ile |
| Ayarlar | tema, odak ayarları | Yerel | AsyncStorage | Değişiklik yok |
| AI koç / sağlayıcı | her şey | **Ağ gerekli (tasarım gereği)** | edge functions | Çevrimdışı vaat yok |

## R02.02 — Mevcut depo yeterliliği

**AsyncStorage** (`@react-native-async-storage/async-storage` ^2.2.0, Expo ~57, RN 0.86.3):

- Anahtar başına bir JSON blob; tek `setItem` atomik, anahtarlar arası işlem YOK.
- Sorgu yok; her okuma tüm blob'u ayrıştırır.
- Android'de varsayılan toplam boyut sınırı vardır (yapılandırılabilir); büyük geçmiş için uygun değil.

**Bu fazda yapılan:** "yerel değişiklik + outbox aynı işlem" kuralı, yerel kopyanın
outbox'ın KENDİSİ olmasıyla sağlandı (ekran = sunucu satırları + `overlay`). Hesap başına
tek anahtar, tek `setItem`. Bu, ilişkisel bir yerel veritabanı DEĞİLDİR.

**Aday:** `expo-sqlite` (Expo'nun birinci taraf modülü; sürüm `npx expo install` ile SDK'ya
sabitlenir). Kazanım: anahtarlar arası işlem, sorgu, büyük geçmiş, gerçek tombstone tablosu.
Maliyet: yeni native bağımlılık → development build; AsyncStorage'dan sayım+sürüm kontrollü
taşıma (R02.07).

**KARAR AÇIK — DURMA NOKTASI S7.** Bağımlılık eklenmedi. `lib/outboxStorage.ts`'teki
`OutboxStorage` arayüzü takas noktasıdır; üstündeki hiçbir kod hangi deponun altta olduğunu
bilmez.

## Kabul ölçütüne göre durum

| Kabul maddesi | Durum | Kanıt |
|---|---|---|
| Çevrimdışı 100 karışık eylem, yeniden başlatma, ağ dönüşünde kayıpsız uzlaşma | **Görevler için fixture'da GEÇER**; alışkanlık kaydı mevcut kuyrukta | `__tests__/fixtures/taskOutboxScenarios.test.ts` |
| Aynı komut beş retry'da tek etki | GEÇER (görev) | aynı dosya, "re-delivered five times" |
| A kuyruğu B hesabına taşınmaz | GEÇER (görev + alışkanlık) | aynı dosya "accounts"; `outboxRunner.test.ts` |
| Silinmiş öğe geç edit ile geri doğmaz | GEÇER (görev) | "deleted elsewhere", "late local edit" |
| Cihazda uçak modu / app kill | **N/R (S8)** | cihaz yok |
| SQLite taşıması | **BLOKE (S7)** | — |
