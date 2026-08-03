# 06 — End-to-End Functional Audit

**Status:** `Partially verified` — static and database-layer checks done; device execution `Blocked`
**Phase:** Gate A

---

## 1. Execution status, stated honestly

This document was intended to record executed Given/When/Then results. It does
not, because two prerequisites are missing:

| Prerequisite | State |
|---|---|
| Physical device / emulator run | **not performed** |
| Automated test runner able to execute app code | **does not exist** — `run-tests.js` reads source as text (doc 03 §P3) |
| Live database | **available** since Phase 0C |
| Write access for test fixtures | **withheld** — no SQL writes permitted before Gate B |

So each case below carries one of:

- **`VERIFIED-STATIC`** — provable by reading code or querying the catalogue
- **`VERIFIED-DB`** — provable from live schema/constraints
- **`BLOCKED-DEVICE`** — needs a running app
- **`BLOCKED-WRITE`** — needs test data to be written

**No case is marked passing on inference.** Where the code path is
demonstrably broken, that is recorded as a **predicted** failure with the
evidence, not as an observed one.

---

## 2. Authentication

| ID | Given / When / Then | Status | Evidence |
|---|---|---|---|
| E2E-A01 | Fresh install → `/` → redirected to login | `VERIFIED-STATIC` | `app/index.tsx:4` `<Redirect href="/(auth)/login" />` |
| E2E-A02 | Valid credentials → land on `/tabs/today` | `VERIFIED-STATIC` | `app/_layout.tsx:52-56` session gate |
| E2E-A03 | No session → any tab redirects to login | `VERIFIED-STATIC` | `_layout.tsx:53` |
| E2E-A04 | Register → profile row created | `VERIFIED-DB` | trigger `handle_new_user` (`SECURITY DEFINER`, `search_path=public`) |
| E2E-A05 | Session survives app restart | `VERIFIED-STATIC` | `lib/supabase.ts:10-13` AsyncStorage + `persistSession` |
| E2E-A06 | Password reset email → deep link → reset screen | `BLOCKED-DEVICE` | `(auth)/reset-password.tsx` exists; deep link untested |
| E2E-A07 | Wrong password shows an error | `BLOCKED-DEVICE` | |
| E2E-A08 | Offline login shows a network error, not a crash | `BLOCKED-DEVICE` | |
| E2E-A09 | User A cannot read user B's rows | `VERIFIED-DB` | RLS on all 48 tables; 39 owner-scoped policies `(SELECT auth.uid()) = user_id`; 0 ERROR advisors |
| E2E-A10 | Logout clears session and data | `BLOCKED-DEVICE` | |

**A09 is the one that mattered most and it passes at the schema level.** Actual
cross-tenant behaviour still needs a two-account device test.

---

## 3. Habits — the core loop

| ID | Case | Status | Evidence / prediction |
|---|---|---|---|
| E2E-H01 | Create habit → appears in list | `BLOCKED-DEVICE` | `habits.tsx` 22 mutations |
| E2E-H02 | Toggle completion → log written | `BLOCKED-DEVICE` | `logStore.logHabit` |
| E2E-H03 | **Double-tap does not duplicate** | `VERIFIED-DB` **PASS** | `UNIQUE (habit_id, completed_at)` exists |
| E2E-H04 | **Double-tap surfaces no silent failure** | **PREDICTED FAIL** | `logStore.ts:71-84` destructures `{ data }` only; the unique violation is swallowed and the UI shows nothing |
| E2E-H05 | XP awarded on completion | `VERIFIED-DB` | BEFORE trigger `fn_habit_log_set_xp` |
| E2E-H06 | Client cannot forge XP | `VERIFIED-DB` **PASS** | trigger overwrites `NEW.xp` unconditionally |
| E2E-H07 | Partial XP never exceeds full | `VERIFIED-DB` **PASS** | `habit_xp_value` clamps with `least(...)` |
| E2E-H08 | Streak advances on consecutive days | `BLOCKED-WRITE` | needs multi-day fixtures |
| E2E-H09 | **Weekly (Mon/Wed/Fri) habit not scored as failed on other days** | **PREDICTED FAIL** | `reportMetrics.ts:87-93` never calls `isDueOn`; denominator is `activeHabits × days` — caps such a habit at 3/7 = 43 % |
| E2E-H10 | **"X times per week" habit becomes due** | **PREDICTED FAIL** | `habitSchedule.ts:32-40` never reads `frequency_config.count`; `weekly` without `days` returns `false` on every date |
| E2E-H11 | **`at_most` habit scores higher for lower values** | **PREDICTED FAIL** | `reportMetrics.ts:40-46` ignores `target_direction`; formula rewards larger values |
| E2E-H12 | **`miss`/`skip` not counted as completed** | **PREDICTED FAIL** | `reportMetrics.ts:126-127` increments on any log row |
| E2E-H13 | Measurable habit accumulates value | `BLOCKED-DEVICE` | `MeasurableInputModal` |
| E2E-H14 | Editing a past day works | `BLOCKED-DEVICE` | |

