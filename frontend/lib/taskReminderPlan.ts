/**
 * F36 (PS-20, PS-24, PS-26) — Görev erken hatırlatıcısı, akşam kapanış daveti ve
 * sınırlı alışkanlık takip bildirimlerinin saf planı ve uzlaştırma farkı.
 *
 * Yalnız `./date`, `./nextBlock`, `./reminderPlan` ve `./notificationActions` içe aktarır.
 */
import { addDaysLocal, ymd, type Ymd } from './date';
import { blocksOn, type BlockTask } from './nextBlock';
import { followUpOffsetsMin, followUpStopKey } from './notificationActions';
import { inQuietHours, parseTime, type PlannedReminder, type ReminderSettings } from './reminderPlan';

export const TASK_LEAD_CHOICES = [0, 10, 30, 60] as const;
export type TaskLeadMin = (typeof TASK_LEAD_CHOICES)[number];
export const EVENING_TIME_CHOICES = ['19:00', '20:00', '21:00', '22:00'] as const;
export type EveningTime = (typeof EVENING_TIME_CHOICES)[number];
export const EVENING_HORIZON_DAYS = 3;
export const TASK_REMINDER_HORIZON_DAYS = 3;
export const TASK_REMINDER_MAX_PENDING = 6;
export const TASK_REMINDER_MAX_PER_DAY = 3;
export const FOLLOW_UP_WINDOW_HOURS = 24;
export const FOLLOW_UP_MAX_PENDING = 6;
export const FOCUS_GRACE_MINUTES = 5;

export const TIME_SUPPORT_KIND = {
  task: 'task-reminder',
  evening: 'evening-close',
  followUp: 'follow-up',
} as const;

export type TimeSupportSettings = {
  taskLeadMin: TaskLeadMin;
  eveningClose: boolean;
  eveningTime: EveningTime;
  followUp: boolean;
};

export const DEFAULT_TIME_SUPPORT_SETTINGS: TimeSupportSettings = {
  taskLeadMin: 0,
  eveningClose: false,
  eveningTime: '21:00',
  followUp: false,
};

function isTaskLeadChoice(v: unknown): v is TaskLeadMin {
  return typeof v === 'number' && (TASK_LEAD_CHOICES as readonly number[]).includes(v);
}

function isEveningTimeChoice(v: unknown): v is EveningTime {
  return typeof v === 'string' && (EVENING_TIME_CHOICES as readonly string[]).includes(v);
}

/** Bilinmeyen / bozuk / eksik her alan varsayılana döner; lead yalnız TASK_LEAD_CHOICES, saat yalnız EVENING_TIME_CHOICES içinden. */
export function normaliseTimeSupport(raw: unknown): TimeSupportSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_TIME_SUPPORT_SETTINGS };
  }
  const r = raw as Record<string, unknown>;
  return {
    taskLeadMin: isTaskLeadChoice(r.taskLeadMin) ? r.taskLeadMin : DEFAULT_TIME_SUPPORT_SETTINGS.taskLeadMin,
    eveningClose: r.eveningClose === true,
    eveningTime: isEveningTimeChoice(r.eveningTime) ? r.eveningTime : DEFAULT_TIME_SUPPORT_SETTINGS.eveningTime,
    followUp: r.followUp === true,
  };
}

export type PlannedTaskReminder = {
  kind: 'task';
  key: string;
  taskId: string;
  day: Ymd;
  startLabel: string;
  leadMin: number;
  at: Date;
  title: string;
};

export type PlannedEvening = {
  kind: 'evening';
  key: string;
  day: Ymd;
  time: EveningTime;
  at: Date;
};

export type PlannedFollowUp = {
  kind: 'followUp';
  key: string;
  primaryKey: string;
  habitId: string;
  day: Ymd;
  n: 1 | 2;
  at: Date;
};

