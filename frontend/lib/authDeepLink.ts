import { useState } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

/**
 * F22 (NAV-07, GAP2-08): where the e-mail links point, and the ONE place that spends the
 * session material a link carries.
 *
 * `lib/supabase.ts` runs with `detectSessionInUrl: false`, so neither supabase-js nor any
 * screen reads tokens out of a URL by itself: every platform comes through
 * `establishSessionFromAuthUrl`. That keeps a single-use PKCE `?code=` from being spent
 * twice (once by the client, once by the screen) and lets the native app, which never had
 * a URL reader, open the recovery form from the fallback link in the mail.
 *
 * Token values are never written to a message, a log line or an error object.
 */

export type AuthLinkKind = 'recovery' | 'signup' | 'other';
export type OtpLinkType = 'recovery' | 'signup' | 'email' | 'magiclink' | 'email_change' | 'invite';
export type ParsedAuthLink =
  | { ok: true; kind: AuthLinkKind; method: 'tokens'; accessToken: string; refreshToken: string }
  | { ok: true; kind: AuthLinkKind; method: 'code'; code: string }
  | { ok: true; kind: AuthLinkKind; method: 'token_hash'; tokenHash: string; otpType: OtpLinkType }
  | { ok: false; reason: 'empty' | 'no_auth_params' | 'link_error'; description?: string };

const OTP_LINK_TYPES: readonly OtpLinkType[] = ['recovery', 'signup', 'email', 'magiclink', 'email_change', 'invite'];

const RESET_ROUTE = 'reset-password';
const LOGIN_ROUTE = 'login';

const EXPIRED_LINK_MESSAGE = 'Bağlantının süresi dolmuş ya da daha önce kullanılmış. Yeni bir kod isteyip tekrar dene.';
const NETWORK_LINK_MESSAGE = 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.';
const GENERIC_LINK_MESSAGE = 'Bağlantı doğrulanamadı. Yeni bir kod isteyip tekrar dene.';
const WRONG_KIND_MESSAGE = 'Bu bağlantı şifre sıfırlama bağlantısı değil. Giriş ekranından devam et.';

