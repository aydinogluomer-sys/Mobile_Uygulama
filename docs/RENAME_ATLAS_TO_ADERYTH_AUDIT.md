# Atlas → Aderyth: rename impact audit

The name is being changed. A global find-and-replace would have changed 68
files, and roughly a third of those occurrences are not the brand at all —
they are deep-link schemes registered in third-party consoles, AsyncStorage
keys holding unsynced user writes, an installed plugin's identity, and the
recorded history of decisions that were made under the old name.

So every occurrence was classified before anything moved. This file is the
classification, and it is the reason the frozen list is frozen.

## The rule

**Rename what a user reads. Freeze what a machine matches on.**

A string is renamed when a person sees it and understands it as the product's
name. A string is frozen when something outside this commit — an OAuth
console, a device's local storage, an already-installed plugin, a deployed
function — will look it up by exact value.

---

## Frozen, and why

These are the ones a global replace would have broken. None of them is
cosmetic; each has a specific external consumer.

### 1. Deep-link scheme — `atlas`

```
app.json          "scheme": "atlas"
→ atlas://notion-callback
  atlas://google-calendar-callback
```

`Linking.createURL()` builds the OAuth redirect URIs from this field, and
those exact strings are registered — or will be — in the Notion and Google
developer consoles, and in the `OAUTH_REDIRECT_ALLOWLIST` edge secret that
`_shared/redirectAllowlist.ts` matches against. Changing `scheme` without
changing all three in the same breath produces an OAuth flow that fails at the
redirect, after the user has already granted consent.

The scheme is invisible in the UI. Nobody reads it. It stays.

### 2. Expo slug — `atlas`

```
app.json          "slug": "atlas"
```

The slug is the EAS project identifier. `app.json` still has no
`extra.eas.projectId`, so nothing is linked yet and the change would currently
be free — but it stops being free the moment the first EAS build runs, and the
bundle identifiers are still outstanding. Renaming the slug belongs in the same
decision as `ios.bundleIdentifier` and `android.package`, not in a branding
pass. It stays until those values arrive.

### 3. AsyncStorage keys

```
lib/syncQueue.ts           atlas_sync_queue_v1
                           atlas_sync_queue_v1:<userId>
store/notionSessionStore.ts  atlas_notion_login_session
                             atlas_notion_login_session:<userId>
```

These are read from the device, not from the repo. Renaming the key does not
migrate the data — it hides it. The sync queue specifically holds **writes the
user made offline that the server has not accepted yet**; a rename ships an
update that silently drops them on every device mid-flush. Both keys already
carry a documented legacy-migration path (the unsuffixed global key is drained
into the per-user one), and adding a second migration to rename a prefix buys
nothing a user can see.

### 4. Supabase project ref — `kbcuolhjjnmhjaarxxmu`

Untouched, as it is in every task. `crossProjectIsolation.test.ts` still
enforces it.

### 5. Migrations

`supabase/migrations/**` was not read for rename candidates and not modified.
An applied migration is a historical fact.

### 6. Test fixtures that mirror frozen values

```
__tests__/store/notionSessionIsolation.test.ts   atlas_notion_login_session
__tests__/lib/syncQueue.test.ts                  atlas_sync_queue_v1
__tests__/store/offlineQueueAccountIsolation.test.ts
__tests__/store/logStoreOfflineSync.test.ts
__tests__/store/oauthClientFailClosed.test.ts    atlas://…
__tests__/store/spotifyOauthGated.test.ts        atlas://…
__tests__/edge/redirectAllowlist.test.ts         https://atlas.app (example host)
```

A test that asserts a frozen value must keep asserting the frozen value.
Renaming these would have made the suite agree with a rename that did not
happen in the code they cover — the exact shape of a gate that goes green for
the wrong reason.

`redirectAllowlist.test.ts` is a slightly different case: `https://atlas.app`
there is an arbitrary example host in a suffix-matching security proof
(`https://atlas.app` must not also allow `https://atlas.app.evil.com`). It is
illustrative, not branding, and renaming it would churn 15 assertions to prove
the same property about a different made-up domain.

### 7. `createAtlasDatabases` — internal function name in `notion-auth`

`edgeCanonicalTree.test.ts` asserts this symbol is present, because a previous
"hardening" rewrite had silently dropped it and would have shipped Notion
links with null database ids. The name is a tripwire for a real regression.
The **page title** it writes into the user's Notion workspace is user-visible
and was renamed; the symbol was not.

