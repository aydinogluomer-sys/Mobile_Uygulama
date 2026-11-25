# Reviewer Notes — App Store Review / Google Play Review

Paste into App Store Connect "Notes for Review" and Play Console "App access"
/ testing instructions. Credentials are **placeholders**; see the last section.

## Test account

Aderyth requires an account, because everything it shows is the signed-in
person's own data.

```
Email:    REVIEW_EMAIL
Password: REVIEW_PASSWORD
```

The account is pre-seeded with habits, tasks and Focus Points so nothing has to
be created before the app is usable.

## First run

1. Sign in with the account above.
2. A short onboarding asks about goals, pace and reminder preference. It can be
   completed in under a minute; it does not require any permission.
3. The app opens on **Bugün** (Today).

No permission is requested at launch. The microphone is requested only on the
first tap of the mic button in AI Coach; notifications only when a reminder is
enabled.

## Where the main features are

The bottom tab bar has five primary tabs (**Bugün**, **Plan**, **Alışkanlıklar**,
**İçgörüler**, **Profil**), plus the top-left navigation drawer (`☰`) and quick
command search (`🔍`):

| Feature | Path |
|---|---|
| Today overview, "Nereden başlayacağımı bilmiyorum" (5-min micro-step start) & "Bugün planım dağıldı" (3-step **Koru → Gör → Uygula** day replan + Undo) | **Bugün** tab |
| Tasks, Focus timer, Routine runner & Calendar time blocks | **Plan** tab (or `☰` Drawer → Planlama) |
| Habits, measurable targets & daily logging | **Alışkanlıklar** tab |
| Statistics, Weekly/Monthly Review, Journal & **AI Koç** | **İçgörüler** tab (or `☰` Drawer → Kişisel) |
| Settings, Data export/import & Focus Points | **Profil** tab → Ayarlar (or `☰` Drawer → Sistem → Ayarlar) |
| Privacy policy (in-app) | **Profil** → Ayarlar → Hesap → **Gizlilik Politikası** |
| **Account deletion** | **Profil** → Ayarlar → Hesap → **Hesabı Sil** |

## AI Coach and Focus Points

AI Coach is a conversational assistant for habits and tasks. Each message
costs **5 Focus Points**; the test account starts with a balance, so several
messages can be sent without any purchase.

Focus Points are an in-app usage allowance, **not** a virtual currency that can
be bought in this build. They are granted with the free tier and refresh
monthly. AI Coach never writes to the database on its own: when it suggests a
habit or a log, the app shows a confirmation card first and nothing is saved
until the reviewer taps confirm.

Text sent to AI Coach is processed by Anthropic. This is described in the
privacy policy and in the Data Safety / App Privacy declarations.

## Voice input

The mic button in AI Coach transcribes speech using the operating system's own
speech recognition. Audio is not recorded or uploaded by the app; the transcript
appears in the composer and is only sent if the user taps send.

## "Coming soon" integrations

Ayarlar → Entegrasyonlar shows **Notion** and **Google Calendar** as *coming
soon / temporarily unavailable*. They are intentionally disabled in this
release; the cards are not tappable and no connection can be started. They are
listed here so the state is not mistaken for a bug.

## Subscriptions

This build contains **no in-app purchases**. There is nothing to buy, no
subscription, no external payment link, and no payment information is
collected. The AI features run on a free Focus Point balance that renews
monthly; Ayarlar → menü → Focus Points shows the balance and what each action
costs.

The owner's decision is FREE MVP (`OWNER_DECISIONS.md` item 1), and the
paywall screen was removed from the app rather than merely unlinked.

## Supplying the credentials

Do **not** commit the review password. At submission time enter it directly in
App Store Connect / Play Console. `REVIEW_EMAIL` and `REVIEW_PASSWORD` above
are placeholders so this file can live in the repository safely.

Recommended: create a dedicated review account, not a personal one, so it can
be deleted after review — noting that the account-deletion flow this reviewer
is asked to look at will remove it permanently.
