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
import { readFileSync } from 'fs';
import { join } from 'path';

const FRONTEND_ROOT = join(__dirname, '..', '..');

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

/** Reads a file relative to `frontend/` root and normalizes CRLF -> LF. */
export function readSource(...segments: string[]): string {
  return readFileSync(join(FRONTEND_ROOT, ...segments), 'utf8').replace(/\r\n?/g, '\n');
}

/** Drops SQL `--` line comments and block comments while preserving single-quoted string literals. */
export function stripSqlComments(sql: string): string {
  const src = sql.replace(/\r\n?/g, '\n');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "'") {
      let end = i + 1;
      while (end < src.length) {
        if (src[end] === "'" && src[end + 1] === "'") {
          end += 2;
          continue;
        }
        if (src[end] === "'") {
          end += 1;
          break;
        }
        end += 1;
      }
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '-' && next === '-') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i = i < src.length ? i + 2 : src.length;
      out += ' ';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Comment-stripped, whitespace-collapsed, UPPERCASE SQL text (string literals blanked so comments/strings never fake keywords). */
export function sqlKeywordsOf(sql: string): string {
  const uncommented = stripSqlComments(sql);
  let withoutStrings = '';
  let i = 0;
  while (i < uncommented.length) {
    if (uncommented[i] === "'") {
      i += 1;
      while (i < uncommented.length) {
        if (uncommented[i] === "'" && uncommented[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (uncommented[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      withoutStrings += " '' ";
      continue;
    }
    withoutStrings += uncommented[i];
    i += 1;
  }
  return withoutStrings.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Extracts first-level `jsonb_build_object(...)` keys; nested `jsonb_build_object` calls do NOT leak into the outer key list. */
export function extractJsonbObjectKeys(sql: string, fnName?: string): string[] {
  const clean = stripSqlComments(sql);
  let target = clean;

  if (fnName) {
    const escaped = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fnRe = new RegExp(
      `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:[A-Za-z_][A-Za-z0-9_]*\\.)?${escaped}\\s*\\(`,
      'i',
    );
    const fnMatch = fnRe.exec(clean);
    if (!fnMatch) return [];
    const fromFn = clean.slice(fnMatch.index);
    const tagMatch = /\bAS\s+(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)/i.exec(fromFn);
    if (tagMatch) {
      const tag = tagMatch[1];
      const bodyStart = tagMatch.index + tagMatch[0].length;
      const closeIdx = fromFn.indexOf(tag, bodyStart);
      target = closeIdx >= 0 ? fromFn.slice(bodyStart, closeIdx) : fromFn.slice(bodyStart);
    } else {
      target = fromFn;
    }
  }

  const returnCall = /\bRETURN\s+jsonb_build_object\s*\(/i.exec(target);
  const anyCall = /\bjsonb_build_object\s*\(/i.exec(target);
  const callMatch = returnCall ?? anyCall;
  if (!callMatch) return [];

  const openParenIdx = target.indexOf('(', callMatch.index + callMatch[0].length - 1);
  if (openParenIdx < 0) return [];

  let depth = 0;
  let closeParenIdx = -1;
  for (let i = openParenIdx; i < target.length; i += 1) {
    const ch = target[i];
    if (ch === "'") {
      i += 1;
      while (i < target.length) {
        if (target[i] === "'" && target[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (target[i] === "'") break;
        i += 1;
      }
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        closeParenIdx = i;
        break;
      }
    }
  }
  if (closeParenIdx < 0) return [];

  const inner = target.slice(openParenIdx + 1, closeParenIdx);
  const args: string[] = [];
  let start = 0;
  let pDepth = 0;
  let bDepth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === "'") {
      i += 1;
      while (i < inner.length) {
        if (inner[i] === "'" && inner[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (inner[i] === "'") break;
        i += 1;
      }
      continue;
    }
    if (ch === '(') pDepth += 1;
    else if (ch === ')' && pDepth > 0) pDepth -= 1;
    else if (ch === '[') bDepth += 1;
    else if (ch === ']' && bDepth > 0) bDepth -= 1;
    else if (ch === ',' && pDepth === 0 && bDepth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = inner.slice(start).trim();
  if (tail.length > 0) args.push(tail);

  const keys: string[] = [];
  for (let idx = 0; idx < args.length; idx += 2) {
    const rawKey = args[idx];
    const lit = /^'((?:''|[^'])*)'(?:::[A-Za-z0-9_]+)?$/.exec(rawKey);
    if (lit) {
      keys.push(lit[1].replace(/''/g, "'"));
    }
  }
  return keys;
}
