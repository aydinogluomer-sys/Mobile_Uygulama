# 03 — Unfinished and Broken Work

**Status:** `Verified` for static evidence; items needing a device are marked
**Phase:** Gate A

---

## 1. Marker scan — unusually clean

| Marker | Hits in `app/`, `components/`, `constants/`, `lib/`, `store/` |
|---|---|
| `TODO` / `FIXME` / `HACK` / `WIP` / `XXX` | **0** |
| `Lorem` / `dummy` / `placeholder` data | **0** (all `placeholder` hits are legitimate `TextInput` props) |
| `console.log` | **0** |
| `onPress={() => {}}` empty handlers | **0** |
| `@ts-ignore` / `@ts-expect-error` | **0** |

**Unfinished work in this codebase is not marked with comments.** It is
structural — code that exists and works but is unreachable, or code that is
reachable but points at something that no longer exists. Grepping for markers
would have produced a clean bill of health and missed every real defect below.

---

## 2. Classification

| Status | Count |
|---|---|
| `BROKEN` — reachable, fails at runtime | 5 |
| `DEAD_CODE` — implemented, unreachable | 5 |
| `UI_ONLY` — renders, no working backend | 2 |
| `MOCK_ONLY` — self-labelled placeholder | 1 |
| `PARTIALLY_IMPLEMENTED` | 3 |
| `REGRESSED` — worked once, broken by drift | 2 |

---

## 3. BROKEN — reachable and failing

### B1 · `utils/api.ts` points at `http://localhost:8000`

`frontend/utils/api.ts:4` — `process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8000'`,
and `frontend/.env` sets exactly that. On any real device every call fails.

| Feature | Entry point | Failure |
|---|---|---|
| Bad-habits tracking | `components/BadHabitsTracker.tsx:15,45,58,77` via Settings → Takip (`settings.tsx:546`) | permanently empty list; errors swallowed at `:48,:70,:81` |
| Webhook CRUD | `app/tabs/settings.tsx:21,57,73` | silent failure, `console.error` only at `:61,:83` |
| Data export | `settings.tsx:87-123` | **shows a false success alert** — see B2 |

**Severity P1.** Three user-facing features are dead on device. Phase 2A.

### B2 · Export reports success when nothing was exported

`app/tabs/settings.tsx:100-112` — the Excel/CSV path calls
`Linking.openURL('http://localhost:8000/api/data/export/...')` and then
**unconditionally** fires `Alert.alert('Başarılı', …)` regardless of outcome.

The user is told their data was exported when no file was produced.
**Severity P1** — actively misleading. Phase 2A.

### B3 · `google-auth` is called but not deployed

`store/googleCalendarStore.ts:34,62,78,109` calls
`${SUPABASE_FUNCTIONS_URL}/google-auth?action=status|url|callback|disconnect`.

Live function list on `kbcuolhjjnmhjaarxxmu`: `generate-routine`, `spotify-auth`,
`notion-auth`, `notion-sync`, `subscription-webhook`. **No `google-auth`.**

Worse, its target table `google_calendar_integrations` **does not exist** in the
live database, despite being defined in canonical
`supabase/migrations/002_integrations.sql:19-29` — that migration was never
applied.

Meanwhile `constants/integrations.ts:53` advertises Google Calendar as
`available`. **Severity P1.** Phase 2A/2C.

### B4 · `notion-sync` silently syncs zero habits

The deployed v1 (retrieved via `get_edge_function`) queries:

```ts
supabase.from('habit_logs').select('habit_id, state, xp, value, target_value').eq('date', syncDate)
```

Live `habit_logs` columns: `id, habit_id, user_id, completed_at, is_completed,
current_streak, notes, mood_rating, created_at, photo_url, voice_note_url,
caption, value, is_makeup, state, xp`.

- `date` → **does not exist** (canonical name is `completed_at`)
- `target_value` → **does not exist** on `habit_logs`

The tasks path is fully compatible. The function returns
`{success: true, synced_habits: 0}` — **reporting success while doing nothing**.
**Severity P1.** Phase 2A/2C.

### B5 · Drawer's "AI Rutin Oluştur" does nothing special

`components/Drawer.tsx:58` defines the route `/tabs/habits?ai=true`, but
`Drawer.tsx:95` does `route.split('?')[0]` and **discards the query**.
Independently, `app/tabs/habits.tsx` never calls `useLocalSearchParams`, so it
could not read the flag anyway. The entry just opens the habits list.

The AI modal is reachable only from the FAB at `habits.tsx:408`.
**Severity P2.** Phase 2A.

---

## 4. DEAD_CODE — implemented but unreachable

