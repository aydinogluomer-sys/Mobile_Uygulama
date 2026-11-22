/**
 * F36 (PS-19) — Saatli görev bloklarının saf, deterministik hesabı:
 * saat ayrıştırma, gün blokları, sıradaki blok geri sayımı, çip metni ve günlük şerit düzeni.
 *
 * Saf modül: React, store, servis, repository, supabase, AsyncStorage,
 * argümansız `new Date()` ve `Date.now()` içermez; zaman yalnız `now` parametresiyle gelir.
 */
import { parseLocalDate, ymd, type Ymd } from './date';

export const DEFAULT_BLOCK_MINUTES = 30;
export const CHIP_FAR_MINUTES = 180;
export const STRIP_MAX_BLOCKS = 8;
export const STRIP_BLOCK_MIN_PX = 48;
export const STRIP_BLOCK_MAX_PX = 96;
export const STRIP_BLOCK_PX_PER_MIN = 0.8;
export const STRIP_GAP_MIN_PX = 8;
export const STRIP_GAP_MAX_PX = 56;
export const STRIP_GAP_PX_PER_MIN = 0.35;
export const STRIP_GAP_LABEL_MIN = 20;
export const STRIP_NOW_GAP_PX = 28;

export type BlockTask = {
  id: string;
  title: string;
  due_date?: string | null;
  time_block_start?: string | null;
  time_block_end?: string | null;
  completed: boolean;
  status: string;
  priority?: 'high' | 'medium' | 'low' | 'none';
};

export type DayBlock = {
  id: string;
  title: string;
  day: Ymd;
  start: Date;
  end: Date | null;
  startLabel: string;
  endLabel: string | null;
  priority: 'high' | 'medium' | 'low' | 'none';
};

export type NextBlockInfo = {
  block: DayBlock;
  minutesUntil: number;
  laterToday: number;
};

export type StripItem =
  | {
      kind: 'block';
      block: DayBlock;
      height: number;
      state: 'past' | 'current' | 'upcoming';
      nowFraction: number | null;
    }
  | {
      kind: 'gap';
      minutes: number;
      height: number;
      label: string | null;
      nowFraction: number | null;
    }
  | {
      kind: 'now';
      label: string;
    };

export type DayStrip = {
  items: StripItem[];
  hiddenCount: number;
  nowLabel: string | null;
};

const PRIORITY_RANK: Readonly<Record<DayBlock['priority'], number>> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function normalisePriority(p: BlockTask['priority']): DayBlock['priority'] {
  if (p === 'high' || p === 'medium' || p === 'low' || p === 'none') return p;
  return 'none';
}

/** 'H:mm' | 'HH:mm' | 'HH:mm:ss' -> { hour, minute }; geçersiz, boş, 24:00, 12:60, '12.30' -> null. */
export function parseBlockTime(raw: string | null | undefined): { hour: number; minute: number } | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] !== undefined ? Number(m[3]) : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null;
  }
  return { hour, minute };
}

/** due_date değerinin gün kısmı (ilk 10 karakter, yalnız geçerli YYYY-MM-DD ise); aksi halde ''. */
export function blockDayOf(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length < 10) return '';
  const head = value.slice(0, 10);
  return parseLocalDate(head) !== null ? head : '';
}

/**
 * Açık (completed false, status 'cancelled' değil), o gün, geçerli başlangıcı olan görevler.
 * Sıra: start artan, priority (high, medium, low, none), title tr, id. Girdiyi değiştirmez.
 */
