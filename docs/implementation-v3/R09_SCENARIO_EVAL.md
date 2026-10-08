# R09.07 — Koç araç senaryoları değerlendirmesi

> Kart: "60 geçerli, 20 belirsiz, 10 yetki/talimat enjeksiyonu, 10 iptal/retry/çökme senaryosuyla
> mevcut ve yeni araçları değerlendir. Metnin akıcılığını araç/argüman/yan etki doğruluğundan ayrı ölç."
>
> Test: `frontend/__tests__/scenarios/coachScenarios.test.tsx` (6 test, 100 senaryo).
> Ortam: jest (Node), gerçek doğrulayıcı + çözümleyici + eylem kartı; store'lar sahte (yalnız çağrılar kaydedilir).

## İki yarı

| Yarı | Ne ölçer | Durum |
|---|---|---|
| **İstemci** | Modelin ürettiği araç çağrısı (JSON) → doğrulayıcı → çözümleme → kart → komut. Üç ayrı eksen: **araç** (doğru kabul/ret), **argüman** (beklenen normal biçime birebir), **yan etki** (tam olarak beklenen komut ya da hiç komut yok). | **Ölçüldü** (bu belge) |
| **Model** | Bir cümleden doğru araç çağrısı üretiliyor mu; metin akıcı mı. | **N/R** — canlı sağlayıcı ve edge deploy gerekiyor (S3); bu makinede yok. Senaryo cümleleri bu korpusun `raw` alanlarıyla eşleştirilip canlı turda aynı üç eksen + ayrı akıcılık puanı ile ölçülecek. |

Akıcılık bu testte **ölçülmez** ve hiçbir eksene karışmaz: puanlar yalnız araç/argüman/yan etki üzerinden.

## Sonuç (istemci yarısı)

| Grup | Adet | Kapsam | Araç | Argüman | Yan etki |
|---|---|---|---|---|---|
| Geçerli — v2 | 42 | `edit_habit_schedule`, `pause_habit`, `move_task`, `suggest_small_step`, `lighten_today`, `edit_reminder_time` (6'şar) + `lighten_week` (6 farklı alışkanlık kümesi) | 42/42 | 42/42 | 42/42 |
| Geçerli — v1 | 18 | `propose_habit`, `propose_habit_plan` (rutin doğrulayıcısına aynen geçer), `log_habit` (tam olarak doğru alışkanlık) — 6'şar | 18/18 | 18/18 | 18/18 |
| Belirsiz / bilinmeyen | 20 | iki kayda uyan ad (alışkanlık ve görev), hiç uymayan ad | 20/20 | 20/20 (adaylar tam olarak beklenen ikili) | 20/20 (Uygula yok, hiçbir komut yok) |
| Yetki / enjeksiyon | 10 | `id`/`user_id`/`habit_id`/`cost`/`xp`/`sql`, bilinmeyen tür, `__proto__`, fazladan anahtar, geçmişe mola | 10/10 (ret) | 10/10 (doğru gerekçe) | 10/10 (komut yok) |
| İptal / retry / çökme | 10 | 4 tür iptal; önizlemeden sonra değişen / silinen alışkanlık, tamamlanan görev; yanıtsız deneme aynı kimlik, yanıtlı deneme yeni kimlik; 6'lı eylem patlaması | 10/10 | 10/10 | 10/10 (yazma yok, ikinci tahsilat yok) |
| **Toplam** | **100** | | **100** | **100** | **100** |

## Ayırt edicilik (mutasyon)

Harness'in gerçekten yakaladığı: yetki anahtarı kontrolünün kaldırılması, kartta "değişti" kontrolünün
kaldırılması, belirsiz görevde ilk adayı seçme, Vazgeç'in komut çağırması, geçmişe başlayan mola,
haftalık molanın açık uçlu yazılması — **6/6 öldürüldü**.

## Sınırlar

- `edit_habit_schedule` yan etkisi komut + hedef kimliği düzeyinde ölçülür; yazılan yamanın içeriği
  (`frequencyEditPatch`, sürümlü hedef) R01.05 testlerinin konusudur.
- `log_habit` için yan etki "doğru alışkanlık" düzeyindedir; yazma yolu ve birim/değer soruları
  `aiCoachActions` render testlerindedir.
- İkinci eylem seti `COACH_ACTIONS_V2_ENABLED=false` arkasındadır; burada `{ v2: true }` ile
  değerlendirilir. Canlıda açılması 032/034/035 + edge deploy'a bağlıdır (SQL_FOR_OWNER.md).
