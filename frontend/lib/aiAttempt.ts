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
import { accountEpoch } from './accountScope';
import { extractInvokeError } from './aiInvoke';
import { EdgeTimeoutError, REQUEST_IN_PROGRESS_RETRY_DELAYS_MS } from './edgeCall';

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

export const REQUEST_IN_PROGRESS_CODE = 'REQUEST_IN_PROGRESS';
export const IN_PROGRESS_NOTE =
  'Yanıtın hâlâ hazırlanıyor. Birkaç saniye sonra aynı isteği tekrar gönder; ikinci kez ücret alınmaz.';

export type AttemptKeeper = {
  /** İstek kimliği: aynı anahtarla açık deneme varsa onun kimliği, yoksa yenisi. */
  begin(key: string): string;
  /**
   * Açık denemeye ikinci bir anahtar bağlar (kimlik DEĞİŞMEZ). Yeni konuşmanın ilk mesajında
   * konuşma satırı oluşunca `${eskiThread}|${metin}` yerine `${yeniThread}|${metin}` ile gelen
   * yeniden gönderim de aynı kimliği bulur. Açık deneme `fromKey` ile eşleşmiyorsa hiçbir şey yapmaz.
   */
  rebind(fromKey: string, toKey: string): void;
  /** Sunucu kesin yanıt verdi (sonuç ya da kesin hata): deneme kapanır. */
  answered(): void;
};

export function createAttemptKeeper(newId: () => string): AttemptKeeper {
  let open: { keys: Set<string>; requestId: string; epoch: number } | null = null;
  return {
    begin(key) {
      const nowEpoch = accountEpoch();
      if (open && open.epoch === nowEpoch && open.keys.has(key)) return open.requestId;
      open = { keys: new Set([key]), requestId: newId(), epoch: nowEpoch };
      return open.requestId;
    },
    rebind(fromKey, toKey) {
      if (open && open.epoch === accountEpoch() && open.keys.has(fromKey)) open.keys.add(toKey);
    },
    answered() { open = null; },
  };
}

export type InvokeOutcome<T> = { data: T | null; error: unknown };
export type InvokeErrorInfo = { msg: string; code?: string; balance?: number };
export type RetryOutcome<T> = InvokeOutcome<T> & {
  /** Bütçe doldu ve sunucu hâlâ işliyor: ANAHTAR KORUNMALI, answered() ÇAĞRILMAMALI. */
  stillInProgress: boolean;
  /** Hata gövdesi BİR KEZ okunmuş hâli (Response gövdesi ikinci kez okunamaz); hata yoksa null. */
  errorInfo: InvokeErrorInfo | null;
};

export async function retryWhileInProgress<T>(
  call: () => Promise<InvokeOutcome<T>>,
  opts: {
    delaysMs?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
    isCancelled?: () => boolean;
    fallbackMessage?: string;
  } = {},
): Promise<RetryOutcome<T>> {
  const delays = opts.delaysMs ?? REQUEST_IN_PROGRESS_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    const out = await call();
    if (!out.error) return { ...out, stillInProgress: false, errorInfo: null };
    if (isNoAnswer(out.error)) return { ...out, stillInProgress: false, errorInfo: null };
    const info = await extractInvokeError(out.error, opts.fallbackMessage);
    if (info.code !== REQUEST_IN_PROGRESS_CODE) return { ...out, stillInProgress: false, errorInfo: info };
    if (attempt >= delays.length || opts.isCancelled?.()) return { ...out, stillInProgress: true, errorInfo: info };
    await sleep(delays[attempt]);
  }
}
