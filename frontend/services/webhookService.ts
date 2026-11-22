/**
 * Outbound webhooks.  (plan §8; migration 009_retire_legacy_backend; F46 REP-14 / DOM-21 / SYN-26)
 *
 * ## Why delivery moved onto the device
 *
 * On the retired FastAPI service `trigger_webhooks` ran server-side, but it
 * only ever ran because the app had just called a completion endpoint. Both
 * of its trigger points — `habit_completed`, `task_completed` — were
 * app-initiated. So sending from the device is not a reduction in coverage;
 * it fires at exactly the same two moments.
 *
 * F46 adds:
 *  1. Client-side private/loopback/link-local host validation (`classifyHost`).
 *  2. Per-registration HMAC-SHA256 signing (`X-Aderyth-Signature: t=<unix>,v1=<hex>` on native).
 *  3. Durable delivery through the unified `effect` outbox channel (`outbox.v1.effect.<uid>`)
 *     with deterministic operation IDs (`wh1.<event>.<subjectKey>.<webhookId>`) and 14-day dedupe.
 */
import { Platform } from 'react-native';
import { hmacSha256Hex, randomHex } from '../lib/hmacSha256';
import type { DeliveryOutcome, OutboxCommand } from '../lib/outbox';
import {
  ENTITY_POLICIES,
  outboxEngine,
  WEBHOOK_EVENT_ENTITY,
  webhookOperationId,
} from '../lib/outboxEngine';
import { asyncStorageOutboxNs, namespacedOutboxKey } from '../lib/outboxStorage';
import { currentUser } from '../lib/session';
import {
  deleteWebhook,
  fetchWebhooks,
  insertWebhook,
  type WebhookEvent,
  type WebhookRow,
} from '../repositories/webhookRepository';
import { createOutboxChannel } from './outboxChannel';

export type { WebhookEvent, WebhookRow };

