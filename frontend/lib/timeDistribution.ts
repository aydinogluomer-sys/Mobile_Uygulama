import type { Ymd } from './date';
import type { Habit } from './supabase';

export type TimeBucketKey = 'focus' | 'routine' | 'habit';

export const TIME_LABELS: Readonly<Record<TimeBucketKey, string>> = {
  focus: 'Odak',
  routine: 'Rutinler',
  habit: 'Süre tipli alışkanlıklar',
};

const DATIVE_LABELS: Readonly<Record<TimeBucketKey, string>> = {
  focus: 'odağa',
  routine: 'rutinlere',
  habit: 'süre tipli alışkanlıklara',
};

const BUCKET_ORDER: readonly TimeBucketKey[] = ['focus', 'routine', 'habit'];

const MINUTE_UNITS = new Set(['', 'dk', 'dak', 'dakika', 'min', 'mın']);
const HOUR_UNITS = new Set(['sa', 'saat', 'h', 'hr']);

export type TimeSegment = {
  key: TimeBucketKey;
  label: string;
  minutes: number;
  share: number; // integer percentage; sum across segments === 100
};

export type TimeDistribution = {
  total: number;
  segments: TimeSegment[];
  top: TimeBucketKey | null;
  unknown: TimeBucketKey[];
  excludedHabits: number;
};

/**
 * Duration-typed habit minutes in [range.start, range.end].
 * Only `done | partial` logs with numeric `value >= 0` and `completed_at <= range.end` count.
 * Unrecognized duration units increment `excluded` once per habit and contribute 0 minutes.
 */
export function habitDurationMinutes(
  habits: readonly Pick<Habit, 'id' | 'tracking_type' | 'unit'>[],
  logs: readonly { habit_id: string; completed_at: string; state: string; value?: number | null }[],
  range: { start: Ymd; end: Ymd },
): { minutes: number; excluded: number } {
  const multiplierByHabit = new Map<string, number>();
  let excluded = 0;

  for (const h of habits) {
    if (h.tracking_type !== 'duration') continue;
    const u = (h.unit ?? '').trim().toLocaleLowerCase('tr-TR');
    if (MINUTE_UNITS.has(u)) {
      multiplierByHabit.set(h.id, 1);
    } else if (HOUR_UNITS.has(u)) {
      multiplierByHabit.set(h.id, 60);
    } else {
      excluded += 1;
    }
  }

  let rawMinutes = 0;
  for (const log of logs) {
    const mult = multiplierByHabit.get(log.habit_id);
    if (mult === undefined) continue;
    if (log.state !== 'done' && log.state !== 'partial') continue;
    const day = typeof log.completed_at === 'string' ? log.completed_at.slice(0, 10) : '';
    if (!day || day < range.start || day > range.end) continue;
    if (typeof log.value !== 'number' || !Number.isFinite(log.value) || log.value < 0) continue;
    rawMinutes += log.value * mult;
  }

  return { minutes: Math.round(rawMinutes), excluded };
}

/** `null` = source could not be read (recorded in `unknown`, never fabricated as 0). */
export function buildTimeDistribution(p: {
  focusMinutes: number | null;
  routineMinutes: number | null;
  habitMinutes: number | null;
  excludedHabits?: number;
}): TimeDistribution {
  const inputs: Record<TimeBucketKey, number | null> = {
    focus: p.focusMinutes,
    routine: p.routineMinutes,
    habit: p.habitMinutes,
  };

  const unknown: TimeBucketKey[] = [];
  const rawSegments: { key: TimeBucketKey; label: string; minutes: number }[] = [];

  for (const key of BUCKET_ORDER) {
    const val = inputs[key];
    if (val === null) {
      unknown.push(key);
      continue;
    }
    const clean = typeof val === 'number' && Number.isFinite(val) && val > 0 ? Math.round(val) : 0;
    if (clean > 0) {
      rawSegments.push({ key, label: TIME_LABELS[key], minutes: clean });
    }
  }

  const excludedHabits =
    typeof p.excludedHabits === 'number' && Number.isFinite(p.excludedHabits) && p.excludedHabits > 0
      ? Math.floor(p.excludedHabits)
      : 0;

  if (rawSegments.length === 0) {
    return {
      total: 0,
      segments: [],
      top: null,
      unknown,
      excludedHabits,
    };
  }

  const total = rawSegments.reduce((acc, s) => acc + s.minutes, 0);
  const shares = rawSegments.map((s) => Math.floor((s.minutes * 100) / total));
  const remainders = rawSegments.map((s, idx) => ({
    idx,
    rem: (s.minutes * 100) % total,
  }));

  let left = 100 - shares.reduce((acc, v) => acc + v, 0);
  remainders.sort((a, b) => (b.rem !== a.rem ? b.rem - a.rem : a.idx - b.idx));
  for (let i = 0; i < remainders.length && left > 0; i++) {
    shares[remainders[i].idx] += 1;
    left -= 1;
  }

  const segments: TimeSegment[] = rawSegments.map((s, idx) => ({
    key: s.key,
    label: s.label,
    minutes: s.minutes,
    share: shares[idx],
  }));

  let topSeg = segments[0];
  for (const seg of segments) {
    if (seg.minutes > topSeg.minutes) {
      topSeg = seg;
    }
  }

  return {
    total,
    segments,
    top: topSeg.key,
    unknown,
    excludedHabits,
  };
}

export function timeCaption(d: TimeDistribution, weekLabel: 'Bu hafta' | 'O hafta'): string {
  if (!d.top || d.segments.length === 0) {
    return `${weekLabel} henüz süre kaydı yok.`;
  }
  return `${weekLabel} zamanın en çok buraya aktı.`;
}

export function timeA11yLabel(d: TimeDistribution, weekLabel: 'Bu hafta' | 'O hafta'): string {
  if (!d.top || d.segments.length === 0) {
    return `${weekLabel} henüz süre kaydı yok.`;
  }
  const topSeg = d.segments.find((s) => s.key === d.top) ?? d.segments[0];
  const breakdown = d.segments.map((s) => `${s.label} ${s.minutes} dakika`).join(', ');
  return `${weekLabel} zamanın en çok ${DATIVE_LABELS[d.top]} aktı: ${topSeg.minutes} dakika. ${breakdown}.`;
}
