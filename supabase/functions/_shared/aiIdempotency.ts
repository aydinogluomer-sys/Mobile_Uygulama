/**
 * One idempotency key = one logical AI operation.
 *
 * ## The defect this module exists to close
 *
 * `spend_focus_points_v2` made the CHARGE idempotent: a repeated `request_id`
 * returns `replayed = true` and writes no second ledger row. `generate-routine`
 * read that flag, set `charged = false` so it would not refund a charge it had
 * not made -- and then continued straight into `new Anthropic(...)`.
 *
 * The money was idempotent. The work was not:
 *
 *     first call    -> 25 FP debited, one Anthropic call
 *     same key      ->  0 FP debited, ANOTHER Anthropic call
 *     same key x10  ->  0 FP debited, TEN Anthropic calls
 *
 * Provider spend is billed to the project rather than to the user, so one
 * charged key could be replayed indefinitely for free compute. And since
 * nothing bound a key to its input, the same key could be re-sent with a
 * different prompt: one payment, unlimited distinct answers.
 *
 * ## The shape of the fix
 *
 * A durable claim, taken BEFORE the provider is touched, which also stores the
 * answer:
 *
 *     begin  -> claimed | replay | in_progress | mismatch | consumed
 *     spend  -> only after a successful claim
 *     call   -> only after a successful charge
 *     store  -> so the next call with this key is answered from the row
 *
 * The order matters in both directions. The claim comes before the spend so
 * that two concurrent instances cannot both reach the provider -- exactly one
 * wins the insert. The spend comes before the provider so that an out-of-
 * credit caller never reaches it either. And the claim is RELEASED when the
 * spend refuses, because a request that never became a transaction should
 * leave no trace and must not poison the key.
 *
 * ## Why this file is separate from the function that uses it
 *
 * `generate-routine/index.ts` is Deno, imports `npm:@anthropic-ai/sdk`, and
 * needs a live paid key to run -- so its behaviour cannot be tested, only its
 * source read. Everything interesting here is orchestration: what gets called,
 * in what order, and how many times. Pulled into a dependency-injected module
 * it can be driven by a test that COUNTS provider invocations, which is the
 * only way to prove "zero additional Anthropic calls" rather than assert it.
 * `_shared/oauthState.ts` is here for the same reason.
 *
 * ## A refund that cannot be written
 *
 * Marking the claim `failed` while its refund was not written loses the refund
 * for good: `ai_request_reconcile_stale` only looks at `in_progress` rows, so
 * nothing ever comes back to it. `fail` is therefore called only after the
 * refund is confirmed. When it is not, the claim stays `in_progress`, its lease
 * is ended (`expireLease`) and the reconcile refunds it.
 */

export type AiMode = 'coach' | 'routine' | 'summarize' | 'insights';

/** What `ai_request_begin` found. */
export type BeginOutcome =
  /** Nothing existed; this caller owns the operation and must do the work. */
  | { kind: 'claimed' }
  /** Already done. The stored payload is the answer -- call nothing. */
  | { kind: 'replay'; response: Record<string, unknown> }
  /** Another instance is mid-flight on this key right now. */
  | { kind: 'in_progress' }
  /** This key was claimed by DIFFERENT input or a different mode. */
  | { kind: 'mismatch' }
  /** The attempt failed and was refunded; the key is spent. */
  | { kind: 'consumed'; error: string | null }
  /** The claim itself could not be taken. Fail closed. */
  | { kind: 'unavailable'; error: string };

/** What the charge RPC decided. */
export type SpendResult =
  | { kind: 'charged'; balance: number }
  /** The ledger already held this key. Do not refund what we did not charge. */
  | { kind: 'replayed'; balance: number }
  | { kind: 'insufficient'; balance: number }
  | { kind: 'unavailable'; error: string };

/** The provider's answer, already reduced to the payload the client receives. */
export type ProviderResult =
  | { ok: true; payload: Record<string, unknown> }
  /** A well-formed refusal: empty text, truncated output, unparseable JSON. */
  | { ok: false; reason: string; message: string };

export type AdmitResult =
  | { ok: true }
  | { ok: false; status: 429; code: string; message: string };

