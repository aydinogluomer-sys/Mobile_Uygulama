# Karar Çerçeveleri → Alışkanlık Ekleme Akışı Entegrasyonu

## Bağlam (Neden?)

A.JPEG / A2.JPEG referansında 4 karar çerçevesi tanımlanmış. Bunlar orijinalde **görev** yönetimi içindir; biz bunları **alışkanlık oluşturma** akışına anlamlı biçimde tercüme edeceğiz. Amaç: kullanıcı sezgisel olarak "bu alışkanlık ne kadar önemli, ne kadar acil" diye karar versin ve sistem onu otomatik olarak doğru Kanban kutusuna (Aktif Odak / Bekleme Odası / Fikirler) yerleştirsin. Bu, mevcut **irade ekonomisi** (willpower) sistemiyle birleşir.

### 4 Çerçevenin Alışkanlığa Tercümesi

| Çerçeve | Orijinal | Alışkanlıkta Karşılığı | Form Alanı |
|---|---|---|---|
| **Etki-Şiddet** | Kritik/Yüksek/Orta/Düşük | Bu alışkanlık hayatımda ne kadar önemli? | `impact_level` (yeni) |
| **Eisenhower** | Acil × Önemli | Önemli = etki seviyesi; Acil = şimdi mi başlamalıyım? | `impact_level` + `urgency` (yeni) |
| **Kanban Durumları** | Fikir→Yapılacak→Yapılıyor→Askıda→Yapıldı | Habit `status`: idea→waiting→active→paused→completed | `status` (mevcut, `idea` eklenir) |
| **Karar/Triaj** | Hemen Yap/Planla/Beklet-İzle/Ele | Etki+Aciliyet+Kapasite → otomatik yerleşim | Hesaplanır (saklanmaz) |

### Triaj Mantığı (Eisenhower → Karar → Kanban)

```
                 ACİL                    ACİL DEĞİL
            ┌──────────────────┬──────────────────┐
  ÖNEMLİ    │ 🔥 HEMEN YAP     │ 📋 PLANLA        │
 (Kritik/   │ → Aktif Odak     │ → Bekleme Odası  │
  Yüksek)   │ status: active   │ status: waiting  │
            ├──────────────────┼──────────────────┤
  ÖNEMSİZ   │ 👁 BEKLET-İZLE   │ 🗑 ELE/İPTAL     │
 (Orta/     │ → Bekleme Odası  │ → Fikirler       │
  Düşük)    │ status: waiting  │ status: idea     │
            └──────────────────┴──────────────────┘
```

```ts
important = impact_level ∈ {critical, high}
urgent    = urgency === 'urgent'

triage = important && urgent   ? 'do_now'      // 🔥
       : important && !urgent  ? 'plan'        // 📋
       : !important && urgent  ? 'wait_watch'  // 👁
       :                         'eliminate'   // 🗑

// Kapasite kapısı (sadece 'do_now' aktif olmak ister):
finalStatus = triage==='do_now' && canActivate(cost) ? 'active'
            : triage==='eliminate'                    ? 'idea'
            :                                           'waiting'
```

### Etki → Önerilen İrade Maliyeti

Önemli alışkanlıklar daha fazla irade taahhüdü ister (irade ekonomisi doğal olarak önceliklendirmeyi zorlar):

| Etki | Önerilen `willpower_cost` |
|---|---|
| Kritik | 5 |
| Yüksek | 4 |
| Orta | 3 |
| Düşük | 2 |

Kullanıcı son adımda 1–10 arası override edebilir.

---

## Adım Yapısı: 4 → 5 Adım

| # | Eski | Yeni |
|---|---|---|
| 1 | İsim + Davranış Tipi | İsim + Davranış Tipi *(değişmez)* |
| 2 | Ölçüm Tipi | Ölçüm Tipi *(değişmez)* |
| 3 | Frekans | Frekans *(değişmez)* |
| 4 | İkon+Renk+İrade | **🆕 Öncelik & Strateji** (Etki + Aciliyet + canlı Eisenhower + Triaj kararı) |
| 5 | — | İkon+Renk+İrade Önizleme *(eski 4, etki→cost otomatik, Kanban hedefi gösterimi)* |

---

## Kullanıcı Akışı (User Flow)

```
[FAB +] → Onboarding açılır (üstte kalıcı İRADE BANDI)
 │
 ├─ Adım 1: "Sabah Sporu" yaz, Pozitif seç → Devam
 ├─ Adım 2: Evet/Hayır veya Ölçülebilir → Devam
 ├─ Adım 3: Günlük/Haftalık + günler + günün bölümü → Devam
 ├─ Adım 4 (YENİ): 
 │    • Etki seç (Kritik/Yüksek/Orta/Düşük)  ──┐
 │    • Aciliyet seç (Acil / Acil Değil)      ──┤→ canlı Eisenhower 2×2'de
 │    • Eisenhower matrisi ilgili hücreyi vurgular │  hücre parlar
 │    • Triaj kararı kartı belirir (🔥/📋/👁/🗑)  ──┘  willpower_cost otomatik önerilir
 │    → Devam
 └─ Adım 5:
      • İkon + Renk
      • İrade Maliyeti (etki'den önceden dolu, ayarlanabilir)
      • İrade bandı + Kanban hedef kartı:
          "🔥 Aktif Odak'a eklenecek" / "📋📋👁 Bekleme Odası'na" / "🗑 Fikirler'e"
      • Submit butonu hedefe göre renk+etiket
        → Kaydet → habits.tsx doğru bölüme yerleştirir + (aktifse) irade harcanır
```

---

## UI/UX Tasarımı

### İrade Bandı (mevcut, korunur)
Header ile progress dots arasında; skor %, kullanılan/bütçe, aktif slot. Renk: yeşil→amber→kırmızı.

### Adım 4 — Öncelik & Strateji (YENİ)

