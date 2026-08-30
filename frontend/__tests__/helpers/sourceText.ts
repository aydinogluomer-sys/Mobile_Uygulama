/**
 * Shared source-text helpers for the `__tests__/repo/**` gates.
 *
 * ## Why this file exists
 *
 * The repo gates assert that production code REACHES a subsystem — that
 * `hydrateSyncQueue()` is really awaited at boot, that `stats.tsx` really has
 * no query waterfall, and so on. They do that by reading the source and
 * matching against it, which only works if comments are removed first: every
 * one of those files discusses the very call being searched for, at length,
 * in its own comments.
 *
 * Four copies of `stripComments` had been written independently, and two of
 * them shared a defect that silently disabled stripping on Windows:
 *
 *     src.split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
 *
 * In JavaScript `.` matches every character EXCEPT a line terminator, and
 * `\r` is a line terminator. On a CRLF checkout `split('\n')` leaves a
 * trailing `\r` on each line, so `.*` halts before it while `$` — with no `m`
 * flag — only matches end-of-string. The pattern therefore never matched and
 * not a single line comment was removed. The gates went on "passing" while
 * matching text inside comments, and one of them failed outright because the
 * comment mention sorted before the real call.
 *
 * That divergence is the reason this lives in one place now. Four copies of a
 * subtle parser is precisely how such a defect survives: fixing the copy that
 * happened to fail leaves the ones that happened to pass still broken.
 */

/**
 * Removes block comments and line comments from TypeScript/TSX source.
 *
 * Line endings are normalised to `\n` first — see the note above; without it
 * this function is a no-op on CRLF input. The `[^:]` guard before `//` keeps
 * a URL (`https://…`) from being read as the start of a comment.
 */
export function stripComments(src: string): string {
  return src
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/**
 * `indexOf` that throws instead of returning -1.
 *
 * `-1` is less than every real index, so
 * `expect(a.indexOf(x)).toBeGreaterThan(a.indexOf(y))` PASSES when `y` was
 * deleted outright. A mutation run caught exactly that: removing a hydration
 * call left two ordering assertions green. Ordering checks go through this so
 * absence fails first, loudly.
 */
export function at(haystack: string, needle: string): number {
  const i = haystack.indexOf(needle);
  if (i < 0) throw new Error(`expected to find ${JSON.stringify(needle)}, but it is absent`);
  return i;
}
