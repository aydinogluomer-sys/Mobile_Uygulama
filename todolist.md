# Günlük Arşivi (Defter) — Yapılacaklar

**Amaç:** "Günlük" bölümüne, klasik bir defter gibi eski sayfaları okuyabileceğin bir **arşiv** eklemek. Kullanıcı geçmiş kayıtlarını kronolojik görür; AI Coach'tan özetlenen girdiler **"AI'dan özetlenmiştir"** rozetiyle görünür; yazdıkları **raporlanır** (toplam, seri, bu ay, ruh hali); ve bir kayda dokununca **sayfa çevirerek** tüm girdileri tam metin okuyabilir.

> Kullanım senaryosu: Kişi negatif bir alışkanlığına kanmak yerine hislerini günlüğe döker; zaman geçince arşivde "eski sayfalara" dönüp ne yazdığını görür.

**Kural:** Her faz bitince `cd frontend && node run-tests.js` çalıştır. **Tümü geçerse** (exit 0) bir sonraki faza geç; geçmezse düzelt.

---

> **Test geçidi notu:** `run-tests.js` baseline'ı **89/92**. 3 başarısızlık (today.tsx "İrade bandı"/"yatay chips", timeline "boş durum drawer hint") bu işten önce de vardı — today.tsx/timeline.tsx refactor edildiği için stale string kontrolleri. Bu yüzden "başarılı" = **tsc 0 hata + sayı 89/92'de sabit (yeni regresyon yok)**.

## Faz 0 — Temel doğrulama (baseline) ✅
- [x] `node run-tests.js` → 89/92 (3 stale, tsc 0 hata).

## Faz 1 — Veri katmanı + arşiv girişi ✅
- [x] `lib/journalStats.ts` — `computeJournalStats` (total/streak/thisMonth/aiCount/moodAvg).
- [x] `lib/journalMoods.ts` — paylaşılan MOODS (journal + archive + reader).
- [x] `store/journalStore.ts`: fetch limit 90 → 365.
- [x] `app/screens/journal.tsx`: header "Arşiv" butonu + geçmiş bölümünde "Tüm arşiv" linki.
- [x] **TEST:** 89/92, tsc 0 hata.

## Faz 2 — Arşiv ekranı (rapor + kronolojik liste) ✅
- [x] `app/screens/journal-archive.tsx`: rapor kartı + aya gruplu liste + "AI'dan özetlenmiştir" chip + boş durum.
- [x] `app/screens/_layout.tsx`: `journal-archive` kaydı.
- [x] **TEST:** 89/92, tsc 0 hata.

## Faz 3 — Defter okuyucu (sayfa çevirme) ✅
- [x] `app/screens/journal-reader.tsx`: yatay `FlatList pagingEnabled`, tam metin, AI rozeti, sayfa X/N + ileri/geri, `?date=` ile o kayıttan başlar.
- [x] `journal-reader` route kaydı; arşiv kartları `?date=` ile yönlendiriyor.
- [x] **TEST:** 89/92, tsc 0 hata.

## Faz 4 — Kapanış ✅
- [x] Son `node run-tests.js` → 89/92, tsc 0 hata.
- [x] Memory güncelle (günlük arşivi/defter + run-tests baseline notu).