```
┌─────────────────────────────────────────┐
│  Öncelik & Strateji                       │
│  Bu alışkanlık ne kadar önemli ve acil?  │
│                                           │
│  ETKİ SEVİYESİ                            │
│  ┌────────┬────────┬────────┬────────┐   │
│  │🔴Kritik│🟠Yüksek│🟡 Orta │⚪Düşük │   │
│  │ hayati │ önemli │anlamlı │ küçük  │   │
│  └────────┴────────┴────────┴────────┘   │
│                                           │
│  ACİLİYET                                 │
│  ┌──────────────┬──────────────┐         │
│  │ ⚡ Acil      │ 🕐 Acil Değil│         │
│  │ Hemen        │ Zamanla      │         │
│  └──────────────┴──────────────┘         │
│                                           │
│  STRATEJİ HARİTASI                        │
│        Acil        Acil Değil             │
│      ┌────────┬────────┐                  │
│ Önem │🔥 HEMEN│📋PLANLA│  ← seçili hücre  │
│      ├────────┼────────┤    parlar        │
│ Önm- │👁BEKLET│🗑 ELE  │                  │
│      └────────┴────────┘                  │
│                                           │
│  ┌─────────────────────────────────────┐ │
│  │ 🔥 HEMEN YAP                        │ │
│  │ Aktif Odak'a alınmaya aday          │ │
│  │ Önerilen irade: 5                   │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

- **Etki kartları**: seçilince renkli kenarlık (kritik=#ef4444, yüksek=#f59e0b, orta=#eab308, düşük=#6b7280). Seçim `willpower_cost`'u otomatik günceller.
- **Aciliyet**: 2 kart, indigo seçim vurgusu.
- **Eisenhower 2×2**: küçük grid; seçili (urgent×important) hücresi triaj rengiyle dolu, diğerleri soluk. Etki/aciliyet değiştikçe anlık güncellenir.
- **Triaj kartı**: büyük, triaj rengiyle; ikon + başlık + "şu kutuya aday" + önerilen irade.

### Adım 5 — Son Ayarlar (eski 4, zenginleştirilmiş)
- İkon + Renk (değişmez).
- İrade Maliyeti satırı: etki seviyesinden önceden dolu; üstünde küçük not "Etki seviyene göre önerildi".
- İrade bandı (mevcut routingCard) → artık triaj+kapasiteyle hesaplanan **3 olası Kanban hedefi** gösterir: Aktif Odak (yeşil) / Bekleme Odası (amber) / Fikirler (gri).
- Submit butonu: hedefe göre renk + etiket ("Aktif Ekle" / "Beklemeye Ekle" / "Fikir Olarak Sakla").

### habits.tsx — Kanban Görünümü
- Mevcut: Aktif Odak + Bekleme Odası.
- **YENİ**: en altta soluk "💡 Fikirler" bölümü (status='idea'). Buradaki kartta "Aktifleştir" yerine "Beklemeye Al" aksiyonu.
- Habit kartlarına **etki çipi** (renkli nokta + Kritik/Yüksek/Orta/Düşük) + küçük triaj ikonu eklenir.

---

## Faz Planı (sırayla, bir faz bitmeden diğerine geçilmez)

### FAZ 1 — Veri Modeli & Yardımcılar
1. **Supabase migration** (`execute_sql` ile canlı DB):
   ```sql
   ALTER TABLE public.habits ADD COLUMN IF NOT EXISTS impact_level text;
   ALTER TABLE public.habits ADD COLUMN IF NOT EXISTS urgency text;
   ALTER TABLE public.habits ADD CONSTRAINT habits_impact_level_check
     CHECK (impact_level IS NULL OR impact_level IN ('critical','high','medium','low'));
   ALTER TABLE public.habits ADD CONSTRAINT habits_urgency_check
     CHECK (urgency IS NULL OR urgency IN ('urgent','not_urgent'));
   ```
   (status'ta CHECK yok → 'idea' migration gerektirmez.)
2. **`lib/supabase.ts`** — `Habit` tipine `impact_level`, `urgency` ekle; `status`'a `'idea'` ekle.
3. **`store/habitStore.ts`** — `fetchHabits` ve `addHabit` select listelerine `impact_level,urgency` ekle.
4. **`lib/triage.ts`** (YENİ) — paylaşılan tek kaynak:
   - `IMPACT_LEVELS` sabiti (key,label,color,suggestedCost)
   - `computeTriage(impact, urgency)`
   - `triageToStatus(triage, canActivate)`
   - `TRIAGE_META` (ikon,label,renk,kutuAdı)
5. **`components/AIRoutineModal.tsx`** — habit oluştururken yeni alanlara default ver (TS kırılmasın).
6. **Doğrulama**: `tsc --noEmit` temiz.

### FAZ 2 — Onboarding Adım 4 (Strateji)
1. `DEFAULT_FORM`'a `impact_level:'medium'`, `urgency:'not_urgent'` ekle.
2. `TOTAL_STEPS = 5`; eski step 4 → renderStep5; yeni `renderStep4` (strateji).
3. Etki seçici + aciliyet seçici + canlı Eisenhower 2×2 + triaj kartı.
4. Etki seçimi `willpower_cost`'u otomatik set eder.
5. `canProceed` step 4 için her zaman true (varsayılanlar dolu).
6. Yeni stiller.
7. **Doğrulama**: `tsc --noEmit` + manuel adım gezinme.

### FAZ 3 — Onboarding Adım 5 (Son Ayarlar + Routing)
1. `renderStep5` (eski 4) — irade maliyeti notu + önceden doldurma.
2. `willGoActive` → triaj tabanlı 3 yönlü hedef hesabı (`lib/triage.ts`).
3. routingCard 3 durumu (active/waiting/idea) gösterir.
4. Submit butonu 3 yönlü renk+etiket.
5. **Doğrulama**: `tsc --noEmit`.

### FAZ 4 — habits.tsx (Kanban + Yönlendirme)
1. `handleAddHabit`: `computeTriage` + `triageToStatus` ile status hesapla; aktifse `spend`.
2. `ideaHabits` filtresi + "💡 Fikirler" bölümü; kartında "Beklemeye Al" aksiyonu (`updateHabit status:'waiting'`).
3. Habit kartına etki çipi + triaj ikonu.
4. **Doğrulama**: `tsc --noEmit`.

### FAZ 5 — Uçtan Uca Doğrulama
1. `npx tsc --noEmit` (frontend).
2. Expo başlat; ekle akışını 4 senaryoyla test et:
   - Kritik+Acil (kapasite var) → Aktif Odak
   - Kritik+Acil (kapasite dolu) → Bekleme Odası
   - Yüksek+Acil Değil → Bekleme Odası (Planla)
   - Düşük+Acil Değil → Fikirler
3. Eisenhower hücresi ve triaj kartı seçimle anlık değişiyor mu.
4. Dark tema tutarlılığı.

---

## Dosya Özeti

| Dosya | Faz | Değişiklik |
|---|---|---|
| Supabase `habits` | 1 | `impact_level`, `urgency` kolonları |
| `lib/supabase.ts` | 1 | `Habit` tipi: impact_level, urgency, status+idea |
| `store/habitStore.ts` | 1 | select listeleri |
| `lib/triage.ts` | 1 | YENİ — triaj çekirdek mantığı |
| `components/AIRoutineModal.tsx` | 1 | yeni alanlara default |
| `components/HabitOnboarding.tsx` | 2,3 | Adım 4 (yeni) + Adım 5 (routing) |
| `app/tabs/habits.tsx` | 4 | Fikirler bölümü + triaj routing + çipler |

---

# ETAP 2 — İrade Motoru, Kapasite Yöneticisi, Silme Akışı

## Bağlam (Neden?)

Kullanıcı 6 ek istek verdi: (1) ekleme sonrası/ilk açılışta Aktif Oda + Bekleme Odası net görünsün, (2) irade (XP) maliyeti çok iyi/şeffaf hesaplansın, (3) daha fazla adım, (4) aktif alışkanlıklar iradeden yer, (5) limit aşılırsa ekleme engellenip "aktiflerden birini beklemeye al" önerisi, (6) her kartta silme → neden sor → geri-al → süre dolunca kalıcı sil.

## Adım sayısı: 5 → 6

5. 🆕 **Zorluk & İrade** — Kolay/Orta/Zor seçimi + şeffaf maliyet dökümü
6. Son Ayarlar (ikon/renk + cost override + routing)

## İrade (XP) Maliyet Formülü — `lib/triage.ts`

```
cost = round( difficulty × frekansFaktörü + davranışBonus + etkiBonus + takipBonus )  → 1..10
  difficulty:    Kolay=1, Orta=3, Zor=5   (DB difficulty kolonu)
  frekansFaktörü: günlük=1.0, haftalık=0.7, aylık=0.5
  davranışBonus:  negatif(bırakma)=+1.5, pozitif=0
  etkiBonus:      kritik=+1.5, yüksek=+1.0, orta=+0.5, düşük=0
  takipBonus:     ölçülebilir=+0.5, evet/hayır=0
