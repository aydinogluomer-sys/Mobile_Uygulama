# Design Mobile Product System

**Purpose:** Evaluate and extend a mobile design system without trading usability for visual ambition.

**Status:** `Created` - not yet validated on a task

## When to use
Assessing design quality, or planning token and component consolidation.

## When NOT to use
Not to justify a redesign. First establish whether a system already exists and is simply unapplied.

## Inputs
Token module - component library - screen list.

## Outputs
Design quality audit with per-screen scores, and phased recommendations.

## Steps
1. Count raw colour literals across the UI tree - the best single proxy for system adoption.
2. Count files importing the token module versus the component library. A large gap means primitives are not being consumed.
3. Count `accessibilityLabel`, `accessibilityRole`, `accessibilityState`.
4. Find interactive elements below 44pt without `hitSlop`.
5. **Find the best screen and name it.** If one screen already meets the bar, the task is propagation, not invention.
6. Score axes separately. Mark `n/r` for anything requiring rendered evidence you do not have.

## Prohibitions
- Never score motion or performance from source. Mark `n/r`.
- Never recommend a new UI kit when one exists and is under-adopted.
- Never recommend animation that raises interaction cost for an attention-sensitive product.
- Never claim a rendered verdict without a screenshot.

## Quality criteria
Every score has code-level evidence. Every recommendation names its phase and size.

## Definition of done
Per-screen scores with evidence; strengths listed as explicitly as weaknesses; a measurable definition of done for the design phase.

---

## Related
See `docs/skills/00_SKILL_MANIFEST.md` for status and ownership.