const TIMEOUT_MS = 5_000;
/** F05 (REP-14): at most three attempts per target in direct `dispatch`, waiting 1 s then 4 s, within 15 s in all. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1_000, 4_000];
const TOTAL_BUDGET_MS = 15_000;
export const MAX_RETRY_AFTER_MS = 15 * 60_000;

export const SIGNING_SECRET_KEY: string = '__aderyth_signing_secret';

const PRIVATE_URL_MESSAGE =
  'Bu adres yalnızca kendi ağından erişilebilir. İnternetten ulaşılabilen bir https adresi gir.';

export type DeliveryReport = {
  attempted: number;
  delivered: number;
  failed: { url: string; reason: string }[];
};

export function readSigningSecret(w: Pick<WebhookRow, 'headers'>): string | null {
  const h = w.headers;
  if (!h || typeof h !== 'object') return null;
  const val = (h as Record<string, unknown>)[SIGNING_SECRET_KEY];
  return typeof val === 'string' && val.length > 0 ? val : null;
}

function stripReservedHeaders(headers: WebhookRow['headers']): Record<string, string> {
  if (!headers || typeof headers !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k === SIGNING_SECRET_KEY) continue;
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function isPrivateIpv4(u32: number): boolean {
  const a = (u32 >>> 24) & 0xff;
  const b = (u32 >>> 16) & 0xff;
  const c = (u32 >>> 8) & 0xff;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && (b & 0xc0) === 64) return true; // 100.64.0.0/10
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24, 192.0.2.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function parseIpv4Aton(host: string): { kind: 'ipv4'; u32: number } | { kind: 'invalid' } | null {
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) {
    if (parts.every((p) => /^[0-9]/.test(p))) return { kind: 'invalid' };
    return null;
  }
  const allNumericLooking = parts.every((p) => /^(0x[0-9a-f]*|[0-9]+)$/i.test(p));
  if (!allNumericLooking) {
    return null;
  }
  const values: number[] = [];
  for (const p of parts) {
    if (!p) return { kind: 'invalid' };
    let v = NaN;
    if (/^0x[0-9a-f]+$/i.test(p)) {
      v = parseInt(p.slice(2), 16);
    } else if (p.length > 1 && p.startsWith('0')) {
      if (!/^0[0-7]+$/.test(p)) return { kind: 'invalid' };
      v = parseInt(p, 8);
    } else if (/^[0-9]+$/.test(p)) {
      v = parseInt(p, 10);
    } else {
      return { kind: 'invalid' };
    }
    if (!Number.isFinite(v) || v < 0) return { kind: 'invalid' };
    values.push(v);
  }
  const n = values.length;
  for (let i = 0; i < n - 1; i += 1) {
    if (values[i] > 255) return { kind: 'invalid' };
  }
  const maxLast = 2 ** (8 * (5 - n)) - 1;
  if (values[n - 1] > maxLast) return { kind: 'invalid' };

  let u32 = values[n - 1];
  for (let i = 0; i < n - 1; i += 1) {
    u32 = (u32 + values[i] * 2 ** (8 * (3 - i))) >>> 0;
  }
  return { kind: 'ipv4', u32: u32 >>> 0 };
}

function parseIpv6(raw: string): Uint16Array | null {
  if (!raw || raw.includes('%')) return null;
  let body = raw;
  let tailGroups: number[] = [];

  const lastColon = body.lastIndexOf(':');
  if (lastColon >= 0 && body.slice(lastColon + 1).includes('.')) {
    const v4Part = body.slice(lastColon + 1);
    const v4 = parseIpv4Aton(v4Part);
    if (!v4 || v4.kind !== 'ipv4') return null;
    tailGroups = [(v4.u32 >>> 16) & 0xffff, v4.u32 & 0xffff];
    body = body.slice(0, lastColon);
    if (body.endsWith(':')) body += '0';
  }

  const doubleColonParts = body.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseHexList = (s: string): number[] | null => {
    if (s === '') return [];
    const tokens = s.split(':');
    const nums: number[] = [];
    for (const tok of tokens) {
      if (!/^[0-9a-f]{1,4}$/i.test(tok)) return null;
      nums.push(parseInt(tok, 16));
    }
    return nums;
  };

  let groups: number[];
  if (doubleColonParts.length === 2) {
    const left = parseHexList(doubleColonParts[0]);
    const right = parseHexList(doubleColonParts[1]);
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length + tailGroups.length);
    if (missing < 1) return null;
    groups = [...left, ...new Array<number>(missing).fill(0), ...right, ...tailGroups];
  } else {
    const all = parseHexList(doubleColonParts[0]);
    if (!all) return null;
    groups = [...all, ...tailGroups];
  }

  if (groups.length !== 8) return null;
  return Uint16Array.from(groups);
}

export function classifyHost(hostInput: string): 'public' | 'private' | 'invalid' {
  const trimmed = hostInput.trim().toLowerCase();
  if (!trimmed) return 'invalid';

  if (trimmed.startsWith('[') || trimmed.endsWith(']') || trimmed.includes(':')) {
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
      // Allow bare IPv6 passed directly to classifyHost(host) as well as bracketed [v6]
      if (trimmed.startsWith('[') || trimmed.endsWith(']')) return 'invalid';
    }
    const inner = trimmed.startsWith('[') ? trimmed.slice(1, -1) : trimmed;
    if (inner.includes('%')) return 'private';
    const g = parseIpv6(inner);
    if (!g) return 'invalid';
    const allZeroPrefix = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
    if (allZeroPrefix && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) {
      return 'private'; // :: or ::1
    }
    if (allZeroPrefix && (g[5] === 0xffff || g[5] === 0)) {
      const mapped = ((g[6] << 16) | g[7]) >>> 0;
      return isPrivateIpv4(mapped) ? 'private' : 'public';
    }
    if ((g[0] & 0xfe00) === 0xfc00) return 'private'; // fc00::/7 (unique local)
    if ((g[0] & 0xffc0) === 0xfe80) return 'private'; // fe80::/10 (link-local)
    if ((g[0] & 0xff00) === 0xff00) return 'private'; // ff00::/8 (multicast)
    if (g[0] === 0x2001 && g[1] === 0x0db8) return 'private'; // documentation
    return 'public';
  }

  const host = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
  if (!host || host.startsWith('.') || host.includes('..')) return 'invalid';

  const v4 = parseIpv4Aton(host);
  if (v4) {
    if (v4.kind === 'invalid') return 'invalid';
    return isPrivateIpv4(v4.u32) ? 'private' : 'public';
  }

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home.arpa')
  ) {
    return 'private';
  }

  const labels = host.split('.');
  if (labels.length < 2) return 'invalid';
  for (const label of labels) {
    if (!label || label.length > 63) return 'invalid';
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) return 'invalid';
  }
  const tld = labels[labels.length - 1];
  if (/^[0-9]+$/.test(tld)) return 'invalid';

  return 'public';
}

/**
 * Rejects anything the server-side CHECK or SSRF/private-network guard refuses,
 * before the round trip.
 */
