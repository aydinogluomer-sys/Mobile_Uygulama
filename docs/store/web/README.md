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

## Owner-confirmed values (applied)

The pages were first written with `{{NAME}}` placeholders so that nothing
would be invented on the owner's behalf. The owner has since confirmed all
three values, and they are applied in every HTML file in this directory
(commit `d225dfc`, 2026-09-13). No placeholder remains.

| Was | Value | Where it appears |
|---|---|---|
| `{{DESTEK_EPOSTA}}` | `support@aderyth.com` | contact link on all three pages (`mailto:` + visible text) |
| `{{SILME_SURESI}}` | `30 gün` | turnaround for a web deletion request, `delete-account.html` |
| `{{YAYINCI}}` | `Ömer Aydınoğlu` | publisher in the footer of all three pages |

`rg '\{\{[^}]+\}\}' docs/store/web/*.html` must return nothing; if a future
edit reintroduces a placeholder, that command is how to catch it before
publishing.

## Order of operations

1. ~~fill the placeholders~~ — done, see above;
2. publish all three and confirm each returns **200**;
3. flip `PUBLIC_SITE_URLS_LIVE` to `true` in `frontend/lib/featureGates.ts`
   (this is what re-enables the in-app Support row);
4. enter the URLs in App Store Connect and Play Console;
5. update `docs/store/OWNER_DECISIONS.md` item 4.

Step 3 is deliberately last. Until the pages resolve, the app must not link to
them — a privacy link that 404s is a named rejection reason in both stores.
