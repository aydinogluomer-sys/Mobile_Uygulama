# 01 — Implementation Backlog

**Status:** `In progress` — seeded with Phase 1D security tasks. Completed at Gate B.
**Rule:** no XL tasks · 1–5 files per task · every task independently reversible.

---

## SEC-1D-001 · Constrain `add_xp` to the calling user

| | |
|---|---|
| Priority | **P0 candidate — see escalation note** |
| MUST/SHOULD | **MUST** |
| Phase | 1D |
| Agent | Supabase & Security |
| Size | S |
| depends_on | Gate B PASS |

### Current signature (verified live)

```
public.add_xp(p_user_id uuid, p_xp_amount integer)
  SECURITY DEFINER · search_path=public
  EXECUTE: PUBLIC, authenticated  →  has_function_privilege('anon') = TRUE
  Body contains no reference to auth.uid()
```

Body effect: `update profiles set total_xp = total_xp + p_xp_amount, current_level_xp=…, level=…, willpower_rank=… where id = p_user_id`

### Exploit scenario

The anon key ships inside the mobile bundle and is public by design. An
**unauthenticated** attacker posts:

```
POST /rest/v1/rpc/add_xp
apikey: <public anon key>
{"p_user_id":"<any user uuid>","p_xp_amount":999999}
```

and rewrites **any** user's `total_xp`, `level` and `willpower_rank`. Both
self-inflation and griefing another account are possible. No authentication, no
ownership check, no amount bound.

### Escalation note — severity is under review

This was first recorded as P1 on the basis of "any authenticated user". The
independent reviewer established it is **`anon`-callable**, which makes it an
*unauthenticated cross-user write*. Whether that re-qualifies it for Emergency
Gate 0 is **a decision for the user**, not something to assume. It does not
touch `tier`, `focus_points`, `user_subscriptions` or `credit_transactions`, so
it is not a payment bypass — which is why P1 was defensible. **No live change
has been made.**

### Proposed fix

In-body ownership guard, not a bare revoke:

```sql
IF auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
  RAISE EXCEPTION 'add_xp: caller may only modify their own profile';
END IF;
```

### Can the `user_id` parameter be removed?

**No — not safely.** `add_xp` is called by five `SECURITY DEFINER` trigger
functions: `fn_habit_log_award`, `trigger_damage_on_habit_log`,
`process_habit_xp`, `trigger_xp_habit_completion`, `trigger_xp_task_completion`.
Inside a trigger, `auth.uid()` is available but the row's owner is the correct
subject, so the parameter must stay for those paths.

**Verified refinement of the reviewer's caution:** all five callers are
`prosecdef = true`, so they execute as the function owner (`postgres`), which
retains EXECUTE. Revoking client EXECUTE would therefore **not** break the
trigger pipeline. A revoke is a viable belt-and-braces addition *on top of* the
guard — but the guard must land first, because the guard alone is sufficient and
a revoke alone would leave trigger paths unguarded against a future caller.

### Migration

`supabase/migrations/<ts>_secure_add_xp.sql` — `CREATE OR REPLACE FUNCTION` with
the guard, plus an internal bypass for trigger context if testing shows one is
needed.

### Test (Layer 2, pgTAP/integration)

1. As `authenticated` user A, call `add_xp(A, 10)` → succeeds.
2. As `authenticated` user A, call `add_xp(B, 10)` → **raises**.
3. As `anon`, call `add_xp(B, 10)` → **raises**.
4. Complete a habit as user A → trigger pipeline still awards XP (regression).

### Rollback

`CREATE OR REPLACE FUNCTION` restoring the previous body (captured verbatim
before the change).

### Acceptance criteria

- `add_xp` cannot modify a profile other than the caller's
- `anon` cannot invoke it to any effect
- habit and task XP triggers still award XP — proven by test 4
- rollback restores prior behaviour exactly

---

## SEC-1D-002 · Constrain `track_weekly_xp` to the calling user

| | |
|---|---|
| Priority | P1 |
| MUST/SHOULD | **MUST** |
| Phase | 1D |
| Agent | Supabase & Security |
| Size | S |
| depends_on | Gate B PASS |

### Current signature (verified live)