```
Etki (adım 4) veya zorluk (adım 5) değişince otomatik yeniden hesaplanır; adım 6'da 1–10 override.

## Faz Planı (ETAP 2)

### FAZ A — Veri & İrade Motoru
- `Habit` tipine `difficulty: number`; `DEFAULT_FORM.difficulty=3`; store select'lerine `difficulty`.
- `lib/triage.ts`: `DIFFICULTY_LEVELS`, `computeWillpowerCost(form)`, `costBreakdown(form)`.
- Supabase: `habit_deletions` tablosu (id,user_id,habit_id,habit_name,reason,created_at) + RLS.

### FAZ B — Onboarding Adım 5 (Zorluk & İrade)
- Yeni `renderStep5` (zorluk kartları + maliyet dökümü); eski 5 → 6; TOTAL_STEPS=6.
- Zorluk/etki değişiminde `willpower_cost` otomatik.

### FAZ C — Habits ekranı: oda görünürlüğü + silme
- Aktif Oda + Bekleme Odası **her zaman** render (boş durum dahil).
- Her kartta çöp kutusu → `DeleteReasonModal` (hazır sebepler + not).
- Onay → optimistik gizle + (aktifse) irade iadesi + **Geri Al** toast (~6sn).
- Geri al → geri yükle; süre dolunca hard `DELETE` (cascade) + `habit_deletions` kaydı.

### FAZ D — Kapasite Yöneticisi
- do_now hedefli ekleme + yer yoksa: ekleme finalize edilmeden `CapacityModal`.
- Aktif alışkanlıkları "Beklemeye Al" (pause→refund) ile yer aç; yeterince boşalınca pending habit AKTİF eklenir.
- Seçenekler: Yer Aç / Beklemeye Ekle / Vazgeç.

### FAZ E — Doğrulama
- `tsc --noEmit` + Android bundle + DB round-trip (difficulty insert, habit_deletions insert).

---

# ETAP 3 — Bitiş Koşulu, Özet Adımı, Kanban "Tamamlandı"

## Bağlam (Neden?)

Denetim sonucu: 4 çekirdek çerçeve (Eisenhower + Etki-Şiddet + Triaj + Öncelik) tam entegre. Boşluklar: (a) A2 "Zaman Faktörü → Son Tarih" karşılığı ekleme akışında yok (`end_condition` şemada var, UI yok), (b) A2 "Mini Tablo Formatı" gibi kaydetmeden önce karar özeti yok, (c) Kanban'da "Yapıldı/Tamamlandı" durumu arayüzde yok. Bu etap bu üç boşluğu kapatır.

## Adım sayısı: 6 → 7

- **Adım 3 (Frekans)** içine **Bitiş Koşulu** alt-bölümü eklenir (yeni adım değil).
- **Adım 6 (Son Ayarlar)**: ikon/renk/irade maliyeti (routing kartı buradan çıkar).
- **🆕 Adım 7 (Özet & Onayla)**: tüm kararların özeti (Mini Tablo karşılığı) + hedef kartı + Submit.

## Faz Planı (ETAP 3)

### FAZ 1 — Bitiş Koşulu (`end_condition`)
- `Habit.end_condition` ve store select zaten hazır (`EndCondition = {kind:'date'|'amount', value}`).
- `renderStep3` sonuna "Bitiş Koşulu" alt-bölümü:
  - 3 seçenek çipi: **Süresiz** (null) · **Tarihe kadar** (date) · **Hedef sayıya** (amount)
  - date → hızlı presetler [30/60/90/180 gün] → `{kind:'date', value: format(addDays(now,N),'yyyy-MM-dd')}` (datepicker bağımlılığı yok)
  - amount → numeric TextInput + "kez" → `{kind:'amount', value:N}`
- Kart/özette insanca gösterim: "Süresiz" / "DD.MM.YYYY'e kadar" / "N kez".
- Yardımcı: `lib/triage.ts` veya inline `endConditionLabel(ec)`.

### FAZ 2 — Adım 7 "Özet & Onayla"
- Yeni `renderStep7`: tek kartta özet satırları — Ad (ikon/renk) · Davranış · Takip (evet-hayır/ölçülebilir+birim/hedef) · Frekans + Bitiş · Etki · Aciliyet · Triaj kararı · İrade maliyeti.
- Routing/hedef kartı (Aktif/Bekleme/Fikir) Adım 6'dan buraya taşınır.
- Submit butonu (dinamik renk/etiket) burada; Adım 6 artık "Devam".
- `TOTAL_STEPS=7`, render switch'e `step===7`.

### FAZ 3 — Kanban "Tamamlandı"
- `habitStore`: `completeHabit(id, wasActive, cost)` → status `completed` (+ aktifse `refund`).
- `habits.tsx` ve `timeline.tsx`:
  - Aktif/Bekleme kartlarına **"Tamamla"** aksiyonu (✓).
  - **"Tamamlanan"** bölümü (soluk, sayıyla) — `status==='completed'` kartları; "Geri Aç" (→ waiting) + sil.
- Böylece Kanban: Fikir(idea) · Yapılacak(waiting) · Yapılıyor(active) · **Yapıldı(completed)** görünür olur.

### FAZ 4 — Doğrulama
- `tsc --noEmit` (her faz) + Android bundle + DB round-trip (`end_condition` jsonb insert, `status='completed'` insert/oku/temizle).

## İleriye Dönük (bu etapta DEĞİL)
Tahmini süre (dk/gün), hatırlatıcı saati, alışkanlık zincirleme (cue), Dashboard & Filtreler, tam AI Coach, "Askıda/Bloke" ayrı durumu.

## Dosya Özeti (ETAP 3)
| Dosya | Faz | Değişiklik |
|---|---|---|
| `components/HabitOnboarding.tsx` | 1,2 | Bitiş koşulu alt-bölümü + Adım 7 özet + routing taşı |
| `lib/triage.ts` | 1 | `endConditionLabel` |
| `store/habitStore.ts` | 3 | `completeHabit` |
| `app/tabs/habits.tsx` | 3 | Tamamla aksiyonu + Tamamlanan bölümü |
| `app/tabs/timeline.tsx` | 3 | Tamamla aksiyonu + Tamamlanan bölümü |

---

# ETAP 4 — İleriye Dönük 5 Özellik (Tam Set)

## Bağlam (Neden?)
Kullanıcı 5 ileriye dönük özelliğin tamamını istedi. Her madde bağımsız bir ana FAZ; her ana FAZ kendi içinde alt-fazlara bölünür; her ana FAZ bittiğinde **test kapısı** (tsc + Android bundle + gerekli DB round-trip) çalışır, geçerse sonraki FAZ'a geçilir. Onay beklenmez.

## Test Protokolü (her ana FAZ sonunda)
1. `npx tsc --noEmit` temiz olmalı.
2. `npx expo export --platform android` başarılı bundle üretmeli (tüm modül grafiği çalışma-zamanı derlemesi).
3. Veri modeli değiştiyse canlı Supabase round-trip (insert/oku/temizle).
Başarısızsa düzelt, tekrar test et; geçmeden sonraki FAZ'a geçme.

---

## FAZ 1 — Tahmini Süre (dk/gün)
**Amaç:** Alışkanlığın günlük tahmini süresi; irade maliyetine girer, ileride Odak/Derin Çalışma'ya bağlanır.

- **1.1 Veri:** `habits.estimated_minutes int DEFAULT 0`. `Habit` tipine `estimated_minutes:number`; `DEFAULT_FORM=0`; store select'lere ekle; `routineStore` default 0.
- **1.2 İrade motoru:** `lib/triage.ts` `CostInput`'a `estimated_minutes`; `costBreakdown`'a `timeBonus = min(2, floor(dk/30)*0.5)`; formül + döküm satırı.
- **1.3 Onboarding UI:** Adım 5 (Zorluk & İrade) içine "Tahmini süre/gün" — çipler [5/15/30/45/60/90 dk] + serbest giriş; değişince cost yeniden hesap.
- **1.4 Gösterim:** Özet (Adım 7) + kartlarda küçük "⏱ N dk" rozeti (habits + timeline).
- **1.5 TEST.**

## FAZ 2 — Hatırlatıcı Saati
**Amaç:** Alışkanlığa günlük yerel bildirim saati.

- **2.1 Bağımlılık & config:** `npx expo install expo-notifications expo-device`; `app.json` plugin + (varsa) izin alanları.
- **2.2 Veri:** `reminders` jsonb (mevcut) → `{ time:'HH:mm', enabled:bool } | null`. `Habit` tipine `reminders`; form default null; store select'e ekle.
- **2.3 Onboarding UI:** Adım 3'e "Hatırlatıcı" alt-bölümü — aç/kapa + saat çipleri [07:00/08:00/12:00/18:00/21:00] + serbest HH:MM.
- **2.4 Zamanlama lib:** `lib/notifications.ts` — `ensurePermission()`, `scheduleHabitReminder(habit)`, `cancelHabitReminder(id)`, günlük tekrarlı tetik.
- **2.5 Entegrasyon:** ekle/aktifleştir → schedule; beklet/tamamla/sil/arşiv → cancel; uygulama açılışında izin + senkron. Kartlarda "🔔 HH:mm" rozeti.
- **2.6 TEST.** (Bildirim teslimi cihazda; burada tsc+bundle.)

## FAZ 3 — Alışkanlık Zincirleme (Çağrışım / Cue)
**Amaç:** "X alışkanlığından sonra" veya "Kahvaltıdan sonra" tetikleyici (atomic habits).

- **3.1 Veri:** `cue_habit_id uuid REFERENCES habits(id) ON DELETE SET NULL`, `cue_note text`. Tip + form default null + select.
- **3.2 Onboarding UI:** Adım 3'e "Çağrışım" alt-bölümü — mod seçimi: Yok / Mevcut alışkanlıktan sonra (liste) / Serbest metin.
- **3.3 Gösterim:** kart + özette "🔗 X'ten sonra" veya "📝 not". `lib/triage.ts` `cueLabel(habit, allHabits)`.
- **3.4 TEST.**

## FAZ 4 — Dashboard & Filtreler
**Amaç:** Tüm alışkanlıkların tablo görünümü + Durum/Etki/Aciliyet filtreleri (A2 "Mini Tablo + Dashboard & Filtreler").

- **4.1 Ekran:** `app/screens/dashboard.tsx` — satır listesi: Ad · Durum · Etki · Karar(triaj) · İrade · Bitiş; üstte özet metrikler.
- **4.2 Filtreler:** çip barı — Durum (active/waiting/idea/paused/completed), Etki (kritik/yüksek/orta/düşük), Aciliyet; çoklu seçim + temizle; arama (ad).
- **4.3 Navigasyon:** `app/screens/_layout.tsx` stack + `components/Drawer.tsx` ALIŞKANLIKLAR grubuna "Dashboard".
- **4.4 TEST.**

## FAZ 5 — Askıda / Bloke Durumu (Kanban 5. durum)
**Amaç:** "Beklemede (kuyruk)" ile "Askıda/Bloke (geçici durduruldu)" ayrımı.

- **5.1 Store/aksiyon:** `blockHabit(id,cost,wasActive)` → status `paused` (+ aktifse refund); `resumeHabit` → waiting. Mevcut "Beklet" (waiting) korunur; ayrı "Askıya Al".
- **5.2 UI:** habits + timeline'da "Askıda" bölümü; aktif/bekleme kartına "Askıya Al" (pause-circle), askıdakine "Devam Et" (→ waiting). Soluk + kilit ikonu.
- **5.3 Yansıma:** Dashboard filtresine 'paused' dahil; Kanban tam 5 durum (Fikir/Yapılacak/Yapılıyor/Yapıldı/Askıda).
- **5.4 TEST.**

## Yeni Supabase kolonları (özet)
```sql
ALTER TABLE habits ADD COLUMN IF NOT EXISTS estimated_minutes int DEFAULT 0;
ALTER TABLE habits ADD COLUMN IF NOT EXISTS cue_habit_id uuid REFERENCES habits(id) ON DELETE SET NULL;
ALTER TABLE habits ADD COLUMN IF NOT EXISTS cue_note text;
-- reminders jsonb, preferred_time_of_day text: mevcut
```

## Dosya Özeti (ETAP 4)
| Dosya | FAZ | Değişiklik |
|---|---|---|
| Supabase habits | 1,3 | estimated_minutes, cue_habit_id, cue_note |
| lib/supabase.ts | 1,2,3 | Habit: estimated_minutes, reminders, cue_* |
| lib/triage.ts | 1,3 | timeBonus, cueLabel |
| lib/notifications.ts (YENİ) | 2 | yerel bildirim zamanlama |
| store/habitStore.ts | 1,2,3,5 | select + blockHabit/resumeHabit |
| store/routineStore.ts | 1 | default estimated_minutes |
| components/HabitOnboarding.tsx | 1,2,3 | tahmini süre + hatırlatıcı + çağrışım + özet |
| app/tabs/habits.tsx | 1,2,3,5 | rozetler + Askıda bölümü + bildirim kancaları |
| app/tabs/timeline.tsx | 1,2,3,5 | rozetler + Askıda bölümü |
| app/screens/dashboard.tsx (YENİ) | 4 | tablo + filtreler |
| app/screens/_layout.tsx, Drawer.tsx | 4 | navigasyon |
| app.json, package.json | 2 | expo-notifications |

---

# ETAP 5 — Tam AI Coach (kalan dokümante madde)

## Bağlam (Neden?)
`app/screens/ai-coach.tsx` arayüzü var ama backend coach modunu desteklemiyor: `generate-routine` edge function yalnızca `body.prompt` okuyup rutin JSON (`{name,description,items}`) döndürüyor; AI Coach'un gönderdiği `{message, context, mode:'coach'}` yok sayılıyor ve `{reply}` dönmüyor → coach pratikte ÇALIŞMIYOR. Bu etap coach modunu uçtan uca işler hale getirir. Rutin modu (AIRoutineModal → `{prompt}`) AYNEN korunur.

## Faz Planı (ETAP 5)

### FAZ 1 — Backend: coach modu
`supabase/functions/generate-routine/index.ts`:
- `mode` oku (varsayılan 'routine'). Rate limit + cooldown ikisinde de geçerli.
- **routine** (mevcut, değişmez): `prompt` → rutin JSON.
- **coach** (yeni): `message` (3–500 char) + `context` (activeHabits[], habitCount, pendingTaskCount). Koçluk sistem promptu (ADHD-dostu, yargılamayan, kısa, Türkçe, somut öneri). Düz metin `{reply: "..."}` döndür (JSON parse YOK).
- MCP `deploy_edge_function` ile deploy; `get_logs` ile boot hatası kontrolü.

### FAZ 2 — Frontend hizalama
- `ai-coach.tsx`: hata mesajını sunucudan düzgün çek (routineStore deseni: `error.context.json().error`), 429/limit mesajları görünsün.
- Bağlam zenginleştir: willpower durumu + bekleyen görev sayısı (zaten var) gönder.
- Navigasyon zaten var (Drawer KİŞİSEL + _layout). Boş durum/ipucu metni gözden geçir.

### FAZ 3 — Test
- `tsc --noEmit` + Android bundle.
- Edge function deploy başarılı + logs temiz.
- NOT: gerçek AI yanıtı kullanıcı JWT'si gerektirir → cihazda giriş yapılmış oturumla doğrulanır (bu ortamda auth'lu uçtan uca çağrı yapılamaz).

## Dosya Özeti (ETAP 5)
| Dosya | FAZ | Değişiklik |
|---|---|---|
| supabase/functions/generate-routine/index.ts | 1 | coach modu + deploy |
| app/screens/ai-coach.tsx | 2 | hata çıkarımı + bağlam |

---

# ETAP 6 — Katmanlı Abonelik + Focus Point Kredi Sistemi (Tiered Monetization)

## Bağlam (Neden?)
AI maliyetini kontrol etmek ve gelir üretmek için katmanlı abonelik (Free / Nexus Plus / Nexus Pro) + tüketim bazlı **Focus Point** kredi sistemi kurulur. AI yine backend Claude anahtarıyla çalışır; her çağrı krediden düşer. Krediler aylık yenilenir, devretmez. Gerçek ödeme (IAP/Stripe) bu ortamda test edilemez → ödeme sınırına kadar kurulur, test için mock aktivasyon eklenir, gerçek IAP dokümante edilir.

## Parametreler (varsayımlar)
| Katman | Aylık Grant | Fiyatlar |
|---|---|---|
| Free | 30 FP | — |
| Plus | 100 FP | Haftalık $4.99 · Aylık $12.99 · Yıllık $39.99 |
| Pro | 1000 FP | Aylık $29.99 · Yıllık $99.99 (haftalık yok) |

**Aksiyon maliyeti (FP):** Coach sohbet = 5 · Rutin planlama (ağır) = 25.
Krediler **aylık** yenilenir (reset, devretmez). Abonelik süresi bitince Free'ye düşer.

## Faz Planı (her faz sonunda tsc + bundle + DB/deploy test kapısı)

### FAZ 1 — Veri modeli + kredi RPC'leri (Supabase)
- `user_subscriptions` (user_id PK, tier, billing_period, status, focus_points, monthly_grant, credits_period_end, sub_period_end, provider, provider_ref) + RLS (yalnız SELECT own; yazma DEFINER fonksiyonlarıyla).
- `credit_transactions` (ledger: delta, reason, balance_after) + RLS SELECT own.
- SECURITY DEFINER fonksiyonlar (hepsi `auth.uid()` ile yalnız kendi satırına): 
  - `get_or_init_subscription()` — yoksa free oluştur; süre dolduysa kredi yenile + abonelik bittiyse Free'ye düşür.
  - `spend_focus_points(amount, reason)` → `(ok, balance)` atomik düşüm + ledger.
  - `mock_activate_subscription(tier, period)` — DEV-ONLY: tier ata + grant yükle. ⚠️ Prod'da ödeme-doğrulamalı webhook ile değiştirilecek.
- Test: SQL round-trip (init → spend → yetersiz → mock activate → renewal).

### FAZ 2 — Edge function kredi gating
- `generate-routine`: aksiyon maliyeti (coach=5, routine=25). Önce `get_or_init_subscription` ile bakiye kontrol → yetersizse `{error, code:'INSUFFICIENT_CREDITS', balance, cost}` 402. Anthropic başarılıysa `spend_focus_points` ile düş; yanıta `balance` ekle. (Eski 3/gün limiti kaldırılır; kredi sistemi gating'i devralır, cooldown kalır.)
- Deploy + logs.

### FAZ 3 — Frontend config + store
- `lib/subscription.ts` — TIERS (grant, fiyatlar, özellik listeleri), ACTION_COST.
- `store/subscriptionStore.ts` — `fetch()` (get_or_init RPC), `tier`, `focusPoints`, `canAfford(cost)`, `activateMock(tier, period)`, `refresh()`.
- Test (tsc + bundle).

### FAZ 4 — Paywall + Focus Point UI + entegrasyon
- `app/screens/paywall.tsx` — Plus/Pro kartları, fiyat çıpalama (Pro öne), özellik listeleri, periyot seçimi, "Abone Ol" → `activateMock` (test). En altta "gerçek ödeme yakında" notu.
- Focus Point rozeti (AI Coach başlığı + Drawer'da kalan FP).
- AI Coach + AIRoutineModal: `INSUFFICIENT_CREDITS` → paywall'a yönlendiren CTA; başarılı çağrı sonrası `subscriptionStore.refresh()`.
- Navigasyon: `_layout.tsx` + Drawer (SİSTEM/KİŞİSEL → "Üyelik & Krediler").
- Test (tsc + bundle).

### FAZ 5 — Gerçek IAP dokümantasyonu (kod değil)
- RevenueCat (RN cross-store) entegrasyon adımları implementation.md'ye: ürün tanımları, `react-native-purchases`, satın alma → store webhook → sunucu doğrulama → `activate_subscription` (verified) ile tier yükleme. `mock_activate` kaldırılır.

## Dosya Özeti (ETAP 6)
| Dosya | FAZ | Değişiklik |
|---|---|---|
| Supabase (tablolar+RPC) | 1 | user_subscriptions, credit_transactions, fonksiyonlar |
| supabase/functions/generate-routine | 2 | kredi gating |
| lib/subscription.ts (YENİ) | 3 | tier/fiyat/maliyet config |
| store/subscriptionStore.ts (YENİ) | 3 | abonelik+kredi store |
| app/screens/paywall.tsx (YENİ) | 4 | paywall |
| app/screens/ai-coach.tsx, components/AIRoutineModal.tsx | 4 | yetersiz kredi CTA + refresh |
| app/screens/_layout.tsx, components/Drawer.tsx | 4 | navigasyon |

## ETAP 6 — FAZ 5: Gerçek Ödeme Entegrasyonu (RevenueCat) — Yapılacaklar

Şu an `mock_activate_subscription` ile test ediliyor. Yayına çıkmadan önce gerçek ödeme:

**Önerilen: RevenueCat** (RN'de iOS+Android tek SDK, makbuz doğrulama dahil).

1. **Mağaza ürünleri tanımla**
   - App Store Connect + Play Console'da abonelik ürünleri: `plus_weekly`, `plus_monthly`, `plus_yearly`, `pro_monthly`, `pro_yearly` (fiyatlar lib/subscription.ts ile aynı).
2. **RevenueCat kurulumu**
   - `npx expo install react-native-purchases` (+ dev build; Expo Go desteklemez).
   - RevenueCat dashboard'da ürünleri "Entitlements"a bağla: `plus`, `pro`. Offerings oluştur.
   - `Purchases.configure({ apiKey })` app açılışında; kullanıcıyı `Purchases.logIn(user.id)` ile eşle.
3. **Paywall'u bağla**
   - `paywall.tsx`'te `activateMock` yerine `Purchases.purchasePackage(pkg)`.
   - Satın alma sonrası `customerInfo.entitlements.active` → tier belirle.
4. **Sunucu doğrulama (kritik)**
   - RevenueCat **webhook** → yeni bir edge function (`subscription-webhook`, `verify_jwt:false`, imza doğrulamalı) → doğrulanmış olayda `activate_subscription(tier, period)` (SECURITY DEFINER, **service-role/webhook'tan** çağrılır) ile tier + grant yükle.
   - **`mock_activate_subscription` fonksiyonunu KALDIR** (client'ın kendine Pro vermesini engelle).
5. **Geri yükleme & iptal**
   - "Satın alımları geri yükle" butonu (`Purchases.restorePurchases`).
   - Webhook `EXPIRATION`/`CANCELLATION` → `get_or_init_subscription`'daki süre-bitti mantığı zaten Free'ye düşürür; webhook anında senkron yapar.
6. **Web için (opsiyonel):** Stripe Checkout + Stripe webhook → aynı `activate_subscription`.

**Güvenlik notu:** Tier yükseltme YALNIZCA doğrulanmış sunucu webhook'undan yapılmalı; istemci asla doğrudan tier set edememeli.

## ETAP 6 — FAZ 6: Sunucu-tarafı ödeme altyapısı (TAMAMLANDI)
Kuruldu & test edildi:
- `activate_subscription(user_id, tier, period, provider, ref)` — **service-role only** (authenticated/anon EXECUTE reddedildi; doğrulandı). Upsert + grant + ledger.
- `expire_subscription(user_id)` — Free'ye düşürür (service-role only).
- `subscription-webhook` edge function (verify_jwt=false, `REVENUECAT_WEBHOOK_SECRET` ile Bearer doğrulama). INITIAL_PURCHASE/RENEWAL/PRODUCT_CHANGE/UNCANCELLATION/NON_RENEWING → activate; EXPIRATION → expire. Yetkisiz istek → 401 (doğrulandı).
- `mock_activate_subscription` hâlâ duruyor (dev paywall testi için) — **prod'da KALDIRILACAK**.

### Kullanıcının yapması gerekenler (sunucu için)
1. Supabase Dashboard → Edge Functions → Secrets: `REVENUECAT_WEBHOOK_SECRET` = güçlü rastgele değer.
2. RevenueCat → Integrations → Webhooks: URL `https://kbcuolhjjnmhjaarxxmu.supabase.co/functions/v1/subscription-webhook`, Authorization header `Bearer <aynı secret>`.
3. RevenueCat ürün id'leri: `plus_weekly/plus_monthly/plus_yearly/pro_monthly/pro_yearly` (webhook mapProduct ile uyumlu).
4. İstemci: `Purchases.logIn(user.id)` → `app_user_id` Supabase user.id ile eşleşmeli (webhook bunu kullanır).
5. Client SDK bağlandıktan sonra `mock_activate_subscription` DROP edilir; paywall `activateMock` yerine gerçek satın almayı kullanır.

