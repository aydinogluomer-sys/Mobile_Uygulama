/**
 * R08.01 — which keys of THIS device's storage belong in a backup.
 *
 * An allowlist, never "everything": the same storage also holds login
 * sessions (Notion, the Supabase auth session), the offline queues and
 * transient timer state. Only the user's own settings and the device-local
 * data that has no server table yet go out:
 *
 *   moods.v1.<uid>            named moods and check-ins (until migration 031)
 *   routine.v1.<uid>          routine templates, history (until migration 030)
 *   review.actions.v1.<uid>   weekly review next actions (until migration 031)
 *   journal.draft.v1.<uid>.*  unsaved journal drafts
 *   focus.settings.v1, reminders.settings.v1, app_theme_dark,
 *   app_seasonal_motion, app_accent   display and reminder preferences
 *
 * Another account's keys never match (the uid is part of the key).
 */
const SETTINGS = new Set(['focus.settings.v1', 'reminders.settings.v1', 'app_theme_dark', 'app_seasonal_motion', 'app_accent']);

export function isDeviceExportKey(key: string, userId: string): boolean {
  if (!userId) return false;
  if (SETTINGS.has(key)) return true;
  return key === `moods.v1.${userId}`
    || key === `routine.v1.${userId}`
    || key === `review.actions.v1.${userId}`
    || key.startsWith(`journal.draft.v1.${userId}.`);
}

export type DeviceEntry = { key: string; value: unknown };

/** Parsed values in key order (stable checksum); unreadable JSON is kept as the raw string. */
export function deviceEntries(pairs: readonly (readonly [string, string | null])[], userId: string): DeviceEntry[] {
  return pairs
    .filter(([k, v]) => v !== null && isDeviceExportKey(k, userId))
    .map(([key, v]) => { let value: unknown = v; try { value = JSON.parse(v as string); } catch { /* keep raw */ } return { key, value }; })
    .sort((a, b) => a.key.localeCompare(b.key));
}
