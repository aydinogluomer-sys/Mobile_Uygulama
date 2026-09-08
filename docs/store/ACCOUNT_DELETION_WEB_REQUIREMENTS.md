# Account Deletion — Web Resource Requirements

**Status: EXTERNAL_OWNER_ACTION_REQUIRED.** No public URL exists yet, and none
has been invented. The final URL must be recorded here and in the Step 11B
report when it is live.

Google Play requires a **publicly reachable web page** where a user can request
account deletion, reachable *without* installing or signing into the app. The
in-app path (Settings → Hesap → Hesabı Sil) satisfies the in-product half; it
does not satisfy the web half.

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
> Hesabını uygulama içinden silebilirsin: **Ayarlar → Hesap → Hesabı Sil**.
> Silme işlemi anında uygulanır ve geri alınamaz.
>
> Uygulamaya erişemiyorsan, kayıtlı e-posta adresinden `<DESTEK_EPOSTA>`
> adresine "Hesap silme talebi" konulu bir e-posta gönder. Talebini
> `<SÜRE>` içinde sonuçlandırırız.
>
> Silme işlemiyle birlikte şunlar kalıcı olarak kaldırılır: hesabın ve
> e-posta adresin, alışkanlıkların ve kayıtların, görevlerin, projelerin,
> notların ve günlük kayıtların, hedeflerin ve OKR'ların, rutinlerin ve telafi
> planların, odak ve derin çalışma seansların, irade/kapasite kayıtların,
> oyunlaştırma ilerlemen, abonelik ve Focus Point kayıtların ve AI Koç
> sohbetlerin.
>
> Silme sonrasında Aderyth sunucularında sana ait kişisel veri saklanmaz.

`<DESTEK_EPOSTA>` and `<SÜRE>` are owner values. They are placeholders on
purpose — inventing a support address would put an unreachable contact in a
store listing.

## Where the URL goes once it exists

| Destination | Field |
|---|---|
| Play Console → App content → Data safety | Account deletion URL |
| Play Console → Store listing | (optional) support/website |
| `docs/store/GOOGLE_PLAY_METADATA.md` | Account deletion URL |
| `docs/store/OWNER_DECISIONS.md` item 4 | mark resolved |