export function validateWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const url = raw.trim();
  if (!url) return { ok: false, error: 'URL boş olamaz.' };
  if (url.length > 2048) return { ok: false, error: 'URL çok uzun.' };
  if (/\s/.test(url)) return { ok: false, error: 'URL boşluk içeremez.' };
  if (!/^https:\/\//i.test(url)) {
    return {
      ok: false,
      error: 'Yalnızca https:// adresleri kabul edilir — http üzerinde alışkanlık adlarınız açık metin gider.',
    };
  }

  const afterScheme = url.slice(8);
  const slashIdx = afterScheme.search(/[/?#]/);
  const authority = slashIdx >= 0 ? afterScheme.slice(0, slashIdx) : afterScheme;
  const pathAndMore = slashIdx >= 0 ? afterScheme.slice(slashIdx) : '';

  if (!authority) {
    return { ok: false, error: 'Geçerli bir https adresi gir.' };
  }
  if (authority.includes('@')) {
    return { ok: false, error: 'URL kullanıcı adı veya parola içeremez.' };
  }

  let host = '';
  let portStr = '';
  if (authority.startsWith('[')) {
    const closeIdx = authority.indexOf(']');
    if (closeIdx < 0) return { ok: false, error: 'Geçerli bir https adresi gir.' };
    host = authority.slice(0, closeIdx + 1);
    const rest = authority.slice(closeIdx + 1);
    if (rest) {
      if (!rest.startsWith(':')) return { ok: false, error: 'Geçerli bir https adresi gir.' };
      portStr = rest.slice(1);
    }
  } else {
    const colonIdx = authority.indexOf(':');
    if (colonIdx >= 0) {
      if (authority.indexOf(':', colonIdx + 1) >= 0) {
        return { ok: false, error: 'Geçerli bir https adresi gir.' };
      }
      host = authority.slice(0, colonIdx);
      portStr = authority.slice(colonIdx + 1);
    } else {
      host = authority;
    }
  }

  if (portStr !== '') {
    if (!/^[0-9]{1,5}$/.test(portStr)) return { ok: false, error: 'Geçerli bir port numarası gir.' };
    const port = Number(portStr);
    if (port < 1 || port > 65535) return { ok: false, error: 'Geçerli bir port numarası gir.' };
  }

  const verdict = classifyHost(host);
  if (verdict === 'private') {
    return { ok: false, error: PRIVATE_URL_MESSAGE };
  }
  if (verdict === 'invalid') {
    return { ok: false, error: 'Geçerli bir https adresi gir.' };
  }

  return { ok: true, url: `https://${authority}${pathAndMore}` };
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
export function payloadFor(
  event: WebhookEvent,
  data: Record<string, unknown>,
  now: Date = new Date(),
  deliveryId?: string,
) {
  return deliveryId
    ? { event, timestamp: now.toISOString(), data, delivery_id: deliveryId }
    : { event, timestamp: now.toISOString(), data };
}

function newDeliveryId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const isTransientHttp = (status: number) =>
  status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function readHeaderValue(headers: unknown, lowerName: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const maybeGet = (headers as { get?: unknown }).get;
  if (typeof maybeGet === 'function') {
    const val = (maybeGet as (name: string) => string | null).call(headers, lowerName);
    return typeof val === 'string' ? val : null;
  }
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (k.toLowerCase() === lowerName && typeof v === 'string') return v;
  }
  return null;
}

export function parseRetryAfterMs(headers: unknown, nowMs: number): number | undefined {
  const raw = readHeaderValue(headers, 'retry-after');
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^[0-9]+$/.test(trimmed)) {
    const secs = Number(trimmed);
    if (!Number.isFinite(secs)) return undefined;
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, secs * 1000));
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, dateMs - nowMs));
}

type AttemptResult =
  | { ok: true }
  | { ok: false; error: string; retry: boolean; retryAfterMs?: number };

export type DeliverOptions = {
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signingSecret?: string | null;
  event?: WebhookEvent;
  deliveryId?: string;
};

