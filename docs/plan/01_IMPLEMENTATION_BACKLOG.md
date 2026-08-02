# 01 — Implementation Backlog

**Status:** `In progress` — seeded with Phase 1D security tasks. Completed at Gate B.
**Rule:** no XL tasks · 1–5 files per task · every task independently reversible.

---

## Emergency Gate 0 status of SEC-1D-001..003

Client `EXECUTE` on all three functions was revoked in migration
**`20260802205850_emergency_gate_0_revoke_client_exec_xp_functions`** after an
independent pre-change review returned PASS WITH FINDINGS.

Post-change ACL for all three: `{postgres=X/postgres,service_role=X/postgres}` —
`anon` and `authenticated` both `false`. **Function bodies were not touched.**

**What that closed:** unauthenticated and cross-user invocation.
**What it did NOT close:** self-inflation. Tracked as SEC-1D-005 below.

The tasks below therefore remain open: the revoke is a containment measure, not
the fix.

---

## SEC-1D-005 · Prevent clients writing server-managed `profiles` columns

| | |
|---|---|
| Priority | **P1** |
| Class | **Self-inflation / domain integrity — NOT cross-user write** |
| Phase | **1** |
| Agent | Supabase & Security |

### Correction to an earlier, technically wrong statement

An earlier draft of this task claimed the policy was unsafe *because*
`with_check` is NULL. **That is incorrect PostgreSQL semantics and is withdrawn.**

For an `UPDATE` policy, when `WITH CHECK` is omitted, **the `USING` expression is
applied to the new row as well**. So `USING (id = auth.uid())` already prevents a
user from re-assigning their row to another `id`. There is no missing row-level
constraint.

### The actual finding

```
policy "Users can update own profile"  UPDATE  USING (id = (SELECT auth.uid()))
```

1. The policy correctly limits the user to **their own row**.
2. **It does not limit which columns of that row may change** — RLS operates on rows, not columns.
3. `authenticated` holds a table-level `UPDATE` grant **and** column-level `UPDATE` on *every* column of `profiles`, including the server-managed ones.

Therefore an authenticated user can `PATCH /rest/v1/profiles?id=eq.<self>` and
set `total_xp`, `current_level_xp`, `level`, `coins`, `willpower_rank`,
`skill_points`, `makeup_credits` and `streak_record` to any value.

**This is not a cross-user write.** A user can only affect their own row. It is a
**self-inflation / domain-integrity** defect: XP, level, rank, coins and the
leaderboard become client-authored. **P1, carried into Phase 1.**

### Column classification (17 columns, live)

| Class | Columns | Client `UPDATE` grant today |
|---|---|---|
| **User-editable** | `username`, `push_token`, `ai_persona` | should keep |
| **Server-managed** | `total_xp`, `current_level_xp`, `coins`, `skill_points`, `makeup_credits`, `last_credit_reset`, `streak_record` | **must remove** |
| **Derived** (computed by `add_xp` / `get_rank_for_level` from `total_xp`) | `level`, `next_level_xp`, `willpower_rank` | **must remove** |
| **Identity / immutable** | `id`, `created_at`, `email` | **must remove** (`id`/`created_at`); `email` needs a decision |
| **Unknown — classify before acting** | `last_ai_context` | written by AI features? confirm owner |

### Frontend write surface — the whole of it

`store/profileStore.ts` is the only file that writes `profiles`:

- `:46` `.insert({ id: user.id, email: user.email })` — bootstrap
- `:73` `.update({ username: trimmed || null })` — the only mutation

**The app writes exactly three columns: `id`, `email`, `username`.** Every other
grant is unused by the product and exists only as attack surface. That makes the
fix low-risk: removing the other column grants cannot break any current feature.

### Sub-tasks — each 1–5 files, independently reversible

**SEC-1D-005a · Grant and policy design** *(no code)*
Decide per column: keep client `UPDATE`, revoke it, or route through an RPC.
Resolve `email` (auth-owned — should it be client-writable at all?) and
`last_ai_context`. Decide whether `INSERT` stays client-side or moves into the
existing `handle_new_user` trigger. Output: a written decision table.
*Acceptance:* every one of the 17 columns has a recorded decision and rationale.

