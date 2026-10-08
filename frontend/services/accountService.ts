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
import { useAiConversationStore } from '../store/aiConversationStore';
import { useTaskStore } from '../store/taskStore';
import { useLogStore } from '../store/logStore';
import { useJournalStore } from '../store/journalStore';
import { useNoteStore } from '../store/noteStore';
import { useRecoveryStore } from '../store/recoveryStore';
import { coreOutbox } from './coreOutbox';
import { useRoutineRunnerStore } from '../store/routineRunnerStore';
import { useMoodStore } from '../store/moodStore';
import { listScheduled, cancelScheduled } from '../lib/notifications';
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
 * Named explicitly in the doc rather than only in code because the list is the
 * claim: the offline log queue, the Notion login session, monthly-review
 * drafts, the focus settings and the AI Coach's last-open thread all carry
 * user content or user-scoped identifiers.
 */
async function clearLocalState(): Promise<void> {
  // R02.06 / R10.04 — memory first: a delivery still running must not write
  // the deleted account's outbox back after the device copy is removed.
  try { coreOutbox.reset(); } catch { /* not loaded */ }
  try { useTaskStore.getState().resetForAccount(); } catch { /* not mounted */ }
  try { useJournalStore.setState({ entries: [] }); useNoteStore.setState({ notes: [], cursor: null, hasMore: false, error: null }); } catch { /* not mounted */ }
  try { useRecoveryStore.setState({ plans: [] }); useLogStore.setState({ logs: [], pendingSyncCount: 0, deadSyncCount: 0 }); } catch { /* not mounted */ }
  // `userId: null` first: both stores only persist while they know their owner,
  // so nothing they hold can be written back after the wipe below.
  try { useRoutineRunnerStore.setState({ userId: null, templates: [], session: null, logged: [], history: [], error: null }); } catch { /* not mounted */ }
  try { useMoodStore.setState({ userId: null, definitions: [], checkins: [] }); } catch { /* not mounted */ }
  // The person is gone: no reminder of theirs may fire on this phone again
  // (habit reminders, snoozes, recovery-plan reminders).
  try { await cancelScheduled((await listScheduled()).map((n) => n.identifier)); } catch { /* nothing scheduled / no permission */ }
  try {
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter((k) => !DEVICE_PREFERENCE_KEYS.has(k));
    if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
  } catch {
    // A device that cannot clear its cache is not a reason to tell the user
    // the server deletion failed -- it did not. The session still ends below,
    // and the rows are already gone.
  }
  // In-memory, and the one store that holds message text rather than ids.
  try { useAiConversationStore.getState().reset(); } catch { /* store not mounted */ }
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
  await clearLocalState();
  try { await supabase.auth.signOut(); } catch { /* the account is gone regardless */ }

  return { ok: true, data: true };
}
