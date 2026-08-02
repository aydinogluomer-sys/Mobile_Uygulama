# 01 — Repository Hygiene and Security

**Status:** `Verified` for history; `Blocked` on two human-dependency decisions
**Phase:** 0A (hygiene) + 0B (secret scan)
**Scanned:** full history, all refs, 611 candidate blobs

---

## 1. Headline

**No credential has ever been committed to this repository.** A full-history
scan across every blob reachable from every ref produced exactly **one** hit,
and that hit is a localhost connection string with no credentials in it.

The real secrets exist only in the working tree, are untracked, and are covered
by `.gitignore`. Two of them nonetheless require a human decision, because they
grant access beyond this project.

---

## 2. Method

`gitleaks` and `trufflehog` are not installed on this machine, and the Docker
daemon is not running (`npipe:////./pipe/dockerDesktopLinuxEngine` unreachable),
so the containerised route was unavailable. An equivalent native scan was
written instead — the plan permits "gitleaks / trufflehog **or equivalent**".

`scan-fast.sh` enumerates every blob reachable from every ref via
`git rev-list --objects --all`, discards `.metro-cache/`, `node_modules/` and
binary assets, streams the remainder through a single `git cat-file --batch`
process, and applies 15 credential patterns in one Perl pass.

Patterns: JWT · Anthropic `sk-ant-` · OpenAI `sk-` · Notion `ntn_`/`secret_` ·
Google `AIza` · AWS `AKIA` · PEM private-key blocks · Supabase `sb_secret_` ·
Supabase `sb_publishable_` · `service_role` literal assignment · generic
`password=` · MongoDB URI · Postgres URI with inline credentials · Slack `xox*` ·
Stripe `sk_live_`/`rk_live_`.

**Limitation:** this scan detects the patterns listed above. A credential in an
unusual format, or split across lines, would not be caught. It is not equivalent
to a maintained commercial ruleset.

---

## 3. History scan result

```
candidate blobs: 611

HIT  [mongo_uri] backend/.env   blob 0f4322c8  => mongodb://loca<REDACTED>

== total hits: 1 ==
```

### The single hit, classified

| Field | Value |
|---|---|
| Path | `backend/.env` |
| Blob | `0f4322c8` |
| Introduced by | `11a2e73` — `auto-commit for c884750a-...` (the Emergent bootstrap commit) |
| Content | `MONGO_URL="mongodb://localhost:27017"` / `DB_NAME="test_database"` |
| Credentials embedded? | **No** — verified: URI matches no `user:pass@` form |
| Still in HEAD? | No — removed from the tree in a later commit |
| Classification | **Cosmetic / non-secret.** A localhost loopback address for a database that is not reachable from anywhere else. |
| Rotation required | **None** |

The historical `frontend/.env` from the same commit contains only
`EXPO_TUNNEL_SUBDOMAIN`, `EXPO_PACKAGER_HOSTNAME`, `EXPO_PUBLIC_BACKEND_URL`,
`EXPO_USE_FAST_RESOLVER` and `METRO_CACHE_ROOT` — Expo tooling configuration,
no credentials. It predates the Supabase integration entirely.

**Conclusion: history rewriting is NOT required for secret remediation.** The
only reason to consider Phase 7 is repository size, not exposure.

---

## 4. Working-tree credential inventory

Every file on disk that can hold a credential, with its tracking status:

