# Edge function error contract — full client-side audit

Every place the app calls a Supabase edge function, and what each does when
the call goes wrong. Produced for §29 / §8.G, which was previously recorded as
"notion-sync and both disconnects fixed; not every client-called edge function
has been audited".

There are **19 call sites** across **8 files**, in two styles:

- `supabase.functions.invoke(name, { body })` — 6 sites
- a raw `fetch(SUPABASE_FUNCTIONS_URL/...)` — 13 sites, all OAuth flows

## The five failure modes checked

| # | Mode | What it looks like on the wire |
|---|------|--------------------------------|
| 1 | Transport failure | `fetch` rejects: DNS, refused connection, aeroplane mode |
| 2 | Non-2xx | 401/403/404/500/503 with a body that may not be JSON |
| 3 | Application failure in a 200 | `{ success: false }` or `{ error: "..." }` with status 200 |
| 4 | Malformed body | `res.json()` throws — an HTML error page from the gateway |
| 5 | No answer at all | The connection is accepted and nothing comes back |

Mode 5 is the one that hides. The other four end in a rejected promise or a
value the caller can inspect; a hung request ends in neither.

## Findings

### Sound before this audit

Every site surfaces its failure into store state rather than swallowing it —
`set({ status: 'error', error: msg })` or an equivalent — so a failed call
reaches the user as a message rather than as a silent no-op. Two go further
and separate cases that matter:

- `googleCalendarStore` treats **404 as "the function is not deployed"** and
  sets `available: false`, rather than reporting "not connected". That
  distinction is real: the function was in fact undeployed for months.
- The same store treats **503 / `{ configured: false }` as "not configured"**,
  which is an operator problem, not a user one, and says so.

Two deliberate silences, both documented at their site:

- `notionStore:55` — a failed URL *prefetch* is ignored because `connect()`
  generates the URL again. Ignoring it costs nothing and reporting it would
  raise an error for a request the user never made.
- `spotifyStore:157` — a best-effort refresh.

### The uniform gap: no deadline anywhere

**0 of 19** call sites had a timeout.

A `fetch` with no signal never rejects on its own when the server accepts the
connection and then says nothing. In that state the `catch` that would set
`status: 'error'` never runs, the spinner turns forever, and the user cannot
tell it apart from "slow" — so they wait, then force-quit.

This is not a hypothetical shape for this project. Edge functions cold-start,
`generate-routine` blocks on an upstream Anthropic call, and OAuth flows run on
whatever network the phone happens to be on, including captive portals that
accept a connection and answer nothing.

Fixed by `lib/edgeCall.ts` (`withEdgeDeadline`), applied to all 19. The
deadline both **aborts** the signal — so the request actually ends and the
socket is released — and **races** it, so the caller is freed even if the
callee ignores the signal. Aborting alone would have been a guarantee that
depends on the callee's good behaviour, which is not a guarantee; that gap was
found by a test and closed before this shipped.

`EDGE_TIMEOUT_MS` is 20s: past the slowest healthy AI generation, far short of
where a user has given up.

## The table

`ok?` = non-2xx distinguished · `body?` = `{ error }` / `{ success:false }`
inspected · `json?` = a throwing `res.json()` is caught · `deadline` = has a
timeout · `surfaced` = the failure reaches the user

| file | line | style | target | ok? | body? | json? | deadline | surfaced |
|------|------|-------|--------|-----|-------|-------|----------|----------|
| `app/screens/ai-coach.tsx` | 154 | invoke | generate-routine | ✅ | ✅ | n/a | ✅ | ✅ |
| `app/screens/ai-coach.tsx` | 218 | invoke | generate-routine (summarize) | ✅ | ✅ | n/a | ✅ | ✅ |
| `app/screens/insights.tsx` | 207 | invoke | generate-routine (coach) | ✅ | ✅ | n/a | ✅ | ✅ |
| `app/screens/journal-insights.tsx` | 71 | invoke | generate-routine (insights) | ✅ | ✅ | n/a | ✅ | ✅ |
| `store/routineStore.ts` | 178 | invoke | generate-routine (routine) | ✅ | ✅ | n/a | ✅ | ✅ |
| `store/notionStore.ts` | 216 | invoke | notion-sync | ✅ | ✅ | n/a | ✅ | ✅ |
| `store/googleCalendarStore.ts` | 47 | fetch | google-auth?status | ✅ 404 | ✅ | ✅ | ✅ | ⚪ by design |
| `store/googleCalendarStore.ts` | 87 | fetch | google-auth?url | ✅ 404/503 | ✅ | ✅ | ✅ | ✅ |
| `store/googleCalendarStore.ts` | 124 | fetch | google-auth?callback | ✅ | ✅ | ✅ | ✅ | ✅ |
| `store/googleCalendarStore.ts` | 161 | fetch | google-auth?disconnect | ✅ | ✅ | ✅ | ✅ | ✅ |
| `store/notionStore.ts` | 44 | fetch | notion-auth?url (prefetch) | ✅ | ✅ | ✅ | ✅ | ⚪ by design |
| `store/notionStore.ts` | 69 | fetch | notion-auth?status | ✅ | ✅ | ✅ | ✅ | ✅ |
| `store/notionStore.ts` | 110 | fetch | notion-auth?url | ✅ | ✅ | ✅ | ✅ | ✅ |
| `store/notionStore.ts` | 141 | fetch | notion-auth?callback | ✅ | ✅ | ✅ | ✅ | ✅ |
| `store/notionStore.ts` | 187 | fetch | notion-auth?disconnect | ✅ | ✅ | ✅ | ✅ | ✅ |
| `store/notionSessionStore.ts` | 85 | fetch | notion-auth?url | ✅ | ✅ | ✅ | ✅ | ✅ |
| `store/notionSessionStore.ts` | 111 | fetch | notion-auth?callback | ✅ | ✅ | ✅ | ✅ | ✅ |
| `store/spotifyStore.ts` | 45 | fetch | spotify-auth (shared caller) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `store/spotifyStore.ts` | 91 | fetch | spotify-auth (now-playing) | ⚪ | ✅ | ✅ | ✅ | ⚪ by design |

⚪ = deliberate, documented at the call site. A now-playing poll that fails
should not paint the Focus screen red every eight seconds.

## What keeps this true

`frontend/__tests__/repo/edgeCallDeadline.test.ts`:

- behaviour tests for the helper — value passthrough, abort on deadline,
  release even when the signal is ignored, and a real transport error passed
  through rather than relabelled as a timeout;
- a source gate requiring every edge call site to go through
  `withEdgeDeadline`, and requiring `lib/edgeCall.ts` to be the only place
  that constructs an `AbortController` (except `services/webhookService.ts`,
  which POSTs to a user-supplied URL with its own shorter deadline).

The gate is mutation-checked in both call shapes. Its first version scanned
line by line and missed the calls that put the URL on the line after `fetch(`
— removing a deadline there stayed green. It now scans the file, and both a
single-line and a multi-line site go red when their deadline is removed.