### 8. Recorded history

```
docs/AUDIT_V2.md, docs/MIGRATION_V2.md, docs/FINAL_*.md, docs/audit/**,
PROGRESS.md, implementation*.md, frontend/awwwards-loop/**
```

These describe decisions taken when the product was called Atlas. Rewriting
them would make the record claim something that did not happen. `BRANDING.md`
is the exception — it is the live contract for what the identity fields *are*,
so it was updated and now carries the rename.

---

## Renamed

Everything below is read by a person.

| file | was |
|---|---|
| `app.json` | `"name": "Atlas"` |
| `app/(auth)/login.tsx` | wordmark |
| `app/(auth)/register.tsx` | tagline (screen rewritten, see below) |
| `app/tabs/today.tsx` | `ATLAS / GÜNLÜK PUSULA` eyebrow |
| `app/tabs/settings.tsx` | app name row, engine blurb, export sheet title |
| `app/screens/integrations.tsx` | 4 body strings |
| `app/screens/ai-coach.tsx` | coach greeting |
| `components/Drawer.tsx` | app name |
| `services/exportService.ts` | CSV banner `# Atlas yedek` |
| `lib/demoSeed.ts` | demo project name (3 sites, matched by equality) |
| `docs/BRANDING.md` | identity contract |

`exportService.ts` was checked before changing: the banner is written and
never parsed back — there is no import path in the codebase that matches on
it — so it is a label, not a format marker.

`demoSeed.ts` names the demo project in three places and one of them is a
`p.name === '…'` lookup. All three moved together; changing two would have
produced a seed that cannot find the project it just created.

### Renamed but not live until a deploy

```
supabase/functions/generate-routine/index.ts   "Atlas AI Coach" ×2 (system prompts)
supabase/functions/notion-auth/index.ts        Notion page title + body copy
```

These are canonical sources for functions that are already deployed. The
canonical tree now says Aderyth; **production still says Atlas until the
functions are redeployed**, which is deliberately not done here — edge deploys
are gated on the outstanding OAuth secrets. Until then the AI coach will still
introduce itself as Atlas in its replies even though the app's own greeting
line says Aderyth.

### Obsidian plugin — display renamed, identity frozen

```
renamed   manifest name / description / author, ribbon label,
          command display names, note headings, sync footer,
          default vault folder
frozen    manifest "id": "atlas-pos-sync"   — installed plugin identity
          command ids  atlas-sync-today, …  — user hotkey bindings
```

Changing the plugin `id` orphans an existing install and its settings;
changing a command id silently drops any hotkey a user bound to it. The
default vault folder moved because it is only a default — an existing install
has its own value persisted and keeps it.

---

## Not renamed, and not claimed to be

Source **comments** still say Atlas in about twenty places (`lib/tokens.ts`,
component headers, test preambles). They are not branding and no user reads
them, so they were left rather than churned through files this pass otherwise
does not touch. `lib/tokens.ts` additionally cites "POS v2 Atlas Design
Language" as the *source* the palette was derived from, which is a citation
and would be wrong to rewrite.

---

## What keeps the old name from coming back

`__tests__/repo/brandResidue.test.ts` scans every `.ts`/`.tsx` under `app/`
and `components/` **with comments stripped**, and fails on the old name inside
a string literal. The distinction is the whole point: a comment mentioning
Atlas is history and passes; a `<Text>` saying Atlas is residue and fails.
Otherwise the cheapest way to make the gate green would have been to delete
the record.

The frozen values are listed in the test as an explicit allowlist rather than
excused by a loose regex, so adding one is a diff a reviewer sees. The same
file asserts the other direction too — that `scheme`, `slug` and both storage
key prefixes are still the old strings — because "renamed too much" is the
failure this audit exists to prevent, and a gate that only checks one
direction would not catch it.

The auth surface, the one screen actually rewritten, is checked by rendering
rather than scanning: `__tests__/ui/signupConfirmation.test.tsx` mounts the
register screen and asserts the form leaves the tree on success.

Mutation-checked, five ways, each confirmed to turn the gates red: reading
`identities` to distinguish a repeat signup, dropping `{{ .Token }}` from the
recovery template, leaking a template variable into an HTML comment, putting
the old name back in a visible label, and renaming a storage key.
