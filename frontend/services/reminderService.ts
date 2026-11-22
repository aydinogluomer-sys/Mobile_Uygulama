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
  accountEpoch,
  registerAccountScoped,
  registerAccountStorage,
} from '../lib/accountScope';
import { isDayClosedOn } from '../lib/dayClose';
import type { BlockTask } from '../lib/nextBlock';
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
  type PlanLog,
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
  scheduleEveningClose,
  scheduleFollowUp,
  scheduleReentryNudge,
  scheduleReminder,
  scheduleSnooze,
  scheduleTaskReminder,
} from '../lib/notifications';
import {
  FOLLOW_UP_SPAN_MIN,
  followUpStopKey,
  handledKey,
  parseAction,
  pruneStopped,
  rememberHandled,
  rememberStopped,
  shouldRecordHandled,
  type HandledOutcome,
  type ResponseLike,
} from '../lib/notificationActions';
import {
  DEFAULT_TIME_SUPPORT_SETTINGS,
  classifyTimeSupport,
  normaliseTimeSupport,
  planEveningClose,
  planFollowUps,
  planTaskReminders,
  reconcileTimeSupport,
  type PlannedTimeSupport,
  type TimeSupportSettings,
} from '../lib/taskReminderPlan';
import { isMeasurableTracking } from '../lib/habitEngine';
import { parseLocalDate, todayLocal, ymd } from '../lib/date';
import { fetchHabitLogsForReview } from '../repositories/habitLogRepository';
import type { Habit, HabitLog } from '../lib/supabase';

export const SETTINGS_KEY = 'reminders.settings.v1';
export const HANDLED_KEY = 'reminders.handled.v1';

let activeTimeSupportUid: string | null = null;

export function bindTimeSupportUser(uid: string | null): void {
  activeTimeSupportUid = uid;
}

export function timeSupportKey(uid: string = 'local'): string {
  return `reminders.timeSupport.v1.${uid}`;
}

export function followUpStoppedKey(uid: string = 'local'): string {
  return `reminders.followUpStopped.v1.${uid}`;
}

export async function loadTimeSupportSettings(uid?: string | null): Promise<TimeSupportSettings> {
  const target = uid ?? activeTimeSupportUid ?? 'local';
  try {
    let raw = await AsyncStorage.getItem(timeSupportKey(target));
    if (raw === null && target !== 'local') {
      raw = await AsyncStorage.getItem(timeSupportKey('local'));
    }
    if (!raw) return { ...DEFAULT_TIME_SUPPORT_SETTINGS };
    return normaliseTimeSupport(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TIME_SUPPORT_SETTINGS };
  }
}

export async function saveTimeSupportSettings(
  s: TimeSupportSettings,
  uid?: string | null,
): Promise<void> {
  const target = uid ?? activeTimeSupportUid ?? 'local';
  await AsyncStorage.setItem(timeSupportKey(target), JSON.stringify(normaliseTimeSupport(s)));
}

async function readStoppedEntries(uid: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(followUpStoppedKey(uid));
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string') out.push(item);
        }
      }
    }
  } catch {
    /* bozuk veri yoksayılır */
  }
  return out;
}

export async function stopFollowUps(
  habitId: string,
  day: string,
  uid?: string | null,
): Promise<void> {
  const target = uid ?? activeTimeSupportUid ?? 'local';
  try {
    const existing = await readStoppedEntries(target);
    const pruned = pruneStopped(existing, todayLocal());
    const next = rememberStopped(pruned, followUpStopKey(habitId, day));
    await AsyncStorage.setItem(followUpStoppedKey(target), JSON.stringify(next));
  } catch {
    /* en iyi çaba */
  }
}

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

export type FocusWindow = { active: boolean; endsAt: Date | null };

export type TimeSupportContext = {
  tasks: () => readonly BlockTask[] | null;
  userId: () => string | null;
  focus: () => FocusWindow;
  isDayClosed?: (userId: string, day: string) => Promise<boolean>;
};

export type TimeSupportReport = {
  tasks: number;
  evening: number;
  followUps: number;
  added: number;
  cancelled: number;
  quieted: number;
  eveningQuieted: boolean;
  skipped?: 'tasks-unknown' | 'no-user' | 'account-changed' | 'permission';
};

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
  timeSupport?: TimeSupportReport;
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