function isWeb(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

/** A malformed percent sequence never throws; the raw value is kept. */
function decodePart(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

function readPairs(part: string, into: Record<string, string>): void {
  for (const piece of part.split('&')) {
    if (!piece) continue;
    const eq = piece.indexOf('=');
    const key = decodePart(eq === -1 ? piece : piece.slice(0, eq));
    const value = eq === -1 ? '' : decodePart(piece.slice(eq + 1));
    if (key) into[key] = value;
  }
}

/**
 * Hand-rolled on purpose: `new URL` / `URLSearchParams` behave differently on Hermes for a
 * custom scheme and for fragments. Query and fragment are merged and the fragment wins.
 * Priority: tokens > code > token_hash. A lone access_token is not accepted.
 */
export function parseAuthUrl(url: string | null | undefined): ParsedAuthLink {
  const text = (url ?? '').trim();
  if (!text) return { ok: false, reason: 'empty' };

  const hashAt = text.indexOf('#');
  const beforeHash = hashAt === -1 ? text : text.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : text.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf('?');
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);

  const params: Record<string, string> = {};
  readPairs(query, params);
  readPairs(fragment, params);

  if (params.error || params.error_code || params.error_description) {
    return {
      ok: false,
      reason: 'link_error',
      description: params.error_description || params.error_code || params.error,
    };
  }

  const type = params.type;
  const kind: AuthLinkKind = type === 'recovery' ? 'recovery' : type === 'signup' ? 'signup' : 'other';

  if (params.access_token && params.refresh_token) {
    return { ok: true, kind, method: 'tokens', accessToken: params.access_token, refreshToken: params.refresh_token };
  }
  if (params.code) {
    return { ok: true, kind, method: 'code', code: params.code };
  }
  if (params.token_hash && (OTP_LINK_TYPES as readonly string[]).includes(type)) {
    return { ok: true, kind, method: 'token_hash', tokenHash: params.token_hash, otpType: type as OtpLinkType };
  }
  return { ok: false, reason: 'no_auth_params' };
}

/** Always a fixed Turkish sentence: the raw server description is never shown. */
export function authLinkErrorMessage(description?: string): string {
  const d = (description ?? '').toLowerCase();
  if (!d.trim() || d.includes('expired') || d.includes('otp_expired') || d.includes('invalid') || d.includes('access_denied')) {
    return EXPIRED_LINK_MESSAGE;
  }
  if (d.includes('failed to fetch') || d.includes('network')) return NETWORK_LINK_MESSAGE;
  return GENERIC_LINK_MESSAGE;
}

type AuthResult = Promise<{ error: { message: string } | null }>;
export type AuthClientLike = {
  setSession(s: { access_token: string; refresh_token: string }): AuthResult;
  exchangeCodeForSession(code: string): AuthResult;
  verifyOtp(p: { token_hash: string; type: OtpLinkType }): AuthResult;
};
export type EstablishResult =
  | { ok: true; kind: AuthLinkKind }
  | { ok: false; reason: 'empty' | 'no_auth_params' | 'link_error' | 'wrong_kind' | 'rejected'; message: string };

const MAX_INFLIGHT = 4;
const inflight = new Map<string, Promise<EstablishResult>>();

async function spend(parsed: Extract<ParsedAuthLink, { ok: true }>, auth: AuthClientLike): Promise<EstablishResult> {
  let answer: { error: { message: string } | null };
  try {
    if (parsed.method === 'tokens') {
      answer = await auth.setSession({ access_token: parsed.accessToken, refresh_token: parsed.refreshToken });
    } else if (parsed.method === 'code') {
      answer = await auth.exchangeCodeForSession(parsed.code);
    } else {
      answer = await auth.verifyOtp({ token_hash: parsed.tokenHash, type: parsed.otpType });
    }
  } catch (e) {
    return { ok: false, reason: 'rejected', message: authLinkErrorMessage(e instanceof Error ? e.message : '') };
  }
  if (answer?.error) {
    return { ok: false, reason: 'rejected', message: authLinkErrorMessage(answer.error.message) };
  }
  stripAuthParamsFromWebUrl();
  return { ok: true, kind: parsed.kind };
}

/**
 * Concurrent or repeated calls for the same URL share ONE request (React 19 double effects,
 * `useURL` re-renders). A failed result is forgotten so the link can be retried; at most
 * four URLs are remembered, so strings holding tokens do not stay in memory for long.
 */
export function establishSessionFromAuthUrl(
  url: string | null | undefined,
  auth: AuthClientLike,
  opts?: { expect?: 'recovery' },
): Promise<EstablishResult> {
  const parsed = parseAuthUrl(url);
  if (!parsed.ok) {
    return Promise.resolve({
      ok: false,
      reason: parsed.reason,
      message: parsed.reason === 'link_error' ? authLinkErrorMessage(parsed.description) : '',
    });
  }
  if (opts?.expect === 'recovery' && parsed.kind === 'signup') {
    return Promise.resolve({ ok: false, reason: 'wrong_kind', message: WRONG_KIND_MESSAGE });
  }

  const key = (url ?? '').trim();
  const existing = inflight.get(key);
  if (existing) return existing;

  const pending = spend(parsed, auth).then((result) => {
    if (!result.ok) inflight.delete(key);
    return result;
  });
  inflight.set(key, pending);
  while (inflight.size > MAX_INFLIGHT) {
    const oldest = inflight.keys().next().value;
    if (oldest === undefined) break;
    inflight.delete(oldest);
  }
  return pending;
}

/** Web: `${origin}/reset-password`; native: the app scheme from Linking.createURL. */
export function recoveryRedirectUrl(): string {
  if (isWeb()) return `${window.location.origin}/${RESET_ROUTE}`;
  return Linking.createURL(RESET_ROUTE);
}

/** Web: `${origin}/login`; native: the app scheme from Linking.createURL. */
export function confirmationRedirectUrl(): string {
  if (isWeb()) return `${window.location.origin}/${LOGIN_ROUTE}`;
  return Linking.createURL(LOGIN_ROUTE);
}

/** Web only: drops query and fragment so tokens stay out of the address bar and history. */
export function stripAuthParamsFromWebUrl(): void {
  if (!isWeb()) return;
  const loc = window.location;
  if (!loc || !window.history?.replaceState) return;
  const title = typeof document !== 'undefined' ? document.title : '';
  window.history.replaceState({}, title, `${loc.origin}${loc.pathname}`);
}

/**
 * Native: `Linking.useURL()` (null on the first render of a cold start). Web: the address
 * as it was on the first render, pinned so a page whose location changes later is not
 * spent a second time.
 */
export function useAuthLinkUrl(): string | null {
  const nativeUrl = Linking.useURL();
  // Lazy state initialiser = read once on the first render and pinned (a ref read during
  // render is rejected by react-hooks/refs).
  const [webUrl] = useState<string | null>(() => (isWeb() ? window.location.href : null));
  return isWeb() ? webUrl : nativeUrl ?? null;
}