export type PlannedTimeSupport = PlannedTaskReminder | PlannedEvening | PlannedFollowUp;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function hhmmOf(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 32 bit djb2 -> base36; görev başlığı değişince anahtar değişsin (kilit ekranı başlığı bayat kalmasın). */
export function titleToken(title: string): string {
  let hash = 5381;
  for (let i = 0; i < title.length; i += 1) {
    hash = ((hash << 5) + hash + title.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export function planTaskReminders(p: {
  tasks: readonly BlockTask[];
  settings: Pick<ReminderSettings, 'quietStart' | 'quietEnd' | 'hideTitles'>;
  support: Pick<TimeSupportSettings, 'taskLeadMin'>;
  now: Date;
}): { reminders: PlannedTaskReminder[]; quieted: number; dropped: number } {
  const lead = p.support.taskLeadMin;
  if (!isTaskLeadChoice(lead) || lead <= 0) {
    return { reminders: [], quieted: 0, dropped: 0 };
  }

  const base = new Date(p.now.getFullYear(), p.now.getMonth(), p.now.getDate());
  const nowMs = p.now.getTime();
  const candidates: PlannedTaskReminder[] = [];
  let quieted = 0;

  for (let i = 0; i < TASK_REMINDER_HORIZON_DAYS; i += 1) {
    const day = ymd(addDaysLocal(base, i));
    const blocks = blocksOn(p.tasks, day);
    for (const b of blocks) {
      const at = new Date(b.start.getTime() - lead * 60_000);
      if (at.getTime() <= nowMs) continue;
      if (inQuietHours(hhmmOf(at), p.settings)) {
        quieted += 1;
        continue;
      }
      const token = p.settings.hideTitles ? 'x' : titleToken(b.title);
      const key = `t:${b.id}:${at.getTime()}:${lead}:${token}`;
      candidates.push({
        kind: 'task',
        key,
        taskId: b.id,
        day: b.day,
        startLabel: b.startLabel,
        leadMin: lead,
        at,
        title: b.title,
      });
    }
  }

  candidates.sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key));

  const perDayCount = new Map<string, number>();
  const reminders: PlannedTaskReminder[] = [];
  let dropped = 0;

  for (const c of candidates) {
    const atDay = ymd(c.at);
    const curDay = perDayCount.get(atDay) ?? 0;
    if (curDay >= TASK_REMINDER_MAX_PER_DAY || reminders.length >= TASK_REMINDER_MAX_PENDING) {
      dropped += 1;
      continue;
    }
    perDayCount.set(atDay, curDay + 1);
    reminders.push(c);
  }

  return { reminders, quieted, dropped };
}

export function planEveningClose(p: {
  settings: Pick<ReminderSettings, 'quietStart' | 'quietEnd'>;
  support: Pick<TimeSupportSettings, 'eveningClose' | 'eveningTime'>;
  now: Date;
  /** Yalnız BUGÜNÜN kapatılıp kapatılmadığı (isDayClosedOn). */
  closedToday: boolean;
}): { reminders: PlannedEvening[]; quieted: boolean } {
  if (!p.support.eveningClose || !isEveningTimeChoice(p.support.eveningTime)) {
    return { reminders: [], quieted: false };
  }
  const parsed = parseTime(p.support.eveningTime);
  if (!parsed) return { reminders: [], quieted: false };

  const normTime = `${pad2(parsed.hour)}:${pad2(parsed.minute)}`;
  if (inQuietHours(normTime, p.settings)) {
    return { reminders: [], quieted: true };
  }

  const base = new Date(p.now.getFullYear(), p.now.getMonth(), p.now.getDate());
  const nowMs = p.now.getTime();
  const reminders: PlannedEvening[] = [];

  for (let i = 0; i < EVENING_HORIZON_DAYS; i += 1) {
    if (i === 0 && p.closedToday) continue;
    const d = addDaysLocal(base, i);
    const day = ymd(d);
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), parsed.hour, parsed.minute, 0, 0);
    if (at.getTime() <= nowMs) continue;
    const time = p.support.eveningTime;
    reminders.push({
      kind: 'evening',
      key: `e:${day}:${time}:${at.getTime()}`,
      day,
      time,
      at,
    });
  }

  return { reminders, quieted: false };
}

