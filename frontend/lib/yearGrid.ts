import type { Habit } from './supabase';
import { addDaysLocal, parseLocalDate, startOfWeekLocal, ymd, type Ymd } from './date';

export const YEAR_GRID_ROWS = 7; // Pzt=0 .. Paz=6
export const YEAR_GRID_MAX_WEEKS = 53;
export const YEAR_GRID_MIN_WEEKS = 13;
export const YEAR_GRID_CELL = 13; // dp, çizim ve dokunma hesabı için tek kaynak
export const YEAR_GRID_GAP = 3;

export const MONTH_SHORT_TR: readonly string[] = [
  'Oca',
  'Şub',
  'Mar',
  'Nis',
  'May',
  'Haz',
  'Tem',
  'Ağu',
  'Eyl',
  'Eki',
  'Kas',
  'Ara',
];

const MONTH_LONG_TR: readonly string[] = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

const WEEKDAY_LONG_TR: readonly string[] = [
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
  'Pazar',
];

const WEEKDAY_SHORT_TR: readonly string[] = [
  'Pzt',
  'Sal',
  'Çar',
  'Per',
  'Cum',
  'Cmt',
  'Paz',
];

export type YearCellState =
  | 'done'
  | 'partial'
  | 'skip'
  | 'missed'
  | 'repaired'
  | 'not_scheduled'
  | 'unknown'
  | 'pending'
  | 'future';

export type YearCell = {
  date: Ymd;
  state: YearCellState;
  value: number | null;
  hasNote: boolean;
};

export type YearGridColumn = {
  weekStart: Ymd;
  monthLabel: string | null;
  cells: YearCell[];
};

export type YearGridSummary = {
  done: number;
  partial: number;
  skip: number;
  repaired: number;
  missed: number;
};

export type YearGridModel = {
  columns: YearGridColumn[];
  summary: YearGridSummary;
  firstDay: Ymd;
  lastDay: Ymd;
};

/** habit-detail.dayCellFor çıktısının yapısal alt kümesi (lib, ekran dosyasını içe aktarmaz). */
export type CellInput = {
  state: 'full' | 'partial' | 'miss' | 'skip' | 'not_scheduled' | 'future';
  value: number | null;
};

export type AggregateRow = { completed_at: string; state: string };

export type AggregateCell = {
  date: Ymd;
  done: number;
  partial: number;
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
};

export type AggregateGridModel = {
  columns: { weekStart: Ymd; monthLabel: string | null; cells: AggregateCell[] }[];
  totalCompletions: number;
  activeDays: number;
  peak: number;
};

export const YEAR_CELL_STATE_LABEL: Readonly<Record<YearCellState, string>> = {
  done: 'Tamamlandı',
  partial: 'Kısmi',
  skip: 'Atlandı',
  missed: 'Kaçırıldı',
  repaired: 'Telafi edildi',
  not_scheduled: 'Planlı değil',
  unknown: 'Kayıt yok',
  pending: 'Bugün',
  future: 'Gelecek gün',
};

