# Performance — what was measured, fixed, and what is still unmeasured

## 1. Asking who is signed in cost a network round trip

`supabase.auth.getUser()` issues `GET /auth/v1/user` on **every** call — it is
a request, not a property read. Fourteen places used it as a guard and nothing
else:

- eleven in screens and components, three of them in `weekly-review.tsx` alone;
- `repositories/shared.currentUserId`, which runs before **every** repository
  operation, so a screen reading three collections paid for three;
- `store/logStore.hydrateSyncQueue`, which runs on boot and on every
  foreground.

Measured against the live project:

| | auth requests | auth time | total |
|---|---|---|---|
| `getUser()` before each of 3 operations | 3 | 373 ms | 1779 ms |
| `getSession()`, resolved once | 0 | 0 ms | 293 ms |

All fourteen now go through `lib/session.currentUser()`, which reads the
persisted session locally and refreshes only near expiry.

**This is not a weakening of authorization.** None of those call sites was an
authorization decision — each guards a render path and is followed by a query
subject to RLS. The boundary is still `auth.uid()` evaluated from the JWT the
server verifies.

Held by `__tests__/lib/sessionLocalRead.test.ts`: behaviour tests for the
helper, plus a source gate so no screen, component, store, repository or
service can call `getUser()` again — which matters because the code that
regresses it looks entirely ordinary.

## 2. Query waterfalls

`stats.tsx` opened with four reads on four separate `await` lines. None
consumed another's output; they were sequential only because each `await` was
written on its own line. The tab waited for four round trips where one would
do.

That one screen was fixed earlier and pinned by
`statsNoQueryWaterfall.test.ts`. The general question — *is this shape
anywhere else?* — had not been asked. It has now:

```
sequential-read runs of 2+ across app/, components/, store/, services/ : 0
```

Zero is a real result rather than a broken scanner: planting three independent
reads in a row makes it report exactly that run, and the assertion is now a
permanent gate (`__tests__/repo/noQueryWaterfall.test.ts`), mutation-checked in
a real screen.

Writing that gate found a flaw in its own first version. It flagged

```ts
const ids  = await fetchHabitIds();
const rows = await fetchLogsFor(ids);
```

as a waterfall. It is not — the second call consumes the first's result, so
the wait is a dependency. The scanner now tracks what each await binds and
breaks the run when a later call references it. A detector that cries wolf
gets switched off, and one that silently matches nothing is worse than none;
both failure modes have their own test.

## 3. Collection reads are bounded

Covered in full by `docs/QUERY_BOUNDING_MATRIX.md`: 64 queries, 32 collection
SELECTs, every one classified, `UNCLASSIFIED: 0`. The gate is per-query rather
than per-file, because a file-level check passed while a second, unbounded
query sat in an already-"bounded" file.

## 4. Bundle weight

`assets/images/` shipped 1056 KB, of which six files — four React logos, an
unused `app-image.png`, and the Expo template splash — were referenced by
nothing. Now 18 KB. See `docs/BRANDING.md`.

## Re-measured at the transport, not at the call site

The numbers above come from timing three operations. The stronger question is
how many requests the app makes AT ALL, and that was measured by counting them
where they actually leave — `global.fetch` — split by service, running the
app's own repositories and services against the live project with a real JWT:

| what | auth requests | rest | rpc |
|---|---|---|---|
| `currentUser()` x10 | **0** | 0 | 0 |
| `getSession()` x40 | **0** | 0 | 0 |
| a six-collection screen load | **0** | 6 | 0 |

Six collections, six reads, no hidden extras and no auth round trip. Before
`lib/session`, that same load cost six `GET /auth/v1/user` calls on top.

The same six in series against the same six batched:

```
serial    983 ms   6 rest requests
parallel  232 ms   6 rest requests
saved     751 ms   at an identical request count
```

Which is the point the waterfall gate exists to protect: writing them on
separate `await` lines costs LATENCY, not requests, so a request-count metric
alone would have shown nothing. The two checks answer different questions and
neither replaces the other.

## What is NOT measured, and why

**Screen-level render profiling on a device.** Re-render counts, frame drops
on the timeline and calendar scrolls, the cost of the seasonal-motion
animations, time-to-interactive per tab.

This needs the app running on a device or simulator with the profiler
attached. It cannot be inferred from source, and a number produced any other
way would be a guess wearing a decimal point. Checked rather than assumed:
neither `adb` nor `emulator` is on this machine and there is no Android SDK,
so it is not a matter of choosing not to.

§36 is therefore **DEFERRED_WITH_JUSTIFICATION** rather than left as "not
done": every cause a source or transport measurement can reach is measured and
zero, and what remains is a **store-release QA gate** — it belongs on a device
before shipping, not on a branch before merging.

What the audit *can* say is which of them are unlikely to be the problem: the
per-operation auth round trip is gone, no screen serialises independent reads,
and no collection read is unbounded. Those were the three measurable causes of
a slow screen that source analysis can find.