export function blocksOn(tasks: readonly BlockTask[], day: Ymd): DayBlock[] {
  const parsedDay = parseLocalDate(day);
  if (!parsedDay) return [];
  const y = parsedDay.getFullYear();
  const m = parsedDay.getMonth();
  const d = parsedDay.getDate();

  const out: DayBlock[] = [];
  for (const t of tasks) {
    if (t.completed || t.status === 'cancelled') continue;
    if (blockDayOf(t.due_date) !== day) continue;
    const startHm = parseBlockTime(t.time_block_start);
    if (!startHm) continue;

    const start = new Date(y, m, d, startHm.hour, startHm.minute, 0, 0);
    const startLabel = `${pad2(startHm.hour)}:${pad2(startHm.minute)}`;

    let end: Date | null = null;
    let endLabel: string | null = null;
    const endHm = parseBlockTime(t.time_block_end);
    if (endHm) {
      const candidate = new Date(y, m, d, endHm.hour, endHm.minute, 0, 0);
      if (candidate.getTime() > start.getTime() && ymd(candidate) === day) {
        end = candidate;
        endLabel = `${pad2(endHm.hour)}:${pad2(endHm.minute)}`;
      }
    }

    out.push({
      id: t.id,
      title: t.title,
      day,
      start,
      end,
      startLabel,
      endLabel,
      priority: normalisePriority(t.priority),
    });
  }

  out.sort((a, b) => {
    const startDiff = a.start.getTime() - b.start.getTime();
    if (startDiff !== 0) return startDiff;
    const prioDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (prioDiff !== 0) return prioDiff;
    const titleDiff = a.title.localeCompare(b.title, 'tr');
    if (titleDiff !== 0) return titleDiff;
    return a.id.localeCompare(b.id);
  });

  return out;
}

/** Bugün (ymd(now)) başlangıcı now'dan BÜYÜK ilk blok; yoksa null. minutesUntil = ceil(mutlak fark / 60000). */
export function nextBlockInfo(tasks: readonly BlockTask[], now: Date): NextBlockInfo | null {
  const today = ymd(now);
  const blocks = blocksOn(tasks, today);
  const nowMs = now.getTime();
  const idx = blocks.findIndex((b) => b.start.getTime() > nowMs);
  if (idx === -1) return null;
  const block = blocks[idx];
  const minutesUntil = Math.ceil((block.start.getTime() - nowMs) / 60_000);
  return {
    block,
    minutesUntil,
    laterToday: blocks.length - idx - 1,
  };
}

/** { text: 'Sıradaki blok 25 dk sonra', a11y: 'Sıradaki blok: Rapor yazma. 25 dakika sonra, başlangıç 15:00.' } */
export function nextBlockChip(info: NextBlockInfo): { text: string; a11y: string } {
  const m = Math.max(0, info.minutesUntil);
  const { title, startLabel } = info.block;

  if (m <= 1) {
    return {
      text: 'Sıradaki blok birazdan',
      a11y: `Sıradaki blok: ${title}. ${m <= 0 ? '1 dakikadan az kaldı' : '1 dakika sonra'}, başlangıç ${startLabel}.`,
    };
  }

  if (m < 60) {
    return {
      text: `Sıradaki blok ${m} dk sonra`,
      a11y: `Sıradaki blok: ${title}. ${m} dakika sonra, başlangıç ${startLabel}.`,
    };
  }

  const hours = Math.floor(m / 60);
  const rem = m % 60;

  if (m < CHIP_FAR_MINUTES) {
    if (rem === 0) {
      return {
        text: `Sıradaki blok ${hours} sa sonra`,
        a11y: `Sıradaki blok: ${title}. ${hours} saat sonra, başlangıç ${startLabel}.`,
      };
    }
    return {
      text: `Sıradaki blok ${hours} sa ${rem} dk sonra`,
      a11y: `Sıradaki blok: ${title}. ${hours} saat ${rem} dakika sonra, başlangıç ${startLabel}.`,
    };
  }

  const spokenSpan = rem === 0 ? `${hours} saat` : `${hours} saat ${rem} dakika`;
  return {
    text: `Sıradaki blok · ${startLabel}`,
    a11y: `Sıradaki blok: ${title}. ${spokenSpan} sonra, başlangıç ${startLabel}.`,
  };
}