export type IdempotencyDeps = {
  begin(input: { requestId: string; mode: AiMode; fingerprint: string }): Promise<BeginOutcome>;
  admit?(input: { requestId: string; mode: AiMode }): Promise<AdmitResult>;
  complete(input: { requestId: string; response: Record<string, unknown> }): Promise<void>;
  fail(input: { requestId: string; error: string }): Promise<void>;
  release(input: { requestId: string }): Promise<void>;
  spend(input: { requestId: string; mode: AiMode; cost: number }): Promise<SpendResult>;
  /** true: iade kaydedildi ya da zaten kayıtlıydı (RPC hatasız döndü). false: iade yazılamadı. Fırlatabilir; çağıran fırlatmayı false sayar. */
  refund(input: { requestId: string; reason: string }): Promise<boolean>;
  /** İade yazılamadığında çağrılır: in_progress satırın kirasını hemen bitirir ve reconcile'ı bir kez dener. Fırlatmaz. */
  expireLease(input: { requestId: string }): Promise<void>;
  /** The ONLY thing in here that costs provider money. */
  callProvider(): Promise<ProviderResult>;
  /**
   * Current balance for the replay path.
   *
   * Deliberately NOT the spend RPC. Asking the charger for a number on a path
   * that must never charge is one refactor away from charging: if the ledger
   * row for this key were ever missing, `spend` would happily create it and
   * the replay would cost 25 FP. A read cannot do that.
   */
  readBalance(): Promise<number | null>;
  /** Turns a raw provider exception into something a user should read. */
  describeError(raw: string): string;
};

export type AiResponse = { status: number; body: Record<string, unknown> };

export const IDEMPOTENCY_MISMATCH = 'IDEMPOTENCY_KEY_REUSE_MISMATCH';
export const REQUEST_IN_PROGRESS = 'REQUEST_IN_PROGRESS';
export const IDEMPOTENCY_CONSUMED = 'IDEMPOTENCY_KEY_CONSUMED';
export const INSUFFICIENT_CREDITS = 'INSUFFICIENT_CREDITS';
export const DAILY_LIMIT = 'DAILY_LIMIT';
export const TOO_MANY_IN_FLIGHT = 'TOO_MANY_IN_FLIGHT';
export const REFUND_PENDING = 'REFUND_PENDING';
export const REFUND_PENDING_NOTE = 'Focus Point iaden güvende; hesabına otomatik olarak işlenecek.';

/**
 * A stable identity for the input that claimed a key.
 *
 * ## What is in it, and what is deliberately not
 *
 * The parts are the caller's own semantic input after the same normalisation
 * the prompt builder applies -- for `routine` the trimmed prompt, for `coach`
 * the trimmed message, and so on. Length-prefixed before joining so that
 * `['ab', 'c']` and `['a', 'bc']` cannot produce the same string.
 *
 * The derived context `coach` mode builds (habit counts, willpower, active
 * habit names) is NOT part of the identity, and that is a decision rather than
 * an oversight. It changes on its own between the first attempt and a retry --
 * tick one habit and it differs -- so including it would reject legitimate
 * retries of the same question as key misuse, on a path where the user has
 * already paid. Excluding it is safe precisely because of the claim row: a
 * repeat with the same message returns the STORED answer without calling the
 * provider, whatever the context says.
 *
 * The hash is not a security boundary. A collision would cause a replay to
 * return the original stored answer -- no provider call, no charge -- so
 * forging one gains an attacker nothing. It exists to catch a key pointed at
 * different input and say so out loud.
 */