## ETAP 6 — FAZ 7: Kredi Geçmişi ekranı (TAMAMLANDI)
- `app/screens/credit-history.tsx` — `credit_transactions` ledger'ı (RLS SELECT own): özet (mevcut/kazanılan/harcanan) + işlem listesi (yenileme/aktivasyon/ai_coach/ai_routine, +/− renkli, bakiye). Paywall'da "Geçmiş" linki + stack kaydı. tsc + web export ✅.

---

# DEVİR & UÇTAN UCA TEST REHBERİ (FAZ C)

## ŞİMDİ test edilebilir (dışsal adım gerekmez)
Dev'de/web'de doğrulanabilir:
- Tüm alışkanlık akışı (7 adım), Kanban 5 durum, takip+yönetim, dashboard/filtreler, OKR, kredi geçmişi.
- **Paywall**: Drawer → Üyelik & Krediler → Plus/Pro "Abone Ol" (mock) → FP 100/1000 yüklenir → Kredi Geçmişi'nde "aktivasyon" satırı.
- AI Coach FP barı + "Yükselt" akışı (yanıt için Track 1 gerekir).

## TRACK 1 — AI'yı çalıştır (Anthropic kredisi) [5 dk]
1. console.anthropic.com → Plans & Billing → kredi yükle.
2. AI Coach'a yaz → gerçek yanıt gelir, **5 FP düşer**; AI Rutin → **25 FP düşer**.
3. FP bitince → 402 → AI Coach'ta "Yükselt", AIRoutineModal'da "Üyeliği Yükselt" CTA'sı çıkar. Kredi Geçmişi harcamaları gösterir.
> Not: Gating zaten çalışıyor; FP yalnızca AI çağrısı BAŞARILI olunca düşer (başarısız çağrı ücretsiz).

