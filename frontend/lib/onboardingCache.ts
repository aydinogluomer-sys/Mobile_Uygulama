/**
 * F06 (NAV-04, PRF-06) — the last known TERMINAL onboarding status of a user, on this device.
 *
 * A signed-in user who opened the app in airplane mode saw "Hesabın hazırlanamadı" and nothing
 * else: the onboarding row lives on the server and the router will not guess (store/onboardingStore.ts,
 * "unknown is not pending"). That stays fail-closed. What changes: a user whose row was already read
 * as `completed`, `legacy` or `skipped` — states that never route anywhere but Today — is let in
 * from this copy while the server is unreachable. `pending` and `installing` are never cached (they
 * route into onboarding and must come from the server), and writing one REMOVES an older terminal
 * copy so a stale `completed` cannot outlive it. The server always wins once it answers.
 *
 * One key per user (`aderyth.onboarding.status.v1:<uid>`), holding only the status constant (no
 * answers, nothing personal). It is registered with the account boundary (lib/accountScope.ts) and
 * removed when that account signs out, changes, or is deleted.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerAccountStorage } from './accountScope';
import type { OnboardingStatus } from './onboarding';

export const ONBOARDING_CACHE_VERSION = 1 as const;
export type CacheableOnboardingStatus = 'completed' | 'legacy' | 'skipped';

export type OnboardingStatusCache = {
  v: typeof ONBOARDING_CACHE_VERSION;
  userId: string;
  status: CacheableOnboardingStatus;
  /** ISO time stamp, for diagnosis only; never used to compute an age (no time zone or DST effect). */
  at: string;
};

export function onboardingCacheKey(userId: string): string {
  return `aderyth.onboarding.status.v1:${userId}`;
}

export function isCacheableStatus(value: unknown): value is CacheableOnboardingStatus {
  return value === 'completed' || value === 'legacy' || value === 'skipped';
}

/** Corrupt JSON, another user's record, an unknown version or a non-terminal status => null. Never throws. */
export async function readCachedOnboardingStatus(userId: string): Promise<OnboardingStatusCache | null> {
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(onboardingCacheKey(userId));
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<OnboardingStatusCache> | null;
    if (!c || typeof c !== 'object') return null;
    if (c.v !== ONBOARDING_CACHE_VERSION || c.userId !== userId || !isCacheableStatus(c.status)) return null;
    return { v: ONBOARDING_CACHE_VERSION, userId, status: c.status, at: typeof c.at === 'string' ? c.at : '' };
  } catch {
    return null;
  }
}

/** A terminal status is written; `pending` / `installing` / `unknown` REMOVE the old record. Never throws. */
export async function writeCachedOnboardingStatus(userId: string, status: OnboardingStatus | 'unknown'): Promise<void> {
  if (!userId) return;
  try {
    if (!isCacheableStatus(status)) {
      await AsyncStorage.removeItem(onboardingCacheKey(userId));
      return;
    }
    const record: OnboardingStatusCache = { v: ONBOARDING_CACHE_VERSION, userId, status, at: new Date().toISOString() };
    await AsyncStorage.setItem(onboardingCacheKey(userId), JSON.stringify(record));
  } catch {
    // a cache that cannot be written is only a cache: the next cold start without a connection shows the gate
  }
}

export async function clearCachedOnboardingStatus(userId: string): Promise<void> {
  if (!userId) return;
  try { await AsyncStorage.removeItem(onboardingCacheKey(userId)); } catch { /* best effort */ }
}

// F04 registry: removed on sign-out, on an account change and on deletion (`transient`), so the next
// account on this phone never starts from this one's status.
registerAccountStorage({ name: 'onboarding.statusCache', transient: true, keysFor: (uid) => [onboardingCacheKey(uid)] });