export async function reconcileReminders(
  habits: HabitsProvider,
  now: () => Date = () => new Date(),
  ctx?: TimeSupportContext,
): Promise<ReconcileReport> {
  if (running) { again = true; return running; }
  running = (async () => {
    let report: ReconcileReport;
    do {
      again = false;
      // Read the habits on EVERY pass: a re-run exists because they changed.
      const list = habits();
      report = list === null ? { ...EMPTY_REPORT, permission: null, skipped: 'habits-unknown' } : await reconcileOnce(list, now(), ctx);
    } while (again);
    if (!report.skipped) lastReport = report;
    return report;
  })();
  try { return await running; } finally { running = null; }
}

async function reconcileTimeSupportPart(a: {
  ctx: TimeSupportContext;
  habits: readonly Habit[];
  logs: readonly PlanLog[] | null;
  settings: ReminderSettings;
  support: TimeSupportSettings;
  scheduled: { identifier: string; data: Record<string, unknown> | null }[];
  permission: boolean;
  now: Date;
  epoch: number;
}): Promise<TimeSupportReport> {
  const uid = a.ctx.userId();
  if (!uid) {
    return {
      tasks: 0,
      evening: 0,
      followUps: 0,
      added: 0,
      cancelled: 0,
      quieted: 0,
      eveningQuieted: false,
      skipped: 'no-user',
    };
  }
  activeTimeSupportUid = uid;

  const rawTasks = a.ctx.tasks();
  const tasksUnknown = rawTasks === null;
  const closedToday = a.support.eveningClose
    ? await (a.ctx.isDayClosed ?? isDayClosedOn)(uid, ymd(a.now))
    : false;

  const taskPlan = tasksUnknown
    ? { reminders: [], quieted: 0, dropped: 0 }
    : planTaskReminders({
        tasks: rawTasks,
        settings: a.settings,
        support: a.support,
        now: a.now,
      });

  const eveningPlan = planEveningClose({
    settings: a.settings,
    support: a.support,
    now: a.now,
    closedToday,
  });

  const lookbackNow = new Date(a.now.getTime() - FOLLOW_UP_SPAN_MIN * 60_000);
  const primaries = a.support.followUp
    ? planReminders({
        habits: a.habits,
        logs: a.logs,
        settings: a.settings,
        now: lookbackNow,
        horizonDays: 2,
        maxPending: 100,
      }).reminders
    : [];

  const rawStopped = await readStoppedEntries(uid);
  const fallbackStopped = uid !== 'local' ? await readStoppedEntries('local') : [];
  const stopped = new Set(pruneStopped([...rawStopped, ...fallbackStopped], ymd(a.now)));

  const followUpPlan = planFollowUps({
    primaries,
    settings: a.settings,
    support: a.support,
    now: a.now,
    focus: a.ctx.focus(),
    stopped,
  });

  const scheduledForDiff = tasksUnknown
    ? a.scheduled.filter((s) => classifyTimeSupport(s.data)?.kind !== 'task')
    : a.scheduled;

  const wantedAll: PlannedTimeSupport[] = tasksUnknown
    ? [...eveningPlan.reminders, ...followUpPlan.reminders]
    : [...taskPlan.reminders, ...eveningPlan.reminders, ...followUpPlan.reminders];

  const wanted = a.permission ? wantedAll : [];
  const diff = reconcileTimeSupport(scheduledForDiff, wanted);

  if (a.epoch !== accountEpoch()) {
    return {
      tasks: taskPlan.reminders.length,
      evening: eveningPlan.reminders.length,
      followUps: followUpPlan.reminders.length,
      added: 0,
      cancelled: 0,
      quieted: taskPlan.quieted,
      eveningQuieted: eveningPlan.quieted,
      skipped: 'account-changed',
    };
  }

  if (diff.cancel.length > 0) {
    await cancelScheduled(diff.cancel);
  }

  let added = 0;
  if (a.permission && diff.add.length > 0) {
    if (diff.add.some((item) => item.kind === 'followUp')) {
      await ensureCategories();
    }
    const byId = new Map(a.habits.map((h) => [h.id, h]));
    for (const item of diff.add) {
      if (a.epoch !== accountEpoch()) break;
      if (item.kind === 'task') {
        if (await scheduleTaskReminder(item, a.settings)) added += 1;
      } else if (item.kind === 'evening') {
        if (await scheduleEveningClose(item)) added += 1;
      } else {
        const h = byId.get(item.habitId);
        if (h && (await scheduleFollowUp(item, h, isMeasurableTracking(h.tracking_type), a.settings))) {
          added += 1;
        }
      }
    }
  }

  return {
    tasks: taskPlan.reminders.length,
    evening: eveningPlan.reminders.length,
    followUps: followUpPlan.reminders.length,
    added,
    cancelled: diff.cancel.length,
    quieted: taskPlan.quieted,
    eveningQuieted: eveningPlan.quieted,
    ...(tasksUnknown
      ? { skipped: 'tasks-unknown' as const }
      : !a.permission
        ? { skipped: 'permission' as const }
        : {}),
  };
}

