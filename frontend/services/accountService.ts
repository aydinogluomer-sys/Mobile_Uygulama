/**
 * Deleting the account, in the order that cannot lie to the user.
 *
 * ## Why this is a store requirement, not a nice-to-have
 *
 * Aderyth lets a person create an account inside the app. Both stores then
 * require that the same person can delete it inside the app -- not deactivate
 * it, not sign out of it, and not email someone to ask.
 *
 * ## The order
 *
 *   1 ask the server to delete   2 only if that succeeded, clear the device
 *   3 end the session            4 the root layout routes to (auth)
 *
 * Step 1 before step 2 is the whole point. Clearing local state first would
 * show a signed-out screen whether or not anything was deleted, and the user
 * would have no session left to try again with -- they would believe their
 * data was gone while it sat on the server. So nothing local is touched until
 * the server has said `ok`.
 *
 * ## What the client is trusted with
 *
 * Nothing. The edge function derives the account from the verified JWT and
 * never reads the request body, so this module has no `user_id` to pass and
 * no way to name anyone else. See `supabase/functions/delete-account`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { withEdgeDeadline } from '../lib/edgeCall';
import { useTaskStore } from '../store/taskStore';
import { useLogStore } from '../store/logStore';
import { coreOutbox } from './coreOutbox';
import { flushAllOutboxes } from './unifiedOutbox';
// F04 — one account boundary: every registered store, module map, the read cache, reminders, keys.
import { endAccountScope } from '../lib/accountScope';
import { currentUser } from '../lib/session';
// F06: an offline sign-out (see signOutLocal)
import { isRetryableAuthError } from '../lib/bootSession';
import { authStorage } from '../lib/authStorage';
import { AUTH_STORAGE_KEY } from '../lib/authStorageKey';
import type { RepoResult } from '../repositories/shared';

/**
 * Device-level display preferences, kept across a deletion.
 *
 * These are the ONLY keys treated as not-personal: they describe how this
 * phone renders, not who was using it. Everything else AsyncStorage holds is
 * removed, including keys added later by code that has not been written yet --
 * for a deletion path, the safe default for an unrecognised key is to delete
 * it, not to keep it.
 */
const DEVICE_PREFERENCE_KEYS = new Set(['app_theme_dark', 'app_seasonal_motion', 'app_accent']);

/**
 * Everything this device remembered about the person who just left.
 *
 * F04: memory, the read cache (this user's rows and, for a deletion, every user's), the reminders
 * and the account's own keys go through the one registry (`lib/accountScope.ts`), the same path a
 * sign-out takes; there is no second, hand-written list here to fall behind. Then the whole of
 * AsyncStorage is swept except the display preferences: the offline log queue, the Notion login
 * session, monthly-review drafts, the focus settings and the AI Coach's last-open thread all carry
 * user content or user-scoped identifiers.
 */
async function clearLocalState(userId: string): Promise<void> {
  // R02.06 / R10.04 — memory first (inside endAccountScope, synchronously): a delivery still running
  // must not write the deleted account's outbox back after the device copy is removed, and stores
  // that persist only while they know their owner (mood, routine runner) forget the owner first.
  await endAccountScope('account_deleted', userId);
  try {
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter((k) => !DEVICE_PREFERENCE_KEYS.has(k));
    if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
  } catch {
    // A device that cannot clear its cache is not a reason to tell the user
    // the server deletion failed -- it did not. The session still ends below,
    // and the rows are already gone.
  }
}

/**
 * R02.06 — changes made on this device that the server has not received yet
 * (habit logs, tasks, journal, notes, recovery plans, focus sessions). The
 * delete confirmation states this number: deleting the account also deletes
 * them, and the user is told so instead of finding out afterwards.
 */
export function unsentChangeCount(): number {
  let n = 0;
  try { n += coreOutbox.sync().pending + coreOutbox.sync().dead + coreOutbox.sync().conflict; } catch { /* none */ }
  try { const t = useTaskStore.getState().sync; n += t.pending + t.dead + t.conflict; } catch { /* none */ }
  try { const l = useLogStore.getState(); n += l.pendingSyncCount + l.deadSyncCount; } catch { /* none */ }
  return n;
}

/**
 * Delete the signed-in account and everything it owns.
 *
 * Returns `{ ok: true }` only after the server confirmed. The caller may then
 * show a terminal message; it must not show one before.
 */
