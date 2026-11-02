/**
 * Outbound webhooks.  (plan §8; migration 009_retire_legacy_backend)
 *
 * ## Why delivery moved onto the device
 *
 * On the retired FastAPI service `trigger_webhooks` ran server-side, but it
 * only ever ran because the app had just called a completion endpoint. Both
 * of its trigger points — `habit_completed`, `task_completed` — were
 * app-initiated. So sending from the device is not a reduction in coverage;
 * it fires at exactly the same two moments.
 *
 * It removes something, though. A server that POSTs to a URL its users type
 * in is a request forgery surface: the URL can name an internal host, and
 * the request arrives with the server's network position and whatever
 * credentials that position implies. From the device the request carries the
 * user's own network position, aimed at an endpoint they own — the same
 * trust domain, so there is nothing to escalate to.
 *
 * The legacy dispatcher had a second bug this replaces rather than ports:
 *
 *     db.webhooks.find({"enabled": True, "event_types": event_type})
 *
 * No owner filter. One user completing a habit POSTed that habit's name to
 * every other user's registered endpoint. Here the read is owner-scoped by
 * RLS and by an explicit filter.
 *
 * ## What is deliberately preserved
 *
 * The payload envelope and the 5s timeout are copied exactly, so webhooks
 * already wired into n8n keep working:
 *
 *     { "event": "...", "timestamp": "...", "data": { ... } }
 */
import { fetchWebhooks, type WebhookEvent, type WebhookRow } from '../repositories/webhookRepository';
import {
  insertWebhook,
  deleteWebhook,
} from '../repositories/webhookRepository';
import { Platform } from 'react-native';

export type { WebhookEvent, WebhookRow };

const TIMEOUT_MS = 5_000;
/** F05 (REP-14): at most three attempts per target, waiting 1 s then 4 s, within 15 s in all. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1_000, 4_000];
const TOTAL_BUDGET_MS = 15_000;

export type DeliveryReport = {
  attempted: number;
  delivered: number;
  failed: { url: string; reason: string }[];
};

/**
 * Rejects anything the server-side CHECK would reject, before the round trip.
 *
 * Not a security boundary — the constraint in the migration is, and it is
 * what stops a client that skips this. This exists so a user who pastes an
 * `http://` link is told why instead of seeing a raw Postgres violation.
 */
export function validateWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const url = raw.trim();
  if (!url) return { ok: false, error: 'URL boş olamaz.' };
  if (url.length > 2048) return { ok: false, error: 'URL çok uzun.' };
  if (/\s/.test(url)) return { ok: false, error: 'URL boşluk içeremez.' };
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, error: 'Yalnızca https:// adresleri kabul edilir — http üzerinde alışkanlık adlarınız açık metin gider.' };
  }
  return { ok: true, url };
}

/** Which of the user's registrations should receive a given event. */
export function targetsFor(webhooks: WebhookRow[], event: WebhookEvent): WebhookRow[] {
  return webhooks.filter((w) => w.enabled && w.event_types.includes(event));
}

/**
 * The envelope `{ event, timestamp, data }` is unchanged (existing n8n flows parse it). F05: when the
 * write has a delivery id, `delivery_id` is added beside it, the same for every attempt and target,
 * so a receiver can drop a repeat.
 */
export function payloadFor(event: WebhookEvent, data: Record<string, unknown>, now: Date = new Date(), deliveryId?: string) {
  return deliveryId
    ? { event, timestamp: now.toISOString(), data, delivery_id: deliveryId }
    : { event, timestamp: now.toISOString(), data };
}

function newDeliveryId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const isTransientHttp = (status: number) => status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type AttemptResult = { ok: true } | { ok: false; error: string; retry: boolean };

/**
 * POSTs one payload, with a hard timeout and no throw.
 *
 * A webhook is a side channel. It must never be able to fail the completion
 * that triggered it, so every outcome — refused connection, DNS failure,
 * 500, a server that accepts the request and never responds — comes back as
 * a value. The AbortController is the part that matters: without it a silent
 * endpoint holds the promise open indefinitely.
 */
