# Google Play Console — Metadata Draft

Draft copy for the owner. **Nothing has been submitted.**

| Field | Value |
|---|---|
| App name (max 30) | `Aderyth` |
| Package | `com.aderyth.app` |
| Default language | Turkish (tr-TR) |
| Category | Health & Fitness |
| Tags | Habit tracker, Productivity, Self-improvement |
| Content rating | Complete the IARC questionnaire. No ads, no purchases in this build, no user-to-user messaging. Usernames appear on a leaderboard |
| Target audience | 13+ expected — confirm via the questionnaire |

## Short description (max 80)

`Alışkanlıklarını iradeni tüketmeden kur. Kapasiteni gör, odaklan, telafi et.` (76)

## Full description (max 4000)

Use the App Store description from `APP_STORE_METADATA.md`; it is within Play's
limit and contains no Apple-specific wording.

## Required URLs

| Field | Value |
|---|---|
| Privacy policy | **EXTERNAL_OWNER_ACTION_REQUIRED** |
| Support email | **EXTERNAL_OWNER_ACTION_REQUIRED** |
| Account deletion URL | **EXTERNAL_OWNER_ACTION_REQUIRED** — see `ACCOUNT_DELETION_WEB_REQUIREMENTS.md` |

## Data safety

Fill from `PRIVACY_DECLARATION_MATRIX.md` §2. Two answers to get right:

- **Data deletion:** users can delete data in-app **and** request deletion via
  the web resource.
- **Encrypted in transit:** yes.

## App access

Aderyth requires an account. Provide the review credentials from
`REVIEWER_NOTES.md` under **App access → All functionality is restricted**.

## Ads

Declare **no ads**. There is no ad SDK in the build.

## Graphics

- App icon 512×512 PNG (32-bit, no alpha for the Play listing icon)
- Feature graphic 1024×500
- Phone screenshots: min 2, 16:9 or 9:16

**Not produced by this pass.**

## Release track

Step 11B does **not** upload. Recommended first upload is **internal testing**,
then closed testing, before any production rollout. That is Step 11C.
