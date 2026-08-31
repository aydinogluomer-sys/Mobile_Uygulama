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

## The second pass: 385 -> 181, and a taxonomy instead of a ceiling

The paragraph that used to sit here said the remaining 385 were "colours the
design system has no word for" and that naming them would be "the same hex
with more steps". That is a good argument for some of them and an excuse for
the rest, and the two were never separated. So they were enumerated one at a
time — file, line, hex — and split by what the colour is FOR:

**181 were semantic UI chrome, and are now tokens:**

| group | examples | count | now |
|-------|----------|-------|-----|
| Tailwind greys | `#6b7280` `#9ca3af` `#e5e7eb` | 32 | `colors.neutral200`…`neutral600` |
| Cool near-blacks | `#2a2a2a` `#1a1a1a` `#111` `#0f0f0f` | 36 | `colors.coolBlack600`…`coolBlack950` |
| Alphas of existing tokens | `#d9775720` `#c76a6a30` `#87a67830` | 90 | `alphaHex(colors.accent, '20')` |
| Journal "paper" surfaces | `#211C18` `#3A3026` `#A88E6A` `#E3DDD0` | 13 | `colors.paperSurface` / `paperBorder` / `paperLabel` / `paperText` |
| Selected-state tints | `#1a1f2e` `#1f1515` `#1f3d33` | 8 | `colors.selectedTint*` |
| One-offs | `#0a0a0a` `#e0a458` | 2 | `colors.coolBlack950`, `colors.amberSoft` |

The names are not inventions, which was the whole objection: `#9ca3af` **is**
Tailwind `gray-400`, and the paper and selection tints are named for the role
they were already playing at every call site.

**181 are not UI chrome, and are exempt — but now by category, not by tally:**

| category | what it is | count |
|---|---|---|
| `category-hue` | one colour per life area / triage level / mood / project chip | 79 |
| `category-tint` | the same hues at an alpha, for chip backgrounds | 29 |
| `illustration` | `components/seasonalMotion/particles.ts` | 30 |
| `theme-palette` | `lib/focusThemes.ts` — one bg/card/accent triple per theme | 24 |
| `third-party-brand` | Spotify `#1db954`, Notion `#f97316`, Google `#4285f4` | 13 |
| `heatmap-scale` | `app/tabs/stats.tsx`'s intensity ramp | 6 |

A categorical palette picks things APART. Naming `#ec4899` `success` or
`warning` would be worse than leaving it alone, and that is why these are not
a backlog.

### Nothing was restyled

Same check as the first pass, on the 30 files this one changed: every
`colors.*` resolved back to its hex, `alphaHex(colors.accent, '20')` back to
`#d9775720`, and the ordered colour sequence compared against `HEAD`.

```
files compared        : 30
colour terms compared : 1325
FILES THAT CHANGED A COLOUR: 0
```

`alphaHex` exists rather than reusing `hexA` for exactly this reason: `hexA`
emits `rgba(217, 119, 87, 0.125)`, a different string and a slightly different
value from `#D9775720`. Swapping ninety literals for it would have been a
silent restyle wearing a refactor's clothes.

### What is still a design decision

Whether the legacy neutral ramp should collapse into `textDim` / `textFaint` /
`bg` / `bgSunk`. That one changes pixels and belongs to a designer. Naming the
colours does not answer it — it makes it possible to ask, with a grep instead
of an archaeology session.

## What keeps it from sliding back

`frontend/__tests__/repo/designTokens.test.ts`:

- **no file spells out a hex the token table already names** — the 1139 + 181
  cannot return one edit at a time. Mutation-checked: putting `'#9ca3af'` back
  into a screen turns it red, naming the file and the token it should use.
- **no semantic UI colour is left as a bare literal** — the category that is
  not allowed to have members. This is the assertion that replaced "the count
  does not grow" as the real gate: a new grey, surface or border written as a
  hex fails the build and is named in the failure.
- **the remaining literals are exactly the exempt kinds** — the six counts
  above are asserted exactly, so a category's population cannot drift without
  somebody writing down why.
- **the untokened count does not grow** (ceiling 181, down from 385), and
  **the ceiling is not stale by a wide margin** — if the real number drops, the
  cap must be lowered in the commit that earned it.

The mutation check plants both failures at once — a re-hardcoded token and a
brand-new unexplained colour — and four of the eight assertions go red.
