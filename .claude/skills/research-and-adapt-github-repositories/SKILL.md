# Research And Adapt Github Repositories

**Purpose:** Select open-source work by fit and licence, adopting patterns over dependencies where possible.

**Status:** `Created` - not yet validated on a task

## When to use
Considering a new dependency, or looking for a proven pattern.

## Inputs
The defect to solve - current stack versions.

## Outputs
Shortlist, licence matrix, pattern adoption guide.

## Steps
1. **Start from a defect the audit actually found.** No speculative additions.
2. Verify framework compatibility against the project's ACTUAL versions, including any pending upgrade.
3. Ask whether the PATTERN alone fixes it. If yes, prefer the pattern - zero dependency, zero licence obligation.
4. Classify the licence: cleared-permissive, cleared-with-attribution, reference-only, blocked, unresolved. **Unresolved defaults to blocked** - an unlicensed repository is not public domain.
5. Shallow-clone into a gitignored research directory, never into the production tree.
6. Record whether the licence was read at a pinned commit or recalled from memory. Only the former satisfies an adoption gate.
7. Note transitive licence exposure separately - a permissive direct dependency says nothing about its tree.

## Prohibitions
- **Never rank by stars.**
- Never copy GPL/AGPL/unclear-licence code into a commercial product.
- Never commit research clones.
- Never adopt a framework to fix a one-line omission.
- Never claim a licence is cleared without reading it at the adoption version.

## Quality criteria
Every entry names the defect it addresses. Every rejection has a stated reason.

## Definition of done
Bounded shortlist; every entry classified; adoption gate criteria stated; rejections recorded.

---

## Related
See `docs/skills/00_SKILL_MANIFEST.md` for status and ownership.
