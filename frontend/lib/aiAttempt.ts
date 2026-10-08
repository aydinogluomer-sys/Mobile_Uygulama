/**
 * R09.06 — one paid AI request, one charge, even when the answer is lost.
 *
 * The edge function charges per `request_id` and replays a finished request
 * instead of charging again (focusPointService.newRequestId). That only helps
 * if a retry SENDS the same id. Until now every tap minted a new one, so:
 *
 *   tap -> server charges and answers -> the 20 s deadline (or the network)
 *   loses the answer -> the user taps again -> new id -> charged twice for one
 *   answer they saw once.
 *
 * The keeper holds the id of an attempt that got NO answer (timeout, offline,
 * relay failure) and hands it back when the same request is sent again; the
 * server then replays the first outcome. An attempt the server DID answer --
 * a result, or a definite error such as "not enough credit" -- is closed, and
 * the next tap is a new request (the user asked again, on purpose).
 * A different request (another prompt, another period) is always new.
 *
 * Pure apart from the id factory it is given.
 */
import { EdgeTimeoutError } from './edgeCall';

/** True when the request may have reached the server but no answer came back. */
export function isNoAnswer(err: unknown): boolean {
  if (err instanceof EdgeTimeoutError) return true;
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError' || name === 'AbortError') return true;
  const msg = (err as { message?: unknown } | null)?.message;
  return err instanceof TypeError && typeof msg === 'string' && /network request failed|failed to fetch/i.test(msg);
}

/** Said after a lost answer, so the user knows trying again is free. */
export const NO_ANSWER_NOTE = 'Yanıt alınamadı. Aynı isteği tekrar gönderirsen ikinci kez ücret alınmaz.';

export type AttemptKeeper = {
  /** The request id for sending `key` now: the open attempt's id if it is the same request, else a new one. */
  begin(key: string): string;
  /** The server answered (success or a definite error): the attempt is closed. */
  answered(): void;
};

export function createAttemptKeeper(newId: () => string): AttemptKeeper {
  let open: { key: string; requestId: string } | null = null;
  return {
    begin(key) {
      if (open && open.key === key) return open.requestId;
      open = { key, requestId: newId() };
      return open.requestId;
    },
    answered() { open = null; },
  };
}