async function reconcileOnce(
  habits: readonly Habit[],
  now: Date,
  ctx?: TimeSupportContext,
): Promise<ReconcileReport> {
  const epoch = accountEpoch();
  const settings = await loadReminderSettings();
  const wantsAny = hasReminderHabits(habits);
  const scheduled = await listScheduled();
  const ours = scheduled.filter((s) => classifyScheduled(s.data).kind !== 'other');
  const hasReentry = scheduled.some((s) => s.data?.kind === REENTRY_KIND);
  if (!ctx && !wantsAny && ours.length === 0 && !hasReentry) {
    return { ...EMPTY_REPORT, permission: await hasPermission() };
  }

  const support = ctx ? await loadTimeSupportSettings(ctx.userId()) : null;
  const wantsTimeSupport =
    !!support &&
    (support.taskLeadMin > 0 || support.eveningClose || (support.followUp && wantsAny));
  const hasScheduledTimeSupport = scheduled.some((s) => classifyTimeSupport(s.data) !== null);

  if (ctx && !wantsAny && ours.length === 0 && !hasReentry && !wantsTimeSupport && !hasScheduledTimeSupport) {
    const permission = await hasPermission();
    const timeSupport = await reconcileTimeSupportPart({
      ctx,
      habits,
      logs: null,
      settings,
      support: support ?? DEFAULT_TIME_SUPPORT_SETTINGS,
      scheduled,
      permission,
      now,
      epoch,
    });
    return { ...EMPTY_REPORT, permission, timeSupport };
  }

  const permission = wantsAny || wantsTimeSupport ? await ensurePermission() : await hasPermission();
  const res = wantsAny ? await fetchHabitLogsForReview({ start: planLogsSince(now), end: ymd(now) }) : null;
  const logs: readonly PlanLog[] | null = res && res.ok ? (res.data as never) : null;
  const others = scheduled.filter((s) => classifyScheduled(s.data).kind === 'other' && s.data?.kind !== REENTRY_KIND).length;
  const plan = planReminders({
    habits,
    logs,
    settings,
    now,
    maxPending: habitSlotBudget(others),
  });
  // Without permission nothing new is added, but stale triggers are still removed.
  const diff = reconcile(scheduled, permission ? plan.reminders : []);
  if (diff.cancel.length > 0) {
    await cancelScheduled(diff.cancel);
  }
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
  const timeSupport = ctx
    ? await reconcileTimeSupportPart({
        ctx,
        habits,
        logs,
        settings,
        support: support ?? DEFAULT_TIME_SUPPORT_SETTINGS,
        scheduled,
        permission,
        now,
        epoch,
      })
    : undefined;
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
    ...(timeSupport ? { timeSupport } : {}),
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
        await stopFollowUps(habit.id, action.day, habit.user_id);
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

registerAccountScoped({
  name: 'reminderTimeSupport',
  onReset: () => {
    activeTimeSupportUid = null;
    lastReport = null;
  },
});

registerAccountStorage({
  name: 'reminderTimeSupport',
  transient: false,
  keysFor: (uid) => [timeSupportKey(uid)],
});

registerAccountStorage({
  name: 'reminderFollowUpStopped',
  transient: true,
  keysFor: (uid) => [followUpStoppedKey(uid)],
});