function clampInt(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function fitCellSize(
  availableWidth: number,
  columns: number,
  gap = YEAR_GRID_GAP,
  min = 4,
  max = YEAR_GRID_CELL,
): number {
  if (!Number.isFinite(availableWidth) || columns <= 0) return max;
  const raw = Math.floor((availableWidth - Math.max(0, columns - 1) * gap) / columns);
  return clampInt(raw, min, max);
}

/** DST-güvenli hafta farkı: getTime() bölmesi YOK, yalnız startOfWeekLocal + addDaysLocal + leksik Ymd. */
function computeColumnCount(
  lastWeekMonday: Date,
  createdYmd: Ymd | null,
  maxWeeks: number,
): number {
  const minW = Math.min(YEAR_GRID_MIN_WEEKS, maxWeeks);
  if (!createdYmd) return maxWeeks;
  const createdDate = parseLocalDate(createdYmd);
  if (!createdDate) return maxWeeks;
  const createdMondayYmd = ymd(startOfWeekLocal(createdDate));

  for (let w = 0; w < maxWeeks; w++) {
    const candidateYmd = ymd(addDaysLocal(lastWeekMonday, -7 * w));
    if (candidateYmd <= createdMondayYmd) {
      return clampInt(w + 1, minW, maxWeeks);
    }
  }
  return maxWeeks;
}

function resolveMonthLabel(colDates: readonly Date[], colIndex: number): string | null {
  const anchor =
    colDates.find((d) => d.getDate() === 1) ??
    (colIndex === 0 ? colDates.find((d) => d.getDate() <= 7) : undefined);
  return anchor ? MONTH_SHORT_TR[anchor.getMonth()] : null;
}

export function buildHabitYearGrid(p: {
  habit: Pick<Habit, 'behavior_type'>;
  todayYmd: Ymd;
  createdYmd: Ymd | null;
  weeks?: number;
  cellFor: (day: Date) => CellInput;
  logStateOn: (day: Ymd) => 'done' | 'partial' | 'skip' | 'miss' | null;
  noteOn: (day: Ymd) => boolean;
  repairedDates: ReadonlySet<Ymd>;
}): YearGridModel {
  const todayDate = parseLocalDate(p.todayYmd) ?? new Date(2026, 0, 1);
  const maxWeeks = clampInt(p.weeks ?? YEAR_GRID_MAX_WEEKS, 1, YEAR_GRID_MAX_WEEKS);
  const lastWeekMonday = startOfWeekLocal(todayDate);
  const colCount = computeColumnCount(lastWeekMonday, p.createdYmd, maxWeeks);
  const firstMonday = addDaysLocal(lastWeekMonday, -7 * (colCount - 1));

  const summary: YearGridSummary = {
    done: 0,
    partial: 0,
    skip: 0,
    repaired: 0,
    missed: 0,
  };

  const columns: YearGridColumn[] = [];

  for (let c = 0; c < colCount; c++) {
    const colMonday = addDaysLocal(firstMonday, c * 7);
    const colDates: Date[] = [];
    const cells: YearCell[] = [];

    for (let r = 0; r < YEAR_GRID_ROWS; r++) {
      const d = addDaysLocal(colMonday, r);
      const dayYmd = ymd(d);
      const parsedDay = parseLocalDate(dayYmd) ?? d;
      colDates.push(parsedDay);

      let state: YearCellState;
      let value: number | null = null;

      if (dayYmd > p.todayYmd) {
        state = 'future';
      } else {
        const ci = p.cellFor(parsedDay);
        value = ci.value;
        if (ci.state === 'future') {
          state = 'future';
        } else if (ci.state === 'full') {
          state = 'done';
        } else if (ci.state === 'partial') {
          state = 'partial';
        } else if (ci.state === 'skip') {
          state = 'skip';
        } else if (ci.state === 'not_scheduled') {
          state = 'not_scheduled';
        } else {
          // ci.state === 'miss'
          const explicitState = p.logStateOn(dayYmd);
          if (explicitState === 'miss') {
            state = 'missed';
          } else if (dayYmd === p.todayYmd) {
            state = 'pending';
          } else if (p.habit.behavior_type === 'negative') {
            state = 'unknown';
          } else {
            state = 'missed';
          }
        }

        if (state === 'missed' && p.repairedDates.has(dayYmd)) {
          state = 'repaired';
        }
      }

      if (state !== 'future') {
        if (state === 'done') summary.done += 1;
        else if (state === 'partial') summary.partial += 1;
        else if (state === 'skip') summary.skip += 1;
        else if (state === 'repaired') summary.repaired += 1;
        else if (state === 'missed') summary.missed += 1;
      }

      cells.push({
        date: dayYmd,
        state,
        value,
        hasNote: state === 'future' ? false : Boolean(p.noteOn(dayYmd)),
      });
    }

    columns.push({
      weekStart: ymd(colMonday),
      monthLabel: resolveMonthLabel(colDates, c),
      cells,
    });
  }

  return {
    columns,
    summary,
    firstDay: columns[0]?.cells[0]?.date ?? p.todayYmd,
    lastDay: p.todayYmd,
  };
}

export function buildAggregateYearGrid(p: {
  rows: readonly AggregateRow[];
  todayYmd: Ymd;
  capacity: number;
  weeks?: number;
}): AggregateGridModel {
  const todayDate = parseLocalDate(p.todayYmd) ?? new Date(2026, 0, 1);
  const weekCount = clampInt(p.weeks ?? YEAR_GRID_MAX_WEEKS, 1, YEAR_GRID_MAX_WEEKS);
  const lastWeekMonday = startOfWeekLocal(todayDate);
  const firstMonday = addDaysLocal(lastWeekMonday, -7 * (weekCount - 1));
  const firstDayYmd = ymd(firstMonday);

  const byDay = new Map<Ymd, { done: number; partial: number }>();
  for (const row of p.rows) {
    if (row.state !== 'done' && row.state !== 'partial') continue;
    const key = typeof row.completed_at === 'string' ? row.completed_at.slice(0, 10) : '';
    if (!key || key < firstDayYmd || key > p.todayYmd) continue;
    if (!parseLocalDate(key)) continue;
    const cur = byDay.get(key) ?? { done: 0, partial: 0 };
    if (row.state === 'done') cur.done += 1;
    else cur.partial += 1;
    byDay.set(key, cur);
  }

  let maxCredit = 0;
  let peak = 0;
  let totalCompletions = 0;
  let activeDays = 0;

  for (const [, counts] of byDay) {
    const countTotal = counts.done + counts.partial;
    const credit = counts.done + counts.partial * 0.5;
    if (countTotal > 0) {
      activeDays += 1;
      totalCompletions += countTotal;
      if (countTotal > peak) peak = countTotal;
      if (credit > maxCredit) maxCredit = credit;
    }
  }

  const columns: AggregateGridModel['columns'] = [];
  for (let c = 0; c < weekCount; c++) {
    const colMonday = addDaysLocal(firstMonday, c * 7);
    const colDates: Date[] = [];
    const cells: AggregateCell[] = [];

    for (let r = 0; r < YEAR_GRID_ROWS; r++) {
      const d = addDaysLocal(colMonday, r);
      const dayYmd = ymd(d);
      const parsedDay = parseLocalDate(dayYmd) ?? d;
      colDates.push(parsedDay);

      const future = dayYmd > p.todayYmd;
      const counts = future ? undefined : byDay.get(dayYmd);
      const done = counts?.done ?? 0;
      const partial = counts?.partial ?? 0;
      const credit = done + partial * 0.5;

      let level: 0 | 1 | 2 | 3 | 4 = 0;
      if (!future && credit > 0) {
        const denom = p.capacity > 0 ? p.capacity : maxCredit;
        const ratio = denom > 0 ? Math.min(1, credit / denom) : 1;
        if (ratio < 0.34) level = 1;
        else if (ratio < 0.67) level = 2;
        else if (ratio < 1) level = 3;
        else level = 4;
      }

      cells.push({ date: dayYmd, done, partial, level, future });
    }

    columns.push({
      weekStart: ymd(colMonday),
      monthLabel: resolveMonthLabel(colDates, c),
      cells,
    });
  }

  return { columns, totalCompletions, activeDays, peak };
}

export function yearGridSummaryText(m: YearGridModel): string {
  const weeks = m.columns.length;
  const parts: string[] = [];
  if (m.summary.done > 0) parts.push(`${m.summary.done} gün tam`);
  if (m.summary.partial > 0) parts.push(`${m.summary.partial} gün kısmi`);
  if (m.summary.skip > 0) parts.push(`${m.summary.skip} bilinçli atlama`);
  if (m.summary.repaired > 0) parts.push(`${m.summary.repaired} onarılmış gün`);

  if (parts.length === 0) {
    return `Son ${weeks} haftada henüz kayıtlı tamamlama yok.`;
  }
  return `Son ${weeks} haftada ${parts.join(', ')}.`;
}

export function aggregateSummaryText(m: AggregateGridModel): string {
  const weeks = m.columns.length;
  if (m.totalCompletions === 0) {
    return `Son ${weeks} haftada henüz kayıtlı tamamlama yok.`;
  }
  return `Son ${weeks} haftada ${m.totalCompletions} tamamlama, ${m.activeDays} aktif gün.`;
}

export function formatDayLongTR(day: Ymd): string {
  const d = parseLocalDate(day);
  if (!d) return day;
  const dow = (d.getDay() + 6) % 7;
  return `${d.getDate()} ${MONTH_LONG_TR[d.getMonth()]} ${WEEKDAY_LONG_TR[dow]}`;
}

export function formatDayWithYearTR(day: Ymd): string {
  const d = parseLocalDate(day);
  if (!d) return day;
  const dow = (d.getDay() + 6) % 7;
  return `${d.getDate()} ${MONTH_LONG_TR[d.getMonth()]} ${d.getFullYear()} ${WEEKDAY_LONG_TR[dow]}`;
}

export function formatDayShortTR(day: Ymd): string {
  const d = parseLocalDate(day);
  if (!d) return day;
  const dow = (d.getDay() + 6) % 7;
  return `${WEEKDAY_SHORT_TR[dow]} ${d.getDate()} ${MONTH_LONG_TR[d.getMonth()]}`;
}

export function yearGridDayLabel(c: YearCell): string {
  return `${formatDayLongTR(c.date)}: ${YEAR_CELL_STATE_LABEL[c.state]}`;
}

export function gridContentWidth(columns: number): number {
  if (columns <= 0) return 0;
  return columns * YEAR_GRID_CELL + (columns - 1) * YEAR_GRID_GAP;
}

export function cellAtPoint(
  x: number,
  y: number,
  columns: number,
): { column: number; row: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || columns <= 0) return null;
  const pitch = YEAR_GRID_CELL + YEAR_GRID_GAP;
  const totalW = gridContentWidth(columns);
  const totalH = YEAR_GRID_ROWS * YEAR_GRID_CELL + (YEAR_GRID_ROWS - 1) * YEAR_GRID_GAP;
  if (x < 0 || y < 0 || x >= totalW || y >= totalH) return null;

  const column = Math.floor(x / pitch);
  const row = Math.floor(y / pitch);
  const remX = x - column * pitch;
  const remY = y - row * pitch;
  if (remX >= YEAR_GRID_CELL || remY >= YEAR_GRID_CELL) return null;
  if (column < 0 || column >= columns || row < 0 || row >= YEAR_GRID_ROWS) return null;
  return { column, row };
}

export function nextSelectableDay(
  m: YearGridModel,
  from: Ymd | null,
  dir: -1 | 1,
): Ymd | null {
  const selectable = m.columns.flatMap((col) => col.cells).filter((c) => c.state !== 'future');
  if (selectable.length === 0) return null;
  if (from === null) {
    return dir === -1 ? selectable[selectable.length - 1].date : selectable[0].date;
  }
  const idx = selectable.findIndex((c) => c.date === from);
  if (idx === -1) {
    if (dir === 1) {
      const next = selectable.find((c) => c.date > from);
      return next ? next.date : null;
    }
    for (let i = selectable.length - 1; i >= 0; i--) {
      if (selectable[i].date < from) return selectable[i].date;
    }
    return null;
  }
  const nextIdx = idx + dir;
  return nextIdx >= 0 && nextIdx < selectable.length ? selectable[nextIdx].date : null;
}
