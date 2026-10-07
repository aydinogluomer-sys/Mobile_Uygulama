/**
 * R04 — keeping the OS's pending reminders equal to the plan, and acting on
 * a reminder's buttons.
 *
 * `reconcileReminders` is idempotent: it computes the plan (lib/reminderPlan),
 * lists what the OS has pending, cancels what is no longer wanted (and every
 * legacy DAILY trigger), and adds what is missing. Run it on launch, on
 * foreground (which also covers a timezone or DST change: the plan is built
 * from local dates at run time), and after any habit or log change. One run
 * at a time; a request during a run schedules exactly one more run.
 *
 * Permission is never pretended: with notifications denied nothing is
 * scheduled and the report says `permission: false` for the screen to show.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_REMINDER_SETTINGS, planLogsSince, planReminders, reconcile, inQuietHours, parseTime,
  type ReminderSettings,
} from '../lib/reminderPlan';
import {
  cancelScheduled, ensureCategories, ensurePermission, hasPermission, listScheduled, reminderTitle, scheduleReminder, scheduleSnooze,
} from '../lib/notifications';
import { handledKey, parseAction, rememberHandled, type ResponseLike } from '../lib/notificationActions';
import { isMeasurableTracking } from '../lib/habitEngine';
import { parseLocalDate, ymd } from '../lib/date';
import { logsForPeriod } from './reviewService';
import type { Habit, HabitLog } from '../lib/supabase';

export const SETTINGS_KEY = 'reminders.settings.v1';
export const HANDLED_KEY = 'reminders.handled.v1';

export async function loadReminderSettings(): Promise<ReminderSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_REMINDER_SETTINGS;
    const o = JSON.parse(raw) as Partial<ReminderSettings>;
    return {
      quietStart: typeof o.quietStart === 'string' && parseTime(o.quietStart) ? o.quietStart : null,
      quietEnd: typeof o.quietEnd === 'string' && parseTime(o.quietEnd) ? o.quietEnd : null,
      hideTitles: o.hideTitles === true,
    };
  } catch {
    return DEFAULT_REMINDER_SETTINGS;
  }
}

export async function saveReminderSettings(s: ReminderSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export type ReconcileReport = {
  permission: boolean;
  planned: number;
  added: number;
  cancelled: number;
  /** Reminders beyond the OS limit, planned on a later run. */
  dropped: number;
  /** Planned times that fell in quiet hours and were left out. */
  quieted: number;
};

let running: Promise<ReconcileReport> | null = null;
let again = false;

export async function reconcileReminders(habits: () => readonly Habit[], now: () => Date = () => new Date()): Promise<ReconcileReport> {
  if (running) { again = true; return running; }
  running = (async () => {
    let report: ReconcileReport;
    do {
      again = false;
      // Read the habits on EVERY pass: a re-run exists because they changed.
      report = await reconcileOnce(habits(), now());
    } while (again);
    return report;
  })();
  try { return await running; } finally { running = null; }
}

async function reconcileOnce(habits: readonly Habit[], now: Date): Promise<ReconcileReport> {
  const settings = await loadReminderSettings();
  const wantsAny = habits.some((h) => h.status === 'active' && h.reminders?.enabled);
  // Ask only when there is something to remind about; otherwise just read.
  const permission = wantsAny ? await ensurePermission() : await hasPermission();
  const res = await logsForPeriod({ start: planLogsSince(now), end: ymd(now) });
  const plan = planReminders({ habits, logs: res.ok ? (res.data as never) : null, settings, now });
  const quieted = habits.reduce((n, h) => {
    const r = h.reminders;
    if (h.status !== 'active' || !r?.enabled) return n;
    const times = r.times && r.times.length ? r.times : [r.time];
    return n + times.filter((t) => inQuietHours(t, settings)).length;
  }, 0);
  const scheduled = await listScheduled();
  // Without permission nothing new is added, but stale triggers are still removed.
  const diff = reconcile(scheduled, permission ? plan.reminders : []);
  await cancelScheduled(diff.cancel);
  let added = 0;
  if (permission && diff.add.length > 0) {
    await ensureCategories();
    const byId = new Map(habits.map((h) => [h.id, h]));
    for (const p of diff.add) {
      const h = byId.get(p.habitId);
      if (h && (await scheduleReminder(p, h, isMeasurableTracking(h.tracking_type), settings))) added += 1;
    }
  }
  return { permission, planned: plan.reminders.length, added, cancelled: diff.cancel.length, dropped: plan.dropped, quieted };
}

// ── R04.03 — a reminder's buttons ───────────────────────────────────────────

export type ResponseDeps = {
  habits: readonly Habit[];
  logHabit: (p: { habitId: string; date: Date; state: HabitLog['state'] }) => Promise<{ ok: boolean; error?: string }>;
  /** Open the app where an amount can be entered for this habit. */
  openMeasure: (habitId: string, day: string) => void;
  /** Re-plan after acting (a done day stops being reminded). */
  reconcile: () => Promise<unknown>;
};

export type ResponseOutcome = 'logged' | 'skipped' | 'snoozed' | 'opened' | 'duplicate' | 'ignored' | 'failed';

/**
 * Act on one reminder response, at most once. A yes/no habit's "Tamamla"
 * logs it done for the reminder's day; a measurable habit is opened for an
 * amount instead -- never logged done without one.
 */
export async function handleReminderResponse(r: ResponseLike, deps: ResponseDeps): Promise<ResponseOutcome> {
  const action = parseAction(r);
  if (!action) return 'ignored';
  const key = handledKey(r);
  let handled: string[] = [];
  try { handled = JSON.parse((await AsyncStorage.getItem(HANDLED_KEY)) ?? '[]'); } catch { handled = []; }
  if (handled.includes(key)) return 'duplicate';
  // Recorded BEFORE acting: a second delivery racing this one is refused.
  try { await AsyncStorage.setItem(HANDLED_KEY, JSON.stringify(rememberHandled(handled, key))); } catch { /* best effort */ }

  const habit = deps.habits.find((h) => h.id === action.habitId);
  if (!habit) return 'ignored';
  const measurable = isMeasurableTracking(habit.tracking_type);
  const date = parseLocalDate(action.day) ?? new Date();
  let outcome: ResponseOutcome;
  switch (action.kind) {
    case 'done': {
      if (measurable) { deps.openMeasure(habit.id, action.day); outcome = 'opened'; break; }
      const res = await deps.logHabit({ habitId: habit.id, date, state: 'done' });
      outcome = res.ok ? 'logged' : 'failed';
      break;
    }
    case 'skip': {
      const res = await deps.logHabit({ habitId: habit.id, date, state: 'skip' });
      outcome = res.ok ? 'skipped' : 'failed';
      break;
    }
    case 'snooze': {
      const settings = await loadReminderSettings();
      await scheduleSnooze(habit.id, action.day, reminderTitle(habit.name, settings), measurable);
      outcome = 'snoozed';
      break;
    }
    case 'measure':
    case 'open':
      deps.openMeasure(habit.id, action.day);
      outcome = 'opened';
      break;
  }
  await deps.reconcile();
  return outcome;
}
