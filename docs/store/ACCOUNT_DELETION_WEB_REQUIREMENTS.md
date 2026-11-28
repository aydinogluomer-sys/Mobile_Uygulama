# Account Deletion — Web Resource Requirements

**Status: PAGE WRITTEN, NOT PUBLISHED.**

The owner has chosen `https://aderyth.com/delete-account`, and the finished
page is at **`docs/store/web/delete-account.html`** — self-contained HTML,
ready to drop onto any static host. Probed 2026-09-08 the URL answers **404**,
so it is not yet usable in Play Console.

Owner-confirmed contact, SLA and publisher values (`support@aderyth.com`,
`30 gün`, `Ömer Aydınoğlu`) have been applied to
**`docs/store/web/delete-account.html`** and
**`docs/store/web/godaddy/delete-account.fragment.html`**.

The draft copy below reflects what that page says, kept here for review.

Google Play requires a **publicly reachable web page** where a user can request
account deletion, reachable *without* installing or signing into the app. The
in-app path (Profil → Ayarlar → Hesap → Hesabı Sil) satisfies the in-product
half; it does not satisfy the web half.

## What the page must do

1. Be reachable at a stable HTTPS URL, with no login required to read it.
2. Name the app and developer clearly (**Aderyth**).
3. Explain how to request deletion — a form or an email address is acceptable.
4. State **what is deleted**: the account and all personal data (habits and
   logs, tasks, projects, notes, journal entries, goals and OKRs, routines,
   recovery plans, focus and deep-work sessions, willpower/capacity records,
   gamification progress, subscription/Focus Point records, AI Coach
   conversations and messages).
5. State **what is retained and for how long**, if anything. Today the answer is
   *nothing*: deletion cascades across all 47 user-owned tables immediately.
   If the owner later introduces a legal/accounting retention period, this page
   and the privacy policy must both say so.
6. State the expected turnaround for a web-form request.
7. Mention that deletion is also available in-app, and where.

## Draft copy (Turkish, matching in-app wording)

> **Aderyth — Hesap ve Veri Silme**
>
> Hesabını uygulama içinden silebilirsin: **Profil → Ayarlar → Hesap → Hesabı Sil**.
> Silme işlemi anında uygulanır ve geri alınamaz.
>
> Uygulamaya erişemiyorsan, kayıtlı e-posta adresinden `support@aderyth.com`
> adresine "Hesap silme talebi" konulu bir e-posta gönder. Talebini
> `30 gün` içinde sonuçlandırırız.
>
> Silme işlemiyle birlikte şunlar kalıcı olarak kaldırılır: hesabın ve
> e-posta adresin, alışkanlıkların ve kayıtların, görevlerin, projelerin,
> notların ve günlük kayıtların, hedeflerin ve OKR'ların, rutinlerin ve telafi
> planların, odak ve derin çalışma seansların, irade/kapasite kayıtların,
> oyunlaştırma ilerlemen, abonelik ve Focus Point kayıtların ve AI Koç
> sohbetlerin.
>
> Silme sonrasında Aderyth sunucularında sana ait kişisel veri saklanmaz.

`support@aderyth.com`, `30 gün` and publisher `Ömer Aydınoğlu` are
owner-confirmed values applied in `docs/store/web/delete-account.html` and
`docs/store/web/godaddy/delete-account.fragment.html` (no unresolved
placeholders remain).

## Where the URL goes once it exists

| Destination | Field |
|---|---|
| Play Console → App content → Data safety | Account deletion URL |
| Play Console → Store listing | (optional) support/website |
| `docs/store/GOOGLE_PLAY_METADATA.md` | Account deletion URL |
| `docs/store/OWNER_DECISIONS.md` item 4 | mark resolved |