## TRACK 2 — Gerçek ödeme (RevenueCat) [sonra, yayın öncesi]
1. Supabase → Edge Functions → Secrets: `REVENUECAT_WEBHOOK_SECRET` = güçlü rastgele.
2. RevenueCat → Webhooks: URL `https://kbcuolhjjnmhjaarxxmu.supabase.co/functions/v1/subscription-webhook`, Authorization `Bearer <secret>`.
3. Ürünler: `plus_weekly/monthly/yearly`, `pro_monthly/yearly`.
4. `npx expo install react-native-purchases` (dev build) → `Purchases.logIn(user.id)` → paywall'da `activateMock` yerine gerçek satın alma.
5. Çalışınca: `DROP FUNCTION mock_activate_subscription(text,text);` (istemci kendine tier veremesin).

## Production Android binary
Windows hermesc `expo export`'ta çöküyor (toolchain). Gerçek APK/AAB için **EAS Build**: `npx eas build -p android` (cloud/Linux). Dev/web etkilenmez.

---

# ETAP 7 — Özet ↔ Dashboard Bağlantısı (Eisenhower deseniyle paralel)

## Bağlam
Alışkanlık ekleme Adım 7 ("Özet & Onayla") tek alışkanlığın mini-tablosu; bağımsız Dashboard tüm alışkanlıkların aynı tablosu. Aynı `lib/triage` dilini paylaşıyorlar ama aralarında açık bağ yok. Eisenhower'da yaptığımız gibi (in-flow ↔ standalone) bağlanacak. Karar: ikisi de kalır, çift yönlü köprü kurulur.

## Yaklaşım
1. **Adım 7 (HabitOnboarding renderStep7)** — özet tablonun altına ayna notu: "📊 Bu özet Dashboard'da bir satır olarak görünür." (Modal içinden navigasyon yok — taslak kaybolmasın; pasif not.)
2. **Dashboard (`app/screens/dashboard.tsx`)** — eyleme dönük köprü:
   - Üstte tek satır ipucu: "Her satır = bir alışkanlığın özeti · dokun → yönet · + → ekle".
   - Satırlar tıklanabilir → `router.push('/tabs/habits')` (yönet).
   - Sağ-altta **"+" FAB** → `/tabs/habits` (ekle; yeni alışkanlık panoda satır olur).
3. Görsel dil zaten ortak (computeTriage/TRIAGE_META/impactMeta/endConditionLabel) — yeni mantık/şema yok.

## Doğrulama
- `tsc --noEmit` + `expo export --platform web`.
- Manuel: Dashboard'da satıra dokun → habits; + → habits; Adım 7'de ayna notu görünür; yeni eklenen alışkanlık panoda satır olarak çıkar.

---

# ETAP 8 — Alışkanlık Kategorisi (Yaşam Alanı) + İstatistikte Alan Performansı

