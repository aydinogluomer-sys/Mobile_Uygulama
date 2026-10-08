# R06.06 — §8.1 ekran durumları: render ortamında kanıt

Ortam: `react-test-renderer` + jest-expo (Node, TZ=Europe/Istanbul). **Fiziksel cihaz yok (S8)**:
animasyon akıcılığı, gerçek yazı büyütme oranı, ekran okuyucu gezintisi ve p95 tepki süresi
**ölçülmedi, puan verilmedi**. "Veri seti" sütunu testte kullanılan sabit veriyi adlandırır.

| §8.1 durumu | Ekran | Veri seti | Gözlenen (test) |
|---|---|---|---|
| İlk kullanım | Notlar / Hedefler / Projeler | boş liste, hata yok | "Henüz … yok" + nasıl başlanacağı (`ui/screenStates` "first use") |
| İlk kullanım | Bugün | açık iş yok | tek eylem "Başla: odak" (`lib/todayNext` R06.02) |
| Veri var | Bugün | 2 alışkanlık (1 arada), 1 görev | arada bölümü, küçük başla, "Başla: Yürüyüş" (`ui/todayScreen`) |
| Yükleniyor | Notlar / Hedefler | `loading: true`, boş | iskelet; boş-durum metni YOK (`ui/screenStates` "loading") |
| Yükleniyor (taslak) | Günlük | yazılmış metin, kayıt sürüyor/başarısız | taslak cihazda kalır (mevcut `journalDraft` testleri, R07.01) |
| Boş sonuç ≠ hata | Notlar / Hedefler / Projeler | `error: 'Network request failed'` | "… yüklenemedi · kayıtların silinmedi" + Tekrar dene; boş metni YOK (`ui/screenStates`) |
| Boş arama | Notlar | sorgu var, sonuç yok | "Sonuç bulunamadı" (`listState` 'no-results') |
| Offline | Bugün | core outbox'ta gönderilmemiş 1 değişiklik | rozet "1 bekliyor" (`ui/todayScreen` R02.04) |
| Offline | Günlük / Not / Plan | ağ kapalı | yerel kayıt + gösterim + sonra teslim (`store/noteJournalOutbox`, `store/recoveryOutbox`) |
| Kaydetme hatası | Hedef / Recovery | yazma reddedildi | form açık, girdi korunur, sebep role=alert (`ui/formFeedback`, `ui/recoveryScreen`) |
| Çatışma | Not / Günlük | başka cihaz değiştirdi | ne değişti + 3 seçenek (`ui/conflictChoice`, `store/noteJournalOutbox`) |
| Uzun içerik | Notlar | 500+ karakter başlık/gövde | kartta `numberOfLines` ile kırpılır, "Yeni not" erişilebilir (`ui/screenStates`) |
| Büyük yazı | ui kit | — | `minHeight` (kırpma yok), ölçek kapatma yok (`repo/accessibilityMeasured`) |
| İptal/geri | Hedef | yeni hedef taslağı | iptal taslağı korur, kayıt yaratmaz (`ui/formFeedback`) |
| İptal/geri (FP) | AI koç | öneri reddi | FP tüketmez (mevcut `aiCoachActions` testleri) |

Bu kartta eklenen davranış: **"yüklenemedi" ≠ "boş"** — `components/ui/LoadErrorState.tsx`
(`listState` kuralı) Notlar, Hedefler, Projeler ve Okuma listesinde; önceden bağlantı hatası
"Henüz … yok" olarak görünüyordu.
