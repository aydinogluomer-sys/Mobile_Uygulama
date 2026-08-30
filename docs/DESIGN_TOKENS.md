# Design tokens — what moved, and what is left to decide

## Where it stood

1572 hex literals across 56 files, against a `lib/tokens.ts` that already
defined the palette. The audit recorded this as "1727 hex → 1728", i.e. a year
of drift with no movement.

## What was done

**1139 literals in 51 files were replaced with the token that already held
that exact colour.** Not a redesign and not a judgement call — 961 were
byte-identical to a token, and another 178 were the short spelling of one
(`#fff` is `#ffffff` is `colors.white`).

The claim that matters is that nothing looks different, so it was checked
rather than asserted. For all 50 changed files the ordered sequence of colour
expressions was extracted from `HEAD` and from the working tree, every
`colors.<name>` resolved back to its hex, and the two sequences compared:

```
files compared        : 50
colour terms compared : 1690
FILES THAT CHANGED A COLOUR: 0
```

Comments are stripped before comparing. An earlier run of the same check
reported one difference, which turned out to be a doc comment that mentioned
`colors.accent` — the checker was counting prose as a rendered colour.

### Two files deliberately untouched

`lib/tokens.ts` and `lib/theme.ts` DEFINE colours. Tokenising inside a palette
is circular, and the first attempt proved it concretely: rewriting
`text: '#ffffff'` to `text: colors.white` in `theme.ts` changed the inferred
literal type and broke `themeStore`'s `Theme | undefined` assignment.

### One type error the change exposed

`app/tabs/settings.tsx` had

```ts
const renderSettingItem = (…, color = colors.accent) => …
```

`colors` is declared `as const`, so the parameter's inferred type was the
single literal `"#D97757"` — every other accent was a type error waiting for
the first call site that passed one. Widened to `string`.

## What is left: 385 literals with no token

These are **not** a backlog of renames. They are colours the design system has
no word for, and inventing one (`grey5`, `purple2`) would be the same hex with
more steps. They need a person to decide whether each is a palette colour, a
one-off, or a mistake.

Grouped by what they look like:

| group | examples | count | the question |
|-------|----------|-------|--------------|
| Tailwind greys | `#6b7280` `#9ca3af` `#e5e7eb` `#d1d5db` | ~60 | Are these the same neutral ramp as `textDim`/`textFaint`, or a second one? |
| Near-blacks | `#2a2a2a` `#1a1a1a` `#111` `#0f0f0f` | ~45 | `lib/theme.ts`'s legacy dark palette, distinct from `colors.bg`/`bgSunk` |
| Accent alphas | `#d9775720` `#c76a6a30` `#87a67830` | ~55 | Already expressible as `hexA(colors.accent, 0.125)` — mechanical, but it changes the EXPRESSION, so it wants review |
| Category hues | `#ec4899` `#8b5cf6` `#f97316` `#14b8a6` | ~90 | Life-area / project colours. Probably a real palette that deserves naming |
| Status hues | `#10b981` `#ef4444` `#f59e0b` `#6366f1` | ~40 | Overlap `success`/`error`/`warning` but are not equal to them |

The largest single group, the category hues, is the one most likely to be a
genuine second palette rather than drift.

## What keeps it from sliding back

`frontend/__tests__/repo/designTokens.test.ts`:

- **no file spells out a hex the token table already names** — the 1139 cannot
  return one edit at a time. Mutation-checked: putting `'#D97757'` back into a
  component turns it red, naming the file and the token it should use.
- **the untokened count does not grow** (ceiling 385) — a new off-palette
  colour introduced by hand fails the build.
- **the ceiling is not stale by a wide margin** — if the real number drops well
  below the cap, the cap has stopped meaning anything and must be lowered in
  the commit that earned it.

The ceiling is deliberately not zero. Zero would force someone to invent the
names in the table above, which is the outcome this document exists to avoid.
