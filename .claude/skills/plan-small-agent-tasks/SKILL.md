# Plan Small Agent Tasks

**Purpose:** Decompose work into small, reversible, independently verifiable tasks.

**Status:** `Created` - not yet validated on a task

## When to use
Converting audit findings into an executable backlog.

## Outputs
A backlog where every task is 1-5 files with its own acceptance criteria.

## Steps
1. One task = one outcome. If the title needs the word "and", split it.
2. Scope to 1-5 files. More means the diff cannot be reviewed properly.
3. **No XL tasks.** Split until every task is XS to L.
4. Give each task: id, priority, MUST/SHOULD/COULD, agent, depends_on, scope, goal, acceptance criteria, validation commands, risk, rollback, size.
5. Acceptance criteria must be observable - "duplicate rows are impossible", not "improve idempotency".
6. Assign file ownership so no two agents own the same file.
7. **Never merge several security fixes into one task.** Each needs independent review and its own rollback.
8. Separate hardening from feature work. Provisioning a missing feature is not hardening.

## Prohibitions
- Never write "refactor X" as a task.
- Never leave acceptance criteria unfalsifiable.
- Never let one task own both a migration and a large frontend change.
- Never let an agent give final approval on its own diff.

## Quality criteria
Every task independently revertible. Every dependency explicit.

## Definition of done
No XL tasks; every task has criteria, validation and rollback; the ownership map has no overlaps.

---

## Related
See `docs/skills/00_SKILL_MANIFEST.md` for status and ownership.
