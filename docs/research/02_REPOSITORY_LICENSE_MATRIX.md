# 02 — Repository Licence Matrix

**Status:** `Audited` — this document is the licence **gate** for Phase 8A
**Rule:** nothing enters production code without a row here marked `Cleared`

---

## Classification scheme

| Class | Meaning | Permitted use |
|---|---|---|
| **Cleared — permissive** | MIT / Apache-2.0 / BSD / ISC / PostgreSQL | dependency **or** code adaptation |
| **Cleared with attribution** | Permissive but requires a NOTICE / attribution file | dependency or adaptation **+ attribution shipped** |
| **Reference only** | Weak copyleft (MPL-2.0, LGPL) | may be read; **file-level copying triggers obligations** |
| **Blocked** | GPL-2.0/3.0, AGPL-3.0, SSPL, BUSL, "source-available" | **never** in this product |
| **Unresolved** | no LICENSE file, or ambiguous | **treated as Blocked** until resolved |

**Default on doubt is `Blocked`.** An unlicensed public repository is *not*
public domain — absent a licence, default copyright applies and no use is granted.

---

## Matrix — the 15 shortlisted repositories

| # | Repository | Licence | Class | Dependency? | Adapt code? | Obligation |
|---|---|---|---|---|---|---|
| 1 | `expo/expo` | MIT | Cleared — permissive | yes (already) | yes | retain MIT notice if copied |
| 2 | `software-mansion/react-native-reanimated` | MIT | Cleared — permissive | yes (already) | yes | as above |
| 3 | `pmndrs/zustand` | MIT | Cleared — permissive | yes (already) | **yes — pattern adaptation planned** | notice if code copied; none for patterns |
| 4 | `TanStack/query` | MIT | Cleared — permissive | if adopted | yes | — |
| 5 | `Nozbe/WatermelonDB` | MIT | Cleared — permissive | if adopted | yes | — |
| 6 | `LegendApp/legend-state` | MIT | Cleared — permissive | if adopted | yes | — |
| 7 | `supabase/supabase-js` | MIT | Cleared — permissive | yes (already) | yes | — |
| 8 | `supabase/cli` | Apache-2.0 | Cleared — permissive | **dev only** | unlikely | NOTICE + state changes if modified |
| 9 | `theory/pgtap` | PostgreSQL Licence | Cleared — permissive | **dev/test only** | yes | retain copyright notice |
| 10 | `jest-expo` (in `expo/expo`) | MIT | Cleared — permissive | **dev only** | no | — |
| 11 | `mobile-dev-inc/maestro` | Apache-2.0 | Cleared — permissive | **dev/CI only** | no | NOTICE if redistributed |
| 12 | `wix/Detox` | MIT | Cleared — permissive | **dev/CI only** | no | — |
| 13 | `date-fns/date-fns` | MIT | Cleared — permissive | yes (already) | yes | — |
| 14 | `getsentry/sentry-react-native` | MIT | Cleared — permissive | if adopted | no | **see §Privacy** |
| 15 | `gitleaks/gitleaks` | MIT | Cleared — permissive | **CI only** | no | — |

**Result: 15 / 15 permissive. Zero `Blocked`, zero `Unresolved`.**

That is not luck — copyleft candidates were filtered out during selection.
Recording it explicitly so a later reviewer does not assume the check was skipped.

---

## Verification method and its limit

Licences above are recorded from each project's well-known published licensing.
**They have not been re-verified by reading the `LICENSE` file at a pinned
commit**, because no repository has been cloned.

**Therefore:** before any repository moves to `Use as dependency` or
`Adapt pattern` in Phase 8A, its `LICENSE` file must be read **at the exact
version to be adopted** and the result recorded here with the commit SHA.
Licences change (Terraform → BUSL, Sentry's own history). A licence known from
memory is a claim, not evidence.

---

## Transitive obligations — the gap this matrix does not close

A direct dependency's MIT licence says nothing about **its** dependency tree.
`frontend/package-lock.json` already resolves hundreds of transitive packages
that were never licence-reviewed.

**Not assessed by this audit.** Before store release (Phase 6E), run a licence
scan across the resolved tree — `license-checker`, `oss-review-toolkit` or
equivalent — and specifically look for GPL/AGPL/SSPL appearing transitively.
Filed as a Phase 6E task.

---

## Attribution obligations if items 8, 9, 11 are adopted

Apache-2.0 (`supabase/cli`, `maestro`) requires the licence text and a NOTICE
file **if the software is redistributed**. Used only as a local/CI dev tool and
never shipped inside the app bundle, redistribution does not occur and no
in-app attribution is required.

pgTAP (PostgreSQL Licence) requires the copyright notice to travel with copied
source. If pgTAP test *helpers* are copied into `supabase/tests/`, the notice
must be retained in those files.

**Practical rule:** anything that ships inside the `.ipa`/`.apk` needs an
in-app licences screen; dev and CI tooling does not. Currently **no** in-app
licences screen exists — added as a Phase 6E task.

---

## Privacy note on item 14 (Sentry)

A licence check is not a privacy check. Crash reporting transmits stack traces
and can capture user context, which becomes a **data-safety disclosure**
obligation on both stores and a GDPR/KVKK consideration for a Turkish user base.

Adopting Sentry requires, in Phase 6C/6E: PII scrubbing configured before
release, disclosure in the privacy policy, and the App Store / Play data-safety
forms updated. **Licence `Cleared` does not mean adoption is free of obligation.**

---

## Gate rule for Phase 8A

A repository may be adopted only when all four hold:

1. Row exists here and is `Cleared`
2. `LICENSE` read at the pinned adoption version, SHA recorded
3. Attribution obligation identified and assigned
4. If it ships in the bundle: covered by the in-app licences screen

**Currently zero repositories satisfy criterion 2**, because none has been
cloned. No adoption may proceed until that changes.