| # | Item | Size | Evidence |
|---|---|---|---|
| D1 | `components/CommandPalette.tsx` | 256 ln | **Never rendered.** `useCommandStore` has two consumers: `tabs/_layout.tsx:23` (the opener) and the palette itself (`:39`). No file mounts `<CommandPalette />`. The ⌘K pill at `tabs/_layout.tsx:42-47` flips store state and nothing appears. |
| D2 | `components/ADHDTaskSplitter.tsx` | 313 ln | **Never imported.** Fully implemented, real `supabase.from('tasks').insert(rows)` at `:56`. |
| D3 | `app/tabs/hub.tsx` | 138 ln | `href:null` at `tabs/_layout.tsx:148` and no `router.push('/tabs/hub')` anywhere. An entire "Keşfet" launcher is unreachable. |
| D4 | `app/screens/dashboard.tsx` | 18 ln | Registered at `screens/_layout.tsx:50`; nothing navigates to it. Self-documented as a back-compat shim at `:6-7`. |
| D5 | `store/useStore.ts` | 60 ln | Zero imports repo-wide. Duplicates habits/tasks/completions using the obsolete `types/index.ts` shapes. |

Plus `app/_layout.tsx:63` registers `<Stack.Screen name="habits" />` for a route
that does not exist (habits lives at `app/tabs/habits.tsx`).

### D6 · Three orphaned database functions

`process_habit_xp`, `trigger_xp_habit_completion`, `trigger_xp_task_completion`
are `SECURITY DEFINER` and reference `add_xp`, but **none is attached to a
trigger**. Only `fn_habit_log_award` and `trigger_damage_on_habit_log` are live,
both on `habit_logs`.

**Consequence: task-completion XP is not a database pipeline at all.** There is
no trigger on any tasks table. A reader of the schema would reasonably assume
otherwise. Recorded so a later phase does not "repair" something never wired.

---

## 5. UI_ONLY and MOCK_ONLY

### U1 · `constants/features.ts` advertises three non-working features

Rendered in Settings under "Şu an kullanabileceğiniz" (`settings.tsx:406-407`):

| Claim | Reality |
|---|---|
| `:45-51` "ADHD dostu görev bölme" | `ADHDTaskSplitter.tsx` is never mounted (D2) |
| `:66-72` "Veri dışa aktarma" | points at the dead localhost backend (B1/B2) |
| `:73-79` "Webhook otomasyonu" | same dead backend |

The heatmap (`:52-58`) and XP (`:31-37`) claims **are** real.
**Severity P2** — the product tells the user features work when they do not.

### U2 · `constants/integrations.ts` status flags are stale in both directions

- `:262-268` Spotify → `comingSoon`, but Spotify is fully wired (`FocusSpotifyCard.tsx`)
- `:121-153` the AI Coach category → `comingSoon`, but `app/screens/ai-coach.tsx` is a working screen reachable from `Drawer.tsx:51`
- `:53` Google Calendar → `available`, but it is B3 (404 on every call)

Otherwise honest: 21 of 25 items are correctly `comingSoon`, and
`integrations.tsx:145` says so to the user.

### M1 · Paywall is a self-labelled mock

`app/screens/paywall.tsx:30` `activateMock`; `:33-36` alert titled
"🎉 Abonelik Aktif (Test)"; `:140-146` renders an explicit disclosure banner.
**Honest, not deceptive** — but no real IAP exists. Now additionally gated behind
`__DEV__` (commit `42b64a0`) since the underlying RPC was revoked.

---

## 6. PARTIALLY_IMPLEMENTED

### P1 · Monthly review reflections are device-local

`app/screens/monthly-review.tsx:129` writes reflection answers to **AsyncStorage
only**, then shows "Kaydedildi (dd.MM.yyyy)" at `:268`. The sibling
`weekly-review.tsx:133` upserts to the `weekly_reviews` Supabase table.

Monthly answers are lost on reinstall or device change, and the UI does not say
so. **Severity P2.** Phase 4A.

### P2 · Calendar is read-only

`app/screens/calendar.tsx` renders a month grid with task/habit dots but has
**zero mutations** — a day tap only sets local state (`:148`). No event can be
created or edited. Reference parity gap, not a defect. Phase 3.

### P3 · `run-tests.js` is not a test suite

351 lines of `fs.readFileSync` + `.includes()` over source **text**. It imports
zero application modules, asserts on Turkish UI copy (`:110` asserts the string
"Aktif alışkanlık yok"), reads gitignored `.env` at `:144` (so it fails on a
clean clone), and is wired to **no npm script**.

Current result: **139/142**, with 3 long-standing failures in
SearchButton / habits list / monthly-review. `todolist.md:11` redefines success
as "count stays at 89/92" — i.e. the failures were normalised rather than fixed.

Not one of the domain defects in doc 07 would be caught, because none of that
code is ever executed. Replacement is Phase 1E.

---