**SEC-1D-005b · Column-level grant migration** *(1 migration)*
`REVOKE UPDATE (…server-managed + derived + identity…) ON public.profiles FROM anon, authenticated;`
Keep `UPDATE (username, push_token, ai_persona)`. Also revoke the unused
`anon` table grants (`UPDATE`/`INSERT`/`DELETE`/`TRUNCATE`) — `anon` has no
`SELECT` and no policy, so nothing legitimate uses them.
*Acceptance:* `has_column_privilege('authenticated','profiles','total_xp','UPDATE')` = false; `…,'username','UPDATE')` = true.

**SEC-1D-005c · Safe profile-update path** *(1–2 files)*
Only if 005a concludes the client needs to write more than the remaining
columns: a `SECURITY DEFINER` RPC accepting only user-editable fields and
deriving the user from `auth.uid()`. Otherwise mark **not required** and close.
*Acceptance:* no client write path reaches a server-managed column.

**SEC-1D-005d · Frontend adaptation** *(1 file — `store/profileStore.ts`)*
Expected to be **near-zero work**: the app already writes only `username` on
update. Confirm the `:46` insert still succeeds under the new grants (it writes
`id` and `email`, both of which 005a may restrict) and adapt if needed.
*Acceptance:* `tsc` clean; profile rename works; first-login bootstrap works.

**SEC-1D-005e · RLS and integration tests** *(Layer 2)*
1. authenticated PATCH own `username` → succeeds
2. authenticated PATCH own `total_xp` → **rejected**
3. authenticated PATCH own `coins`/`level`/`willpower_rank` → **rejected**
4. authenticated PATCH *another* user's row → rejected (already true; regression guard)
5. habit completion → trigger still awards XP and level still advances
6. `anon` → no access at all
*Acceptance:* all six pass against a real local Postgres, not a client mock.

**SEC-1D-005f · Rollback**
`GRANT UPDATE (<exact prior column list>) ON public.profiles TO anon, authenticated;`
Capture the pre-change column grants verbatim in the migration header before
applying, exactly as was done for the two Emergency Gate 0 migrations.
*Acceptance:* rollback restores the captured grant set byte-for-byte.

### Why this is Phase 1, not Emergency Gate 0

It is not a cross-user or unauthenticated write. A user can only inflate their
own numbers, and no payment, credit or subscription value is reachable. It fails
the "actively exploitable against other users or against payment" bar, so it goes
through the normal gate.

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

**No — not safely.** Inside a trigger the row's owner is the correct subject, so
the parameter must stay for those paths.

**Caller inventory — corrected by independent pre-change review.** An earlier
draft of this task claimed "five `SECURITY DEFINER` trigger functions". That was
stale: five functions *reference* `add_xp`, but **only two are attached to a
trigger**.

| Caller | `SECURITY DEFINER` | Owner | Attached to a trigger? |
|---|---|---|---|
| `fn_habit_log_award` | yes | postgres | **yes** — `habit_logs.trg_habit_log_award` |
| `trigger_damage_on_habit_log` | yes | postgres | **yes** — `habit_logs.on_habit_completed_damage_boss` |
| `process_habit_xp` | yes | postgres | **no — orphaned** |
| `trigger_xp_habit_completion` | yes | postgres | **no — orphaned** |
| `trigger_xp_task_completion` | yes | postgres | **no — orphaned** |

**Task-completion XP is not a database pipeline at all** — there is no trigger on
any tasks table. Anyone reading the schema would reasonably assume otherwise. A
later phase must not "repair" a pipeline that was never wired.

Because both live callers are `SECURITY DEFINER` owned by `postgres`, the client
EXECUTE revoke applied in migration `20260802205850` did **not** break them.

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

### Additional case found by independent review — negative damage

`p_damage` is not only unbounded upward. A **negative** value evaluates
`v_new_hp := current_hp - (-N)`, which **heals the boss**, and writes a negative
`total_damage` into `boss_contributors`, corrupting the contribution
leaderboard. The positivity check is therefore not optional polish — it is a
second distinct defect. The real signature is
`deal_damage_to_active_boss(p_user_id uuid, p_damage integer DEFAULT 10)`; the
`DEFAULT` is not part of the identity argument list.

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
