/**
 * Every edge call finishes, one way or the other.
 *
 * ## What the audit of all 19 client call sites found
 *
 * The error handling was mostly sound. Each site surfaces its failure into
 * store state rather than swallowing it, and the OAuth flows even separate
 * 404 ("the function is not deployed") from 503 ("it is not configured").
 *
 * The gap was uniform: not one of the nineteen had a timeout.
 *
 * A `fetch` with no signal never rejects on its own when the server accepts
 * the connection and then says nothing — a cold start that hangs, a function
 * stuck upstream, a captive-portal network that swallows the request. The
 * promise stays pending, the `catch` that would set `status: 'error'` never
 * runs, and the spinner turns until the user force-quits. From the outside
 * that is indistinguishable from "slow", so they wait.
 *
 * Two tests, of two kinds. The behaviour tests pin what the helper does. The
 * source gate pins that every call site uses it — which is the part that
 * rots, because a new call site that forgets looks exactly like one that
 * works, right up until the day a function hangs.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import {
  withEdgeDeadline,
  EdgeTimeoutError,
  EDGE_TIMEOUT_MS,
  STREAM_FIRST_BYTE_MS,
  STREAM_IDLE_MS,
  STREAM_TOTAL_MS,
} from '../../lib/edgeCall';

describe('withEdgeDeadline', () => {
  it('passes the value through when the call returns in time', async () => {
    await expect(withEdgeDeadline('X', async () => 'done')).resolves.toBe('done');
  });

  it('gives the call a signal that is not already aborted', async () => {
    let seen: AbortSignal | null = null;
    await withEdgeDeadline('X', async (signal) => { seen = signal; return 1; });
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen!.aborted).toBe(false);
  });

  it('aborts the signal when the deadline passes', async () => {
    let seen: AbortSignal | null = null;
    const p = withEdgeDeadline('Notion', (signal) => {
      seen = signal;
      // A server that accepts and never answers: exactly the case that used
      // to hang forever.
      return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason)); });
    }, 10);

    await expect(p).rejects.toBeInstanceOf(EdgeTimeoutError);
    expect(seen!.aborted).toBe(true);
  });

  it("a real transport error is passed through, not relabelled as a timeout", async () => {
    // "Network request failed" and "the server never answered" are different
    // problems and the user is told different things.
    const boom = new Error('Network request failed');
    await expect(withEdgeDeadline('X', async () => { throw boom; })).rejects.toBe(boom);
  });

  it('a caller-side abort is not reported as our timeout', async () => {
    const err = await withEdgeDeadline('X', async () => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    }).catch((e) => e);
    expect(err).not.toBeInstanceOf(EdgeTimeoutError);
  });

  it('releases the caller even when the call ignores the signal', async () => {
    // The case that made the helper stronger: aborting only frees the caller
    // if the callee honours the signal. A promise that ignores it would still
    // hang forever -- the exact failure this exists to fix -- so the deadline
    // is raced as well as aborted.
    const err = await withEdgeDeadline('Google Takvim', () => new Promise<never>(() => {}), 20)
      .catch((e) => e);
    expect(err).toBeInstanceOf(EdgeTimeoutError);
    expect(err.message).toContain('Google Takvim');
    expect(err.message).toMatch(/sunucu yanıt vermedi/);
  });

  it('the default deadline is long enough for an AI generation and stream deadlines export distinct constants', () => {
    // generate-routine calls Anthropic and returns paragraphs; a tight limit
    // would cut off work that was going to succeed.
    expect(EDGE_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(EDGE_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    expect(STREAM_FIRST_BYTE_MS).toBe(20_000);
    expect(STREAM_IDLE_MS).toBe(20_000);
    expect(STREAM_TOTAL_MS).toBe(90_000);
    expect(STREAM_TOTAL_MS).toBeGreaterThan(STREAM_IDLE_MS);
  });
});

describe('every edge call site goes through it', () => {
  const ROOT = join(__dirname, '..', '..');
  const files: { rel: string; code: string }[] = [];
  const skip = new Set(['node_modules', '.expo', 'dist', '__tests__', 'coverage', 'android', 'ios']);
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const abs = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(abs, r); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      files.push({ rel: r, code: stripComments(readFileSync(abs, 'utf8')) });
    }
  };
  walk(ROOT, '');

  /**
   * An edge call, in either of the two styles.
   *
   * Scanned over the whole file rather than line by line. A line-by-line
   * version of this missed a real case: several `fetch(` calls put the URL on
   * the FOLLOWING line, so the site was never detected and removing its
   * deadline was invisible to the gate. Found by mutating exactly that call
   * site and watching this file stay green.
   */
  const EDGE_CALL = /(functions\.invoke\s*\(|fetch\s*\(\s*[`'"]?\s*\$?\{?\s*(SUPABASE_FUNCTIONS_URL|FN_URL))/g;

  const sites = files.flatMap((f) => {
    const found: { rel: string; line: number; text: string }[] = [];
    for (const m of f.code.matchAll(EDGE_CALL)) {
      const line = f.code.slice(0, m.index).split('\n').length;
      found.push({ rel: f.rel, line, text: m[0] });
    }
    return found;
  });

  it('finds them (scanner sanity)', () => {
    // F12: 15 store call sites consolidated into `services/edgeFunctions.ts` (21 -> 8 sites:
    // 3 screens + accountService 1 + aiStreamService 2 + edgeFunctions 2).
    // Threshold lowered deliberately and pinned to the central transport service.
    expect(sites.length).toBeGreaterThanOrEqual(6);
    expect(sites.some((s) => s.rel === 'services/edgeFunctions.ts')).toBe(true);
  });

  it('none is issued without a deadline', () => {
    // `withEdgeDeadline` / `withStreamDeadline` wraps the call, so its name
    // appears on the same line as the call it guards, or the line above when
    // the call is broken across lines. Both are accepted; a bare call is not.
    const offenders = sites.filter((s) => {
      const f = files.find((x) => x.rel === s.rel)!;
      const lines = f.code.split('\n');
      const window = [lines[s.line - 2] ?? '', lines[s.line - 1] ?? ''].join(' ');
      return !/withEdgeDeadline|withStreamDeadline/.test(window);
    });
    expect(offenders.map((o) => `${o.rel}:${o.line}`)).toEqual([]);
  });

  it('lib/edgeCall.ts is the only place that builds the controller', () => {
    // Otherwise "it has a timeout" becomes true in nineteen slightly
    // different ways, and one of them is wrong.
    const offenders = files.filter(
      (f) => f.rel !== 'lib/edgeCall.ts' && f.code.includes('new AbortController()'),
    );
    // services/webhookService.ts legitimately has its own: it POSTs to a
    // user-supplied URL, not to an edge function, and has a shorter deadline.
    expect(offenders.map((f) => f.rel)).toEqual(['services/webhookService.ts']);
  });
});
