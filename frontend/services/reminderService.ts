/**
 * R04 / F17 — keeping the OS's pending reminders equal to the plan, and acting on
 * a reminder's buttons safely across cold starts, timezone changes and budgets.
 *
 * `reconcileReminders` is idempotent:
 *   - skips (`skipped: 'habits-unknown'`) when the habits provider returns `null`
 *     so a cold or offline boot never wipes pending OS reminders (DOM-V01)
 *   - reads OS pending notifications locally first and exits with zero network
 *     or OS writes when no habit wants reminders and none of ours are pending (PRF-08)
 *   - computes the plan with `@<epoch ms>` keys (DOM-04), dynamic iOS slot budget
 *     `habitSlotBudget(others)` and one re-entry nudge at the end of the 7-day
 *     horizon (DOM-05), plus Calm-Tech daily cap and quiet deferral (DOM-15)
 *
 * `handleReminderResponse` waits for `whenHabitsReady`, deduplicates concurrent
 * deliveries with `inFlight`, leaves unknown habits unrecorded so cold-start
 * timeouts can retry, and persists `HANDLED_KEY` only after the action succeeds
 * (DOM-14, DOM-V01).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_REMINDER_SETTINGS,
  DEFAULT_MAX_PER_DAY,
  DEFAULT_HORIZON_DAYS,
  REENTRY_KIND,
  classifyScheduled,
  habitSlotBudget,
  hasReminderHabits,
  normaliseMaxPerDay,
  parseTime,
  planLogsSince,
  planReminders,
  reconcile,
  reentryTime,
  type ReminderSettings,
} from '../lib/reminderPlan';
import {
  cancelReentryNudge,
  cancelScheduled,
  ensureCategories,
  ensurePermission,
  hasPermission,
  listScheduled,
  reminderTitle,
  scheduleReentryNudge,
  scheduleReminder,
  scheduleSnooze,
} from '../lib/notifications';
import {
  handledKey,
  parseAction,
  rememberHandled,
  shouldRecordHandled,
  type HandledOutcome,
  type ResponseLike,
} from '../lib/notificationActions';
import { isMeasurableTracking } from '../lib/habitEngine';
import { parseLocalDate, ymd } from '../lib/date';
import { fetchHabitLogsForReview } from '../repositories/habitLogRepository';
import type { Habit, HabitLog } from '../lib/supabase';

export const SETTINGS_KEY = 'reminders.settings.v1';
export const HANDLED_KEY = 'reminders.handled.v1';

export async function loadReminderSettings(): Promise<ReminderSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_REMINDER_SETTINGS;
    const o = JSON.parse(raw) as Partial<ReminderSettings> & { maxPerDay?: unknown };
    return {
      quietStart: typeof o.quietStart === 'string' && parseTime(o.quietStart) ? o.quietStart : null,
      quietEnd: typeof o.quietEnd === 'string' && parseTime(o.quietEnd) ? o.quietEnd : null,
      hideTitles: o.hideTitles === true,
      maxPerDay: o.maxPerDay === undefined ? DEFAULT_MAX_PER_DAY : normaliseMaxPerDay(o.maxPerDay),
    };
  } catch {
    return DEFAULT_REMINDER_SETTINGS;
  }
}

export async function saveReminderSettings(s: ReminderSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...s, maxPerDay: normaliseMaxPerDay(s.maxPerDay) }));
}

export type HabitsProvider = () => readonly Habit[] | null;

export type ReconcileReport = {
  permission: boolean | null;
  planned: number;
  added: number;
  cancelled: number;
  /** Reminders beyond the OS limit, planned on a later run. */
  dropped: number;
  /** Planned times that fell in quiet hours and could not be deferred in the same day. */
  quieted: number;
  /** Reminders dropped by the Calm-Tech daily cap. */
  capped: number;
  /** Reminders deferred to the end of quiet hours on the same day. */
  deferred: number;
  /** Whether the horizon re-entry nudge is scheduled. */
  reentry: boolean;
  skipped?: 'habits-unknown';
};

const EMPTY_REPORT: ReconcileReport = {
  permission: false,
  planned: 0,
  added: 0,
  cancelled: 0,
  dropped: 0,
  quieted: 0,
  capped: 0,
  deferred: 0,
  reentry: false,
};

let lastReport: ReconcileReport | null = null;
export const getLastReconcileReport = (): ReconcileReport | null => lastReport;

let running: Promise<ReconcileReport> | null = null;
let again = false;

export async function reconcileReminders(habits: HabitsProvider, now: () => Date = () => new Date()): Promise<ReconcileReport> {
  if (running) { again = true; return running; }
  running = (async () => {
    let report: ReconcileReport;
    do {
      again = false;
      // Read the habits on EVERY pass: a re-run exists because they changed.
      const list = habits();
      report = list === null ? { ...EMPTY_REPORT, permission: null, skipped: 'habits-unknown' } : await reconcileOnce(list, now());
    } while (again);
    if (!report.skipped) lastReport = report;
    return report;
  })();
  try { return await running; } finally { running = null; }
}