```
public.track_weekly_xp(p_user_id uuid, p_xp integer)
  SECURITY DEFINER · search_path NOT pinned
  EXECUTE: PUBLIC, authenticated  →  anon = TRUE
  No auth.uid() reference
```

Body: `INSERT INTO public.weekly_xp (user_id, week_start, xp_earned) VALUES (p_user_id, …)`

### Exploit scenario

Unauthenticated write to the **weekly leaderboard** for an arbitrary
`user_id`. An attacker can place themselves at the top, or push another user's
totals to absurd values to discredit the board. `get_weekly_leaderboard` reads
this table, so the corruption is user-visible.

### Proposed fix

Same ownership guard as SEC-1D-001, **plus pin `SET search_path = public`** —
this function is `SECURITY DEFINER` with an unpinned search_path and references
`weekly_xp` unqualified.

### Can the `user_id` parameter be removed?

**Likely yes**, but confirm caller list first. If every caller is a trigger that
already knows the owning row, replacing the parameter with `auth.uid()` breaks
trigger use. Safer target: keep the parameter, add the guard, and allow a
trigger-context bypass. Decide during implementation with the caller list in hand.

### Migration

`supabase/migrations/<ts>_secure_track_weekly_xp.sql` — `CREATE OR REPLACE`
with guard + `SET search_path = public`.

### Test (Layer 2)

1. User A calls for A → row written.
2. User A calls for B → **raises**.
3. `anon` calls → **raises**.
4. `get_weekly_leaderboard` still returns correct data after a real habit completion.

### Rollback

`CREATE OR REPLACE` restoring the captured prior definition.

### Acceptance criteria

- no cross-user `weekly_xp` write is possible
- `anon` cannot write
- `search_path` pinned
- leaderboard still populates through the normal path

---

## SEC-1D-003 · Constrain and bound `deal_damage_to_active_boss`

| | |
|---|---|
| Priority | P1 |
| MUST/SHOULD | **MUST** |
| Phase | 1D |
| Agent | Supabase & Security |
| Size | M |
| depends_on | Gate B PASS |

### Current signature (verified live)

```
public.deal_damage_to_active_boss(p_user_id uuid, p_damage integer)
  SECURITY DEFINER · search_path NOT pinned
  EXECUTE: PUBLIC, authenticated  →  anon = TRUE
  No auth.uid() reference
```

Body: inserts into `boss_contributors(boss_id, p_user_id, p_damage)`; on kill,
`UPDATE profiles SET coins = coins + reward_coins, total_xp = total_xp + reward_xp`
for contributors.

### Exploit scenario

Worse than the other two because it mutates **global** state. `p_damage` is
unbounded and unvalidated. A single unauthenticated call with a huge value
zeroes `current_hp`, flips `is_active = false`, and pays `reward_coins` /
`reward_xp` to every row in `boss_contributors` — **including rows the attacker
just inserted for arbitrary `user_id`s**. One request can end the global boss
event and mint currency for accounts of the attacker's choosing.

### Proposed fix

Three changes, all required:
1. Ownership guard (as SEC-1D-001).
2. **Bound `p_damage`** — clamp to a per-call maximum derived from game rules, and reject non-positive values.
3. Pin `SET search_path = public`.

### Can the `user_id` parameter be removed?

**No.** Called by the `trigger_damage_on_habit_log` trigger on `habit_logs`,
which must attribute damage to the row's owner. Keep the parameter; guard it.

### Migration

`supabase/migrations/<ts>_secure_deal_damage_to_active_boss.sql`

### Test (Layer 2)

1. User A damages as A → contribution recorded.
2. User A damages as B → **raises**.
3. `anon` → **raises**.
4. `p_damage` above the cap → clamped or rejected; boss HP cannot be zeroed in one call.
5. `p_damage <= 0` → rejected.
6. Habit completion still deals damage through the trigger.

### Rollback

`CREATE OR REPLACE` restoring the captured prior definition.

### Acceptance criteria

- no cross-user contribution can be inserted
- `anon` cannot invoke
- a single call cannot kill the boss
- non-positive damage rejected
- `search_path` pinned
- trigger path unaffected

---

## SEC-1D-004 · Remove blanket write grants on the money tables