/**
 * POSTs one payload, with a hard timeout and no throw.
 */
export async function deliver(
  webhook: Pick<WebhookRow, 'url' | 'headers'>,
  body: ReturnType<typeof payloadFor>,
  fetchImpl: typeof fetch = fetch,
  opts: DeliverOptions = {},
): Promise<{ ok: true } | { ok: false; error: string; retryAfterMs?: number }> {
  const attempts = opts.attempts ?? MAX_ATTEMPTS;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const started = now();
  let last: AttemptResult = { ok: false, error: 'gönderilmedi', retry: false };
  for (let i = 0; i < attempts; i += 1) {
    last = await deliverOnce(webhook, body, fetchImpl, opts, now);
    if (last.ok) return last;
    if (!last.retry || i === attempts - 1) break;
    const wait = last.retryAfterMs ?? RETRY_DELAYS_MS[i] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    if (now() - started + wait > TOTAL_BUDGET_MS) break;
    await sleep(wait);
  }
  if (last.ok) return { ok: true };
  return last.retryAfterMs !== undefined
    ? { ok: false, error: last.error, retryAfterMs: last.retryAfterMs }
    : { ok: false, error: last.error };
}

async function deliverOnce(
  webhook: Pick<WebhookRow, 'url' | 'headers'>,
  body: ReturnType<typeof payloadFor>,
  fetchImpl: typeof fetch,
  opts: DeliverOptions,
  now: () => number,
): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const raw = JSON.stringify(body);
  const nowMs = now();
  const deliveryId = opts.deliveryId ?? ('delivery_id' in body ? body.delivery_id : undefined);
  const secret = opts.signingSecret !== undefined ? opts.signingSecret : readSigningSecret(webhook);
  const eventHeader = opts.event ?? (secret ? body.event : undefined);
  const isNative = Platform.OS !== 'web';
  const unixSec = Math.floor(nowMs / 1000);

  const headers: Record<string, string> = {
    ...stripReservedHeaders(webhook.headers),
    'Content-Type': 'application/json',
    ...(isNative && eventHeader ? { 'X-Aderyth-Event': eventHeader } : {}),
    ...(isNative && deliveryId ? { 'X-Aderyth-Delivery': deliveryId } : {}),
    ...(isNative && secret
      ? { 'X-Aderyth-Signature': `t=${unixSec},v1=${hmacSha256Hex(secret, `${unixSec}.${raw}`)}` }
      : {}),
  };

  try {
    const res = await fetchImpl(webhook.url, {
      method: 'POST',
      headers,
      body: raw,
      signal: controller.signal,
      redirect: 'manual',
    });
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return { ok: false, error: 'yönlendirme reddedildi', retry: false };
    }
    if (!res.ok) {
      const retryAfterMs = parseRetryAfterMs((res as { headers?: unknown }).headers, now());
      return {
        ok: false,
        error: `HTTP ${res.status}`,
        retry: isTransientHttp(res.status),
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: msg === 'Aborted' || msg.includes('abort') ? 'zaman aşımı' : msg,
      retry: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Direct fan-out helper (kept for backwards compatibility and unit tests).
 */
export async function dispatch(
  event: WebhookEvent,
  data: Record<string, unknown>,
  deps: { fetchImpl?: typeof fetch; now?: Date; deliveryId?: string; sleep?: (ms: number) => Promise<void> } = {},
): Promise<DeliveryReport> {
  const targets = targetsFor(await registrations(), event);
  if (targets.length === 0) return { attempted: 0, delivered: 0, failed: [] };

  const body = payloadFor(event, data, deps.now, deps.deliveryId ?? newDeliveryId());
  const results = await Promise.all(
    targets.map((w) => deliver(w, body, deps.fetchImpl ?? fetch, { sleep: deps.sleep }).then((r) => ({ w, r }))),
  );

  const failed = results
    .filter((x) => !x.r.ok)
    .map((x) => ({
      url: x.w.url,
      reason: x.r.ok ? '' : x.r.error,
    }));
  return { attempted: targets.length, delivered: results.length - failed.length, failed };
}

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

type WebhookEventPayload = {
  event: WebhookEvent;
  data: Record<string, unknown>;
  webhookId: string;
};

let customFetchForTransport: typeof fetch | null = null;
/** Test hook for overriding `fetch` inside `effectChannel` transport without mutating global.fetch. */
export function setWebhookTransportFetchForTests(fn: typeof fetch | null): void {
  customFetchForTransport = fn;
}

async function webhookEventTransport(cmd: OutboxCommand): Promise<DeliveryOutcome> {
  const p = cmd.payload as Partial<WebhookEventPayload>;
  if (!p || (p.event !== 'habit_completed' && p.event !== 'task_completed') || typeof p.webhookId !== 'string') {
    return { kind: 'gone' };
  }
  const all = await registrations();
  const target = all.find((w) => w.id === p.webhookId);
  if (!target || !target.enabled || !target.event_types.includes(p.event)) {
    return { kind: 'gone' };
  }

  const data = p.data && typeof p.data === 'object' ? p.data : {};
  const body = payloadFor(p.event, data, new Date(cmd.createdAt), cmd.operationId);
  const res = await deliver(target, body, customFetchForTransport ?? fetch, {
    attempts: 1,
    event: p.event,
    deliveryId: cmd.operationId,
  });
  if (res.ok) return { kind: 'applied' };
  if (res.error === 'yönlendirme reddedildi') {
    return { kind: 'rejected', error: res.error };
  }
  if (res.error.startsWith('HTTP ')) {
    const code = Number(res.error.slice(5));
    if (isTransientHttp(code)) {
      return {
        kind: 'retryable',
        error: res.error,
        ...(res.retryAfterMs !== undefined ? { retryAfterMs: res.retryAfterMs } : {}),
      };
    }
    return { kind: 'rejected', error: res.error };
  }
  return {
    kind: 'retryable',
    error: res.error,
    ...(res.retryAfterMs !== undefined ? { retryAfterMs: res.retryAfterMs } : {}),
  };
}

export const effectChannel = createOutboxChannel({
  storage: asyncStorageOutboxNs('effect'),
  transports: { [WEBHOOK_EVENT_ENTITY]: webhookEventTransport },
  currentUserId: async () => (await currentUser())?.id ?? null,
  policies: ENTITY_POLICIES,
  registerStorage: {
    name: 'effect',
    keysFor: (uid) => [namespacedOutboxKey('effect', uid)],
  },
});

outboxEngine.register('effect', effectChannel);

export async function enqueueWebhookEvent(params: {
  event: WebhookEvent;
  subjectKey: string;
  data: Record<string, unknown>;
}): Promise<{ queued: number }> {
  const targets = targetsFor(await registrations(), params.event);
  if (targets.length === 0) {
    // Zero targets -> never touch AsyncStorage for accounts without webhooks.
    return { queued: 0 };
  }
  let queued = 0;
  for (const w of targets) {
    const opId = webhookOperationId(params.event, params.subjectKey, w.id);
    const res = await effectChannel.write(
      {
        entity: WEBHOOK_EVENT_ENTITY,
        entityId: opId,
        kind: 'update',
        payload: {
          event: params.event,
          data: params.data,
          webhookId: w.id,
        },
      },
      { operationId: opId },
    );
    if (res.ok) queued += 1;
  }
  return { queued };
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

/** Registration, refusing locally what the database or private-network check refuses, and issuing a 32-byte signing secret. */
export async function registerWebhook(input: { url: string; eventTypes?: WebhookEvent[] }): Promise<
  | { ok: true; data: WebhookRow; signingSecret: string }
  | { ok: false; error: string }
> {
  const checked = validateWebhookUrl(input.url);
  if (!checked.ok) return { ok: false, error: checked.error };
  const secret = randomHex(32);
  const res = await insertWebhook({
    url: checked.url,
    eventTypes: input.eventTypes,
    headers: { [SIGNING_SECRET_KEY]: secret },
  });
  resetWebhookCache();
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: res.data, signingSecret: secret };
}

/**
 * Fire-and-forget durable notification for a completion.
 *
 * Enqueues into `effectChannel` so offline completions, transient 5xxs, and app restarts
 * never drop a webhook, while `webhookOperationId` deduplicates replays for 14 days.
 */
export function notify(
  event: WebhookEvent,
  data: Record<string, unknown>,
  opts?: { subjectKey?: string; deliveryId?: string },
): void {
  const subjectKey = opts?.subjectKey ?? opts?.deliveryId ?? newDeliveryId();
  void enqueueWebhookEvent({ event, subjectKey, data }).catch(() => undefined);
}
