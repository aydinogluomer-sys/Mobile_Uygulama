# Host-ready pages for aderyth.com

Three static pages the stores require. **None of them is live.** Probed
2026-09-08: `https://aderyth.com/` answers 200, but `/privacy`, `/support` and
`/delete-account` all answer **404**.

| File | Must be served at |
|---|---|
| `privacy.html` | `https://aderyth.com/privacy` |
| `support.html` | `https://aderyth.com/support` |
| `delete-account.html` | `https://aderyth.com/delete-account` |

Each file is self-contained — no external CSS, JS, fonts or images — so it can
be dropped onto any static host as-is.

## Placeholders that MUST be filled before publishing

They are written as `{{NAME}}` so an unfilled one is impossible to miss and
trivial to grep. Nothing here was invented; each is a fact only the owner has.

| Placeholder | What it is | Why it is not filled in |
|---|---|---|
| `{{DESTEK_EPOSTA}}` | the support e-mail address | none was provided; an unreachable contact in a store listing is worse than a missing one |
| `{{SILME_SURESI}}` | turnaround for a web deletion request, e.g. "30 gün" | no SLA has been decided; a made-up one is a promise the owner never made |
| `{{YAYINCI}}` | the publisher / legal entity shown in the footer | no legal identity has been confirmed |

`grep -o '{{[A-Z_]*}}' docs/store/web/*.html | sort -u` lists what is left.

## Order of operations

1. fill the placeholders;
2. publish all three and confirm each returns **200**;
3. flip `PUBLIC_SITE_URLS_LIVE` to `true` in `frontend/lib/featureGates.ts`
   (this is what re-enables the in-app Support row);
4. enter the URLs in App Store Connect and Play Console;
5. update `docs/store/OWNER_DECISIONS.md` item 4.

Step 3 is deliberately last. Until the pages resolve, the app must not link to
them — a privacy link that 404s is a named rejection reason in both stores.