**Four predicted failures, all in `lib/reportMetrics.ts` / `lib/habitSchedule.ts`
— pure functions, all testable without a device.** Phase 1E Layer 1 should
convert every one into a failing-then-passing test.

---

## 4. Date and timezone — highest-value cases

All at `TZ=Europe/Istanbul` (UTC+3, no DST).

| ID | Case | Status | Prediction |
|---|---|---|---|
| E2E-D01 | Complete a habit at 00:30 → attributed to today | **PREDICTED FAIL** | `logStore` uses local `format()`, `taskStore.ts:130,137` uses `toISOString()` — they disagree between 00:00–03:00 |
| E2E-D02 | Task due today shows as due today at 01:00 | **PREDICTED FAIL** | `taskStore.dueToday()` returns yesterday's date |
| E2E-D03 | Complete at 23:30 → attributed to today | `BLOCKED-DEVICE` | likely passes |
| E2E-D04 | Focus streak survives a 01:30 session | **PREDICTED FAIL** | `focusReport.ts:134` matches local `ymd()` keys against UTC `.slice(0,10)` |
| E2E-D05 | Journal streak counts a late-night entry | **PREDICTED FAIL** | `journalStats.ts:52-60` same mismatch |
| E2E-D06 | Life-areas save at 01:00 does not overwrite yesterday | **PREDICTED FAIL** | `lifeAreasStore.ts:72,84` UTC date into a `(user_id,date,area)` upsert |
| E2E-D07 | Sunday 22:00 deep-work session lands in the right week | **PREDICTED FAIL** | `deepWorkStore.ts:66-69` local Monday serialised via `toISOString()` |
| E2E-D08 | Willpower budget resets at midnight | **PREDICTED FAIL** | cached `state_date` never invalidated |

**Eight cases, seven predicted failures.** This is the single most concentrated
defect cluster in the product and the strongest argument for Phase 1B.

---

## 5. Willpower and telafi

| ID | Case | Status | Prediction |
|---|---|---|---|
| E2E-W01 | Activating a habit debits the budget | `BLOCKED-DEVICE` | |
| E2E-W02 | Two rapid activations debit twice | **PREDICTED FAIL** | `willpowerStore.ts:68` client read-modify-write; both read the same `used` |
| E2E-W03 | Activation blocked when budget exhausted | **PREDICTED FAIL** | `habitStore.ts:113-115` TOCTOU across a network round-trip |
| E2E-W04 | Blocked activation tells the user why | **PREDICTED FAIL** | `habitStore.ts:113` bare `return`, no user-visible error |
| E2E-W05 | Pausing a never-activated habit does not refund | **PREDICTED FAIL** | `habitStore.ts:118-122` refunds unconditionally |
| E2E-W06 | `willpower_state` upsert does not duplicate | `VERIFIED-DB` **PASS** | live PK is exactly `(user_id, state_date)` |
| E2E-T01 | Telafi plan created for a missed habit | `BLOCKED-DEVICE` | `recovery.tsx` 13 mutations |
| E2E-T02 | **Duplicate plan for the same missed day is prevented** | **PREDICTED FAIL** | no unique on `(habit_id, source_date)` — verified absent |
| E2E-T03 | **Completing a telafi moves the completion metric** | **PREDICTED FAIL** | `recoveryStore.ts:72-82` flips a status only — no log, no XP |

---

## 6. Subscription and credits

