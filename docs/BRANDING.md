# Branding and store assets

## What shipped, and why nobody noticed

```
name    "frontend"
slug    "frontend"
scheme  "frontend"
icon    assets/images/icon.png  — Expo's blue "e"
```

The app installed under the name **frontend**, wearing another framework's
logo, and deep-linked as `frontend://`. `icon.png`, `favicon.png` and
`adaptive-icon.png` were byte-identical: one file doing three jobs with
different framing requirements.

None of this is visible from inside the app. You have to build and install it
to find out, which is why it survived a year of work on everything else. Two
quieter ones were in the same file: the adaptive icon and the splash both sat
on `#000` against an app whose background is `#15140F`, a warm near-black — so
the launch flashed a colder black than the first screen — and the notification
tint was `#6366f1`, an indigo that appears nowhere else in the palette.

## What changed

| field | was | is |
|-------|-----|-----|
| `name` | `frontend` | `Atlas` |
| `slug` | `frontend` | `atlas` |
| `scheme` | `frontend` | `atlas` |
| `description` | absent | present (stores require one) |
| `primaryColor` | absent | `#D97757` (`colors.accent`) |
| adaptive icon background | `#000` | `#15140F` (`colors.bg`) |
| splash background | `#000` | `#15140F` |
| splash image | Expo template | generated mark |
| notification tint | `#6366f1` | `#D97757` |

Six unreferenced template assets were deleted — the four React logos,
`app-image.png` and the old `splash-image.png`. `assets/images/` went from
1056 KB to 18 KB, all of it shipped in every build.

### The scheme change has an external half

`atlas://` is the deep-link scheme, and the OAuth redirect URIs are built from
it by `Linking.createURL(...)`:

```
atlas://notion-callback
atlas://google-calendar-callback
```

**These must be registered in the Notion and Google consoles.** This was the
cheapest possible moment to make the change: neither integration is configured
yet (§5 and §6 are blocked on missing deploy secrets), so nothing that worked
has been broken. Doing it after the consoles were set up would have meant
changing them twice.

`slug` was equally free: `app.json` has no `extra.eas.projectId`, so no EAS
project is linked to the old name.

### The icon is a placeholder, and says so

`scripts/generate-app-icons.py` draws a geometric "A" in `colors.accent` on
`colors.bg` and writes all four files. It introduces no shape, colour or
typeface that is not already a decision the codebase had made — which is the
point. Designing a brand identity is a design deliverable, not something a
hardening pass should invent.

It is committed as a script rather than four opaque binaries so the next
person can adjust it instead of redrawing it:

```
python scripts/generate-app-icons.py
```

| file | size | for |
|------|------|-----|
| `icon.png` | 1024² | store listing and iOS app icon (the OS rounds it) |
| `adaptive-icon.png` | 1024² | Android foreground layer; mark kept inside the safe circle, background from `app.json` |
| `favicon.png` | 96² | web; rounded here because nothing masks it |
| `splash-icon.png` | 512² | launch screen, on the `#15140F` ground |

## Still required, and why it is not done here

**Bundle identifiers.** `ios.bundleIdentifier` and `android.package` are absent
and a store build cannot proceed without them. They are deliberately not
invented: an identifier is tied to the owner's Apple and Google developer
accounts and to a domain they control, and a guess like `com.atlas.app` can
collide with a real listing. The owner must choose, e.g.:

```json
"ios":     { "bundleIdentifier": "com.<their-domain>.atlas" },
"android": { "package":          "com.<their-domain>.atlas" }
```

**Real artwork.** Icon, feature graphic, and screenshots for both stores.

**Store listing copy.** `description` in `app.json` is the in-app/manifest
description, not the store listing; the listing needs its own title, subtitle,
keywords and full description per locale.

## What keeps the defaults from coming back

`frontend/__tests__/repo/brandingIdentity.test.ts` — the identity fields are
not the template's, the launch colours are read from `lib/tokens.ts` rather
than hard-coded (so a palette change cannot leave them pointing at the old
colour), the three icons are no longer the same file, the generator is
present, and none of the six deleted template assets has returned.

`frontend/__tests__/repo/appConfigAssetsExist.test.ts` already covered the
other half: every path `app.json` references must exist on disk.