export async function deleteAccount(): Promise<RepoResult<true>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: 'Oturum bulunamadı. Lütfen tekrar giriş yap.' };

  let ok = false;
  try {
    // Under a deadline like every other edge call. A delete that hangs is the
    // worst one to leave spinning: the user does not know whether their
    // account is gone, and the honest answer is "it timed out, try again" --
    // which is safe, because the function is idempotent from the caller's side
    // (a second attempt with a still-valid session either deletes or 401s).
    const { data, error } = await withEdgeDeadline('Hesap silme', (signal) =>
      supabase.functions.invoke('delete-account', { signal, body: {} }));
    if (error) {
      // The function's own message when it has one; otherwise a sentence the
      // user can act on. Never a stack trace.
      let message = 'Hesap silinemedi, lütfen tekrar deneyin.';
      try {
        const body = await (error as { context?: { json?: () => Promise<{ error?: string }> } })
          .context?.json?.();
        if (body?.error) message = body.error;
      } catch { /* keep the default */ }
      return { ok: false, error: message };
    }
    ok = data?.ok === true;
  } catch {
    return { ok: false, error: 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.' };
  }

  if (!ok) return { ok: false, error: 'Hesap silinemedi, lütfen tekrar deneyin.' };

  // Server said yes. Now, and only now, the device forgets.
  await clearLocalState(session.user.id);
  try { await supabase.auth.signOut(); } catch { /* the account is gone regardless */ }

  return { ok: true, data: true };
}

// ---------------------------------------------------------------------------
// F04 (NAV-02, SYN-22) — signing out of THIS device, on purpose
// ---------------------------------------------------------------------------

const SYNC_FIRST_DEADLINE_MS = 6000;

/**
 * Ends the session on this device only (`scope: 'local'`: other devices stay signed in, and it works
 * offline), then clears what the account left in memory, in the read cache and in its transient keys.
 * Unsent work is NOT removed: it stays under the account's own key and is sent when the same account
 * signs in again. Nothing is cleared when the sign-out itself failed: no false success.
 */
export async function signOutLocal(): Promise<RepoResult<true>> {
  const uid = (await currentUser())?.id ?? null;
  let failed = false;
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    // F06 (NAV-04): auth-js 2.107 still calls POST /logout for scope 'local' (and an expired token
    // first tries a refresh), so offline this answered AuthRetryableFetchError and nobody could sign
    // out without a connection -- including from the onboarding gate, whose escape this is.
    failed = !!error && !(isRetryableAuthError(error) && (await forgetSessionOnDevice()));
  } catch {
    failed = true;
  }
  if (failed) return { ok: false, error: 'Oturum kapatılamadı, lütfen tekrar dene.' };
  await endAccountScope('signed_out', uid);
  return { ok: true, data: true };
}

/**
 * F06: the local half of a sign-out when the auth server cannot be reached. The stored session is
 * removed first; the second `signOut` then finds no session, makes no request, and auth-js clears
 * its own state and emits SIGNED_OUT (the root layout routes to the login screen). The refresh
 * token is not revoked on the server (that needs the network); it no longer exists on this device.
 */
async function forgetSessionOnDevice(): Promise<boolean> {
  try {
    await authStorage.removeItem(AUTH_STORAGE_KEY);
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    return !error;
  } catch {
    return false;
  }
}

/**
 * The Settings action. With `syncFirst` (the default) and unsent changes, one delivery attempt is
 * made first, for at most six seconds; offline it simply moves on. Its result never blocks the
 * sign-out: whatever is still unsent stays on the device for this account.
 */
export async function signOutCurrentAccount(opts?: { syncFirst?: boolean }): Promise<RepoResult<true>> {
  if (opts?.syncFirst !== false && unsentChangeCount() > 0) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        flushAllOutboxes().then(() => undefined, () => undefined),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, SYNC_FIRST_DEADLINE_MS); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return signOutLocal();
}

/**
 * What the confirmation says about unsent work (pure; the modal and the tests share it). Informs,
 * never alarms: the changes are not lost, they wait on this device for the same account.
 */
export function signOutNotice(unsent: number): string | null {
  if (!Number.isFinite(unsent) || unsent <= 0) return null;
  return `Henüz eşitlenmemiş ${Math.floor(unsent)} değişiklik var. Eşitlenmeden çıkarsan bu değişiklikler bu cihazda kalır; aynı hesapla tekrar girince gönderilir.`;
}