export function planFollowUps(p: {
  /** planReminders'ın (now - FOLLOW_UP_SPAN_MIN) ile ürettiği birincil liste: yakın geçmişte ateşlenenler de dahildir. */
  primaries: readonly Pick<PlannedReminder, 'key' | 'habitId' | 'day' | 'at'>[];
  settings: Pick<ReminderSettings, 'quietStart' | 'quietEnd'>;
  support: Pick<TimeSupportSettings, 'followUp'>;
  now: Date;
  focus: { active: boolean; endsAt: Date | null };
  /** followUpStopKey(habitId, day) kümesi: kullanıcı ertele bastı. */
  stopped: ReadonlySet<string>;
}): { reminders: PlannedFollowUp[]; dropped: number } {
  if (!p.support.followUp) {
    return { reminders: [], dropped: 0 };
  }

  const offsets = followUpOffsetsMin();
  const nowMs = p.now.getTime();
  const windowMs = FOLLOW_UP_WINDOW_HOURS * 3_600_000;
  const graceMs = FOCUS_GRACE_MINUTES * 60_000;
  const candidates: PlannedFollowUp[] = [];

  for (const prim of p.primaries) {
    if (prim.at.getTime() - nowMs > windowMs) continue;
    if (p.stopped.has(followUpStopKey(prim.habitId, prim.day))) continue;

    for (let idx = 0; idx < offsets.length; idx += 1) {
      const n = (idx + 1) as 1 | 2;
      const at = new Date(prim.at.getTime() + offsets[idx] * 60_000);
      if (at.getTime() <= nowMs) continue;
      if (ymd(at) !== prim.day) continue;
      if (inQuietHours(hhmmOf(at), p.settings)) continue;
      if (p.focus.active && (p.focus.endsAt === null || at.getTime() <= p.focus.endsAt.getTime() + graceMs)) {
        continue;
      }
      candidates.push({
        kind: 'followUp',
        key: `f:${prim.key}:${n}:${at.getTime()}`,
        primaryKey: prim.key,
        habitId: prim.habitId,
        day: prim.day,
        n,
        at,
      });
    }
  }

  candidates.sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key));
  const reminders = candidates.slice(0, FOLLOW_UP_MAX_PENDING);
  const dropped = Math.max(0, candidates.length - reminders.length);
  return { reminders, dropped };
}

/** data.kind task-reminder | evening-close | follow-up ve string key taşıyorsa; aksi halde null. */
export function classifyTimeSupport(
  data: Record<string, unknown> | null | undefined,
): { kind: PlannedTimeSupport['kind']; key: string } | null {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.key !== 'string' || data.key.length === 0) return null;
  if (data.kind === TIME_SUPPORT_KIND.task) return { kind: 'task', key: data.key };
  if (data.kind === TIME_SUPPORT_KIND.evening) return { kind: 'evening', key: data.key };
  if (data.kind === TIME_SUPPORT_KIND.followUp) return { kind: 'followUp', key: data.key };
  return null;
}

/** Habit reconcile ile aynı kalıp: istenmeyen ve yinelenen iptal, eksik ekleme. Diğer bildirimlere ASLA dokunmaz. */
export function reconcileTimeSupport(
  scheduled: readonly { identifier: string; data: Record<string, unknown> | null | undefined }[],
  wanted: readonly PlannedTimeSupport[],
): { cancel: string[]; add: PlannedTimeSupport[] } {
  const want = new Set(wanted.map((w) => w.key));
  const have = new Set<string>();
  const cancel: string[] = [];

  for (const s of scheduled) {
    const c = classifyTimeSupport(s.data);
    if (!c) continue;
    if (want.has(c.key) && !have.has(c.key)) {
      have.add(c.key);
    } else {
      cancel.push(s.identifier);
    }
  }

  return {
    cancel,
    add: wanted.filter((w) => !have.has(w.key)),
  };
}

export const TIME_SUPPORT_COPY = {
  eveningTitle: 'Gün sonu',
  eveningBody: 'Hazır olduğunda günü kapatabilirsin.',
  taskBody: (leadMin: number, startLabel: string): string => `${leadMin} dk sonra başlıyor (${startLabel}).`,
  taskBodyHidden: 'Bir görevin zamanı yaklaşıyor.',
  taskTitleHidden: 'Hatırlatıcı',
  followUpBody: 'Hâlâ burada, hazır olunca.',
} as const;
