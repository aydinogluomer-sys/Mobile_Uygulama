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

| Feature | Path |
|---|---|
| Habits and daily logging | **Alışkanlıklar** tab |
| Tasks / projects | **Görevler** tab |
| Focus timer | **Odak** tab |
| AI Coach | **Hub** → AI Koç |
| Settings | **Ayarlar** tab |
| Privacy policy | Ayarlar → Hesap → Gizlilik Politikası |
| **Account deletion** | Ayarlar → Hesap → **Hesabı Sil** |

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

<<< FREE MVP >>>
This build contains **no in-app purchases**. There is nothing to buy and no
payment information is collected.

<<< PAID >>>
(To be completed if the paid branch is chosen — subscription names, durations,
prices, restore path and sandbox tester instructions.)

Delete whichever block does not apply before submitting. See
`OWNER_DECISIONS.md` item 1.

## Supplying the credentials

Do **not** commit the review password. At submission time enter it directly in
App Store Connect / Play Console. `REVIEW_EMAIL` and `REVIEW_PASSWORD` above
are placeholders so this file can live in the repository safely.

Recommended: create a dedicated review account, not a personal one, so it can
be deleted after review — noting that the account-deletion flow this reviewer
is asked to look at will remove it permanently.
