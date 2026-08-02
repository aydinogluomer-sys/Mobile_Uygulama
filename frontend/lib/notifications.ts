// Yerel hatırlatıcı bildirimleri — expo-notifications
// Günlük tekrarlı tetik; her alışkanlık için tek bildirim.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Habit } from './supabase';

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

export async function ensurePermission(): Promise<boolean> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) return true;
    if (permissionAsked && settings.status === 'denied') return false;
    permissionAsked = true;
    const req = await Notifications.requestPermissionsAsync();
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('habit-reminders', {
        name: 'Alışkanlık Hatırlatıcıları',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    return req.granted;
  } catch {
    return false;
  }
}

// Bildirim id'sini habit id'siyle eşleştirip saklamak yerine,
// içeriğe habitId koyup iptalde filtreliyoruz.
function parseTime(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export async function cancelHabitReminder(habitId: string): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.content?.data?.habitId === habitId)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
  } catch {
    /* sessiz geç */
  }
}

export async function scheduleHabitReminder(habit: Habit): Promise<void> {
  // Önce eskiyi temizle
  await cancelHabitReminder(habit.id);

  const r = habit.reminders;
  if (!r || !r.enabled || !r.time) return;
  const parsed = parseTime(r.time);
  if (!parsed) return;

  const granted = await ensurePermission();
  if (!granted) return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: habit.name,
        body: 'Alışkanlık zamanı ⚡',
        data: { habitId: habit.id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: parsed.hour,
        minute: parsed.minute,
      },
    });
  } catch {
    /* sessiz geç */
  }
}

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
      },
    });
  } catch {
    /* sessiz geç */
  }
}

// Tüm aktif alışkanlıkların hatırlatıcılarını yeniden senkronla
export async function syncAllReminders(habits: Habit[]): Promise<void> {
  const granted = await ensurePermission();
  if (!granted) return;
  for (const h of habits) {
    if (h.reminders?.enabled && (h.status === 'active' || h.status === 'waiting')) {
      await scheduleHabitReminder(h);
    } else {
      await cancelHabitReminder(h.id);
    }
  }
}
