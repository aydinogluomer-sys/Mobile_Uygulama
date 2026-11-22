// Yerel bildirimler — expo-notifications. (R04)
//
// KD-04: her alışkanlık için takvimden bağımsız TEK bir DAILY tetik vardı.
// Artık alışkanlık hatırlatıcıları `lib/reminderPlan.ts`'in planından gelen
// TEK SEFERLİK tetiklerdir ve `services/reminderService.reconcileReminders`
// ile uzlaştırılır. Bu dosya yalnız işletim sistemi tarafıdır: izin, kanal,
// kategori (eylem düğmeleri), listeleme, planlama ve iptal.
//
// `scheduleHabitReminder` / `cancelHabitReminder` / `syncAllReminders`
// adları korunur (store'lar bunları çağırıyor) ama artık doğrudan tetik
// kurmazlar: kayıtlı uzlaştırıcıdan bir uzlaştırma isterler. Uzlaştırıcı
// `app/_layout.tsx`'te kaydedilir; kaydedilmemişse (testler) hiçbir şey olmaz.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Habit } from './supabase';
import { parseTime, type PlannedReminder, type ReminderSettings } from './reminderPlan';
import { CATEGORY_BINARY, CATEGORY_MEASURE, SNOOZE_MINUTES } from './notificationActions';
import type { FocusPhase } from './focusTimer';

export const HABIT_CHANNEL = 'habit-reminders';
export const FOCUS_CHANNEL = 'focus-timer';
export const FOCUS_END_KIND = 'focus-end';
export type FocusEndKind = 'work' | 'break';
export const focusEndId = (kind: FocusEndKind): string => `${FOCUS_END_KIND}-${kind}`;
export function focusEndKindOf(phase: FocusPhase): FocusEndKind {
  return phase === 'work' ? 'work' : 'break';
}

// Ön planda da bildirim gösterilsin
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let permissionAsked = false;
let channelReady = false;

/**
 * R04.04 — the Android channel is created whatever the permission state.
 * It used to be created only on the path that REQUESTED permission, so on a
 * device where permission was already granted the channel never existed.
 */
export async function ensureChannel(): Promise<void> {
  if (channelReady || Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(HABIT_CHANNEL, {
      name: 'Alışkanlık Hatırlatıcıları',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync(FOCUS_CHANNEL, {
      name: 'Odak Bitişi',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200, 120, 200],
    });
    channelReady = true;
  } catch { /* yeniden denenir */ }
}

export async function ensurePermission(): Promise<boolean> {
  await ensureChannel();
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) return true;
    if (permissionAsked && settings.status === 'denied') return false;
    permissionAsked = true;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

/** Has the user granted notifications? Read only -- never prompts. */
export async function hasPermission(): Promise<boolean> {
  try { return (await Notifications.getPermissionsAsync()).granted; } catch { return false; }
}

/** R04.03 — the action buttons on a reminder. */
export async function ensureCategories(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(CATEGORY_BINARY, [
      { identifier: 'done', buttonTitle: 'Tamamla', options: { opensAppToForeground: true } },
      { identifier: 'snooze', buttonTitle: `${SNOOZE_MINUTES} dk ertele`, options: { opensAppToForeground: true } },
      { identifier: 'skip', buttonTitle: 'Bugünü atla', options: { opensAppToForeground: true } },
    ]);
    await Notifications.setNotificationCategoryAsync(CATEGORY_MEASURE, [
      { identifier: 'measure', buttonTitle: 'Miktar gir', options: { opensAppToForeground: true } },
      { identifier: 'snooze', buttonTitle: `${SNOOZE_MINUTES} dk ertele`, options: { opensAppToForeground: true } },
      { identifier: 'skip', buttonTitle: 'Bugünü atla', options: { opensAppToForeground: true } },
    ]);
  } catch { /* kategori yoksa bildirim yine gelir, yalnız düğmesiz */ }
}

export async function listScheduled(): Promise<{ identifier: string; data: Record<string, unknown> | null }[]> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return all.map((n) => ({ identifier: n.identifier, data: (n.content?.data ?? null) as Record<string, unknown> | null }));
  } catch {
    return [];
  }
}

export async function cancelScheduled(ids: readonly string[]): Promise<void> {
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
}

/** The lock-screen title: the habit's name, unless the user hid titles. */
export function reminderTitle(habitName: string, settings: Pick<ReminderSettings, 'hideTitles'>): string {
  return settings.hideTitles ? 'Hatırlatıcı' : habitName;
}