async function reconcileOnce(habits: readonly Habit[], now: Date): Promise<ReconcileReport> {
  const settings = await loadReminderSettings();
  const wantsAny = hasReminderHabits(habits);
  const scheduled = await listScheduled();
  const ours = scheduled.filter((s) => classifyScheduled(s.data).kind !== 'other');
  const hasReentry = scheduled.some((s) => s.data?.kind === REENTRY_KIND);
  if (!wantsAny && ours.length === 0 && !hasReentry) {
    return { ...EMPTY_REPORT, permission: await hasPermission() };
  }
  const permission = wantsAny ? await ensurePermission() : await hasPermission();
  const res = wantsAny ? await fetchHabitLogsForReview({ start: planLogsSince(now), end: ymd(now) }) : null;
  const others = scheduled.filter((s) => classifyScheduled(s.data).kind === 'other' && s.data?.kind !== REENTRY_KIND).length;
  const plan = planReminders({
    habits,
    logs: res && res.ok ? (res.data as never) : null,
    settings,
    now,
    maxPending: habitSlotBudget(others),
  });
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
  let reentry = false;
  if (permission && wantsAny) {
    reentry = await scheduleReentryNudge(reentryTime(now, DEFAULT_HORIZON_DAYS, settings), now.getTime());
  } else if (hasReentry) {
    await cancelReentryNudge();
  }
  return {
    permission,
    planned: plan.reminders.length,
    added,
    cancelled: diff.cancel.length,
    dropped: plan.dropped,
    quieted: plan.quieted,
    capped: plan.capped,
    deferred: plan.deferred,
    reentry,
  };
}

export const REPLAN_DEBOUNCE_MS = 2000;

export function createReconcileTrigger(p: { run: () => Promise<unknown>; delayMs?: number }): {
  schedule: () => void;
  flushNow: () => Promise<void>;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    schedule() {
      clear();
      timer = setTimeout(() => {
        timer = null;
        void p.run().catch(() => undefined);
      }, p.delayMs ?? REPLAN_DEBOUNCE_MS);
    },
    async flushNow() {
      clear();
      try {
        await p.run();
      } catch {
        /* sessiz: bir sonraki tetikleme dener */
      }
    },
    cancel() {
      clear();
    },
  };
}

// ── R04.03 — a reminder's buttons ───────────────────────────────────────────

export type ResponseDeps = {
  habits: readonly Habit[];
  /** Habit listesi yüklenince çözülür (sınırlı bekleme); yoksa `habits` kullanılır. */
  whenHabitsReady?: () => Promise<readonly Habit[]>;
  logHabit: (p: { habitId: string; date: Date; state: HabitLog['state'] }) => Promise<{ ok: boolean; error?: string }>;
  /** Open the app where an amount can be entered for this habit. */
  openMeasure: (habitId: string, day: string) => void;
  /** Re-plan after acting (a done day stops being reminded). */
  reconcile: () => Promise<unknown>;
};

export type ResponseOutcome = HandledOutcome;

const inFlight = new Set<string>();

const readHandled = async (): Promise<string[]> => {
  try {
    return JSON.parse((await AsyncStorage.getItem(HANDLED_KEY)) ?? '[]');
  } catch {
    return [];
  }
};

/**
 * Act on one reminder response, at most once. A yes/no habit's "Tamamla"
 * logs it done for the reminder's day; a measurable habit is opened for an
 * amount instead -- never logged done without one.
 */
export async function handleReminderResponse(r: ResponseLike, deps: ResponseDeps): Promise<ResponseOutcome> {
  const action = parseAction(r);
  if (!action) return 'ignored';
  const key = handledKey(r);
  if (inFlight.has(key)) return 'duplicate';
  inFlight.add(key);
  try {
    const handled = await readHandled();
    if (handled.includes(key)) return 'duplicate';
    const habits = deps.whenHabitsReady ? await deps.whenHabitsReady() : deps.habits;
    const habit = habits.find((h) => h.id === action.habitId);
    if (!habit) return 'ignored';
    const measurable = isMeasurableTracking(habit.tracking_type);
    const date = parseLocalDate(action.day) ?? new Date();
    let outcome: ResponseOutcome;
    switch (action.kind) {
      case 'done': {
        if (measurable) {
          deps.openMeasure(habit.id, action.day);
          outcome = 'opened';
          break;
        }
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
    if (shouldRecordHandled(outcome)) {
      try {
        await AsyncStorage.setItem(HANDLED_KEY, JSON.stringify(rememberHandled(await readHandled(), key)));
      } catch {
        /* en iyi çaba */
      }
    }
    await deps.reconcile();
    return outcome;
  } finally {
    inFlight.delete(key);
  }
}
