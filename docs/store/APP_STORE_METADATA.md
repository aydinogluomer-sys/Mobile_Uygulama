# App Store Connect — Metadata Draft

Draft copy for the owner. **Nothing has been submitted.** No claim below
describes a feature the app does not have.

| Field | Value |
|---|---|
| App name | Aderyth |
| Bundle ID | `com.aderyth.app` |
| Primary language | Turkish (tr-TR) |
| Marketing version | 1.0.0 |
| Primary category | Health & Fitness |
| Secondary category | Productivity |
| Age rating | 4+ expected — no user-generated public content, no ads. Answer the questionnaire honestly; the leaderboard shows usernames only |

## Subtitle (max 30 chars)

`İrade ekonomisiyle alışkanlık` (29)

Alternatives: `Alışkanlık ve odak koçu` (23) · `ADHD dostu alışkanlık takibi` (28)

## Promotional text (max 170)

> Alışkanlıklarını iradeni tüketmeden kur. Günlük kapasiteni gör, telafi planı
> yap, odaklan. AI Koç yazarak ya da konuşarak yardım etsin.

## Description

> Aderyth, alışkanlıklarını "daha çok çabala" demeden kurmana yardım eden bir
> karar çerçevesi. Fikir basit: iradenin günlük bir bütçesi var. Aderyth o
> bütçeyi görünür kılar ve alışkanlıklarını ona göre planlar.
>
> NE YAPAR
>
> • İrade ekonomisi — her alışkanlığın bir maliyeti var. Günlük kapasiteni
>   aşarsan yeni alışkanlık otomatik olarak sıraya alınır, zorla eklenmez.
> • Alışkanlık takibi — evet/hayır ya da ölçülebilir hedeflerle (20 dakika
>   okuma, 8 bardak su). Kısmi günler kısmi sayılır.
> • Telafi planları — kaçırdığın günü suçluluk yerine bir planla kapat.
> • Odak seansları — zamanlayıcı, derin çalışma kaydı ve raporlar.
> • Görevler ve projeler — Eisenhower matrisi, alt görevler, proje bazlı takip.
> • Günlük — yazdıklarını arşivle, dönemsel içgörü al.
> • Haftalık ve aylık değerlendirme — ne işledi, ne işlemedi.
> • AI Koç — alışkanlıkların hakkında konuş. Yazabilir ya da konuşarak
>   söyleyebilirsin. Koç bir şey önerdiğinde önce onay kartı çıkar; sen
>   onaylamadan hiçbir şey kaydedilmez.
>
> ADHD DOSTU
>
> Yargılamayan dil, küçük adımlar, kaçırılan günü telafi etme yolu ve aşırı
> yüklenmeyi engelleyen bir kapasite sınırı.
>
> VERİLERİN
>
> Verilerin hesabına bağlı olarak saklanır ve yalnızca sen erişirsin. İstediğin
> zaman JSON, CSV veya Excel olarak dışa aktarabilir, hesabını ve tüm verilerini
> uygulama içinden kalıcı olarak silebilirsin.

## Keywords (max 100 chars, comma-separated, no spaces)

`alışkanlık,habit,odak,focus,adhd,rutin,hedef,görev,üretkenlik,günlük,takip,disiplin,pomodoro`

## What's New (1.0.0)

> İlk sürüm.

## URLs

| Field | Value |
|---|---|
| Support URL | `https://aderyth.com/support` — **NOT LIVE (404)** |
| Marketing URL | optional — omit if none |
| Privacy Policy URL | `https://aderyth.com/privacy` — **NOT LIVE (404)** |

Both are required fields in App Store Connect. The owner has chosen the URLs
and the page content is written (`docs/store/web/`), but both paths answered
**404** when probed on 2026-09-08. **Do not enter them until they return 200** —
a privacy URL that 404s is a rejection, not a warning. See
`OWNER_DECISIONS.md` item 4.

## Screenshots

Required sizes: 6.7" iPhone and 6.5" iPhone. **No iPad screenshots** — the
owner chose iPhone-only and `ios.supportsTablet` is now `false`
(`OWNER_DECISIONS.md` item 2).

Suggested six: Bugün dashboard · Alışkanlıklar with capacity bar · Habit detail
with recovery plan · Odak timer · AI Coach with a confirmation card · Weekly
review. **Not produced by this pass** — screenshots need a real device and
real-looking data.

## In-App Purchases

**None.** The owner's decision is FREE MVP: no products, no subscription
group, and nothing to configure in App Store Connect. Answer "No" to in-app
purchases. The paywall screen was removed from the app entirely — see
`OWNER_DECISIONS.md` item 1.

## App Review Information

See `REVIEWER_NOTES.md`.
