# Verify Date Time And Streak Logic

**Purpose:** Find and prevent UTC/local date defects - the highest-blast-radius bug class in habit apps.

**Status:** `Created` - not yet validated on a task

## When to use
Any work touching dates, streaks, weekly buckets or day attribution.

## Inputs
Every module deriving a date - the target timezone.

## Steps
1. Grep for every date-derivation pattern: `toISOString`, `.slice(0,10)`, `.split('T')[0]`, `format(`, `getDay`, `setHours`, `startOfWeek`.
2. **Count distinct patterns. More than one means they will eventually disagree.**
3. For each, decide whether it produces a LOCAL or a UTC date.
4. **Find comparisons between the two.** A local day key matched against a UTC day key silently drops days.
5. Find duplicated helpers - two byte-identical date helpers are a divergence waiting to happen.
6. Check cached "today" values for midnight rollover.
7. Verify pure functions accept an injectable `now`. A hardcoded clock call is untestable.

## Prohibitions
- **Never use an ISO/UTC serialisation to derive a local calendar date.** East of UTC it returns the wrong day for the first hours after midnight.
- Never fix one call site - introduce one canonical module and route everything through it.
- Never test only at midday. Test just after midnight and just before it.

## Quality criteria
One canonical module. Every test pins the timezone. Every boundary hour covered.

## Validation
`TZ=<target> npx jest date` - a grep for banned patterns returns zero hits outside the canonical module.

## Definition of done
Single date module; zero UTC/local comparisons; boundary tests pass; no cached date survives midnight.

---

## Related
See `docs/skills/00_SKILL_MANIFEST.md` for status and ownership.