| File | Tracked | Ignored | Contents | Severity |
|---|---|---|---|---|
| `backend/.env.local` | no | yes (`*.env.*`) | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, `SUPABASE_URL`, **`SUPABASE_SERVICE_ROLE_KEY`** | **HUMAN DEPENDENCY — see §6** |
| `.claude/settings.local.json` | no | yes (added in Phase 0A) | account passwords, live JWT bearer tokens, a user id, publishable key | **HUMAN DEPENDENCY — see §7** |
| `backend/supabase/functions/.env.local` | no | yes | duplicate `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` | Medium — duplicate of the above |
| `frontend/.env` | no | yes | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_BACKEND_URL` | **None.** `EXPO_PUBLIC_*` is public by design and ships inside the app bundle |
| `backend/.env` | no | yes | localhost Mongo URI | None |
| `.codex/config.toml` | **yes** | no | `url = "https://mcp.notion.com/mcp"` — 56 bytes, zero token-like strings | **None** — public endpoint, safe to track |

Client-side key usage is correct: `frontend/lib/supabase.ts:5-8` uses only
`EXPO_PUBLIC_SUPABASE_ANON_KEY`. No `service_role` reference exists anywhere in
`frontend/`.

---

## 5. Phase 0A hygiene changes

Ten commits on `chore/commit-baseline`:

| Commit | Subject |
|---|---|
| `15f8664` | chore(repo): untrack Metro build cache and repair .gitignore |
| `22dddf4` | feat(supabase): add migrations and edge functions to version control |
| `c0db839` | feat(frontend): add domain layer — lib, stores, constants |
| `852cff4` | feat(frontend): add component layer |
| `fea1fda` | feat(frontend): add Expo Router route tree |
| `876acf5` | chore(frontend): add build config, scripts and feature docs |
| `0934542` | chore(tooling): add agent skill packs and tooling config |
| `933e00f` | docs: add implementation and planning documents |
| `a3f263f` | chore: add Obsidian plugin, Playwright harness and debug screenshots |
| `e291f21` | fix(repo): untrack obsidian-api embedded git repository |

### `.gitignore` defects found and fixed

| Defect | Evidence | Fix |
|---|---|---|
| `.metro-cache/` matched no rule; only `.metro-health-check*` was ignored | `frontend/.gitignore:22` | added `.metro-cache/` to both gitignores |
| `supabase/.temp/` and `backend/supabase/.temp/` tracked (CLI scratch state) | `git status` showed `supabase/.temp/linked-project.json` staged | untracked + ignored |
| `android-sdk/ -e ` — malformed entry from an `echo -e` artifact; matched nothing | root `.gitignore` | corrected to `android-sdk/` |
| `.claude/settings.local.json` not ignored, and contains real credentials | §7 | ignored via `.claude/settings.local.json` and `**/settings.local.json` |
| `obsidian-api/` added as a `160000` gitlink with no `.gitmodules` | `git ls-tree HEAD obsidian-api` | untracked + ignored, clone URL documented in `.gitignore` |

The `obsidian-api` gitlink was a real defect: a broken submodule reference
resolves to an empty directory in any clone, with no way to fetch the contents.

### Deliberately not done

Historical `.metro-cache` blobs remain reachable from the 90 pre-existing
commits. `.git` is 45 MB. No SHA changed, no force-push occurred, no
`git filter-repo` ran. Full cleanup is **Phase 7**, gated on explicit approval,
and — per §3 — is a size optimisation, not a security requirement.

---

## 6. HUMAN DEPENDENCY 1 — service-role key for an unrelated project

`backend/.env.local:4` holds `SUPABASE_SERVICE_ROLE_KEY` for
**`zdqiujpeewtyhtcqhdcj` ("Mas Technic Site")** — not this application's project.
A service-role key bypasses all Row Level Security and grants full administrative
access to that database.

**No autonomous action has been taken and none will be.** Per the approved plan,
without explicit approval I will not revoke the key, not delete the file, and not
change anything in that external project.

### Impact assessment

| Question | Answer |
|---|---|
| Is it committed? | **No.** Untracked, ignored by `*.env.*`, absent from all 611 history blobs. |
| Is it exposed? | Only to whoever has filesystem access to this machine. |
| Does this app use it? | **No.** No file in `frontend/` or `supabase/` reads it. It is used, if at all, by `backend/supabase/functions/*`, which target the wrong project anyway. |
| What breaks if it is rotated? | Anything in "Mas Technic Site" authenticating with it — outside this repository, so the blast radius **cannot be determined from here**. |

### Proposed options — your decision

1. **Relocate, do not rotate.** Move the file outside the repository tree (e.g.
   a machine-local secrets directory) and point any consumer at the new path.
   Lowest risk; the key stays valid. **Recommended** if "Mas Technic Site" is live.
2. **Rotate and relocate.** Issue a new service-role key in the Supabase
   dashboard for `zdqiujpeewtyhtcqhdcj`, update every consumer of the old key,
   then delete the local copy. Correct if the key may have been shared or if
   provenance is uncertain — but every consumer must be inventoried first, and
   that inventory does not exist in this repository.
3. **Delete outright.** Only safe once confirmed nothing depends on it.

**Blocking question:** is `zdqiujpeewtyhtcqhdcj` ("Mas Technic Site") a live
production project, and who else holds this key?

---

## 7. HUMAN DEPENDENCY 2 — credentials captured in the agent permission allowlist

Found during Phase 0A while deciding whether `.claude/` could be committed.
**This file was never committed and is now gitignored** — but the credentials in
it are real and, unlike the history hit, are current.

`.claude/settings.local.json` stores previously-approved Bash commands verbatim
in its permission allowlist. Those commands were `curl` calls against the live
Supabase auth API, so their bodies were captured too:

| Captured | Detail |
|---|---|
| Account password | **your own** — `aydinogluomer@gmail.com` with a plaintext password |
| Test account passwords | three further accounts (`testci@habitapp.dev`, `testci@gmail.com`, `testci@supatest.com`) |
| Live JWT bearer tokens | multiple `Authorization: Bearer eyJ...` access tokens |
| User id | a real `user_id` UUID |
| Publishable key | `sb_publishable_...` — public by design, not a concern |

The JWTs have almost certainly expired (Supabase access tokens default to one
hour). **The passwords have not.**

### Proposed options — your decision

1. **Rotate the passwords.** At minimum the `aydinogluomer@gmail.com` account,
   since it appears to be the owner account. **Recommended.**
2. **Prune the allowlist.** Remove the credential-bearing entries from
   `.claude/settings.local.json` so they are not re-read into future sessions.
3. **Stop approving credential-bearing commands.** The root cause is that
   `curl ... -d '{"password":"..."}'` was approved as a permission rule, which
   stores the whole command string. Future auth probing should read credentials
   from an env var so only the shape is stored.

**Blocking question:** may I prune the credential entries from
`.claude/settings.local.json`? Password rotation is yours to perform — I will not
attempt it.

---

## 8. Findings summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | 268 source files never committed; app existed only in the working tree | **P0** | **Resolved** — Phase 0A |
| 2 | 13,534 `.metro-cache` files tracked; matched no ignore rule | **P1** | **Resolved** — Phase 0A |
| 3 | Service-role key for an unrelated project in the tree | **P1** | **Blocked** — §6 |
| 4 | Real passwords + JWTs in the agent permission allowlist | **P1** | **Blocked** — §7 |
| 5 | `obsidian-api` committed as a broken gitlink | P2 | **Resolved** — `e291f21` |
| 6 | `supabase/.temp/` CLI scratch state tracked | P3 | **Resolved** — Phase 0A |
| 7 | Malformed `android-sdk/ -e ` ignore rule | P3 | **Resolved** — Phase 0A |
| 8 | `packageManager: yarn@1.22.22` but only `package-lock.json` exists | P2 | **Planned** — Phase 2B |
| 9 | Historical `backend/.env` with a localhost Mongo URI | P4 | **No action** — not a secret |
| 10 | `.git` remains 45 MB from historical cache blobs | P3 | **Deferred** — Phase 7 |

---

## 9. Phase 0B exit criteria

| Criterion | Status |
|---|---|
| Full history scanned | **Met** — 611 blobs, all refs, 15 patterns |
| Every finding classified | **Met** — §8 |
| Rotation proposals presented | **Met** — §6, §7 |
| Impact reports presented | **Met** — §6 impact table; §7 blast radius |
| No key revoked or file deleted without approval | **Met** — no action taken on either |

**Phase 0B is complete except for two decisions that are yours to make.**
Neither blocks Phase 0C.