## Bağlam
Kullanıcı her alışkanlığa bir **yaşam alanı kategorisi** (Sağlık/Kariyer/Eğitim/Finans/Aile/Sosyal/Ruhsal/Hobiler = `LIFE_AREAS`) seçmek ve **İstatistikler** ekranında bu alanlarda nasıl gittiğini (alışkanlık tamamlamalarından türetilmiş) görmek istiyor. Mevcut `life-areas.tsx` elle 1-10 öz-değerlendirme radarı; bu yeni görünüm **veri-temelli** (habit_logs'tan).

## Faz Planı (her faz sonunda tsc + web export; veri değişiminde SQL round-trip)

### FAZ 1 — Veri modeli
- Supabase: `ALTER TABLE habits ADD COLUMN life_area text` + CHECK (8 anahtar: saglik/kariyer/egitim/finans/aile/sosyal/ruhsal/hobiler, NULL serbest).
- `lib/supabase.ts` `Habit`: `life_area: string | null`.
- `store/habitStore.ts` select listelerine `life_area`.
- `HabitOnboarding` `DEFAULT_FORM.life_area = null`.

### FAZ 2 — Onboarding kategori seçimi
- Adım 1'e (İsim + Davranış) **"Yaşam Alanı"** çip ızgarası (`LIFE_AREAS`, renkli, tek seçim, opsiyonel).
- Adım 7 özet tablosuna "Alan" satırı (seçilen alan label'ı).

### FAZ 3 — İstatistik alan performansı
- `components/AreaRadar.tsx` (YENİ, paylaşılan): `life-areas.tsx`'deki radar SVG'si buraya taşınır; props `{ values: Record<AreaKey,number>(0-10), size?, color? }`. `life-areas.tsx` bunu kullanacak (DRY).
- `stats.tsx`:
  - `loadData`'ya 30 günlük `habit_logs(habit_id, state done/partial)` sorgusu.
  - Render'da her alan için: o alana ait aktif alışkanlık sayısı + son 30g tamamlama oranı `done/(aktifSayı×30)` (capped 100). Radar değeri = oran/10.
  - "Yaşam Alanları" kartı (Trend kartından sonra): radar + alan başına satır (renk noktası, label, "(N alışkanlık)", %). Alan boşsa soluk "alışkanlık yok".

### FAZ 4 — Doğrulama
- SQL: life_area insert/oku/temizle.
- `tsc --noEmit` + `expo export --platform web`.
- Manuel: alışkanlığa alan seç → stats'ta o alanın çubuğu/radarı tamamlamalarla dolar.

## Dosyalar
| Dosya | Değişiklik |
|---|---|
| Supabase habits | +life_area |
| lib/supabase.ts, store/habitStore.ts | Habit.life_area + select |
| components/HabitOnboarding.tsx | Adım 1 alan çipleri + Adım 7 satırı |
| components/AreaRadar.tsx (YENİ) | paylaşılan radar |
| app/screens/life-areas.tsx | paylaşılan radarı kullan |
| app/tabs/stats.tsx | alan performans kartı + 30g sorgu |

---

# ETAP 9 — İstatistik Özet: alışkanlık-odaklı sayılar

## Bağlam / Neden
Kullanıcının 0 görevi (task) var, sadece alışkanlığı var (1 aktif/4 bekleyen/1 tamamlanan). Özet'teki "Bekleyen Görev / Tamamlanan Görev / Aktif Görev" task verisinden 0 gösteriyor; kullanıcı bunları alışkanlık (Bekleme=4, Tamamlanan=1) sanıp "yanlış" diyor. Çözüm: Özet'i alışkanlık-odaklı yap, görev sayılarını yalnız görev varsa göster.

## FAZ 1 — stats.tsx Özet düzeltmesi
- Alt "Özet" quick kartı → hesaplanan `summaryRows`: Aktif Odak / Bekleme Odası (waitingHabits) / Tamamlanan (completedHabits) / Toplam Tamamlama. `tasks.length > 0` ise ek satırlar: Bekleyen Görev / Tamamlanan Görev.
- Grid 2'deki "Aktif Görev" (activeTasks=0) kartı → "Bu Ay" (monthCompletions) ile değiştir.

## FAZ 2 — Test
- `tsc --noEmit` + `expo export --platform web`.
- Manuel: Özet'te Bekleme Odası 4, Tamamlanan 1 görünür; görev yoksa görev satırları çıkmaz.

---

# ETAP 10 — Oran-temelli Yıllık Isı Haritası

## Bağlam / Neden
Mevcut "Yıllık Aktivite" ısı haritası rengi o günkü ham tamamlama SAYISINA göre (1/2/3/4+). Kullanıcı, rengin günlük tamamlama ORANINA (yapılan/beklenen) göre olmasını, 0'da gri, yüksek oranda parlak yeşil olmasını istiyor — yıllık 365 kare, günü gününe.

## FAZ 1 — Oran renklendirme (stats.tsx)
- Payda D = `max(1, activeHabits.length)`.
- Hücre oranı = `min(1, (heatmap[gün] ?? 0) / D)`.
- `ratioColor(r)`: 0→#1a1a1a (gri); (0,.2]→#0e4429; (.2,.4]→#006d32; (.4,.6]→#15803d; (.6,.8]→#26a641; >.8→#39d353.
- renderHeatmap hücre rengi = ratioColor; lejant 0%→100% gradiyent; alt başlık "Günlük tamamlama oranı".

## FAZ 2 — Kapsamlılık
- Ay etiketleri: hafta sütunlarının üstünde, ay değiştiğinde MONTHS_TR kısaltması (aynı sütun genişliği/gap ile hizalı, aynı yatay ScrollView içinde).
- Hücre tıklanabilir → `selectedDay` state → grid altında "DD.MM.YYYY · %oran (sayı/aktif)" satırı.

## FAZ 3 — Test
- `tsc --noEmit` + `expo export --platform web`.
- Manuel: günlük renk orana göre değişiyor; ay etiketleri hizalı; hücreye dokununca detay çıkıyor.

---

# ETAP 11 — Odak (Focus): Tema · Ayarlar · Raporlar

## Bağlam / Neden
Referans artifact (POS v2 web) "Odak" modunda **Tema** butonu (arka plan paneli), **Ayarlar** butonu (çok bölümlü ayarlar) ve **Raporlar** özelliği var. RN uygulamasının Odak sekmesinde: Raporlar HİÇ yok; Tema dedike buton değil (inline preset şeridi); Ayarlar yalnız 3 süre alanı. Bu üç özellik RN'e uyarlanacak (gradient yok — `expo-linear-gradient` yüklü değil; düz renk + overlay kullanılır).

**Ortak mimari:** Odak ekranı başlık aksiyon satırına 3 ikon buton → Raporlar (`stats-chart-outline`), Tema (`color-palette-outline`), Ayarlar (`settings-outline`). Her biri tam-ekran `Modal`. Bileşenler `components/focus/` altında. Renkler `lib/tokens.ts`. `focus_sessions` kolonları: id,user_id,task_id,task_title,mode,started_at,ended_at,planned_seconds,completed_seconds,completed,created_at (mode hep 'work').

**Test geçidi (her faz):** `cd frontend && node run-tests.js` → tsc 0 hata + **92/92** (regresyon yok). Geçmeden sonraki faza geçilmez.

## FAZ 1 — Raporlar
- `lib/focusReport.ts` (yeni, saf fn): `rangeStart(range)`, `inRange(sessions,range)`, `summary` (toplam saniye/oturum/odaklı gün/tamam/kesilen), `byTask`, `buckets(range)` (today=saat, week=7 gün, month=gün, year=ay), `ranking` (en çok odaklanılan görev, en uzun toplam, en çok tamamlanan, en verimli gün/saat, streak), `fmtDuration`/`fmtHours`. mode='work' & tamamlanan seanslar baz.
- `components/focus/FocusReportModal.tsx` (yeni): üstte range filtresi (Bugün/Hafta/Ay/Yıl) + 3 sekme (Özet/Detay/Sıralama). Özet: 3 stat kartı + bar grafik (View yükseklikleri) + göreve göre süre listesi. Detay: seans satırları. Sıralama: rank kartları. Supabase'den kendi `focus_sessions` çekilir (RLS). Boş durum.
- `app/tabs/focus.tsx`: "Raporlar" ikon butonu → modal aç.
- **Test:** `node run-tests.js` (92/92, tsc 0); DB sanity (focus_sessions kolon uyumu); manuel akış.

## FAZ 2 — Tema
- `FOCUS_PRESETS` zenginleştir (daha fazla atmosferik düz-renk preset). `focusStore.settings.overlayOpacity` ekle (zemin koyuluğu, 0–0.6).
- `components/focus/FocusThemeModal.tsx` (yeni): preset kart ızgarası (swatch önizleme + aktif tik) + koyuluk seçenekleri (Az/Orta/Çok). Seçim anında uygulanır.
- `focus.tsx`: inline preset şeridini "Tema" ikon butonuyla değiştir → modal.
- **Test:** `node run-tests.js`; manuel: tema değişince zemin/kart rengi değişir.

## FAZ 3 — Ayarlar (genişletilmiş)
- `focusStore.settings` genişlet: `autoStartBreaks`, `autoStartPomodoros`, `longBreakInterval`, `requireTaskBeforeStart`, `soundOnFinish`, `notifyOnFinish`. AsyncStorage'a kalıcı (init'te yükle, değişimde kaydet).
- Zamanlayıcı mantığına bağla: `nextPhase` longBreakInterval (sabit 4 yerine ayar); `autoStart*` ile otomatik başlat; `start()` requireTaskBeforeStart kontrolü.
- `components/focus/FocusSettingsModal.tsx` (yeni): bölümlü — Zamanlayıcı (süreler), Otomasyon (autoStart toggle + longBreakInterval), Görevler (requireTaskBeforeStart), Sesler (soundOnFinish/notifyOnFinish). Custom toggle. Mevcut basit ayarlar modalını değiştir.
- **Test:** `node run-tests.js`; manuel: ayar kalıcı; longBreakInterval/autoStart davranışı.

## FAZ 4 — Kapanış
- Son `node run-tests.js` (92/92, tsc 0) + memory güncelle (odak tema/ayarlar/raporlar).

---

# ETAP 12 — Odak Ayarlar (çok bölümlü) + Rapor dışa aktarma

## Bağlam / Neden
ETAP 11 Ayarlar bottom-sheet'inin (1) en üstte kenar boşluğu sorunu var (SafeAreaView top yok), (2) kapsamı çok dar. Referans artifact'te Ayarlar tam-ekran ve bölümlü: **Genel · Zamanlayıcı · Görevler · Raporlar · Sesler · Hesap · Entegrasyonlar · Gelişmiş**. Ayrıca Rapor'da artifact'teki **"Yerel rapor · cihazında" footer + CSV/JSON dışa aktarma** eksik; grafik başlığı "Odak saatleri" değil.

**Saptanan eksikler:** Ayarlar tam-ekran değil + 8 bölüm yok; Rapor CSV/JSON dışa aktarma + footer yok; ayar↔davranış bağı yok (varsayılan rapor aralığı, grafik/sıralama görünürlüğü, saat formatı, görev otomatik tamamlama).

## FAZ 1 — Rapor dışa aktarma + footer
- `lib/focusReport.ts`: `toCSV(sessions)`.
- `components/focus/FocusReportModal.tsx`: alt footer "Yerel rapor · cihazında" + **CSV** + **JSON** butonları → RN `Share.share` ile metin paylaş. Grafik başlığı "ODAK SAATLERİ".
- Test: `node run-tests.js` (92/92, tsc 0).

## FAZ 2 — Ayarlar: tam-ekran + 8 bölüm
- `focusStore.settings` yeni alanlar: `hourFormat('24h'|'12h')`, `autoCheckTasks`, `enableLocalReports`, `defaultReportRange`, `showFocusChart`, `showRanking` (persist + load DEFAULT merge ile geriye uyumlu).
- `components/focus/FocusSettingsModal.tsx` yeniden: tam-ekran `Modal` + `SafeAreaView edges=['top','bottom']` (margin fix) + yatay bölüm sekmesi (8 bölüm). Bölüm içerikleri:
  - **Genel:** Tema & arka plan (→ tema modal), Saat formatı (24/12), Bitince bildirim.
  - **Zamanlayıcı:** work/short/long stepper + uzun mola aralığı + otomatik başlat (mola/pomodoro) toggle.
  - **Görevler:** Başlamadan görev zorunlu, Tahmini bitince otomatik tamamla.
  - **Raporlar:** Yerel rapor, Varsayılan aralık, Grafik göster, Sıralama göster, "Rapor verisini temizle" (danger).
  - **Sesler:** Bitince titreşim, Bitince bildirim.
  - **Hesap:** oturum e-postası + "yerel mod" notu.
  - **Entegrasyonlar:** "Entegrasyonları yönet" → `/screens/integrations`.
  - **Gelişmiş:** Ayarları sıfırla, Tüm odak verisini dışa aktar (Share JSON).
- `focus.tsx`: settings modalına `onOpenTheme` (tema modalını aç) prop'u.
- Test: `node run-tests.js`.

## FAZ 3 — Ayar ↔ davranış bağlama
- `FocusReportModal`: store'dan settings → başlangıç aralığı `defaultReportRange`; `showFocusChart`/`showRanking` görünürlük; `hourFormat` detay saat; footer `enableLocalReports`.
- `focusStore.nextPhase`: `autoCheckTasks` → görev tahmini pomodoroya ulaşınca otomatik tamamla.
- Aksiyonlar: "Rapor verisini temizle" → focus_sessions sil (Alert onaylı); "Ayarları sıfırla" → DEFAULT_SETTINGS.
- Test: `node run-tests.js`.

## FAZ 4 — Kapanış
- Son `node run-tests.js` (92/92, tsc 0) + memory güncelle.

# ETAP 13 — Odak verisi dışa aktarma (CSV + Excel) + "Ayarları sıfırla" düzeltmesi

## Bağlam / Neden
Gelişmiş sekmesindeki "Tüm odak verisini dışa aktar" yalnızca **JSON**. Kullanıcı **CSV** ve **Excel** formatı da istiyor. RN'de native dosya yazımı yok (`expo-file-system`/`expo-sharing` yüklü değil) → dışa aktarma `Share.share({ message })` ile metin paylaşımı. Excel için bağımlılıksız çözüm: **SpreadsheetML 2003 XML** (düz metin; Excel/Google Sheets/LibreOffice gerçek **çok sayfalı** tablo olarak açar) — gerçek `.xlsx` ikili formatı için kütüphane (SheetJS) gerekir, kaçınılır.

Ayrıca **"Odak ayarlarını sıfırla" butonu "çalışmıyor" görünüyor**: aslında veri katmanında `onSave(DEFAULT_SETTINGS)` çalışıyor ama `clearReports`'ın aksine **görsel geri bildirim yok** ve sıfırlama Gelişmiş sekmesinde görünür bir değişiklik yaratmıyor → kullanıcı çalışmadığını sanıyor. Düzeltme: onaydan sonra haptic + başarı bildirimi (clearReports kalıbı).

## FAZ 1 — Dışa aktarma yardımcıları (lib, saf)
- `lib/focusReport.ts`: `ExcelSheet` tipi + `toExcelXML(sheets)` (SpreadsheetML 2003 XML üretici: çok sayfa, başlık + satır, `Number`/`String` tip ayrımı, XML-escape, sayfa adı 31 char + yasak karakter temizliği) + `sessionsSheet(sessions, name?)` (oturum kolonları `toCSV` ile aynı). `toCSV` korunur.
- Test: `node run-tests.js` (tsc 0 + yeni assertion: `toExcelXML` & `sessionsSheet` mevcut).

## FAZ 2 — Gelişmiş sekmesi: JSON · CSV · Excel
- `components/focus/FocusSettingsModal.tsx`: tek "dışa aktar (JSON)" ActionRow → **ExportRow** bloğu (JSON/CSV/Excel 3 buton). `exportAll(fmt)`: `focus_tasks` + `focus_sessions` çek →
  - **JSON** = tam paket `{ settings, focus_tasks, focus_sessions }`,
  - **CSV** = oturumlar (`toCSV`),
  - **Excel** = 3 sayfalı workbook (Ayarlar key/value · Görevler · Oturumlar) `toExcelXML`.
  - `Share.share({ message })`.
- Test: `node run-tests.js` (yeni assertion: CSV + Excel dışa aktarma var).

## FAZ 3 — Rapor modalına Excel butonu (tutarlılık)
- `components/focus/FocusReportModal.tsx`: footer'da CSV/JSON yanına **Excel** butonu. `exportData('excel')` → `toExcelXML([sessionsSheet(sessions)])`.
- Test: `node run-tests.js` (yeni assertion: rapor Excel butonu).

## FAZ 4 — "Ayarları sıfırla" düzeltmesi + kapanış
- `FocusSettingsModal.tsx`: `resetSettings` onay sonrası `onSave(DEFAULT_SETTINGS)` + `haptic.success()` + başarı Alert ("Odak ayarları varsayılana döndürüldü."). `haptic` import.
- Test: son `node run-tests.js` (tsc 0 + tüm yeni assertion'lar) + memory güncelle.

## FAZ 5 — Platform-güvenli dışa aktarma + Modal-içi onay (bug fix)
**Sorun:** JSON/CSV/Excel + "ayarları sıfırla" butonları çalışmıyordu. Kök neden: `Share.share` ve `Alert.alert` **tam-ekran RN Modal'in üstünde açılamıyor** (iOS: root VC zaten Modal sunuyor; **web**: react-native-web `Alert` no-op, `Share` masaüstü tarayıcılarda yok). FAZ 4'teki "başarı Alert'i" de aynı sebeple görünmüyordu → sıfırla "çalışmıyor" sanılıyordu.
- `lib/focusReport.ts`: `ExportFmt`, `EXPORT_META` (ext/mime), `webDownload(filename,mime,content)` (Blob + `<a download>` ile gerçek tarayıcı indirmesi; `globalThis` guard).
- `FocusSettingsModal.tsx` + `FocusReportModal.tsx` `exportAll/exportData`: **Platform dalı** — `web` → `webDownload` (gerçek dosya), `ios` → `onClose()` + 350ms sonra `Share.share` (Modal üstü sunum sorunu), `android` → doğrudan `Share.share`.
- `Alert.alert` onayları kaldırıldı → **`ConfirmRow`** (modal-içi iki-aşamalı: etiket → "Vazgeç / Evet"; her platformda çalışır). Reset + "rapor verisini temizle" bununla. Geri bildirim: `Alert` yerine **`flash`** (modal-içi geçici banner, 2.6s).
- Test: `node run-tests.js` → tsc 0 + **100/100** (+webDownload, platform-güvenli, ConfirmRow assertion'ları).

# ETAP 14 — Spotify OAuth + Odak mini-oynatıcı

## Bağlam / Neden
Kullanıcı Odak sekmesine **Spotify OAuth** istedi: kişi API ile uğraşmadan "Spotify ile Bağlan" → Google/Gmail ile Spotify'da oturum açar → çalışırken müzik dinler/kontrol eder. Kullanıcı **OAuth** yolunu ve **Premium** üyeliği seçti (uygulama-içi çal/duraklat/atla aktif). Mevcut kanıtlanmış desen: `notion-auth` edge fonksiyonu (`verify_jwt:false`, `?action=url|callback|status|disconnect`, kullanıcı Authorization header ile doğrulanır, token'lar service-role client ile tabloya yazılır) + `googleCalendarStore` (WebBrowser.openAuthSessionAsync + Linking redirect). Spotify bunu birebir izler + oynatma proxy aksiyonları ekler.

**Tek seferlik dış kurulum (yönetici):** Spotify Developer app → Client ID/Secret; redirect URI olarak `Linking.createURL('spotify-callback')` çıktıları (dev: `exp://…/--/spotify-callback`, prod: `frontend://spotify-callback`); Supabase edge secrets `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET`. Son kullanıcı hiçbir şey yapmaz.

## FAZ 0 — Backend (DB + edge) [production değişiklik]
- **Migration `spotify_accounts`**: `user_id uuid pk → auth.users`, `access_token`, `refresh_token`, `expires_at timestamptz`, `scope`, `spotify_user_id`, `display_name`, `product`, `created_at/updated_at`. RLS **etkin, istemci policy YOK** → token'lara yalnız service-role edge erişir (status/disconnect bile edge'de admin client ile, kullanıcı JWT doğrulandıktan sonra).
- **Edge `spotify-auth`** (verify_jwt false). Aksiyonlar: `url` (authorize URL + scope'lar), `callback` (kod→token, `/me` profil, upsert), `status`, `disconnect`, `now-playing`, `play`, `pause`, `next`, `previous`, `play-context` (çalma listesi). `getValidToken` helper: süresi dolan token'ı `refresh_token` ile yeniler. Premium olmayan/aktif-cihaz-yok durumlarında anlamlı hata döner.
- Doğrulama: `list_edge_functions` → spotify-auth ACTIVE; `list_tables` → spotify_accounts var.

## FAZ 1 — Frontend store + lib
- `store/spotifyStore.ts`: `googleCalendarStore` deseni — `connection{display_name,product}`, `status`, `error`, `nowPlaying`, metotlar `fetchStatus/connect/disconnect` + `fetchNowPlaying/play/pause/next/previous/playContext`. `REDIRECT_URI=Linking.createURL('spotify-callback')`, edge'i `?action=` ile çağıran `callFn` helper.
- `lib/spotifyFocus.ts`: küratörlü odak çalma listeleri (ad + `spotify:playlist:` uri + open URL).
- Test: `node run-tests.js` (tsc 0 + store/lib assertion'ları).

## FAZ 2 — Odak mini-oynatıcı kartı
- `components/focus/FocusSpotifyCard.tsx`: bağlı değil → "Spotify ile Bağlan"; bağlı → çalan şarkı (kapak+başlık+sanatçı) + prev/play-pause/next + odak çalma listesi çipleri (Premium→`playContext`, değilse `Linking.openURL`). Spotify yeşili `#1DB954`. Çalışırken now-playing periyodik yenilenir.
- `app/tabs/focus.tsx`: kontrol bloğu ile görev listesi arası `<FocusSpotifyCard />`; mount'ta `fetchStatus`.
- Test: `node run-tests.js` (tsc 0 + kart/focus assertion'ları).

## FAZ 3 — Kapanış + kurulum dökümanı
- `SPOTIFY_SETUP.md` (repo): dev app + redirect URI + secret adımları.
- Son `node run-tests.js` + memory güncelle.

---

# ETAP 15 — Atlas HTML Paritesi: Editöryel Dashboard, Komut Paleti, Aksan Temaları & UX Cilası

## Bağlam / Neden
Referans tasarım `Downloads/personal-os-v2 (8).html` (Atlas "Paper/Clay Editorial" dil sistemi, 9427 satır, tek-dosya web prototipi). **Sayfa düzeyinde uygulama referansın ÖNÜNDE** — HTML'deki 18 sayfanın (dashboard, tasks, recovery, eisenhower, calendar, habits, pomodoro, deep, coach, goals, okrs, projects, life, journal, notes, analytics, review, settings + list-* + project-detail) tamamı uygulamada karşılığı olan ekranlara sahip; üstüne uygulamada HTML'de **olmayan** ekranlar da var (hub, timeline, stats, focus, leaderboard, profile, journal-archive/reader/insights, monthly-review, integrations, paywall, credit-history, reading-list, recovery). GTD liste filtreleri (Gelen/Bu Hafta/Bir Gün/Arşiv) zaten `tabs/tasks.tsx`'te, Komut Paleti zaten `components/CommandPalette.tsx`'te, Atlas token'ları zaten `lib/tokens.ts`'te.

**Demek ki gerçek boşluklar sayfa değil, derinlik/cila.** HTML'in editöryel zenginliği uygulamada henüz yok.

### Boşluk Tablosu (HTML (8) → uygulama)
| # | HTML'de var | Uygulamada durum | Boşluk türü |
|---|---|---|---|
| 1 | Editöryel "Bugün" hero (anlatısal serif başlık + 3 bağlamsal CTA) | `today.tsx` jenerik "Günaydın 👋" | **özellik** |
| 2 | Sakin 4'lü metrik ızgarası (eyebrow/num/sub: uyku·odak·açık görev·telafi) | 2 adet StatTile | özellik |
| 3 | "Sırada" şeridi (yatay, zamanlı sıradaki işler) | yok | özellik |
| 4 | Bugün: Masadakiler ↔ Zaman çizelgesi sekmesi | yalnız liste | özellik |
| 5 | Satır-içi görev ekleyici (inline composer, modalsız) | yalnız modal | iyileştirme |
| 6 | Zengin QuickSearch (görev/proje/not + son kullanılanlar + bağlamsal öneri) | yalnız hızlı eylem + alışkanlık | iyileştirme |
| 7 | Aksan renk temaları (clay/moss/slate/amber) | yalnız dark/light | özellik |
| 8 | Telafi sağ-rail kartı (uyku/antrenman/stres/sosyal mini satırlar) | yok | özellik |
| 9 | Editöryel boş durumlar (sakin serif italik kopya) | EmptyState var ama düz | cila |
| 10 | Breadcrumb/bağlamsal başlık | sade başlık | cila (düşük) |
| 11 | Proje detay görünümü (gruplanmış görevler + ilerleme) | `projects.tsx` yalnız liste+ekle | özellik |

### Genel iyileştirme adayları
- **Açık tema denetimi (büyük):** `lib/tokens.ts` `colors` dark-only sabit; ekranlar `colors`'ı doğrudan import ediyor → light tema pratikte ekran-genelinde çalışmıyor olabilir. Doğruluk açısından en büyük kazanç ama en geniş refactor → bilinçli olarak **ayrı bir etaba** bırakılır (aşağıda "kapsam dışı" notu).
- Tabular-num/haptik/erişilebilirlik tutarlılığı (faz faz, ilgili dosyalarda).

## Kapsam kararı
Önce **katma değeri yüksek + bağımsız + düşük riskli** (saf frontend, additive) boşluklar uygulanır: editöryel Bugün dashboard (1·2·3·4), satır-içi ekleyici (5), zengin komut paleti (6), telafi rail + editöryel boş durum (8·9), aksan temaları (7), proje detay (11). **Açık tema ekran-genel denetimi** ve breadcrumb (10) bu etaba alınmaz (büyük/riskli refactor; ayrı etap notu bırakılır). Habit/calendar mantığına dokunulmaz. Her faz sonunda `node run-tests.js` kapısı + o faza özel assertion'lar.

## Faz Planı (bir faz bitmeden diğerine geçilmez; her faz sonunda test kapısı)

### FAZ 1 — Editöryel "Bugün" hero + sakin metrik ızgarası
- **Yeni `lib/todayNarrative.ts`:** gerçek veriden (gecikmiş/bugün görev sayısı, kalan/biten alışkanlık, bugünkü odak seansı, saat dilimi) anlatısal serif başlık + alt-metin üretir (`buildTodayNarrative({...})`). Saf fonksiyon, deterministik.
- **Yeni `components/today/TodayHero.tsx`:** eyebrow (tarih · hafta), serif başlık (`narrative.title`, `<em>` vurgusu için renkli span), alt-metin, 3 bağlamsal CTA: "Odağa geç" (`/tabs/focus`), "Haftalık rapor" (`/screens/weekly-review`), "Telafiye bak" (`/screens/recovery`). Token'lar `lib/tokens`.
- **Yeni `components/today/MetricGrid.tsx`:** 2×2 sakin metrik ızgarası — Açık görev (gecikmiş·bugün alt), Odak (bugünkü seans), Alışkanlık (% / kalan), Telafi (planlı telafi sayısı). `eyebrow/num/sub` Atlas deseni; mono tabular num.
- `today.tsx`: jenerik header + 2 StatTile yerine `<TodayHero/>` + `<MetricGrid/>` mount; mevcut ring/irade/alışkanlık/görev blokları korunur.
- Test: `node run-tests.js` + yeni bölüm "🗞️ 17. Editöryel Bugün" (todayNarrative + TodayHero + MetricGrid + today.tsx mount).

### FAZ 2 — "Sırada" yaklaşan görev şeridi (NextUpStrip)
- **Veri gerçeği:** uygulama `tasks` modelinde **saat (clock-time) alanı yok** (yalnız `due_date`); alışkanlıklarda da net saat yok. Bu yüzden HTML'in saat-tabanlı "Zaman çizelgesi" sekmesi **uydurma veri** olur → uygulanmaz. Bunun yerine HTML'in görsel olarak ayırt edici parçası olan **"Sırada" şeridi** son-tarih sıralamasıyla yapılır.
- **Yeni `components/today/NextUpStrip.tsx`:** yatay ScrollView; öğeler öncelik sırasıyla — gecikmiş (kırmızı "gecikmiş") → bugün ("bugün") → en yakın son-tarihli birkaç görev. Her öğe: öncelik noktası + başlık (kısaltılmış) + son-tarih etiketi; aralarda "→". Boşsa render edilmez. `onPress` → `/tabs/tasks`.
- **today.tsx:** hero/metrik altına `<NextUpStrip items={...}/>`.
- Test: `node run-tests.js` + assertion'lar (NextUpStrip).

### FAZ 3 — Satır-içi görev ekleyici (inline composer)
- **Yeni `components/InlineComposer.tsx`:** tek satır TextInput + "Ekle" — Enter/buton ile `taskStore.addTask` çağırır, alanı temizler. Opsiyonel `dueToday` ve `projectId` props.
- `tasks.tsx` liste başına ve `today.tsx` görev bölümüne mount (modalsız hızlı ekleme; mevcut modal korunur).
- Test: `node run-tests.js` + assertion'lar.

### FAZ 4 — Zengin Komut Paleti
- `CommandPalette.tsx`: mevcut hızlı eylem + alışkanlık aramasına ek olarak **görev** (`taskStore`), **not** (`noteStore`), **proje** (`projectStore`) araması; sonuç bölümleri ayrı. Son kullanılan rotalar (`recents`, AsyncStorage `app_cmd_recents`) boş sorguda gösterilir. Seçim doğru rotaya/aksiyona gider.
- Test: `node run-tests.js` + assertion'lar.

### FAZ 5 — Telafi rail kartı + editöryel boş durumlar
- **Yeni `components/today/RecoveryRailCard.tsx`:** `recoveryStore` planlarından mini özet (planlı/bugün/tamamlanan) + "Tam dökümü aç →" (`/screens/recovery`). today.tsx'e ek blok.
- `EmptyState` (veya today/tasks boş durumları): sakin serif italik kopya varyantı (`variant="editorial"`), Atlas tonunda.
- Test: `node run-tests.js` + assertion'lar.

### FAZ 6 — Aksan renk temaları (clay/moss/slate/amber)
- **Mimari gerçek:** `lib/tokens.ts` `colors` sabit ve `StyleSheet.create` ile uygulama-geneline gömülü → runtime aksan değişimi her ekrana yayılamaz (tam yayılım = theme-context refactor = ayrı etap). **Bu yüzden FAZ render-anında hesaplanan baskın aksan yüzeylerine uygulanır:** her **primary Button** (bg render'da hesaplanıyor), **tab bar aktif tint** (screenOptions render'da), ve **Today hero** (vurgu + birincil CTA). Bu, tutarlı bir aksan kimliği verir; StyleSheet'e gömülü kalan küçük clay tonları "açık tema ekran-genel denetimi" etabına bırakılır.
- **`lib/tokens.ts`:** `ACCENTS` haritası (clay/moss/slate/amber → primary·bright·deep·soft·label) + `AccentKey` + `DEFAULT_ACCENT`.
- **`lib/useAccent.ts` (yeni):** `useThemeStore(s=>s.accent)` → `ACCENTS[accent]` döndüren hook.
- **`store/themeStore.ts`:** `accent: AccentKey` + `setAccent`, AsyncStorage `app_accent`, `load()`.
- **`Button.tsx` + `tabs/_layout.tsx` + `TodayHero.tsx`:** `useAccent()` ile aksanı oku.
- **`settings.tsx`:** Görünüm bölümüne "Aksan rengi" — 4 renk dairesi seçici.
- Test: `node run-tests.js` + assertion'lar.

### FAZ 7 — Proje detay görünümü
- `projects.tsx`: bir projeye dokununca detay (modal veya inline) — proje adı, ilerleme (tamamlanan/toplam görev), o projeye ait görev listesi (toggle/ekle). `taskStore` `project_id` filtresi.
- Test: `node run-tests.js` + assertion'lar.

## Kapsam dışı (bu etapta DEĞİL — ayrı etap)
- **Açık tema ekran-genel denetimi** (tüm ekranların `colors`'tan token okuduğunu garanti eden geniş refactor) — büyük yüzey, regresyon riski; aksan temaları (FAZ 6) bunun küçük öncüsü.
- Masaüstüne özgü breadcrumb/sidebar collapsible (mobilde gereksiz).
- Habit/calendar/Supabase şema değişikliği YOK (saf frontend etabı).

## Dosya Özeti (ETAP 15)
| Dosya | FAZ | Değişiklik |
|---|---|---|
| frontend/lib/todayNarrative.ts | 1 | **yeni** — anlatısal başlık üreteci |
| frontend/components/today/TodayHero.tsx | 1 | **yeni** |
| frontend/components/today/MetricGrid.tsx | 1 | **yeni** |
| frontend/components/today/NextUpStrip.tsx | 2 | **yeni** |
| frontend/components/InlineComposer.tsx | 3 | **yeni** |
| frontend/components/today/RecoveryRailCard.tsx | 5 | **yeni** |
| frontend/app/tabs/today.tsx | 1·2·3·5 | hero/metrik/sırada/sekme/composer/rail mount |
| frontend/app/tabs/tasks.tsx | 3 | inline composer |
| frontend/components/CommandPalette.tsx | 4 | görev/not/proje arama + recents |
| frontend/lib/tokens.ts + store/themeStore.ts + app/tabs/settings.tsx | 6 | aksan temaları |
| frontend/app/screens/projects.tsx | 7 | proje detay |
| frontend/components/ui/EmptyState.tsx | 5 | editöryel varyant |
| frontend/run-tests.js | her faz | ETAP 15 assertion bölümleri |

## Doğrulama
1. Her faz sonunda `cd frontend && node run-tests.js` → tsc 0 + tüm yapısal kontroller geçer (126'dan artar).
2. Habit/calendar mantığı, Supabase şeması, 12 takvim görseli ve mevsimsel hareket dokunulmadan kalır.