export async function fingerprintInput(mode: AiMode, parts: string[]): Promise<string> {
  const canonical = [mode, ...parts].map((p) => `${p.length}:${p}`).join('|');
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Runs one AI operation at most once, whatever the caller does with the key.
 *
 * Every early return below is a path on which `callProvider` is never
 * awaited. That is the property the whole module is for, and the tests count
 * it rather than trusting it.
 */
export async function runIdempotentAiRequest(
  input: { requestId: string; mode: AiMode; fingerprint: string; cost: number },
  deps: IdempotencyDeps,
): Promise<AiResponse> {
  const { requestId, mode, fingerprint, cost } = input;

  const begin = await deps.begin({ requestId, mode, fingerprint });

  // ── the key is not ours to use ──────────────────────────────────────────
  if (begin.kind === 'unavailable') {
    // Fail CLOSED. Without a claim there is nothing stopping a second call, so
    // a claim we could not take is a call we must not make.
    return { status: 503, body: { error: 'İstek kaydı yapılamadı, lütfen tekrar deneyin.' } };
  }

  if (begin.kind === 'mismatch') {
    return {
      status: 409,
      body: {
        error: 'Bu istek anahtarı farklı bir içerikle kullanılmış. Yeni bir istek başlat.',
        code: IDEMPOTENCY_MISMATCH,
      },
    };
  }

  if (begin.kind === 'in_progress') {
    return {
      status: 409,
      body: { error: 'Bu istek hâlâ işleniyor, birazdan tekrar dene.', code: REQUEST_IN_PROGRESS },
    };
  }

  if (begin.kind === 'consumed') {
    return {
      status: 409,
      body: {
        error: begin.error ?? 'Bu istek daha önce başarısız oldu ve ücreti iade edildi.',
        code: IDEMPOTENCY_CONSUMED,
      },
    };
  }

  // ── the answer already exists ───────────────────────────────────────────
  if (begin.kind === 'replay') {
    // THE short-circuit. No spend, no provider, no new answer -- the caller
    // gets back exactly what they were given the first time.
    const balance = await deps.readBalance();
    return {
      status: 200,
      body: {
        ...begin.response,
        ...(typeof balance === 'number' ? { balance } : {}),
        cost,
        replayed: true,
      },
    };
  }

  // ── claimed: this caller does the work, once ────────────────────────────
  if (deps.admit) {
    const gate = await deps.admit({ requestId, mode });
    if (!gate.ok) {
      await deps.release({ requestId });
      return { status: gate.status, body: { error: gate.message, code: gate.code } };
    }
  }

  const spend = await deps.spend({ requestId, mode, cost });

  if (spend.kind === 'unavailable') {
    // Do NOT release the claim: the spend RPC may have committed on the server
    // before its HTTP response dropped. Expiring the lease lets reconcile
    // refund any committed debit (or mark an uncommitted claim failed at 0 FP).
    try {
      await deps.expireLease({ requestId });
    } catch {
      /* lease expires naturally in 5 min; reconcile refunds if spend committed */
    }
    return {
      status: 503,
      body: {
        error: `Kredi işlemi doğrulanamadı, lütfen tekrar deneyin. ${REFUND_PENDING_NOTE}`,
        code: REFUND_PENDING,
      },
    };
  }

  if (spend.kind === 'insufficient') {
    // Nothing was charged and nothing was called, so the claim is retracted:
    // the key is untouched and works the moment the user has credit again.
    await deps.release({ requestId });
    return {
      status: 402,
      body: {
        error: `Yetersiz Focus Point. Bu işlem ${cost} FP gerektiriyor, bakiyen ${spend.balance}.`,
        code: INSUFFICIENT_CREDITS,
        balance: spend.balance,
        cost,
      },
    };
  }

  // `replayed` means the ledger already held this key while `ai_requests` did
  // not -- a key that predates this table. The work still has to happen, but
  // refunding would return money this call never took.
  const charged = spend.kind === 'charged';

  const failAndRefund = async (p: { reason: string; dbError: string; userMessage: string }): Promise<AiResponse> => {
    let refunded = true;
    if (charged) {
      try { refunded = await deps.refund({ requestId, reason: p.reason }); } catch { refunded = false; }
    }
    if (refunded) {
      await deps.fail({ requestId, error: p.dbError });
      return { status: 500, body: { error: p.userMessage } };
    }
    // İade yazılamadı: satır in_progress KALIR (fail çağrılsaydı reconcile onu bir daha görmezdi).
    try {
      await deps.expireLease({ requestId });
    } catch {
      /* kira 5 dk sonunda doğal olarak biter ve uzlaştırma iadeyi yazar */
    }
    return { status: 500, body: { error: `${p.userMessage} ${REFUND_PENDING_NOTE}`, code: REFUND_PENDING } };
  };

  let result: ProviderResult;
  try {
    result = await deps.callProvider();
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error('ai provider call failed:', raw);
    const safeMsg = deps.describeError(raw);
    return failAndRefund({ reason: 'ai_error', dbError: safeMsg, userMessage: safeMsg });
  }
  if (!result.ok) {
    return failAndRefund({ reason: result.reason, dbError: result.message, userMessage: result.message });
  }

  // Stored BEFORE returning, so a client that never sees this response can
  // recover it by retrying the same key.
  await deps.complete({ requestId, response: result.payload });

  return {
    status: 200,
    body: { ...result.payload, balance: spend.balance, cost, replayed: false },
  };
}