## 7. REGRESSED — worked once, broken by drift

### R1 · `supabase/functions/generate-routine` no longer matches production

The committed file supports **2 modes** (`COST = { coach: 5, routine: 25 }`,
`:7`, with `:42` treating anything not `coach` as `routine`). The app sends
**4** — `coach`, `routine`, `summarize` (`ai-coach.tsx:130`), `insights`
(`journal-insights.tsx:68`).

Deployed version is **11**; the committed file is an older lineage. Deploying the
repo file today would charge `summarize` 25 Focus Points instead of 3, and
`insights` 25 instead of 5, and hand both a routine-generation prompt.

**The canonical tree contains a file that would regress production if deployed.**
Severity P1. Phase 1D re-implementation.

### R2 · Nineteen live migrations have no repository counterpart

Live ledger: **21** migrations. Repository: **4** files, of which only the two
Emergency Gate 0 ones match a ledger entry.

`supabase db reset` from the repo produces a database the app **cannot run
against** — 41 of 48 tables missing, all 40 RPCs missing, all 9 triggers missing,
five renamed columns, and a `status` CHECK (`001:20`) that rejects `'idea'`,
a value the client writes (`lib/supabase.ts:55`).

**Deliberately not reconstructed by guesswork.** Gate B records the
reconciliation decision; Phase 1A applies it after a three-way diff.

---

## 8. Findings table

| ID | Item | Status | Missing layer | Files | User impact | Priority | Phase |
|---|---|---|---|---|---|---|---|
| B1 | localhost backend | BROKEN | backend | `utils/api.ts`, `BadHabitsTracker.tsx`, `settings.tsx` | 3 features dead on device | P1 | 2A |
| B2 | false export success | BROKEN | backend + UX | `settings.tsx:100-112` | user misled | P1 | 2A |
| B3 | `google-auth` undeployed | BROKEN | backend + schema | `googleCalendarStore.ts` | Calendar 404s | P1 | 2A/2C |
| B4 | `notion-sync` habits path | BROKEN | schema | edge function | silent zero-sync | P1 | 2A/2C |
| B5 | drawer query stripped | BROKEN | navigation | `Drawer.tsx:95` | AI entry inert | P2 | 2A |
| D1 | CommandPalette unmounted | DEAD_CODE | mount | `CommandPalette.tsx` | ⌘K does nothing | P2 | 2A |
| D2 | ADHDTaskSplitter | DEAD_CODE | import | `ADHDTaskSplitter.tsx` | advertised, absent | P2 | 2A |
| D3 | `tabs/hub.tsx` | DEAD_CODE | navigation | `hub.tsx` | none (invisible) | P3 | 2A |
| D4 | `screens/dashboard.tsx` | DEAD_CODE | navigation | `dashboard.tsx` | none | P3 | 2A |
| D5 | `store/useStore.ts` | DEAD_CODE | — | `useStore.ts` | none | P3 | 2A |
| D6 | 3 orphaned DB functions | DEAD_CODE | trigger | database | task XP never awarded | P2 | 1A |
| U1 | false feature claims | UI_ONLY | backend | `constants/features.ts` | user misled | P2 | 2A |
| U2 | stale integration flags | UI_ONLY | — | `constants/integrations.ts` | user misled | P3 | 2A |
| M1 | paywall mock | MOCK_ONLY | IAP | `paywall.tsx` | disclosed | P2 | 6 |
| P1 | monthly reflections local | PARTIAL | backend | `monthly-review.tsx:129` | silent data loss | P2 | 4A |
| P2 | calendar read-only | PARTIAL | write path | `calendar.tsx` | parity gap | P3 | 3 |
| P3 | no real tests | PARTIAL | test infra | `run-tests.js` | no safety net | P1 | 1E |
| R1 | stale `generate-routine` | REGRESSED | — | edge function | would regress on deploy | P1 | 1D |
| R2 | 19 missing migrations | REGRESSED | migrations | `supabase/migrations/` | no reproducible env | P1 | 1A |

---

## 9. What is genuinely finished

Stated explicitly so remediation does not disturb it:

- **Today, Habits, Timeline, Tasks, Focus, Stats, Recovery** — real reads and writes against Supabase, with loading and empty states.
- **No fake metrics anywhere.** `awwwards-loop/reports/iteration-02.md` records that the reference HTML's hardcoded sleep/recovery figures were deliberately **rejected**. Verified: zero occurrences of `−4s 12d`, `31%` or `6.4` in `app/`, `components/`, `constants/`.
- **XP and streaks are server-authoritative** — a BEFORE trigger overwrites any client-supplied `xp` (doc 07 §5).
- **TypeScript is clean** under `strict: true` with zero suppressions.
- **RLS is enabled on all 48 tables**, 0 ERROR-level advisor lints.
