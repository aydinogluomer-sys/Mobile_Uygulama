# R10.02 — Tek etki tablosu (R01–R09 eylemleri)

> Kart: "R01–R09 yeni eylemlerinde kayıt/XP/FP tek etkisini ve başarısız işlem geri dönüşünü doğrula."
> Her satırdaki test adı `frontend/__tests__/repo/singleEffectTable.test.ts` ile dosyasında aranır;
> bir test silinir ya da adı değişirse bu tablo kırmızı olur.

| Eylem | Tek etki nasıl sağlanır | Başarısız işlem | Test (dosya › ad) |
|---|---|---|---|
| Alışkanlık kaydı (XP sunucuda) | aynı alışkanlık uçuştayken ikinci dokunuş ikinci insert üretmez; çevrimdışı tekrar son durumu tek yazar | yazma kuyrukta kalır, son durum korunur | `store/logStore.test.ts` › issues exactly one insert when the same habit is tapped twice mid-flight · `store/logStoreOfflineSync.test.ts` › replays exactly one write, carrying the FINAL tapped state |
| Görev (outbox) | kalıcı kuyruk + istemci kimliği; 100 karışık çevrimdışı işlem birer kez | sürüm çatışması sessizce uygulanmaz | `fixtures/taskOutboxScenarios.test.ts` › 100 mixed offline actions arrive as the user left them, once each |
| Günlük / not / telafi planı / odak oturumu (core outbox) | 23505 = zaten uygulandı; yarıda kesilen gönderim tekrar edilir, tek etki | yerelde kalır, çevrimiçi olunca gider | `services/coreOutboxChannel.test.ts` › a create re-sent after every "crash" lands once (23505 = already applied) · › a send interrupted mid-flight (saved with \`sending\`) is sent again on load, still one effect |
| Rutin yürütücü: bağlı alışkanlık kaydı | adım tekrar tamamlansa da tek log | — | `store/routineRunnerStore.test.ts` › a completed step linked to a yes/no habit logs it done once; a measurable habit is never logged from here |
| Rutin yürütücü: bitir | bitmiş oturum ikinci kez geçmişe yazılmaz (**bu kartta düzeltildi**) | — | `store/routineRunnerStore.test.ts` › R10.02 — finishing twice (double tap, resumed screen) records the session once |
| Koç v1 (öneri kurulumu / kayıt) | aynı karede iki dokunuş tek yazma (**bu kartta düzeltildi**: durum bir render geride kalıyordu) | kurulum hatası raporlanır, bekleyen eylem açık kalır | `ui/aiCoachActions.test.tsx` › confirming writes exactly once · › R10.02 — two taps in the same frame still log once |
| Koç v2 (7 eylem) | kart başına tek etki: uçuştaki ya da sonraki ikinci basış yazmaz (**bu kartta düzeltildi**) | hedef değiştiyse/silindiyse yazılmaz | `ui/coachApplyOnce.test.tsx` › two presses while the first write is in flight: one write · › a press after the action finished writes nothing more |
| AI tahsilatı (FP) | `request_id` başına tek tahsilat, tekrar ilk sonucu oynatır; yanıtı kaybolan istek aynı kimlikle tekrar gider | tahsilat geri alınır; tekrar, gözlediği tahsilatı ikinci kez iade etmez | `edge/aiIdempotency.test.ts` › a retry recovers the persisted output without calling the provider · `repo/focusPointAtomicity.test.ts` › a replayed charge is not refunded by the retry that observed it · `store/routineGenerateOneCharge.test.ts` › offline: says the answer was lost; the resend carries the same id |
| Geri yükleme | aynı dosya ikinci kez 0 ekler; XP taşıyan kayıt geri gelmez; yarım iş aynı iş olarak sürer | iş `failed`, kalan kısım sürdürülür | `fixtures/backupDrills.test.ts` › drill 5 — the same backup restored twice: the second adds nothing and earns nothing · › drill 3 — half a network: the restore stops, then continues as the same job, nothing twice |

## Bu kartta bulunan ve düzeltilen

1. **Koç v2 kartı** — `busy` durumu bir render geride kaldığı için aynı karede iki basış iki komut
   çağırıyordu; kart bitince tekrar basış yeniden yazıyordu. `useRef` tek atım koruması.
2. **Koç v1 onayı** — aynı sınıf: `stagedBusy` durumu ikinci basışı göremiyordu; ref koruması.
3. **Rutin bitir** — bitmiş oturum ikinci `finish()` ile geçmişe ikinci kez yazılıyordu.

Mutasyon: 5/5 (v2 koruması 2, v1 koruması 2, bitir 1).