export async function deliver(
  webhook: Pick<WebhookRow, 'url' | 'headers'>,
  body: ReturnType<typeof payloadFor>,
  fetchImpl: typeof fetch = fetch,
  opts: { attempts?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const attempts = opts.attempts ?? MAX_ATTEMPTS;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const started = now();
  let last: AttemptResult = { ok: false, error: 'gönderilmedi', retry: false };
  for (let i = 0; i < attempts; i++) {
    last = await deliverOnce(webhook, body, fetchImpl);
    if (last.ok) return last;
    // only a lost connection, a timeout, 408/425/429 or a 5xx is worth another try; any other answer is final
    if (!last.retry || i === attempts - 1) break;
    const wait = RETRY_DELAYS_MS[i] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    if (now() - started + wait > TOTAL_BUDGET_MS) break;
    await sleep(wait);
  }
  return { ok: false, error: last.ok ? '' : last.error };
}

async function deliverOnce(
  webhook: Pick<WebhookRow, 'url' | 'headers'>,
  body: ReturnType<typeof payloadFor>,
  fetchImpl: typeof fetch,
): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const deliveryId = 'delivery_id' in body ? body.delivery_id : undefined;
  try {
    const res = await fetchImpl(webhook.url, {
      method: 'POST',
      headers: {
        ...(webhook.headers ?? {}),
        'Content-Type': 'application/json',
        // a custom header widens the CORS preflight on the web and would break existing receivers;
        // there the id travels in the body only
        ...(deliveryId && Platform.OS !== 'web' ? { 'X-Aderyth-Delivery': deliveryId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      // REP-14: an https endpoint that redirects (perhaps to http://) is NOT followed: the body
      // would leave in clear text and `validateWebhookUrl` would mean nothing
      redirect: 'manual',
    });
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return { ok: false, error: 'yönlendirme reddedildi', retry: false };
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, retry: isTransientHttp(res.status) };
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg === 'Aborted' || msg.includes('abort') ? 'zaman aşımı' : msg, retry: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fires an event to every matching registration.
 *
 * Endpoints are independent, so one slow or dead endpoint must not delay the
 * others — they go out together and are settled together. The return value
 * is a report rather than a throw for the reason above: callers are
 * completion paths.
 */
export async function dispatch(
  event: WebhookEvent,
  data: Record<string, unknown>,
  deps: { fetchImpl?: typeof fetch; now?: Date; deliveryId?: string; sleep?: (ms: number) => Promise<void> } = {},
): Promise<DeliveryReport> {
  const targets = targetsFor(await registrations(), event);
  if (targets.length === 0) return { attempted: 0, delivered: 0, failed: [] };

  // one id for this event: every target and every attempt carry the same one (F05)
  const body = payloadFor(event, data, deps.now, deps.deliveryId ?? newDeliveryId());
  const results = await Promise.all(
    targets.map((w) => deliver(w, body, deps.fetchImpl ?? fetch, { sleep: deps.sleep }).then((r) => ({ w, r }))),
  );

  const failed = results.filter((x) => !x.r.ok).map((x) => ({
    url: x.w.url,
    reason: x.r.ok ? '' : x.r.error,
  }));
  return { attempted: targets.length, delivered: results.length - failed.length, failed };
}

/**
 * Session cache of the registration list.
 *
 * `dispatch` runs on the completion path, which is the most-used write in
 * the app. Reading `webhooks` from PostgREST on every tick to discover — for
 * almost every account — that there are none registered would spend a round
 * trip to do nothing. The list changes only through the three functions
 * below, so they invalidate it; nothing else can go stale.
 *
 * Cleared on sign-out via `resetWebhookCache`, so one account's
 * registrations can never be read for another's completion.
 */
let cache: WebhookRow[] | null = null;

export function resetWebhookCache(): void {
  cache = null;
}

async function registrations(): Promise<WebhookRow[]> {
  if (cache) return cache;
  const res = await fetchWebhooks();
  if (!res.ok) return [];
  cache = res.data;
  return cache;
}

export async function listWebhooks() {
  const res = await fetchWebhooks();
  if (res.ok) cache = res.data;
  return res;
}

export async function removeWebhook(id: string) {
  const res = await deleteWebhook(id);
  resetWebhookCache();
  return res;
}

/** Registration, refusing locally what the database would refuse anyway. */
export async function registerWebhook(input: { url: string; eventTypes?: WebhookEvent[] }) {
  const checked = validateWebhookUrl(input.url);
  if (!checked.ok) return { ok: false as const, error: checked.error };
  const res = await insertWebhook({ url: checked.url, eventTypes: input.eventTypes });
  resetWebhookCache();
  return res;
}

/**
 * Fire-and-forget notification for a completion.
 *
 * A webhook is a side channel: the user's habit is logged whether or not
 * their automation is reachable. So this never rejects and is never awaited
 * by the completion path — the `catch` is the contract, not defensive
 * decoration.
 */
export function notify(event: WebhookEvent, data: Record<string, unknown>, opts?: { deliveryId?: string }): void {
  void dispatch(event, data, { deliveryId: opts?.deliveryId }).catch(() => undefined);
}