| ID | Case | Status | Evidence |
|---|---|---|---|
| E2E-S01 | **Client cannot self-grant a paid tier** | `VERIFIED-DB` **PASS** | `mock_activate_subscription` ACL `{postgres,service_role}`; `anon`/`authenticated` false |
| E2E-S02 | Release build hides the mock purchase path | `VERIFIED-STATIC` **PASS** | `__DEV__` guard, commit `42b64a0` |
| E2E-S03 | **Client cannot write `user_subscriptions` directly** | `VERIFIED-DB` **PASS** | SELECT-only policy; no write policy exists |
| E2E-S04 | AI call debits Focus Points | `BLOCKED-DEVICE` | |
| E2E-S05 | **Concurrent AI calls cannot overspend** | **PREDICTED FAIL** | balance read `:59`, debit `:110` — TOCTOU |
| E2E-S06 | **Failed debit still returns the AI answer** | **PREDICTED FAIL** | `:109-112` swallows the error — fail-open |
| E2E-S07 | Webhook replay does not double-grant credits | **PREDICTED FAIL** | no idempotency on `provider_ref` |
| E2E-S08 | **User cannot inflate own XP/coins** | **PREDICTED FAIL** | column-level UPDATE on all `profiles` columns (SEC-1D-005) |
| E2E-S09 | **Unauthenticated caller cannot grant XP** | `VERIFIED-DB` **PASS** | migration `20260802205850` |

---

## 7. Integrations

| ID | Case | Status | Evidence |
|---|---|---|---|
| E2E-I01 | **Google Calendar connect** | **VERIFIED FAIL** | `google-auth` not deployed; `google_calendar_integrations` does not exist |
| E2E-I02 | **Notion sync writes habits** | **VERIFIED FAIL** | deployed function queries `habit_logs.date` / `.target_value`, neither exists |
| E2E-I03 | Notion sync writes tasks | `BLOCKED-DEVICE` | schema compatible — likely passes |
| E2E-I04 | Spotify connect and playback | `BLOCKED-DEVICE` | fully wired |
| E2E-I05 | OAuth `state` prevents account-linking CSRF | **PREDICTED FAIL** | `state` minted and never verified; `backend/notion-auth:161-163` is an empty `if` |
| E2E-I06 | Bad-habits tracker loads | **VERIFIED FAIL** | `localhost:8000` |
| E2E-I07 | Data export produces a file | **VERIFIED FAIL** | `localhost:8000`, plus a false success alert |

---

## 8. Navigation and reachability

| ID | Case | Status | Evidence |
|---|---|---|---|
| E2E-N01 | Every drawer entry reaches a screen | `VERIFIED-STATIC` **PASS** | all 26 entries resolve |
| E2E-N02 | **⌘K / search opens the palette** | **VERIFIED FAIL** | `CommandPalette` never mounted |
| E2E-N03 | **"AI Rutin Oluştur" opens the AI modal** | **VERIFIED FAIL** | query stripped at `Drawer.tsx:95` |
| E2E-N04 | No screen is unreachable | **VERIFIED FAIL** | `tabs/hub.tsx`, `screens/dashboard.tsx` orphaned |
| E2E-N05 | Back gesture behaves on both platforms | `BLOCKED-DEVICE` | |

---

## 9. Tally

| Verdict | Count |
|---|---|
| `VERIFIED-DB` / `VERIFIED-STATIC` **PASS** | **16** |
| **VERIFIED FAIL** (observed statically) | **7** |
| **PREDICTED FAIL** (code path demonstrably broken) | **23** |
| `BLOCKED-DEVICE` | 15 |
| `BLOCKED-WRITE` | 1 |
| **Total** | **62** |

> **Corrected at Gate B remediation (C4).** This table previously read
> 12 / 6 / 21 / 18 / 1 = 58. Those were hand-tallied and every figure was wrong.
> The values above come from a script that counts the verdict cells in the case
> tables of this document. `08_CANONICAL_METRICS.md` is the single source for
> these counts; no other document restates them.

### What passes and matters

Cross-tenant isolation (RLS on all 48 tables), habit-log uniqueness,
server-authoritative XP with client forgery impossible, partial-XP clamping,
subscription self-grant closed, direct `user_subscriptions` write closed,
unauthenticated XP grant closed.

### What fails and matters most

1. **The date cluster** — 7 of 8 cases. Affects habits, tasks, focus, journal, life areas, deep work and willpower simultaneously.
2. **Metric correctness** — 4 cases, all in two pure modules, all unit-testable today.
3. **Willpower concurrency** — 4 cases, needs an atomic RPC.
4. **Telafi is decorative** — completing one changes no metric.
5. **Two integrations are dead** — Google Calendar and Notion habit sync.

### To close this document

Phase 1E Layer 1 converts the 23 predicted failures into executing tests — most
need no device, only `TZ=Europe/Istanbul` and the pure modules. Phase 6A covers
the 15 device-blocked cases. **No case here should be marked passing until it has
actually run.**