function endOrDefaultMs(block: DayBlock): number {
  return block.end ? block.end.getTime() : block.start.getTime() + DEFAULT_BLOCK_MINUTES * 60_000;
}

function formatGapLabel(minutes: number): string | null {
  if (minutes < STRIP_GAP_LABEL_MIN) return null;
  if (minutes < 60) return `${minutes} dk ara`;
  const h = Math.floor(minutes / 60);
  const r = minutes % 60;
  return r > 0 ? `${h} sa ${r} dk ara` : `${h} sa ara`;
}

/** now null: şimdi çizgisi yok. */
export function layoutDayStrip(
  blocks: readonly DayBlock[],
  now: Date | null,
  maxBlocks: number = STRIP_MAX_BLOCKS,
): DayStrip {
  if (blocks.length === 0) {
    return { items: [], hiddenCount: 0, nowLabel: null };
  }

  const limit = Math.max(1, Math.floor(maxBlocks));
  const visible = blocks.slice(0, limit);
  const hiddenCount = Math.max(0, blocks.length - visible.length);
  const nowLabel = now ? `şimdi ${pad2(now.getHours())}:${pad2(now.getMinutes())}` : null;
  const nowMs = now ? now.getTime() : null;

  const items: StripItem[] = [];
  let nowPlaced = false;

  if (nowMs !== null && nowLabel !== null && nowMs < visible[0].start.getTime()) {
    items.push({ kind: 'now', label: nowLabel });
    nowPlaced = true;
  }

  for (let i = 0; i < visible.length; i += 1) {
    const cur = visible[i];
    const startMs = cur.start.getTime();
    const endMs = endOrDefaultMs(cur);

    if (i > 0) {
      const prevEndMs = endOrDefaultMs(visible[i - 1]);
      if (startMs > prevEndMs) {
        const gapMinutes = Math.round((startMs - prevEndMs) / 60_000);
        if (gapMinutes > 0) {
          const baseHeight = clamp(
            Math.round(gapMinutes * STRIP_GAP_PX_PER_MIN),
            STRIP_GAP_MIN_PX,
            STRIP_GAP_MAX_PX,
          );
          let gapNowFraction: number | null = null;
          let gapHeight = baseHeight;
          if (!nowPlaced && nowMs !== null && nowMs >= prevEndMs && nowMs < startMs) {
            gapNowFraction = clamp((nowMs - prevEndMs) / (startMs - prevEndMs), 0, 1);
            gapHeight = Math.max(baseHeight, STRIP_NOW_GAP_PX);
            nowPlaced = true;
          }
          items.push({
            kind: 'gap',
            minutes: gapMinutes,
            height: gapHeight,
            label: formatGapLabel(gapMinutes),
            nowFraction: gapNowFraction,
          });
        }
      }
    }

    const durationMin = Math.max(1, Math.round((endMs - startMs) / 60_000));
    const blockHeight = clamp(
      Math.round(durationMin * STRIP_BLOCK_PX_PER_MIN),
      STRIP_BLOCK_MIN_PX,
      STRIP_BLOCK_MAX_PX,
    );

    let state: 'past' | 'current' | 'upcoming' = 'upcoming';
    if (nowMs !== null) {
      if (endMs <= nowMs) state = 'past';
      else if (startMs <= nowMs && nowMs < endMs) state = 'current';
      else state = 'upcoming';
    }

    let blockNowFraction: number | null = null;
    if (!nowPlaced && nowMs !== null && state === 'current') {
      blockNowFraction = clamp((nowMs - startMs) / Math.max(1, endMs - startMs), 0, 1);
      nowPlaced = true;
    }

    items.push({
      kind: 'block',
      block: cur,
      height: blockHeight,
      state,
      nowFraction: blockNowFraction,
    });
  }

  if (!nowPlaced && nowMs !== null && nowLabel !== null) {
    items.push({ kind: 'now', label: nowLabel });
  }

  return { items, hiddenCount, nowLabel };
}
