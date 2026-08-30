/**
 * Every call to an edge function has a deadline.
 *
 * ## What the audit found
 *
 * Nineteen client call sites reach an edge function, in two styles —
 * `supabase.functions.invoke(...)` and a raw `fetch(SUPABASE_FUNCTIONS_URL/...)`.
 * Their error handling is mostly sound: each surfaces the failure into store
 * state rather than swallowing it, and the OAuth flows even distinguish 404
 * ("not deployed") from 503 ("not configured").
 *
 * All nineteen had the same gap: no timeout. Not one of them.
 *
 * That is not a cosmetic omission. A `fetch` with no signal never rejects on
 * its own if the server accepts the connection and then says nothing — a cold
 * start that hangs, a function stuck on an upstream call, a captive-portal
 * Wi-Fi that swallows the request. The promise stays pending, the `catch` that
 * would set `status: 'error'` never runs, and the spinner turns until the user
 * force-quits. The user cannot tell that from "it is slow", so they wait.
 *
 * ## Why one helper and not nineteen AbortControllers
 *
 * Because the next call site would forget, and forgetting looks exactly like
 * working. `__tests__/repo/edgeCallDeadline.test.ts` requires every edge call
 * to come through here, so a new one cannot quietly ship without a deadline.
 *
 * The deadline does NOT replace each site's own handling of 404, 503 or a
 * `{ error }` body — those distinctions are real and stay where they are. This
 * only guarantees that a call eventually finishes, one way or the other.
 */

/**
 * 20 seconds.
 *
 * An AI generation legitimately takes several seconds — `generate-routine`
 * calls Anthropic and returns whole paragraphs — so a tight limit would cut
 * off work that was going to succeed. Twenty is comfortably past the slowest
 * healthy call observed and far short of "the user has given up", which is
 * where an unbounded wait leaves them.
 */
export const EDGE_TIMEOUT_MS = 20_000;

/** Thrown when the deadline passes. Distinguishable from a transport error. */
export class EdgeTimeoutError extends Error {
  constructor(public readonly label: string) {
    super(`${label}: sunucu yanıt vermedi (${EDGE_TIMEOUT_MS / 1000} sn). Bağlantını kontrol edip tekrar dene.`);
    this.name = 'EdgeTimeoutError';
  }
}

/**
 * Runs one edge call under a deadline.
 *
 * The signal is passed INTO the call rather than raced against it: racing
 * would let the caller continue while the request stayed open, holding a
 * socket and eventually resolving into nothing. Aborting ends it.
 *
 * `label` appears in the message the user reads, so it should name the action
 * ('Notion bağlantısı'), not the function slug.
 */
export async function withEdgeDeadline<T>(
  label: string,
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = EDGE_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let fire: (() => void) | null = null;

  // ── Why both an abort AND a race ──────────────────────────────────────
  //
  // Aborting alone is not enough. It only releases the caller if the callee
  // actually honours the signal — `fetch` does, and supabase-js passes it
  // through, but a helper whose guarantee depends on the callee's good
  // behaviour is not a guarantee. A promise that ignores the signal would
  // still hang forever, which is the exact failure being fixed.
  //
  // Racing alone is not enough either: the caller would continue while the
  // request stayed open, holding a socket and eventually resolving into
  // nothing.
  //
  // So: abort, to end the request, and race, to release the caller either
  // way.
  const deadline = new Promise<never>((_resolve, reject) => {
    fire = () => reject(new EdgeTimeoutError(label));
  });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    fire?.();
  }, timeoutMs);

  try {
    return await Promise.race([run(controller.signal), deadline]);
  } catch (e) {
    // An abort surfaces as a DOMException named AbortError, or as a plain
    // Error mentioning aborting, depending on the runtime. `timedOut` is the
    // reliable signal, and it is what distinguishes OUR abort from one the
    // caller triggered for its own reasons.
    if (timedOut && !(e instanceof EdgeTimeoutError)) throw new EdgeTimeoutError(label);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