| | |
|---|---|
| Priority | P2 (latent) |
| MUST/SHOULD | SHOULD |
| Phase | 1D |
| Agent | Supabase & Security |
| Size | XS |
| depends_on | Gate B PASS |

`anon` and `authenticated` hold `INSERT`, `UPDATE`, `DELETE` **and `TRUNCATE`**
on both `user_subscriptions` and `credit_transactions` (verified).

Today this is neutralised: RLS is enabled and only `SELECT` policies exist, so
I/U/D default-deny. **`TRUNCATE` is not subject to RLS** — but PostgREST exposes
no TRUNCATE verb, so it is not reachable through the API today. Hence *latent*,
not active.

The risk is structural: the protection is incidental (absence of a policy)
rather than intentional (absence of a grant). The moment anyone adds a
permissive or `FOR ALL` write policy, `user_subscriptions` becomes directly
client-writable and the Emergency Gate 0 revoke becomes worthless.

**Fix:** `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_subscriptions, public.credit_transactions FROM anon, authenticated;`

**Acceptance:** client writes to both tables fail at the *grant* layer, not only
the policy layer; `get_or_init_subscription`, `spend_focus_points` and the
webhook path continue to work (they run as `SECURITY DEFINER` / service-role).

---

## OPS-0B-001 · Relocate the foreign `backend/.env.local`

| | |
|---|---|
| Priority | P1 |
| MUST/SHOULD | MUST |
| Phase | 2C — **awaiting user approval** |
| Agent | Supabase & Security |
| Size | XS |

### What it is

`backend/.env.local` holds `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`,
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for **`zdqiujpeewtyhtcqhdcj`
("Mas Technic Site")** — a separate, unrelated project. Untracked, gitignored,
never committed.

### Components that consume it — verified

| Consumer | Reads | Note |
|---|---|---|
| `backend/supabase/functions/notion-auth` | `NOTION_CLIENT_ID/SECRET`, `SUPABASE_SERVICE_ROLE_KEY` | non-canonical tree (doc 07 §2b: legacy/superseded) |
| `backend/supabase/functions/google-auth` | `SUPABASE_SERVICE_ROLE_KEY` | non-canonical tree |

**Nothing in Mobile_Uygulama's deployed path consumes this file.** Supabase
**auto-injects** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into deployed
edge functions — stated at `supabase/functions/subscription-webhook/index.ts:3`.
The file matters only for `supabase functions serve` run locally from
`backend/supabase/`, which targets the foreign project.

`NOTION_CLIENT_ID/SECRET` **are** genuinely needed by the canonical
`supabase/functions/notion-auth`, but as **Supabase function secrets set on
`kbcuolhjjnmhjaarxxmu`**, not from a file in this repo.

### Proposed relocation

1. **Target:** a machine-local secrets directory outside the repository, e.g. `%USERPROFILE%\.secrets\mas-technic\.env.local`. Outside any git work tree.
2. **Backup first:** copy to that target and verify byte-identical before removing the original.
3. **Remove** `backend/.env.local` and `backend/supabase/functions/.env.local` from the repo tree.
4. **Verify** Mobile_Uygulama is unaffected — no canonical function reads it (table above).
5. Hand the relocated file to whoever owns Mas Technic.

### Explicitly out of scope

**No rotation.** This engagement does not rotate, invalidate or otherwise touch
that key, and performs no operation on Mas Technic. Rotation is that project
owner's decision, made outside this work.

### Acceptance criteria

- no `.env*` containing foreign-project credentials remains under `Mobile_Uygulama/`
- canonical Notion OAuth continues to work via Supabase function secrets on `kbcuolhjjnmhjaarxxmu`
- backup verified before deletion
- **user approved the move beforehand**

---

## Deferred to Phase 1A — do not act on now

The live database has **20 migrations**; the repository has **3**. Nineteen live
migrations have no repo counterpart.

**These are deliberately NOT reconstructed by guesswork.** Writing 19 speculative
migration files would create a schema that merely looks authoritative while
diverging from reality. Handling:

- **Gate A** — documented as schema drift (doc 07 §8)
- **Gate B** — reconciliation decision recorded (squashed baseline vs. incremental)
- **Phase 1A** — applied only after the three-way diff (migrations / live / code expectations)
