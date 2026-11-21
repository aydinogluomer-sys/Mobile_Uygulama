/**
 * Extracts and classifies every PostgREST query chain in a repository file.
 *
 * ## Why per-query and not per-file
 *
 * The first bounding gate asked "does this file contain a `.limit()`". A
 * repository with one paginated query and one unbounded query passed, because
 * the bounded one satisfied the whole file. That is a false green of exactly
 * the shape this codebase keeps producing: an instrument that looks like it
 * measures the thing and measures something adjacent.
 *
 * This walks each `supabase.from('table')` chain to its end and classifies
 * that chain alone, so two queries in one file get two verdicts.
 */

export type BoundKind =
  | 'KEYSET_PAGE'
  | 'RANGE_PAGED'
  | 'DATE_WINDOW'
  | 'UNPAGED_WINDOW'
  | 'BOUNDED_SEARCH'
  | 'SINGLE_ROW'
  | 'EXACT_COUNT'
  | 'STATIC_REFERENCE'
  | 'BOUNDED_DOMAIN_WINDOW'
  | 'WRITE'
  | 'UNCLASSIFIED';

export type QueryChain = {
  /** The enclosing exported function, when one can be determined. */
  operation: string;
  table: string;
  chain: string;
  /** A SELECT that can return many rows — the only kind that needs a bound. */
  isCollection: boolean;
  bound: BoundKind;
  userScoped: boolean;
};

/** The exported function a character offset falls inside. */
function enclosingFunction(src: string, offset: number): string {
  const re = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)|export\s+const\s+([A-Za-z0-9_]+)\s*=/g;
  let name = '(module)';
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) && m.index < offset) name = m[1] ?? m[2];
  return name;
}

/**
 * Reads one chain starting at `supabase` / `admin` and ending at the
 * statement's semicolon, balancing parentheses so a `.or('a,and(b)')`
 * argument cannot terminate it early.
 */
function readChain(src: string, start: number): string {
  let depth = 0;
  let i = start;
  let inStr: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
    } else if (c === "'" || c === '"' || c === '`') {
      inStr = c;
    } else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth <= 0) break;
    i++;
  }
  return src.slice(start, i);
}

export function extractChains(src: string): QueryChain[] {
  const out: QueryChain[] = [];
  const re = /\b(?:supabase|admin)\s*\n?\s*\.\s*from\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(src))) {
    const table = m[1];
    const chain = readChain(src, m.index);
    const isWrite = /\.\s*(insert|update|upsert|delete)\s*\(/.test(chain);
    const single = /\.\s*(single|maybeSingle)\s*\(/.test(chain);
    const isCollection = !isWrite && !single && /\.\s*select\s*\(/.test(chain);

    let bound: BoundKind = 'UNCLASSIFIED';
    if (isWrite) bound = 'WRITE';
    else if (single) bound = 'SINGLE_ROW';
    else if (/count:\s*['"]exact['"]/.test(chain)) bound = 'EXACT_COUNT';
    else if (/\.\s*ilike\s*\(/.test(chain) && /\.\s*limit\s*\(/.test(chain)) bound = 'BOUNDED_SEARCH';
    else if (/\.\s*range\s*\(/.test(chain)) bound = 'RANGE_PAGED';
    else if (/\.\s*gte\s*\(/.test(chain)) {
      const lim = /\.\s*limit\s*\(\s*(\d+)\s*\)/.exec(chain);
      bound = lim && Number(lim[1]) <= 1000 ? 'DATE_WINDOW' : 'UNPAGED_WINDOW';
    }
    else if (/\.\s*in\s*\(/.test(chain)) bound = 'BOUNDED_DOMAIN_WINDOW';
    else if (/\.\s*limit\s*\(/.test(chain)) bound = 'BOUNDED_DOMAIN_WINDOW';

    out.push({
      operation: enclosingFunction(src, m.index),
      table,
      chain: chain.replace(/\s+/g, ' ').slice(0, 160),
      isCollection,
      bound,
      userScoped: /\.\s*eq\s*\(\s*['"]user_id['"]/.test(chain) || /\.\s*eq\s*\(\s*['"]id['"]\s*,\s*u\.userId/.test(chain),
    });
  }
  return out;
}

/** Repository functions that delegate their bounding to `shared.fetchPage`. */
export function keysetOperations(src: string): { operation: string; table: string }[] {
  const out: { operation: string; table: string }[] = [];
  const re = /fetchPage<[^>]*>\(\{([\s\S]*?)\}\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const table = /table:\s*['"]([^'"]+)['"]/.exec(m[1])?.[1] ?? '(unknown)';
    out.push({ operation: enclosingFunction(src, m.index), table });
  }
  return out;
}