export async function scheduleReminder(p: PlannedReminder, habit: Pick<Habit, 'name'>, measurable: boolean, settings: ReminderSettings): Promise<boolean> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: reminderTitle(habit.name, settings),
        body: settings.hideTitles ? 'Bir alışkanlığın zamanı.' : 'Alışkanlık zamanı.',
        data: { kind: 'habit', key: p.key, habitId: p.habitId, day: p.day },
        categoryIdentifier: measurable ? CATEGORY_MEASURE : CATEGORY_BINARY,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: p.at,
        ...(Platform.OS === 'android' ? { channelId: HABIT_CHANNEL } : {}),
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** R04.03 — snooze: the same reminder once more, SNOOZE_MINUTES from now. */
export async function scheduleSnooze(habitId: string, day: string, title: string, measurable: boolean, now: Date = new Date()): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: 'Ertelenen hatırlatıcı.',
        data: { kind: 'snooze', habitId, day },
        categoryIdentifier: measurable ? CATEGORY_MEASURE : CATEGORY_BINARY,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(now.getTime() + SNOOZE_MINUTES * 60_000),
        ...(Platform.OS === 'android' ? { channelId: HABIT_CHANNEL } : {}),
      },
    });
  } catch { /* sessiz geç */ }
}

// ── Uzlaştırma isteği (eski adlar) ─────────────────────────────────────────

let reconciler: (() => Promise<unknown>) | null = null;

/** Registered once by the root layout: runs a full reconcile. */
export function registerReminderReconciler(fn: (() => Promise<unknown>) | null): void {
  reconciler = fn;
}

function requestReconcile(): Promise<void> {
  return reconciler ? reconciler().then(() => undefined, () => undefined) : Promise.resolve();
}

/** A habit's reminder changed: re-plan everything (one-off triggers, not a DAILY). */
export async function scheduleHabitReminder(_habit: Habit): Promise<void> { await requestReconcile(); }
/** A habit stopped being remindable: re-plan everything. */
export async function cancelHabitReminder(_habitId: string): Promise<void> { await requestReconcile(); }
/** Re-plan everything. */
export async function syncAllReminders(_habits: Habit[]): Promise<void> { await requestReconcile(); }

// ── Telafi hatırlatıcısı (tek seferlik, belirli gün+saat) ──────────────
export async function cancelRecoveryReminder(planId: string): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.content?.data?.recoveryId === planId)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
  } catch {
    /* sessiz geç */
  }
}

export async function scheduleRecoveryReminder(
  planId: string,
  habitName: string,
  targetDate: string,   // 'yyyy-MM-dd'
  time: string,         // 'HH:mm'
): Promise<void> {
  await cancelRecoveryReminder(planId);
  const parsed = parseTime(time);
  if (!parsed) return;

  const [y, mo, d] = targetDate.split('-').map((n) => parseInt(n, 10));
  if (!y || !mo || !d) return;
  const when = new Date(y, mo - 1, d, parsed.hour, parsed.minute, 0, 0);
  // Geçmişe tarih düşerse planlama yapma
  if (when.getTime() <= Date.now()) return;

  const granted = await ensurePermission();
  if (!granted) return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Telafi: ${habitName}`,
        body: 'Bugün telafi etme zamanı 🔁',
        data: { recoveryId: planId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
        ...(Platform.OS === 'android' ? { channelId: HABIT_CHANNEL } : {}),
      },
    });
  } catch {
    /* sessiz geç */
  }
}

// ── F16: Odak bitiş bildirimi (tek seferlik, sabit kimlikli, sessiz öncelik) ──

export function focusEndContent(phase: FocusPhase, plannedSeconds: number): { title: string; body: string } {
  if (phase === 'work') {
    const minutes = Math.max(1, Math.round(plannedSeconds / 60));
    return { title: 'Odak tamam', body: `${minutes} dk bitti. Hazır olduğunda mola ver ya da devam et.` };
  }
  return { title: 'Mola bitti', body: 'Hazır olduğunda odağa dönebilirsin; acele yok.' };
}

export async function scheduleFocusEnd(p: {
  phase: FocusPhase;
  endsAtMs: number;
  plannedSeconds: number;
  withSound: boolean;
  now?: number;
}): Promise<boolean> {
  if (p.endsAtMs <= (p.now ?? Date.now()) + 1000) return false;
  if (!(await hasPermission())) return false;
  await ensureChannel();
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: focusEndId(focusEndKindOf(p.phase)),
      content: {
        ...focusEndContent(p.phase, p.plannedSeconds),
        sound: p.withSound,
        data: { kind: FOCUS_END_KIND, phase: p.phase },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(p.endsAtMs),
        ...(Platform.OS === 'android' ? { channelId: FOCUS_CHANNEL } : {}),
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelFocusEnd(kind?: FocusEndKind): Promise<void> {
  const kinds: FocusEndKind[] = kind ? [kind] : ['work', 'break'];
  await Promise.all(
    kinds.map(async (k) => {
      const id = focusEndId(k);
      try { await Notifications.cancelScheduledNotificationAsync(id); } catch { /* yoksay */ }
      try { await Notifications.dismissNotificationAsync(id); } catch { /* yoksay */ }
    }),
  );
}
